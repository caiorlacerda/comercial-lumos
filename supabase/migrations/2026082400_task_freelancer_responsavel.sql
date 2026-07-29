-- Responsável freelancer numa tarefa: além do responsável interno
-- (responsavel_id → app_users), uma tarefa pode ter um freelancer/parceiro
-- externo como responsável, que vem da tabela de fornecedores.
-- Regra de uso no app: a tarefa tem OU responsavel_id (interno) OU
-- responsavel_freela_id (freelancer), nunca os dois ao mesmo tempo.
-- ON DELETE SET NULL: apagar o fornecedor não trava nem apaga a tarefa.
ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS responsavel_freela_id uuid
  REFERENCES public.fornecedores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_tasks_responsavel_freela
  ON public.project_tasks(responsavel_freela_id);

-- Atualiza o log de atividade para registrar também a atribuição a freelancer.
-- Antes só olhava responsavel_id (interno); agora considera os dois campos e
-- resolve o nome do responsável na app_users OU na fornecedores.
CREATE OR REPLACE FUNCTION public.log_task_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a_id uuid; a_name text; old_resp text; new_resp text;
BEGIN
  SELECT id, full_name INTO a_id, a_name
    FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1;

  IF tg_op = 'INSERT' THEN
    INSERT INTO public.task_activity(task_id, actor_id, actor_name, action, new_value)
    VALUES (new.id, a_id, a_name, 'created', new.titulo);
    RETURN new;
  END IF;

  IF new.status IS DISTINCT FROM old.status THEN
    INSERT INTO public.task_activity(task_id, actor_id, actor_name, action, old_value, new_value)
    VALUES (new.id, a_id, a_name, 'status', old.status, new.status);
  END IF;

  IF new.prioridade IS DISTINCT FROM old.prioridade THEN
    INSERT INTO public.task_activity(task_id, actor_id, actor_name, action, old_value, new_value)
    VALUES (new.id, a_id, a_name, 'prioridade', old.prioridade, new.prioridade);
  END IF;

  IF new.titulo IS DISTINCT FROM old.titulo THEN
    INSERT INTO public.task_activity(task_id, actor_id, actor_name, action, old_value, new_value)
    VALUES (new.id, a_id, a_name, 'titulo', old.titulo, new.titulo);
  END IF;

  IF new.data_fim IS DISTINCT FROM old.data_fim THEN
    INSERT INTO public.task_activity(task_id, actor_id, actor_name, action, old_value, new_value)
    VALUES (new.id, a_id, a_name, 'prazo', old.data_fim::text, new.data_fim::text);
  END IF;

  IF new.data_inicio IS DISTINCT FROM old.data_inicio THEN
    INSERT INTO public.task_activity(task_id, actor_id, actor_name, action, old_value, new_value)
    VALUES (new.id, a_id, a_name, 'data_inicio', old.data_inicio::text, new.data_inicio::text);
  END IF;

  -- Responsável: interno (app_users) OU freelancer (fornecedores).
  IF (new.responsavel_id IS DISTINCT FROM old.responsavel_id)
     OR (new.responsavel_freela_id IS DISTINCT FROM old.responsavel_freela_id) THEN
    IF old.responsavel_id IS NOT NULL THEN
      SELECT full_name INTO old_resp FROM public.app_users WHERE id = old.responsavel_id;
    ELSIF old.responsavel_freela_id IS NOT NULL THEN
      SELECT nome INTO old_resp FROM public.fornecedores WHERE id = old.responsavel_freela_id;
    END IF;
    IF new.responsavel_id IS NOT NULL THEN
      SELECT full_name INTO new_resp FROM public.app_users WHERE id = new.responsavel_id;
    ELSIF new.responsavel_freela_id IS NOT NULL THEN
      SELECT nome INTO new_resp FROM public.fornecedores WHERE id = new.responsavel_freela_id;
    END IF;
    INSERT INTO public.task_activity(task_id, actor_id, actor_name, action, old_value, new_value)
    VALUES (new.id, a_id, a_name, 'responsavel', old_resp, new_resp);
  END IF;

  -- Descrição: registra que houve edição, sem guardar o HTML inteiro.
  IF new.descricao IS DISTINCT FROM old.descricao THEN
    INSERT INTO public.task_activity(task_id, actor_id, actor_name, action)
    VALUES (new.id, a_id, a_name, 'descricao');
  END IF;

  RETURN new;
END $$;
