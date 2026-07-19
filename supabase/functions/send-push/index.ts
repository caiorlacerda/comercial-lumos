// Envio de notificações push (Web Push) — Fase 2 do plano mobile.
//
// Disparada pelo trigger trg_notify_push (pg_net) a cada INSERT em
// public.notifications. Recebe { notification_id }, carrega a notificação,
// respeita a preferência de push do usuário e envia para todos os aparelhos
// inscritos em push_subscriptions. Remove inscrições mortas (404/410).
//
// Secrets necessários: PUSH_WEBHOOK_SECRET (mesmo valor do header x-push-secret
// no trigger), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.
// Deploy com --no-verify-jwt (a autenticação é o header x-push-secret).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PUSH_WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:caio.lacerda@produtoralumos.com.br'

serve(async (req) => {
  // Autenticação por segredo compartilhado (mesmo padrão do drive-provision).
  if (req.headers.get('x-push-secret') !== PUSH_WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }

  let notification_id: string | undefined
  try {
    ({ notification_id } = await req.json())
  } catch {
    return new Response('bad request', { status: 400 })
  }
  if (!notification_id) return new Response('missing notification_id', { status: 400 })

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // 1) Carrega a notificação criada.
  const { data: n } = await supa
    .from('notifications')
    .select('id, user_id, event_type, title, body, link')
    .eq('id', notification_id)
    .single()
  if (!n) return new Response('notification not found', { status: 200 })

  // 2) Respeita a preferência de push do usuário para esse evento.
  const { data: pref } = await supa
    .from('notification_preferences')
    .select('push')
    .eq('user_id', n.user_id)
    .eq('event_type', n.event_type)
    .maybeSingle()
  if (pref && pref.push === false) return new Response('push disabled for event', { status: 200 })

  // 3) Aparelhos inscritos do usuário.
  const { data: subs } = await supa
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', n.user_id)
  if (!subs || subs.length === 0) return new Response('no subscriptions', { status: 200 })

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  const payload = JSON.stringify({
    title: n.title,
    body: n.body ?? '',
    link: n.link ?? '/',
    tag: n.event_type,
  })

  const results = await Promise.allSettled(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode
      // Inscrição expirada/removida: limpa do banco.
      if (code === 404 || code === 410) {
        await supa.from('push_subscriptions').delete().eq('id', s.id)
      }
      throw err
    }
  }))

  const sent = results.filter(r => r.status === 'fulfilled').length
  return new Response(JSON.stringify({ sent, total: subs.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
