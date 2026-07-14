-- Histórico das Anotações do Projeto: cada snapshot registra quem editou, quando
-- e o conteúdo naquele momento. Serve para MONITORAR as atividades recentes das
-- anotações e para RECUPERAR o conteúdo caso ele suma/seja sobrescrito.
--
-- Append-only: o cliente só insere (uma vez a cada ~2 min de edição ativa) e lê.
-- Sem UPDATE/DELETE (é um log de auditoria).

CREATE TABLE IF NOT EXISTS public.project_notes_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  notes      text,
  edited_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_notes_history_project_idx
  ON public.project_notes_history (project_id, created_at DESC);

-- RLS: mesma faixa de papéis que enxerga a produção do projeto.
ALTER TABLE public.project_notes_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_project_notes_history ON public.project_notes_history;
CREATE POLICY select_project_notes_history ON public.project_notes_history
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento', 'social_media'));

DROP POLICY IF EXISTS insert_project_notes_history ON public.project_notes_history;
CREATE POLICY insert_project_notes_history ON public.project_notes_history
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento', 'social_media'));

-- Realtime: painel de atividades atualiza ao vivo entre usuários.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_notes_history'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_notes_history;
  END IF;
END $$;
