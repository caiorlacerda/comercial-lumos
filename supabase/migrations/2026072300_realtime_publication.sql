-- Colaboração em tempo real: adiciona as tabelas de dados à publication
-- supabase_realtime para que o Supabase Realtime (postgres_changes) emita
-- eventos de INSERT/UPDATE/DELETE aos clientes. O frontend usa o hook
-- useRealtimeRefetch para rebuscar dados silenciosamente quando algo muda.
-- RLS se aplica aos eventos: cada usuário só recebe o que pode ler.
-- Idempotente: ignora tabelas já publicadas ou inexistentes.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- Produção
    'projects', 'project_tasks', 'task_comments', 'project_task_tags',
    'task_tags', 'task_activity', 'project_task_templates',
    'ordens_do_dia', 'fornecedores', 'fornecedor_servicos', 'access_credentials',
    'edicoes_cronograma', 'editores',
    -- Revisão de vídeo
    'video_versions', 'review_comments', 'review_links',
    -- Comercial
    'budgets', 'budget_items', 'budget_versions', 'clients',
    -- Financeiro
    'payables', 'receivables', 'reimbursements',
    'project_costs', 'projetos_financeiro'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t)
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
       ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
