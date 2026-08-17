-- ÁREA DE PROJETOS — Status (pipeline de fases), Briefing, Diárias e vínculo
-- da Ordem do Dia com o projeto. Inspirado no benchmark, SEM tocar em nada de
-- financeiro.
--
-- 1) project_briefings: um briefing estruturado por projeto (seções em jsonb).
-- 2) project_diarias: diárias de gravação (data, duração, local) — o clima é
--    consultado no cliente (Open-Meteo), não fica no banco.
-- 3) project_stage_checks: etapas MANUAIS do pipeline marcadas à mão; as
--    automáticas são derivadas dos dados e não entram aqui.
-- 4) ordens_do_dia.project_id: liga a OD ao projeto (nullable — ordens antigas
--    seguem soltas até alguém vincular).

CREATE TABLE IF NOT EXISTS public.project_briefings (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  sections   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_diarias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  data          date,
  duracao_horas numeric(4,1) NOT NULL DEFAULT 10,
  local         text,
  descricao     text,
  ordem         int NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_diarias_project ON public.project_diarias(project_id);

CREATE TABLE IF NOT EXISTS public.project_stage_checks (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage_key  text NOT NULL,
  done_by    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  done_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, stage_key)
);

ALTER TABLE public.ordens_do_dia
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ordens_project ON public.ordens_do_dia(project_id);

-- RLS: mesmo padrão do resto da produção — todo usuário logado lê e escreve.
ALTER TABLE public.project_briefings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_diarias      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_stage_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS briefings_all ON public.project_briefings;
CREATE POLICY briefings_all ON public.project_briefings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS diarias_all ON public.project_diarias;
CREATE POLICY diarias_all ON public.project_diarias
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS stage_checks_all ON public.project_stage_checks;
CREATE POLICY stage_checks_all ON public.project_stage_checks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.project_briefings, public.project_diarias, public.project_stage_checks TO authenticated;
