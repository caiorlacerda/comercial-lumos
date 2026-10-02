-- public.notifications — a tabela central de TODO o sistema de notificações
-- (ver seção "Notificações" do CLAUDE.md) — nunca teve uma migration própria
-- de CREATE TABLE. Foi criada direto no Studio em algum momento; as
-- migrations seguintes (triggers de banco em 2026070403, push em 2026081300)
-- sempre assumiram que ela já existia. Isso impedia recriar o banco do zero
-- com `supabase start` (descoberto só agora, na primeira vez que alguém
-- tentou).
--
-- Reconstruída por inferência do uso real no código (nenhuma introspecção
-- direta da produção foi possível nesta sessão):
--   - src/lib/notifications/notify.ts: insere (user_id, event_type, category,
--     priority, title, body, link, data, actor_id, scope).
--   - supabase/migrations/2026070403_create_notifications_triggers.sql:
--     INSERT INTO com as mesmas colunas (confirma os nomes/ordem).
--   - src/hooks/useNotifications.tsx: lê com join
--     actor:app_users!actor_id(...), ordena por created_at, marca lida via
--     update({read_at: ...}) — ou seja, "lido" é read_at IS NULL/NOT NULL,
--     não um boolean.
--
-- RLS: notify() é chamado pelo usuário que DISPARA a notificação (o "ator"),
-- não pelo dono da notificação (user_id) — por isso o INSERT libera qualquer
-- authenticated, nunca anon. Isso bate com a nota do CLAUDE.md de que
-- chamadas notify() em páginas públicas falham por RLS (ali o caminho certo
-- é trigger de banco, que roda SECURITY DEFINER e ignora RLS). SELECT/UPDATE/
-- DELETE seguem o padrão das tabelas irmãs (push_subscriptions,
-- notification_preferences): só o dono.
--
-- Vale conferir contra a produção antes de confiar cegamente nisso.
CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  category   text NOT NULL,
  priority   text NOT NULL DEFAULT 'normal',
  scope      text NOT NULL DEFAULT 'personal',
  title      text NOT NULL,
  body       text,
  link       text,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own notifications select" ON public.notifications;
CREATE POLICY "own notifications select" ON public.notifications FOR SELECT
  USING (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "own notifications update" ON public.notifications;
CREATE POLICY "own notifications update" ON public.notifications FOR UPDATE
  USING (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "own notifications delete" ON public.notifications;
CREATE POLICY "own notifications delete" ON public.notifications FOR DELETE
  USING (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "authenticated can notify" ON public.notifications;
CREATE POLICY "authenticated can notify" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT ALL ON public.notifications TO authenticated, service_role;
