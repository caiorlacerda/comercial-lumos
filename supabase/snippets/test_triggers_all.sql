BEGIN;

-- Create temporary notifications table matching production schema (will be rolled back)
CREATE TABLE IF NOT EXISTS public.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  event_type   text NOT NULL,
  category     text,
  priority     text,
  title        text NOT NULL,
  body         text,
  link         text,
  data         jsonb DEFAULT '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz DEFAULT now()
);

-- Setup Mock Environment
-- 1. Create active production user (Samantha) and secondary admin
INSERT INTO public.app_users (id, full_name, email, role, status)
VALUES 
  ('e1111111-2222-3333-4444-555555555555', 'Samantha Lacerda', 'samantha@lumos.com', 'producao', 'ativo'),
  ('d2222222-2222-3333-4444-555555555555', 'Admin Secondary', 'admin2@lumos.com', 'admin', 'ativo');

-- 2. Create client, project, and budget
INSERT INTO public.clients (id, name)
VALUES ('c1111111-2222-3333-4444-555555555555', 'Cliente Teste');

INSERT INTO public.projects (id, name, client_id, status)
VALUES ('a1111111-2222-3333-4444-555555555555', 'Projeto Teste', 'c1111111-2222-3333-4444-555555555555', 'ativo');

INSERT INTO public.budgets (id, project_name, category, status, client_id, code)
VALUES ('b0000000-0000-0000-0000-000000000000', 'Projeto Teste', 'digital', 'rascunho', 'c1111111-2222-3333-4444-555555555555', 'B-2026-001');

-- 3. Create a task (unassigned)
INSERT INTO public.project_tasks (id, project_id, titulo, status, prioridade, ordem)
VALUES ('b1111111-2222-3333-4444-555555555555', 'a1111111-2222-3333-4444-555555555555', 'Filmar Entrevista', 'iniciar', 'media', 10);


-- =============================================================================
-- TEST 1: Task Assigned Notification
-- =============================================================================
SELECT '--- TEST 1: TASK ASSIGNED ---' AS step;

-- Assign task to Samantha
UPDATE public.project_tasks
SET responsavel_id = 'e1111111-2222-3333-4444-555555555555'
WHERE id = 'b1111111-2222-3333-4444-555555555555';

-- Check notification
SELECT user_id, event_type, category, title, body, link FROM public.notifications;

-- Clear notifications for next tests
DELETE FROM public.notifications;


-- =============================================================================
-- TEST 2: Comment on your Task Notification (No Duplicates)
-- =============================================================================
SELECT '--- TEST 2: COMMENT ON TASK (WITHOUT MENTION) ---' AS step;

-- Insert comment by Caio Lacerda (Author ID: d0d4fb77-2f1d-4001-a1e6-231a473f3a1f)
-- Samantha is the assignee, so she should get a comment notification.
INSERT INTO public.task_comments (id, task_id, user_id, content)
VALUES ('f1111111-2222-3333-4444-555555555555', 'b1111111-2222-3333-4444-555555555555', 'd0d4fb77-2f1d-4001-a1e6-231a473f3a1f', 'Olá Samantha, comece assim que puder.');

-- Check comment notification
SELECT user_id, event_type, category, title, body, link FROM public.notifications;

DELETE FROM public.notifications;


SELECT '--- TEST 2.1: COMMENT WITH MENTION (PREVENT DUPLICATION) ---' AS step;

-- Insert comment by Caio Lacerda containing @Samantha Lacerda.
-- Samantha is mentioned, so the comment trigger should SKIP sending the comment notification 
-- to let the mention trigger handle it.
INSERT INTO public.task_comments (id, task_id, user_id, content)
VALUES ('f2222222-2222-3333-4444-555555555555', 'b1111111-2222-3333-4444-555555555555', 'd0d4fb77-2f1d-4001-a1e6-231a473f3a1f', 'Olá @Samantha Lacerda, comece assim que puder.');

-- Check notifications (should be empty because the mention trigger notification is not simulated here)
SELECT count(*) as comment_notification_count FROM public.notifications;

DELETE FROM public.notifications;


-- =============================================================================
-- TEST 3: Project Closed Notification
-- =============================================================================
SELECT '--- TEST 3: PROJECT CLOSED ---' AS step;

-- Project is currently active, and Samantha has an active task on it ('Filmar Entrevista', status='iniciar').
-- Close project
UPDATE public.projects
SET status = 'concluido'
WHERE id = 'a1111111-2222-3333-4444-555555555555';

-- Check project closed notification (Samantha should receive it, as she has an active task)
SELECT user_id, event_type, category, title, body, link FROM public.notifications;

DELETE FROM public.notifications;


-- =============================================================================
-- TEST 4: Budget Approved Notification
-- =============================================================================
SELECT '--- TEST 4: BUDGET APPROVED ---' AS step;

-- Approve budget
UPDATE public.budgets
SET status = 'aprovado'
WHERE id = 'b0000000-0000-0000-0000-000000000000';

-- Check budget approved notification (Admin users should receive it, e.g. Admin Secondary, excluding Caio Lacerda who ran the update if mocked)
SELECT user_id, event_type, category, title, body, link FROM public.notifications;

ROLLBACK;
