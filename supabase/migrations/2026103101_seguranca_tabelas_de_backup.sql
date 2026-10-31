-- SEGURANÇA: TABELAS DE BACKUP SEM PROTEÇÃO (RLS)
--
-- As tabelas de cópia de segurança criadas por migrations anteriores à regra "somente_equipe"
-- (2026102300) nasceram SEM RLS, e o Supabase libera SELECT de tabela nova ao papel anon.
-- Resultado confirmado em produção: um visitante com a chave pública do app lia as 161 linhas
-- de project_tasks_tipo_backup_20261024 (títulos de tarefas de projetos), sem login.
--
-- Com RLS ligado e nenhuma política, ninguém pelo app (anon ou authenticated) lê ou grava
-- nessas tabelas. Quem roda SQL no painel (dono da tabela) e o servidor (service_role) seguem
-- passando por cima do RLS, então o "plano de volta" das migrations 2026102414 e do backup de
-- nota_requests continua funcionando pelo SQL Editor. Nenhuma tela do app usa estas tabelas.
--
-- Seguro rodar mais de uma vez. Não mexe em dados.

ALTER TABLE IF EXISTS public.project_tasks_tipo_backup_20261024 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.nota_requests_backup_20261025 ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.project_tasks_tipo_backup_20261024') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.project_tasks_tipo_backup_20261024 FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON public.project_tasks_tipo_backup_20261024 FROM anon, authenticated';
  END IF;
  IF to_regclass('public.nota_requests_backup_20261025') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.nota_requests_backup_20261025 FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON public.nota_requests_backup_20261025 FROM anon, authenticated';
  END IF;
END $$;

-- CONFERÊNCIA: nenhuma tabela do schema public pode ficar sem RLS (linhas = 0).
SELECT c.relname AS tabela_sem_rls
FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
ORDER BY 1;

-- PLANO DE VOLTA (se precisar consultar o backup pelo app, o que hoje ninguém faz):
--   GRANT SELECT ON public.project_tasks_tipo_backup_20261024 TO authenticated;
--   CREATE POLICY equipe_le ON public.project_tasks_tipo_backup_20261024 FOR SELECT TO authenticated USING (public.is_team());
