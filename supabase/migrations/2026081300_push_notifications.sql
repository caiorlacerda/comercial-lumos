-- Notificações push (Web Push) — Fase 2 do plano mobile.
-- Cria a tabela de aparelhos inscritos, a preferência por-usuário e o trigger
-- que dispara o envio (edge function send-push) sempre que uma notificação é
-- criada. Como TODA notificação (trigger de banco OU notify() do cliente) vira
-- uma linha em public.notifications, este trigger cobre todos os eventos.
--
-- ⚠️ ANTES DE RODAR: na linha do header 'x-push-secret' abaixo, troque
--    <SEGREDO> pelo MESMO valor do secret PUSH_WEBHOOK_SECRET da edge function
--    send-push (ex.: saída de `openssl rand -hex 24`).

CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1) Aparelhos inscritos ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Cada usuário gerencia só os próprios aparelhos. A edge function usa a
-- service_role (ignora RLS) para ler todos ao enviar.
DROP POLICY IF EXISTS "own push subs select" ON public.push_subscriptions;
CREATE POLICY "own push subs select" ON public.push_subscriptions FOR SELECT
  USING (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "own push subs insert" ON public.push_subscriptions;
CREATE POLICY "own push subs insert" ON public.push_subscriptions FOR INSERT
  WITH CHECK (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "own push subs update" ON public.push_subscriptions;
CREATE POLICY "own push subs update" ON public.push_subscriptions FOR UPDATE
  USING (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "own push subs delete" ON public.push_subscriptions;
CREATE POLICY "own push subs delete" ON public.push_subscriptions FOR DELETE
  USING (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

-- 2) Preferência de push por evento (espelha in_app) ------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push boolean NOT NULL DEFAULT true;

-- 3) Trigger: ao criar uma notificação, dispara o envio do push ------------
CREATE OR REPLACE FUNCTION public.notify_push_on_notification()
RETURNS trigger AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/send-push',
    body := jsonb_build_object('notification_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', '<SEGREDO>'
    ),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloqueia a criação da notificação in-app se o push falhar.
  RAISE WARNING 'send-push webhook falhou: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_push ON public.notifications;
CREATE TRIGGER trg_notify_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_notification();
