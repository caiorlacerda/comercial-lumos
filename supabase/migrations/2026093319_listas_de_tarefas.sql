-- LISTAS DE TAREFAS DENTRO DO PROJETO
--
-- Tem cliente que a Lumos atende por mês (Uniasselvi, Vitru Educação). Hoje o
-- jeito de separar agosto de setembro é abrir um PROJETO novo por mês — e aí o
-- que é do cliente se parte em pedaços: entregas, financeiro e histórico ficam
-- espalhados por projetos diferentes, e ninguém consegue olhar o cliente inteiro.
--
-- Agora o projeto continua um só e as tarefas se organizam em listas nomeadas
-- ("Agosto", "Setembro", mas também "Institucional" ou "Fase 2"). A lista vira
-- uma aba dentro de Tarefas.
--
-- Por que lista nomeada, e não mês deduzido da data: a data de uma tarefa muda
-- (prazo escorrega, entrega atrasa). Se a aba viesse da data, a tarefa mudaria
-- de mês sozinha, sem ninguém ter mandado — e "onde foi parar a tarefa" é
-- exatamente o tipo de dúvida que a separação deveria acabar. Aqui quem decide
-- é a pessoa.
--
-- list_id é OPCIONAL: projeto que não usa lista continua exatamente como está,
-- e tarefa sem lista aparece em "Sem lista". Apagar uma lista NÃO apaga tarefa
-- (ON DELETE SET NULL): elas voltam pra "Sem lista", que é o comportamento
-- seguro — lista é organização, não é dono do trabalho.

CREATE TABLE IF NOT EXISTS public.project_task_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  ordem       integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_lists_project ON public.project_task_lists(project_id, ordem);

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS list_id uuid REFERENCES public.project_task_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_tasks_list ON public.project_tasks(list_id);

DROP TRIGGER IF EXISTS update_project_task_lists_updated_at ON public.project_task_lists;
CREATE TRIGGER update_project_task_lists_updated_at
  BEFORE UPDATE ON public.project_task_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Mesmas regras das tarefas: todo mundo da equipe lê, admin e produção mexem.
ALTER TABLE public.project_task_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_task_lists ON public.project_task_lists;
CREATE POLICY select_task_lists ON public.project_task_lists
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS manage_task_lists ON public.project_task_lists;
CREATE POLICY manage_task_lists ON public.project_task_lists
  FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'producao'));

GRANT ALL ON public.project_task_lists TO authenticated, service_role;

-- Conferência: deve devolver a tabela nova e a coluna nova.
SELECT to_regclass('public.project_task_lists') AS tabela;
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'project_tasks' AND column_name = 'list_id';
