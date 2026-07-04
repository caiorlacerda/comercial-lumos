-- Migration: Create Notifications Table, RLS Policies, Indexes and Enable Supabase Realtime
-- Date: 2026-07-04
-- Author: Antigravity

-- 1. Create Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  type            varchar(50) NOT NULL CHECK (type IN ('mencao', 'projeto_encerrado', 'tarefa_atribuida', 'prazo_alerta', 'orcamento_aprovado', 'comentario_tarefa')),
  title           text NOT NULL,
  message         text NOT NULL,
  read            boolean NOT NULL DEFAULT false,
  reference_table varchar(100),
  reference_id    uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. Create performance indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id) WHERE (read = false);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- 3. Register updated_at trigger for notifications
DROP TRIGGER IF EXISTS update_notifications_updated_at ON public.notifications;
CREATE TRIGGER update_notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS Policies
-- Users can only read their own notifications
CREATE POLICY select_own_notifications ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

-- Users can only update their own notifications (e.g. mark as read)
CREATE POLICY update_own_notifications ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()))
  WITH CHECK (user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

-- Users can delete their own notifications (or admin)
CREATE POLICY delete_own_notifications ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()) OR public.get_user_role() = 'admin');

-- System or authenticated users can insert notifications (e.g., when trigger or API is executed)
CREATE POLICY insert_notifications ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- 6. Safely enable Supabase Realtime for the table in publication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_rel pr 
      JOIN pg_class c ON pr.prrelid = c.oid 
      JOIN pg_namespace n ON c.relnamespace = n.oid 
      WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
      AND c.relname = 'notifications' 
      AND n.nspname = 'public'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
  END IF;
END $$;
