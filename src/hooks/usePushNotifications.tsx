import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';

// Web Push no cliente: pede permissão, inscreve o aparelho no PushManager e
// salva a inscrição em push_subscriptions (uma linha por aparelho). O envio é
// feito pela edge function send-push, disparada pelo trigger em notifications.

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export type PushStatus = {
  supported: boolean;          // navegador suporta Web Push
  configured: boolean;         // VITE_VAPID_PUBLIC_KEY presente no build
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;         // este aparelho está inscrito
  busy: boolean;
};

export function usePushNotifications() {
  const { profile } = useAuth();
  const toast = useToast();
  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  const configured = !!VAPID_PUBLIC_KEY;

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Descobre se este aparelho já está inscrito e AUTO-REPARA: se o navegador
  // tem inscrição mas o banco não a registrou (salvamento anterior falhou),
  // re-salva silenciosamente ao abrir a tela.
  useEffect(() => {
    if (!supported || !profile?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (!sub) { setSubscribed(false); return; }
        const json = sub.toJSON();
        const { count } = await supabase
          .from('push_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('endpoint', json.endpoint);
        if (!count) {
          // Navegador inscrito mas banco vazio → re-salva.
          await supabase.from('push_subscriptions').upsert(
            {
              user_id: profile.id,
              endpoint: json.endpoint,
              p256dh: json.keys?.p256dh,
              auth: json.keys?.auth,
              user_agent: navigator.userAgent,
              last_used_at: new Date().toISOString(),
            },
            { onConflict: 'endpoint' }
          );
        }
        if (!cancelled) setSubscribed(true);
      } catch {
        /* noop */
      }
    })();
    return () => { cancelled = true; };
  }, [supported, profile?.id]);

  const subscribe = useCallback(async () => {
    if (!supported || !configured || !profile?.id) return false;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        toast.error('Permissão de notificação negada neste aparelho.');
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY as string) as BufferSource,
        });
      }

      const json = sub.toJSON();
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: profile.id,
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
          user_agent: navigator.userAgent,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      );
      if (error) throw error;

      setSubscribed(true);
      toast.success('Notificações ativadas neste aparelho!');
      return true;
    } catch (err: any) {
      console.error('push subscribe failed', err);
      // Mostra o motivo real na tela (no celular não dá pra ver o console).
      toast.error(`Falha ao ativar: ${err?.message || err?.error_description || 'erro desconhecido'}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, configured, profile?.id]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      console.error('push unsubscribe failed', err);
    } finally {
      setBusy(false);
    }
  }, [supported]);

  const status: PushStatus = {
    supported,
    configured,
    permission: supported ? permission : 'unsupported',
    subscribed,
    busy,
  };

  return { status, subscribe, unsubscribe };
}
