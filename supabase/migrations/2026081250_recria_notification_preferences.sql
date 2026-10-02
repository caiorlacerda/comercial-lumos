-- notification_preferences nunca teve uma migration própria de CREATE TABLE —
-- só 2026081300_push_notifications.sql, que faz ALTER TABLE assumindo que ela
-- já existe (foi criada direto no Studio em algum momento, fora do controle
-- de versão). Isso impedia recriar o banco do zero com `supabase start`
-- (descoberto só agora, na primeira vez que alguém tentou).
--
-- Reconstruída por inferência do uso real no código (nenhuma introspecção
-- direta da produção foi possível nesta sessão):
--   - src/pages/ConfiguracoesNotificacoes.tsx: lê/grava (user_id, event_type,
--     in_app) via upsert() SEM onConflict explícito — ou seja, o Postgres
--     resolve o conflito pela própria chave primária, que por isso precisa
--     ser (user_id, event_type) composta, sem id separado.
--   - src/hooks/useNotifications.tsx: lê (event_type, in_app).
--   - supabase/functions/send-push: lê (push) filtrando por (user_id, event_type).
--   - RLS e FK seguem o padrão de push_subscriptions (mesma tabela irmã,
--     criada na mesma migration 2026081300): auth_user_id -> app_users.id,
--     não auth.users.id direto (diferente de dashboard_preferences, que é
--     mais antiga e usa auth.uid() = user_id sem indireção por app_users).
--
-- Vale conferir contra a produção antes de confiar cegamente nisso.
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id    uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  in_app     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_type)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own notification prefs select" ON public.notification_preferences;
CREATE POLICY "own notification prefs select" ON public.notification_preferences FOR SELECT
  USING (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "own notification prefs insert" ON public.notification_preferences;
CREATE POLICY "own notification prefs insert" ON public.notification_preferences FOR INSERT
  WITH CHECK (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "own notification prefs update" ON public.notification_preferences;
CREATE POLICY "own notification prefs update" ON public.notification_preferences FOR UPDATE
  USING (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "own notification prefs delete" ON public.notification_preferences;
CREATE POLICY "own notification prefs delete" ON public.notification_preferences FOR DELETE
  USING (user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

GRANT ALL ON public.notification_preferences TO authenticated, service_role;
