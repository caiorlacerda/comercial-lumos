-- Histórico de atividade por tarefa (estilo ClickUp): "quem fez o quê e quando".
-- Alimentado por triggers no banco, então funciona para qualquer origem da mudança
-- (app, template, etc.) e não depende do cliente lembrar de registrar.

CREATE TABLE IF NOT EXISTS public.task_activity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  actor_name text,                     -- snapshot do nome de quem agiu
  action     text NOT NULL,            -- created | status | prioridade | titulo | prazo | data_inicio | responsavel | descricao | tag_added | tag_removed
  old_value  text,
  new_value  text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON public.task_activity(task_id, created_at);

ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;
-- Leitura para qualquer autenticado; a escrita acontece só via triggers SECURITY
-- DEFINER (não há policy de INSERT para o cliente — ninguém forja histórico).
DROP POLICY IF EXISTS read_task_activity ON public.task_activity;
CREATE POLICY read_task_activity ON public.task_activity
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.task_activity TO authenticated;
GRANT ALL ON public.task_activity TO service_role;

-- ── Trigger de mudanças na própria tarefa ───────────────────────────────────
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

  IF new.responsavel_id IS DISTINCT FROM old.responsavel_id THEN
    SELECT full_name INTO old_resp FROM public.app_users WHERE id = old.responsavel_id;
    SELECT full_name INTO new_resp FROM public.app_users WHERE id = new.responsavel_id;
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

DROP TRIGGER IF EXISTS trg_log_task_activity_ins ON public.project_tasks;
CREATE TRIGGER trg_log_task_activity_ins
  AFTER INSERT ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();

DROP TRIGGER IF EXISTS trg_log_task_activity_upd ON public.project_tasks;
CREATE TRIGGER trg_log_task_activity_upd
  AFTER UPDATE ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();

-- ── Trigger de tags (adicionar/remover) ─────────────────────────────────────
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
    SELECT name INTO tname FROM public.task_tags WHERE id = old.tag_id;
    INSERT INTO public.task_activity(task_id, actor_id, actor_name, action, old_value)
    VALUES (old.task_id, a_id, a_name, 'tag_removed', tname);
    RETURN old;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_log_task_tag_ins ON public.project_task_tags;
CREATE TRIGGER trg_log_task_tag_ins
  AFTER INSERT ON public.project_task_tags
  FOR EACH ROW EXECUTE FUNCTION public.log_task_tag_activity();

DROP TRIGGER IF EXISTS trg_log_task_tag_del ON public.project_task_tags;
CREATE TRIGGER trg_log_task_tag_del
  AFTER DELETE ON public.project_task_tags
  FOR EACH ROW EXECUTE FUNCTION public.log_task_tag_activity();
