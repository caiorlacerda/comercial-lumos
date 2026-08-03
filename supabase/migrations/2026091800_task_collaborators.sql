-- Colaboradores de tarefa: além do responsável (dono), a tarefa pode ter N
-- pessoas participando. O dono continua em project_tasks.responsavel_id (é ele
-- que aparece na Carga por Pessoa e leva a cobrança); os colaboradores entram
-- aqui e também são notificados e veem a tarefa em "Minhas tarefas".

CREATE TABLE IF NOT EXISTS public.task_collaborators (
  task_id uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_collab_user ON public.task_collaborators(user_id);

ALTER TABLE public.task_collaborators ENABLE ROW LEVEL SECURITY;

-- Mesma régua das tarefas hoje (2026091700): qualquer pessoa logada gerencia.
DROP POLICY IF EXISTS manage_task_collaborators ON public.task_collaborators;
CREATE POLICY manage_task_collaborators ON public.task_collaborators
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.task_collaborators TO authenticated, service_role;

-- Realtime (a lista atualiza sozinha pra quem está com a tarefa aberta).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'task_collaborators'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_collaborators;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Notificação: quem é adicionado como colaborador recebe o mesmo aviso de
-- "tarefa atribuída" (sem auto-notificação de quem adicionou).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_task_collab_notification()
RETURNS trigger AS $$
DECLARE
  active_user_id UUID;
  t RECORD;
BEGIN
  BEGIN
    active_user_id := (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'ativo');

    IF active_user_id IS NULL OR active_user_id != NEW.user_id THEN
      SELECT id, titulo, project_id INTO t FROM public.project_tasks WHERE id = NEW.task_id;

      INSERT INTO public.notifications (
        user_id, event_type, category, priority, title, body, link, data, actor_id
      ) VALUES (
        NEW.user_id,
        'todo_atribuido',
        'producao',
        'normal',
        'Você entrou numa tarefa',
        'Você foi adicionado como colaborador da tarefa "' || COALESCE(t.titulo, '') || '".',
        '/producao/projetos?projectId=' || COALESCE(t.project_id::text, '') || '&taskId=' || COALESCE(t.id::text, ''),
        jsonb_build_object('task_id', NEW.task_id, 'project_id', t.project_id, 'collab', true),
        active_user_id
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Erro ao notificar colaborador da tarefa %: %', NEW.task_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_task_collab_notification ON public.task_collaborators;
CREATE TRIGGER trg_task_collab_notification
  AFTER INSERT ON public.task_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.handle_task_collab_notification();
