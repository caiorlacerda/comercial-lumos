-- Tags de tarefas (estilo ClickUp): catálogo de tags coloridas + vínculo N:N
-- com as tarefas, para rastrear e filtrar.

CREATE TABLE IF NOT EXISTS public.task_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  color      text NOT NULL DEFAULT '#6b7280',
  ordem      integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.task_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_task_tags ON public.task_tags;
CREATE POLICY read_task_tags ON public.task_tags FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS manage_task_tags ON public.task_tags;
CREATE POLICY manage_task_tags ON public.task_tags FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin','producao')) WITH CHECK (public.get_user_role() IN ('admin','producao'));
GRANT ALL ON public.task_tags TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.project_task_tags (
  task_id uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  tag_id  uuid NOT NULL REFERENCES public.task_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_ptt_task ON public.project_task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_ptt_tag  ON public.project_task_tags(tag_id);
ALTER TABLE public.project_task_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_ptt ON public.project_task_tags;
CREATE POLICY read_ptt ON public.project_task_tags FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS manage_ptt ON public.project_task_tags;
CREATE POLICY manage_ptt ON public.project_task_tags FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin','producao')) WITH CHECK (public.get_user_role() IN ('admin','producao'));
GRANT ALL ON public.project_task_tags TO authenticated, service_role;

-- Seed das tags iniciais (idempotente)
INSERT INTO public.task_tags (name, color, ordem) VALUES
  ('bruto','#F5B301',10), ('captação','#2E90FA',20), ('cliente','#C7D2FE',30),
  ('edição','#12B76A',40), ('entregas','#F04438',50), ('foto','#9E77ED',60),
  ('interno','#DDD6FE',70), ('live','#F04438',80), ('orçamento','#0E9384',90),
  ('postagem','#7A5AF8',100), ('produção','#EE46BC',110), ('real time','#6172F3',120),
  ('reunião','#F5B301',130), ('roteiro','#3E7BFA',140), ('video','#F97316',150)
ON CONFLICT (name) DO NOTHING;
