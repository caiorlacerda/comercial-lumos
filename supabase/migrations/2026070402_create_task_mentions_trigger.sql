-- Trigger Function: handle_task_comment_mention_notification
-- Dispatched when a new row is inserted into public.task_comment_mentions.
-- Creates a notification in the existing notifications table for the mentioned user.
-- Safely isolates errors to prevent blocking comment creation.
-- Avoids self-mention notifications.

CREATE OR REPLACE FUNCTION public.handle_task_comment_mention_notification()
RETURNS trigger AS $$
DECLARE
  comment_author_id UUID;
  comment_author_name TEXT;
  comment_content TEXT;
  task_id_ref UUID;
  task_title TEXT;
  project_id_ref UUID;
BEGIN
  -- 1. Check if the mention is already processed
  IF NEW.notified = true THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- 2. Fetch details about comment, author, and task
    SELECT tc.user_id, tc.content, tc.task_id, au.full_name, pt.titulo, pt.project_id
    INTO comment_author_id, comment_content, task_id_ref, comment_author_name, task_title, project_id_ref
    FROM public.task_comments tc
    JOIN public.project_tasks pt ON tc.task_id = pt.id
    JOIN public.app_users au ON tc.user_id = au.id
    WHERE tc.id = NEW.comment_id;

    -- 3. Avoid self-mention (do not notify if mentioned_user_id is the author of the comment)
    IF NEW.mentioned_user_id = comment_author_id THEN
      -- Flag as notified and return
      UPDATE public.task_comment_mentions
      SET notified = true
      WHERE id = NEW.id;
      
      RETURN NEW;
    END IF;

    -- 4. Insert notification into the existing notifications table
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
      NEW.mentioned_user_id,
      'mencao_comentario', -- Mapped to 'mencao_comentario' in events.ts
      'producao',
      'normal',
      'Você foi mencionado em um comentário',
      comment_author_name || ' mencionou você na tarefa "' || task_title || '": "' || 
        CASE 
          WHEN length(comment_content) > 60 THEN substring(comment_content, 1, 60) || '...'
          ELSE comment_content
        END || '"',
      '/producao/projetos?projectId=' || COALESCE(project_id_ref::text, '') || '&taskId=' || COALESCE(task_id_ref::text, ''),
      jsonb_build_object(
        'comment_id', NEW.comment_id,
        'task_id', task_id_ref,
        'project_id', project_id_ref
      )
    );

    -- 5. Mark the mention as notified = true
    UPDATE public.task_comment_mentions
    SET notified = true
    WHERE id = NEW.id;

  EXCEPTION WHEN OTHERS THEN
    -- Safety isolation: Log error but do not raise exception to prevent comment transaction abortion
    RAISE WARNING 'Error creating mention notification for comment %: %', NEW.comment_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create Trigger on public.task_comment_mentions
DROP TRIGGER IF EXISTS trg_task_comment_mention_notification ON public.task_comment_mentions;
CREATE TRIGGER trg_task_comment_mention_notification
  AFTER INSERT ON public.task_comment_mentions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_task_comment_mention_notification();
