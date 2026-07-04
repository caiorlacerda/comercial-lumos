-- Migration: Create Task Comments and Mentions Schema
-- Created At: 2026-07-04

BEGIN;

-- 1. Criar Tabela de Comentários
CREATE TABLE IF NOT EXISTS public.task_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE, -- Referência ao usuário interno (app_users)
  content     text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Indexar task_id para otimizar busca de comentários por tarefa
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.task_comments(task_id);

-- Trigger para atualizar automaticamente o campo updated_at
DROP TRIGGER IF EXISTS update_task_comments_updated_at ON public.task_comments;
CREATE TRIGGER update_task_comments_updated_at
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. Criar Tabela de Menções (@)
CREATE TABLE IF NOT EXISTS public.task_comment_mentions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id        uuid NOT NULL REFERENCES public.task_comments(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  notified          boolean NOT NULL DEFAULT false, -- Flag consumida pelo sistema de notificações futuro
  created_at        timestamptz DEFAULT now()
);

-- Indexar mentioned_user_id filtrado por não-notificados para otimização de consultas futuras do worker
CREATE INDEX IF NOT EXISTS idx_mentions_unnotified ON public.task_comment_mentions(mentioned_user_id) WHERE (notified = false);
CREATE INDEX IF NOT EXISTS idx_mentions_comment ON public.task_comment_mentions(comment_id);

-- 3. Habilitar RLS (Row Level Security)
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comment_mentions ENABLE ROW LEVEL SECURITY;

-- 4. Criar Políticas de RLS para Comentários (task_comments)

-- Qualquer usuário autenticado pode ler comentários
DROP POLICY IF EXISTS select_task_comments ON public.task_comments;
CREATE POLICY select_task_comments ON public.task_comments
  FOR SELECT TO authenticated USING (true);

-- Qualquer usuário autenticado pode comentar (garantindo que se identifique como ele mesmo)
DROP POLICY IF EXISTS insert_task_comments ON public.task_comments;
CREATE POLICY insert_task_comments ON public.task_comments
  FOR INSERT TO authenticated 
  WITH CHECK (user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

-- Apenas o próprio autor do comentário ou administradores podem atualizar o comentário
DROP POLICY IF EXISTS update_task_comments ON public.task_comments;
CREATE POLICY update_task_comments ON public.task_comments
  FOR UPDATE TO authenticated 
  USING (user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()) OR public.get_user_role() = 'admin');

-- Apenas o próprio autor do comentário ou administradores podem deletar o comentário
DROP POLICY IF EXISTS delete_task_comments ON public.task_comments;
CREATE POLICY delete_task_comments ON public.task_comments
  FOR DELETE TO authenticated 
  USING (user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()) OR public.get_user_role() = 'admin');

-- 5. Criar Políticas de RLS para Menções (task_comment_mentions)

-- Qualquer usuário autenticado pode ler menções
DROP POLICY IF EXISTS select_mentions ON public.task_comment_mentions;
CREATE POLICY select_mentions ON public.task_comment_mentions
  FOR SELECT TO authenticated USING (true);

-- Qualquer usuário autenticado pode inserir menções
DROP POLICY IF EXISTS insert_mentions ON public.task_comment_mentions;
CREATE POLICY insert_mentions ON public.task_comment_mentions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- Apenas a equipe de produção ou admin (worker futuro) pode marcar a menção como notificada (notified = true)
DROP POLICY IF EXISTS update_mentions ON public.task_comment_mentions;
CREATE POLICY update_mentions ON public.task_comment_mentions
  FOR UPDATE TO authenticated 
  USING (public.get_user_role() IN ('admin', 'producao'));

-- 6. Garantir permissões de acesso às roles da aplicação
GRANT ALL ON public.task_comments TO authenticated, service_role;
GRANT ALL ON public.task_comment_mentions TO authenticated, service_role;

COMMIT;
