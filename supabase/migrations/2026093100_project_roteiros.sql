-- ROTEIROS DO PROJETO — aba própria, no formato do benchmark, do jeito Lumos:
-- cada roteiro é um link do Google Docs com nome e status. A aba Roteiros da
-- Ordem do Dia e o modal de criação passam a beber daqui.

CREATE TABLE IF NOT EXISTS public.project_roteiros (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  url        text NOT NULL,
  status     text NOT NULL DEFAULT 'em_criacao'
             CHECK (status IN ('em_criacao', 'revisao', 'aprovado')),
  ordem      int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_roteiros_project ON public.project_roteiros(project_id);

ALTER TABLE public.project_roteiros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_roteiros_all ON public.project_roteiros;
CREATE POLICY project_roteiros_all ON public.project_roteiros
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.project_roteiros TO authenticated;
