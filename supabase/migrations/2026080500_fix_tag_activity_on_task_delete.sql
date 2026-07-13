-- Corrige exclusão de tarefa que tem tag.
--
-- O trigger AFTER DELETE em project_task_tags (log_task_tag_activity) registra
-- "tag removida" inserindo em task_activity com o task_id. Ao EXCLUIR a tarefa,
-- o cascade apaga as tags dela e dispara esse trigger — que tenta inserir em
-- task_activity apontando para a tarefa que está sendo excluída no mesmo comando.
-- Isso viola a FK task_activity.task_id -> project_tasks(id) e cancela o DELETE
-- inteiro ("Erro ao excluir tarefa").
--
-- Fix: no ramo de DELETE, só registra a remoção da tag se a TAREFA ainda existe
-- (ou seja, foi a tag que saiu, não a tarefa inteira). Quando a tarefa está
-- sendo excluída, não há o que logar (o histórico some junto, em cascata).

CREATE OR REPLACE FUNCTION public.log_task_tag_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a_id uuid; a_name text; tname text;
BEGIN
  SELECT id, full_name INTO a_id, a_name
    FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1;

  IF tg_op = 'INSERT' THEN
    SELECT name INTO tname FROM public.task_tags WHERE id = new.tag_id;
    INSERT INTO public.task_activity(task_id, actor_id, actor_name, action, new_value)
    VALUES (new.task_id, a_id, a_name, 'tag_added', tname);
    RETURN new;
  ELSE
    -- Só loga se a tarefa continua existindo (tag removida da tarefa). Se a
    -- própria tarefa está sendo excluída, não insere (evita violar a FK e
    -- travar o DELETE em cascata).
    IF EXISTS (SELECT 1 FROM public.project_tasks WHERE id = old.task_id) THEN
      SELECT name INTO tname FROM public.task_tags WHERE id = old.tag_id;
      INSERT INTO public.task_activity(task_id, actor_id, actor_name, action, old_value)
      VALUES (old.task_id, a_id, a_name, 'tag_removed', tname);
    END IF;
    RETURN old;
  END IF;
END $$;
