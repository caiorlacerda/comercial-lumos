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
-- Não mexe nas tabelas antigas (payables, receivables, project_costs): elas
-- são lidas por telas que a produção acessa, como o encerramento de projeto,
-- e merecem uma passada própria pra não quebrar nada.

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

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_imports', 'bank_transactions', 'metas_financeiras', 'bank_accounts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- sai a política aberta que a reforma criou
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_financeiro', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.pode_ver_financeiro()) WITH CHECK (public.pode_ver_financeiro())',
      t || '_financeiro', t
    );
  END LOOP;
END $$;

-- Conferência rápida depois de rodar: deve listar as 4 tabelas, cada uma com
-- a política *_financeiro e nenhuma política *_all sobrando.
-- SELECT tablename, policyname FROM pg_policies
-- WHERE tablename IN ('bank_imports','bank_transactions','metas_financeiras','bank_accounts')
-- ORDER BY tablename;
