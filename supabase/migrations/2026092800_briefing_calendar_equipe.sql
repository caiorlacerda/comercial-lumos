-- ÁREA DE PROJETOS, ajustes da rodada de feedback:
-- 1) project_members: equipe do projeto cadastrada à mão (time interno OU
--    fornecedor), além da derivada das tarefas.
-- 2) project_diarias.google_event_id: a diária vira evento no Google Calendar
--    da produção; guardamos o id pra atualizar/apagar junto.

CREATE TABLE IF NOT EXISTS public.project_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES public.app_users(id) ON DELETE CASCADE,
  freela_id  uuid REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  funcao     text,
  added_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- exatamente UM dos dois: ou gente do time, ou fornecedor
  CHECK ((user_id IS NULL) <> (freela_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON public.project_members(project_id);
-- sem duplicar a mesma pessoa no mesmo projeto
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_members_user
  ON public.project_members(project_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_members_freela
  ON public.project_members(project_id, freela_id) WHERE freela_id IS NOT NULL;

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_members_all ON public.project_members;
CREATE POLICY project_members_all ON public.project_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.project_members TO authenticated;

ALTER TABLE public.project_diarias
  ADD COLUMN IF NOT EXISTS google_event_id text;
