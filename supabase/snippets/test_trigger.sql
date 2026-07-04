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

-- 1. Create another user for testing mentions (user ID must be valid hex)
INSERT INTO public.app_users (id, full_name, email, role, status)
VALUES ('e1111111-2222-3333-4444-555555555555', 'Samantha Lacerda', 'samantha@lumos.com', 'producao', 'ativo');

-- 2. Create a mock client and project (use valid hex IDs starting with 'c' and 'a')
INSERT INTO public.clients (id, name)
VALUES ('c1111111-2222-3333-4444-555555555555', 'Cliente Teste');

INSERT INTO public.projects (id, name, client_id, status)
VALUES ('a1111111-2222-3333-4444-555555555555', 'Projeto Teste', 'c1111111-2222-3333-4444-555555555555', 'ativo');

-- 3. Create a project task (use valid hex ID starting with 'b')
INSERT INTO public.project_tasks (id, project_id, titulo, status, prioridade, ordem)
VALUES ('b1111111-2222-3333-4444-555555555555', 'a1111111-2222-3333-4444-555555555555', 'Filmar Entrevista', 'iniciar', 'media', 10);

-- 4. Create a task comment (Author: Caio Lacerda, ID: d0d4fb77-2f1d-4001-a1e6-231a473f3a1f, Comment ID starting with 'f')
INSERT INTO public.task_comments (id, task_id, user_id, content)
VALUES ('f1111111-2222-3333-4444-555555555555', 'b1111111-2222-3333-4444-555555555555', 'd0d4fb77-2f1d-4001-a1e6-231a473f3a1f', 'Olá @Samantha Lacerda, pode revisar?');

-- 5. Insert comment mention (user mentioned: Samantha Lacerda)
INSERT INTO public.task_comment_mentions (comment_id, mentioned_user_id, notified)
VALUES ('f1111111-2222-3333-4444-555555555555', 'e1111111-2222-3333-4444-555555555555', false);

-- Check results for Test 1
SELECT '--- TEST 1: NOTIFICATION CREATED ---' AS label;
SELECT user_id, event_type, category, title, body, link, data FROM public.notifications;

SELECT '--- TEST 1: MENTION STATUS (notified=true) ---' AS label;
SELECT comment_id, mentioned_user_id, notified FROM public.task_comment_mentions WHERE mentioned_user_id = 'e1111111-2222-3333-4444-555555555555';

-- Test 2: Self-Mention
INSERT INTO public.task_comment_mentions (comment_id, mentioned_user_id, notified)
VALUES ('f1111111-2222-3333-4444-555555555555', 'd0d4fb77-2f1d-4001-a1e6-231a473f3a1f', false);

-- Check results for Test 2
SELECT '--- TEST 2: NOTIFICATION COUNT (Should still be 1 total notification) ---' AS label;
SELECT count(*) FROM public.notifications;

SELECT '--- TEST 2: SELF-MENTION STATUS (notified=true) ---' AS label;
SELECT comment_id, mentioned_user_id, notified FROM public.task_comment_mentions WHERE mentioned_user_id = 'd0d4fb77-2f1d-4001-a1e6-231a473f3a1f';

ROLLBACK;
