-- TIPO DE TAREFA: o que a tarefa É (Roteiro, Edição, Motion...), separado do nome e das tags.
--
-- O time vinha escrevendo "EDIÇÃO | Nome do vídeo" no título porque a tag não aparecia fora da lista do
-- projeto e dava trabalho para colocar. O Tipo é um campo único (uma escolha só), com catálogo
-- editável, mostrado como pílula colorida em todas as telas. As tags continuam para o resto.
--
-- Quem lê: equipe. Quem cria/edita tipos do catálogo: admin e produção (igual às tags).
-- Quem muda o tipo de uma tarefa: quem já pode editar a tarefa (regras de project_tasks, que não mudam).
-- O app funciona antes e depois deste SQL: sem ele, os campos de Tipo simplesmente não aparecem.
-- Idempotente. Desfazer:  ALTER TABLE public.project_tasks DROP COLUMN tipo_id;  DROP TABLE public.task_tipos;

CREATE TABLE IF NOT EXISTS public.task_tipos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL UNIQUE,
  cor        text NOT NULL DEFAULT '#64748b',
  ordem      integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.task_tipos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_task_tipos ON public.task_tipos;
CREATE POLICY read_task_tipos ON public.task_tipos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS manage_task_tipos ON public.task_tipos;
CREATE POLICY manage_task_tipos ON public.task_tipos FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin','producao')) WITH CHECK (public.get_user_role() IN ('admin','producao'));
-- Mesma regra restritiva das outras tabelas (ver 2026102300_somente_equipe.sql): só equipe ativa.
DROP POLICY IF EXISTS somente_equipe ON public.task_tipos;
CREATE POLICY somente_equipe ON public.task_tipos AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_team())) WITH CHECK ((SELECT public.is_team()));
GRANT ALL ON public.task_tipos TO authenticated, service_role;

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS tipo_id uuid REFERENCES public.task_tipos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_tasks_tipo ON public.project_tasks (tipo_id);

INSERT INTO public.task_tipos (nome, cor, ordem) VALUES
  ('Roteiro',  '#3b82f6', 10),
  ('Captação', '#f59e0b', 20),
  ('Edição',   '#16a34a', 30),
  ('Motion',   '#a855f7', 40),
  ('Criação',  '#ec4899', 50),
  ('Design',   '#14b8a6', 60),
  ('Foto',     '#f97316', 70),
  ('Social',   '#6366f1', 80),
  ('Reunião',  '#64748b', 90)
ON CONFLICT (nome) DO NOTHING;

-- CONFERÊNCIA (leitura): deve listar os 9 tipos e a coluna nova
SELECT t.nome, t.cor, t.ordem,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_tasks' AND column_name='tipo_id') AS coluna_tipo_id
FROM public.task_tipos t ORDER BY t.ordem;
