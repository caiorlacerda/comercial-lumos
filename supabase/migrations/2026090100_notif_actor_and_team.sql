-- Notificações Fase 2 (parte B): preenche o ATOR nos triggers e transforma
-- "Projeto encerrado" num MARCO do time (todo mundo vê, scope='team').
-- Os campos actor_id/scope já existem (migration anterior). Additivo: só
-- reescreve as funções de trigger (mesma assinatura), nada quebra.

-- 1) Tarefa atribuída → grava quem atribuiu como ator.
CREATE OR REPLACE FUNCTION public.handle_task_assignment_notification()
RETURNS trigger AS $$
DECLARE
  active_user_id UUID;
BEGIN
  IF NEW.responsavel_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.responsavel_id IS NULL OR OLD.responsavel_id != NEW.responsavel_id) THEN
    BEGIN
      active_user_id := (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'ativo');
      IF active_user_id IS NULL OR active_user_id != NEW.responsavel_id THEN
        INSERT INTO public.notifications (user_id, event_type, category, priority, title, body, link, data, actor_id)
        VALUES (
          NEW.responsavel_id, 'todo_atribuido', 'producao', 'normal',
          'Nova tarefa atribuída a você',
          'Você foi definido como responsável pela tarefa "' || NEW.titulo || '".',
          '/producao/projetos?projectId=' || COALESCE(NEW.project_id::text, '') || '&taskId=' || COALESCE(NEW.id::text, ''),
          jsonb_build_object('task_id', NEW.id, 'project_id', NEW.project_id),
          active_user_id
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error creating task assignment notification for task %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2) Comentário na tarefa → grava o autor do comentário como ator.
CREATE OR REPLACE FUNCTION public.handle_task_comment_notification()
RETURNS trigger AS $$
DECLARE
  task_resp_id UUID;
  task_resp_name TEXT;
  task_title TEXT;
  project_id_ref UUID;
  comment_author_name TEXT;
BEGIN
  BEGIN
    SELECT responsavel_id, titulo, project_id
      INTO task_resp_id, task_title, project_id_ref
      FROM public.project_tasks WHERE id = NEW.task_id;

    IF task_resp_id IS NOT NULL AND task_resp_id != NEW.user_id THEN
      SELECT full_name INTO task_resp_name FROM public.app_users WHERE id = task_resp_id;
      IF NEW.content LIKE '%@' || COALESCE(task_resp_name, '') || '%' THEN
        RETURN NEW;
      END IF;
      SELECT full_name INTO comment_author_name FROM public.app_users WHERE id = NEW.user_id;

      INSERT INTO public.notifications (user_id, event_type, category, priority, title, body, link, data, actor_id)
      VALUES (
        task_resp_id, 'comentario_tarefa', 'producao', 'normal',
        'Novo comentário na sua tarefa',
        comment_author_name || ' comentou na sua tarefa "' || task_title || '": "' ||
          CASE WHEN length(NEW.content) > 60 THEN substring(NEW.content, 1, 60) || '...' ELSE NEW.content END || '"',
        '/producao/projetos?projectId=' || COALESCE(project_id_ref::text, '') || '&taskId=' || COALESCE(NEW.task_id::text, ''),
        jsonb_build_object('comment_id', NEW.id, 'task_id', NEW.task_id, 'project_id', project_id_ref),
        NEW.user_id
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Error creating task comment notification for comment %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3) Projeto encerrado → MARCO do time: notifica TODO MUNDO (scope='team'),
--    com o ator = quem encerrou. (Antes era só pros responsáveis de tarefas.)
CREATE OR REPLACE FUNCTION public.handle_project_closed_notification()
RETURNS trigger AS $$
DECLARE
  active_user_id UUID;
  u_record RECORD;
BEGIN
  IF OLD.status != 'concluido' AND NEW.status = 'concluido' THEN
    BEGIN
      active_user_id := (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'ativo');

      FOR u_record IN
        SELECT id FROM public.app_users
        WHERE status = 'ativo'
          AND id != COALESCE(active_user_id, '00000000-0000-0000-0000-000000000000')
      LOOP
        INSERT INTO public.notifications (user_id, event_type, category, priority, title, body, link, data, actor_id, scope)
        VALUES (
          u_record.id, 'projeto_encerrado', 'producao', 'normal',
          'Projeto encerrado',
          'O projeto "' || NEW.name || '" foi concluído e encerrado.',
          '/producao/projetos?projectId=' || COALESCE(NEW.id::text, ''),
          jsonb_build_object('project_id', NEW.id),
          active_user_id, 'team'
        );
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error creating project closed notifications for project %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
