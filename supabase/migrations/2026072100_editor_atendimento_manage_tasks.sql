-- Editor e Atendimento passam a poder GERENCIAR tarefas (criar/editar/excluir),
-- não só visualizar. O frontend já expõe os controles (canManage inclui quem tem
-- 'ordem_do_dia'), mas a RLS só deixava admin/producao escreverem — o que gerava
-- "Erro ao adicionar tarefa." para esses cargos. Alinha as 3 policies de escrita.

-- Tarefas de projeto
DROP POLICY IF EXISTS manage_tasks ON public.project_tasks;
CREATE POLICY manage_tasks ON public.project_tasks
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento'))
  WITH CHECK (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento'));

-- Vínculo tarefa ↔ tag (atribuir/remover tags de uma tarefa)
DROP POLICY IF EXISTS manage_ptt ON public.project_task_tags;
CREATE POLICY manage_ptt ON public.project_task_tags
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento'))
  WITH CHECK (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento'));

-- Catálogo de tags (criar/renomear/excluir tag)
DROP POLICY IF EXISTS manage_task_tags ON public.task_tags;
CREATE POLICY manage_task_tags ON public.task_tags
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento'))
  WITH CHECK (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento'));
