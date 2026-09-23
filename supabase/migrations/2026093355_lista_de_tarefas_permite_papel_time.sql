-- BUG: "Não deu pra criar a lista." pra gente do time de produção.
--
-- Mesmo furo que a migration 2026091700_time_role_rls.sql já tinha corrigido
-- em outras tabelas: o front libera o botão de criar lista pela permissão
-- 'ordem_do_dia' (ROLE_DEFAULTS dá essa permissão pros papéis 'time',
-- 'atendimento', 'editor' e 'social_media' — ver src/hooks/useAuth.tsx), mas a
-- policy de project_task_lists (criada depois, em 2026093319) só liberava
-- get_user_role() IN ('admin', 'producao') — papel antigo, de antes da
-- unificação em 'time'. Resultado: o botão aparece, a pessoa clica, e o INSERT
-- é barrado pela RLS — um erro de permissão que a tela não sabe explicar,
-- porque o texto não bate com "relation/schema/does not exist" (esse aviso é
-- só pra quando falta a migration).
--
-- Fix: mesma lista de papéis que 2026091700 já usa nas outras tabelas.
DROP POLICY IF EXISTS manage_task_lists ON public.project_task_lists;
CREATE POLICY manage_task_lists ON public.project_task_lists
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin','producao','time','editor','atendimento','social_media'))
  WITH CHECK (public.get_user_role() IN ('admin','producao','time','editor','atendimento','social_media'));
