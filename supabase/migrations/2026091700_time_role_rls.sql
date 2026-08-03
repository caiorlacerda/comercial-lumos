-- Corrige a RLS depois da simplificação de papéis (atendimento/editor/social/basico
-- foram unificados em 'time'). Várias policies ainda listavam só os papéis legados,
-- então quem virou 'time' (ex.: Ariela, do atendimento) passou a ser BLOQUEADO
-- mesmo com o botão aparecendo no front — daí o "Erro ao adicionar tarefa.".

-- ─────────────────────────────────────────────────────────────────────────────
-- SEÇÃO 1 — Tarefas: TODO MUNDO logado pode criar/editar/excluir.
-- (Intenção do Caio: qualquer pessoa do time gerencia tarefas.) Como é "todo
-- mundo", usamos USING(true) — assim não quebra de novo se surgir papel novo.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS manage_tasks ON public.project_tasks;
CREATE POLICY manage_tasks ON public.project_tasks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS manage_ptt ON public.project_task_tags;
CREATE POLICY manage_ptt ON public.project_task_tags
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS manage_task_tags ON public.task_tags;
CREATE POLICY manage_task_tags ON public.task_tags
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEÇÃO 2 — Mesmo furo em 3 lugares que o papel 'time' também deveria acessar
-- (o ROLE_DEFAULTS do front dá essas permissões pra 'time', mas a RLS bloqueava):
-- histórico de notas, documentos do projeto e leitura do cofre de senhas.
-- Aqui mantemos o escopo por papel, só acrescentando 'time' à lista.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS select_project_notes_history ON public.project_notes_history;
CREATE POLICY select_project_notes_history ON public.project_notes_history
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin','producao','time','editor','atendimento','social_media'));

DROP POLICY IF EXISTS insert_project_notes_history ON public.project_notes_history;
CREATE POLICY insert_project_notes_history ON public.project_notes_history
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin','producao','time','editor','atendimento','social_media'));

DROP POLICY IF EXISTS manage_project_documents ON public.project_documents;
CREATE POLICY manage_project_documents ON public.project_documents
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin','producao','time','editor','atendimento','social_media'))
  WITH CHECK (public.get_user_role() IN ('admin','producao','time','editor','atendimento','social_media'));

DROP POLICY IF EXISTS read_access_credentials ON public.access_credentials;
CREATE POLICY read_access_credentials ON public.access_credentials
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin','producao','time','editor','atendimento','social_media'));
