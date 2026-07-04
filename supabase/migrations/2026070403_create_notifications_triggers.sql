-- Trigger 1: handle_task_assignment_notification
-- Dispatched AFTER INSERT OR UPDATE on public.project_tasks when responsavel_id changes.
-- Creates a notification for the assigned user.
-- Avoids self-notification.
CREATE OR REPLACE FUNCTION public.handle_task_assignment_notification()
RETURNS trigger AS $$
DECLARE
  active_user_id UUID;
BEGIN
  -- Check if responsavel_id is defined and changed (or inserted)
  IF NEW.responsavel_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.responsavel_id IS NULL OR OLD.responsavel_id != NEW.responsavel_id) THEN
    BEGIN
      -- Retrieve active user from context
      active_user_id := (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'ativo');
      
      -- Avoid self-notification
      IF active_user_id IS NULL OR active_user_id != NEW.responsavel_id THEN
        INSERT INTO public.notifications (
          user_id,
          event_type,
          category,
          priority,
          title,
          body,
          link,
          data
        ) VALUES (
          NEW.responsavel_id,
          'todo_atribuido',
          'producao',
          'normal',
          'Nova tarefa atribuída a você',
          'Você foi definido como responsável pela tarefa "' || NEW.titulo || '".',
          '/producao/projetos?projectId=' || COALESCE(NEW.project_id::text, '') || '&taskId=' || COALESCE(NEW.id::text, ''),
          jsonb_build_object(
            'task_id', NEW.id,
            'project_id', NEW.project_id
          )
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Error isolation
      RAISE WARNING 'Error creating task assignment notification for task %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_task_assignment_notification ON public.project_tasks;
CREATE TRIGGER trg_task_assignment_notification
  AFTER INSERT OR UPDATE ON public.project_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_task_assignment_notification();


-- Trigger 2: handle_task_comment_notification
-- Dispatched AFTER INSERT on public.task_comments.
-- Creates a notification for the task assignee, avoiding duplicates if mentioned.
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
    -- 1. Fetch task details
    SELECT responsavel_id, titulo, project_id
    INTO task_resp_id, task_title, project_id_ref
    FROM public.project_tasks
    WHERE id = NEW.task_id;

    -- 2. If there is a responsible user and it's not the comment author
    IF task_resp_id IS NOT NULL AND task_resp_id != NEW.user_id THEN
      -- Fetch responsible user's name
      SELECT full_name INTO task_resp_name FROM public.app_users WHERE id = task_resp_id;
      
      -- Avoid duplicate notification if the comment text mentions the responsible user's name
      IF NEW.content LIKE '%@' || COALESCE(task_resp_name, '') || '%' THEN
        RETURN NEW;
      END IF;

      -- Fetch comment author's name
      SELECT full_name INTO comment_author_name FROM public.app_users WHERE id = NEW.user_id;

      -- Insert comment notification
      INSERT INTO public.notifications (
        user_id,
        event_type,
        category,
        priority,
        title,
        body,
        link,
        data
      ) VALUES (
        task_resp_id,
        'comentario_tarefa',
        'producao',
        'normal',
        'Novo comentário na sua tarefa',
        comment_author_name || ' comentou na sua tarefa "' || task_title || '": "' || 
          CASE 
            WHEN length(NEW.content) > 60 THEN substring(NEW.content, 1, 60) || '...'
            ELSE NEW.content
          END || '"',
        '/producao/projetos?projectId=' || COALESCE(project_id_ref::text, '') || '&taskId=' || COALESCE(NEW.task_id::text, ''),
        jsonb_build_object(
          'comment_id', NEW.id,
          'task_id', NEW.task_id,
          'project_id', project_id_ref
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Error isolation
    RAISE WARNING 'Error creating task comment notification for comment %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_task_comment_notification ON public.task_comments;
CREATE TRIGGER trg_task_comment_notification
  AFTER INSERT ON public.task_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_task_comment_notification();


-- Trigger 3: handle_project_closed_notification
-- Dispatched AFTER UPDATE on public.projects.
-- Creates notifications for responsible users of active tasks when project is closed.
CREATE OR REPLACE FUNCTION public.handle_project_closed_notification()
RETURNS trigger AS $$
DECLARE
  active_user_id UUID;
  task_resp_record RECORD;
BEGIN
  -- Trigger condition: transition to 'concluido'
  IF OLD.status != 'concluido' AND NEW.status = 'concluido' THEN
    BEGIN
      -- Retrieve active user from context
      active_user_id := (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'ativo');

      -- Loop through unique responsible users of active tasks on this project, excluding active_user_id
      FOR task_resp_record IN 
        SELECT DISTINCT responsavel_id 
        FROM public.project_tasks
        WHERE project_id = NEW.id 
          AND responsavel_id IS NOT NULL 
          AND status NOT IN ('concluido', 'entregue')
          AND responsavel_id != COALESCE(active_user_id, '00000000-0000-0000-0000-000000000000')
      LOOP
        INSERT INTO public.notifications (
          user_id,
          event_type,
          category,
          priority,
          title,
          body,
          link,
          data
        ) VALUES (
          task_resp_record.responsavel_id,
          'projeto_encerrado',
          'producao',
          'normal',
          'Projeto Encerrado',
          'O projeto "' || NEW.name || '", no qual você possui tarefas ativas, foi concluído e encerrado.',
          '/producao/projetos?projectId=' || COALESCE(NEW.id::text, ''),
          jsonb_build_object(
            'project_id', NEW.id
          )
        );
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      -- Error isolation
      RAISE WARNING 'Error creating project closed notifications for project %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_project_closed_notification ON public.projects;
CREATE TRIGGER trg_project_closed_notification
  AFTER UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_project_closed_notification();


-- Trigger 4: handle_budget_approved_notification
-- Dispatched AFTER UPDATE on public.budgets.
-- Creates notifications for active admin users when budget is approved.
CREATE OR REPLACE FUNCTION public.handle_budget_approved_notification()
RETURNS trigger AS $$
DECLARE
  active_user_id UUID;
  admin_record RECORD;
BEGIN
  -- Trigger condition: transition to 'aprovado'
  IF OLD.status != 'aprovado' AND NEW.status = 'aprovado' THEN
    BEGIN
      -- Retrieve active user from context
      active_user_id := (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'ativo');

      -- Loop through active admin users, excluding active_user_id
      FOR admin_record IN 
        SELECT id 
        FROM public.app_users
        WHERE role = 'admin' 
          AND status = 'ativo'
          AND id != COALESCE(active_user_id, '00000000-0000-0000-0000-000000000000')
      LOOP
        INSERT INTO public.notifications (
          user_id,
          event_type,
          category,
          priority,
          title,
          body,
          link,
          data
        ) VALUES (
          admin_record.id,
          'orcamento_aprovado',
          'comercial',
          'high',
          'Orçamento Aprovado',
          'O orçamento "' || NEW.project_name || '" (Código: ' || COALESCE(NEW.code, '') || ') foi aprovado pelo cliente.',
          '/comercial/orcamentos?id=' || COALESCE(NEW.id::text, ''),
          jsonb_build_object(
            'budget_id', NEW.id
          )
        );
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      -- Error isolation
      RAISE WARNING 'Error creating budget approved notifications for budget %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_budget_approved_notification ON public.budgets;
CREATE TRIGGER trg_budget_approved_notification
  AFTER UPDATE ON public.budgets
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_budget_approved_notification();
