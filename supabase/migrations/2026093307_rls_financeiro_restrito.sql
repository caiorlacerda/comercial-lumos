-- RLS DE VERDADE NAS TABELAS DO FINANCEIRO
--
-- Até aqui as tabelas internas do app liberavam leitura e escrita pra
-- QUALQUER usuário logado, e quem via o quê era decidido na interface. Isso
-- funciona pro resto do app, mas o extrato bancário completo da produtora é
-- outro nível de sensibilidade: agora o próprio banco só devolve esses dados
-- a quem pode ver o Financeiro.
--
-- Quem passa: role 'admin', ou quem um admin liberou explicitamente com a
-- permissão 'financeiro_admin' em custom_permissions (mesma regra do app).
-- Quem não passa: produção, editor, básico — nem pela interface, nem pela API.
--
-- ANTES DE RODAR: feche as abas do app (app.produtoralumos.com.br e a
-- preview). Trocar política exige lock exclusivo na tabela, e o app lendo ao
-- mesmo tempo pode gerar deadlock — foi o que aconteceu na primeira tentativa.
-- Deadlock não estraga nada, o Postgres desfaz tudo, mas evita o susto.
--
-- Se ainda assim der "lock timeout", espere alguns segundos e rode de novo.

SET lock_timeout = '15s';

-- ── Quem pode ver o financeiro ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pode_ver_financeiro()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app_users u
    WHERE u.auth_user_id = auth.uid()
      AND u.status = 'ativo'
      AND (
        u.role = 'admin'
        OR u.custom_permissions ->> 'financeiro_admin' = 'true'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.pode_ver_financeiro() TO authenticated;

-- ── Uma política por tabela, escrita na mão (o analisador do Supabase lê
--    melhor assim, e some o falso alerta de "tabela sem RLS") ──────────────
DROP POLICY IF EXISTS bank_imports_all ON public.bank_imports;
DROP POLICY IF EXISTS bank_imports_financeiro ON public.bank_imports;
CREATE POLICY bank_imports_financeiro ON public.bank_imports
  FOR ALL TO authenticated
  USING (public.pode_ver_financeiro()) WITH CHECK (public.pode_ver_financeiro());

DROP POLICY IF EXISTS bank_transactions_all ON public.bank_transactions;
DROP POLICY IF EXISTS bank_transactions_financeiro ON public.bank_transactions;
CREATE POLICY bank_transactions_financeiro ON public.bank_transactions
  FOR ALL TO authenticated
  USING (public.pode_ver_financeiro()) WITH CHECK (public.pode_ver_financeiro());

DROP POLICY IF EXISTS metas_financeiras_all ON public.metas_financeiras;
DROP POLICY IF EXISTS metas_financeiras_financeiro ON public.metas_financeiras;
CREATE POLICY metas_financeiras_financeiro ON public.metas_financeiras
  FOR ALL TO authenticated
  USING (public.pode_ver_financeiro()) WITH CHECK (public.pode_ver_financeiro());

DROP POLICY IF EXISTS bank_accounts_all ON public.bank_accounts;
DROP POLICY IF EXISTS bank_accounts_financeiro ON public.bank_accounts;
CREATE POLICY bank_accounts_financeiro ON public.bank_accounts
  FOR ALL TO authenticated
  USING (public.pode_ver_financeiro()) WITH CHECK (public.pode_ver_financeiro());

-- ── Rede de segurança: política sem RLS ligado não protege nada ───────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_imports', 'bank_transactions', 'metas_financeiras', 'bank_accounts'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ── Conferência: deve listar as 4 tabelas com a política *_financeiro e
--    rls_ligado = true. Aparece na aba Results assim que rodar. ────────────
SELECT c.relname AS tabela,
       c.relrowsecurity AS rls_ligado,
       p.policyname AS politica
FROM pg_class c
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE c.relname IN ('bank_imports', 'bank_transactions', 'metas_financeiras', 'bank_accounts')
ORDER BY c.relname;
