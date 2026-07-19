import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';
import { ArrowLeft, RefreshCw, Trash2, CheckCircle2, BellRing, Smartphone } from 'lucide-react';
import { clsx } from 'clsx';
import { usePushNotifications } from '@/hooks/usePushNotifications';

export default function ConfiguracoesNotificacoes() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const { status: pushStatus, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications();

  // No iPhone o push só funciona com o app instalado na Tela de Início.
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);

  const userId = profile?.id;

  useEffect(() => {
    fetchPreferences();
  }, [userId]);

  async function fetchPreferences() {
    if (!userId) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('event_type, in_app')
        .eq('user_id', userId);

      if (error) throw error;

      // Build preferences state
      const prefsMap: Record<string, boolean> = {};
      
      // Initialize with catalog defaults
      Object.values(NOTIFICATION_EVENTS).forEach(ev => {
        // Skip adminOnly if current user is not admin
        if ((ev as any).adminOnly && !isAdmin) return;
        prefsMap[ev.key] = ev.defaultEnabled;
      });

      // Override with user customizations
      (data ?? []).forEach(pref => {
        prefsMap[pref.event_type] = pref.in_app;
      });

      setPreferences(prefsMap);
    } catch (err: any) {
      console.error('Error fetching preferences:', err);
      toast.error('Erro ao carregar preferências.');
    } finally {
      setLoading(false);
    }
  }

  const handleToggle = async (eventKey: string) => {
    if (!userId) return;
    const currentVal = preferences[eventKey];
    const newVal = !currentVal;

    // Optimistic UI update
    setPreferences(prev => ({ ...prev, [eventKey]: newVal }));

    try {
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: userId,
          event_type: eventKey,
          in_app: newVal,
          // Push acompanha o mesmo botão: desligou o evento, não recebe push dele.
          push: newVal
        });

      if (error) throw error;
    } catch (err: any) {
      console.error('Error updating preference:', err);
      toast.error('Erro ao salvar alteração. Tente novamente.');
      // Rollback
      setPreferences(prev => ({ ...prev, [eventKey]: currentVal }));
    }
  };

  const handleRestoreDefaults = async () => {
    if (!userId) return;
    const confirm = window.confirm('Deseja realmente restaurar as configurações padrão de fábrica para suas notificações?');
    if (!confirm) return;

    try {
      const { error } = await supabase
        .from('notification_preferences')
        .delete()
        .eq('user_id', userId);

      if (error) throw error;

      toast.success('Configurações padrão restauradas!');
      fetchPreferences();
    } catch (err: any) {
      console.error('Error restoring defaults:', err);
      toast.error('Erro ao restaurar padrões.');
    }
  };

  const handleClearOldNotifications = async () => {
    if (!userId) return;
    const confirm = window.confirm('Deseja deletar permanentemente todas as suas notificações com mais de 30 dias?');
    if (!confirm) return;

    try {
      setCleaning(true);
      const limitDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('user_id', userId)
        .lt('created_at', limitDate);

      if (error) throw error;

      toast.success('Notificações antigas limpas com sucesso!');
    } catch (err: any) {
      console.error('Error cleaning old notifications:', err);
      toast.error('Erro ao limpar notificações.');
    } finally {
      setCleaning(false);
    }
  };

  // Group events by category
  const categories = [
    { id: 'financeiro', label: 'Financeiro' },
    { id: 'producao', label: 'Produção' },
    { id: 'comercial', label: 'Comercial' },
    { id: 'sistema', label: 'Sistema' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-8 font-work-sans">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-lumos-bg rounded-full text-lumos-text-secondary transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Notificações</h1>
          <p className="text-lumos-text-secondary mt-1 font-medium">Escolha o que você quer receber no sino do sistema.</p>
        </div>
      </div>

      {/* Push neste aparelho */}
      <div className="card space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lumos bg-lumos-yellow/10 text-lumos-yellow flex-shrink-0">
            <BellRing className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black text-lumos-text-primary">Notificações push neste aparelho</h3>
            <p className="text-[13px] text-lumos-text-secondary mt-0.5">
              Receba avisos no celular mesmo com o app fechado, igual a um app instalado.
            </p>
          </div>
        </div>

        {!pushStatus.supported ? (
          <p className="text-[13px] text-lumos-text-secondary italic px-1">
            Este navegador não suporta notificações push.
          </p>
        ) : isIOS && !isStandalone ? (
          <div className="flex items-start gap-2 text-[13px] text-lumos-text-secondary bg-lumos-bg border border-lumos-border rounded-lumos p-3">
            <Smartphone className="w-4 h-4 text-lumos-yellow flex-shrink-0 mt-0.5" />
            <span>No iPhone, primeiro adicione o app à Tela de Início (botão compartilhar, Adicionar à Tela de Início). Depois abra por lá e volte aqui para ativar.</span>
          </div>
        ) : !pushStatus.configured ? (
          <p className="text-[13px] text-lumos-text-secondary italic px-1">
            Push ainda não configurado no servidor (chave VAPID pendente).
          </p>
        ) : pushStatus.permission === 'denied' ? (
          <p className="text-[13px] text-lumos-text-secondary italic px-1">
            As notificações estão bloqueadas nas configurações do navegador. Libere-as para este site e tente de novo.
          </p>
        ) : pushStatus.subscribed ? (
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-green-500">
              <CheckCircle2 className="w-4 h-4" /> Ativado neste aparelho
            </span>
            <button
              onClick={pushUnsubscribe}
              disabled={pushStatus.busy}
              className="btn-secondary text-xs h-9 px-4 disabled:opacity-50"
            >
              Desativar
            </button>
          </div>
        ) : (
          <button
            onClick={pushSubscribe}
            disabled={pushStatus.busy}
            className="btn-primary h-10 px-5 flex items-center gap-2 disabled:opacity-50"
          >
            <BellRing className="w-4 h-4" />
            {pushStatus.busy ? 'Ativando…' : 'Ativar notificações neste aparelho'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Settings Lists by Category */}
          {categories.map(category => {
            const events = Object.values(NOTIFICATION_EVENTS).filter(
              ev => ev.category === category.id && (!(ev as any).adminOnly || isAdmin)
            );

            if (events.length === 0) return null;

            return (
              <div key={category.id} className="card space-y-4">
                <h3 className="text-xs font-black text-lumos-text-secondary uppercase tracking-widest border-b border-lumos-border/50 pb-2">
                  {category.label}
                </h3>
                
                <div className="divide-y divide-lumos-border/40 space-y-3.5">
                  {events.map((ev, index) => {
                    const isEnabled = preferences[ev.key] ?? ev.defaultEnabled;
                    return (
                      <div 
                        key={ev.key} 
                        className={clsx(
                          "flex items-center justify-between gap-4",
                          index > 0 && "pt-3.5"
                        )}
                      >
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-lumos-text-primary">
                            {ev.label}
                          </p>
                          {(ev as any).adminOnly && (
                            <span className="inline-block text-[8px] font-bold uppercase tracking-wider bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded mt-1">
                              Apenas Administradores
                            </span>
                          )}
                        </div>

                        {/* Switch iOS Style */}
                        <button
                          onClick={() => handleToggle(ev.key)}
                          className={clsx(
                            "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                            isEnabled ? "bg-lumos-yellow" : "bg-lumos-border"
                          )}
                        >
                          <span
                            className={clsx(
                              "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                              isEnabled ? "translate-x-4 bg-black" : "translate-x-0"
                            )}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Maintenance Section */}
          <div className="card space-y-6">
            <h3 className="text-xs font-black text-lumos-text-secondary uppercase tracking-widest border-b border-lumos-border/50 pb-2">
              Gerenciamento de Dados
            </h3>
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={handleRestoreDefaults}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lumos border border-lumos-border text-xs font-bold text-lumos-text-primary hover:bg-lumos-bg transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Restaurar Padrões
              </button>
              
              <button
                onClick={handleClearOldNotifications}
                disabled={cleaning}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lumos bg-red-500/10 text-red-500 text-xs font-bold hover:bg-red-500/20 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                {cleaning ? 'Limpando...' : 'Limpar Antigas (>30 dias)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
