-- HOTFIX URGENTE — volta os custos que "sumiram" do detalhe do projeto.
--
-- Nenhum dado foi perdido: a Fase 0 criou FKs que JÁ existiam em produção
-- (criadas fora do versionamento). Com duas ligações iguais entre as mesmas
-- tabelas, a leitura com join do detalhe fica ambígua (PGRST201) e a página
-- exibe vazio. Aqui removemos APENAS as constraints novas que duplicaram uma
-- já existente; onde a nossa era a única, ela fica.

DO $$
DECLARE
  alvo record;
  n int;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('fk_project_costs_fornecedor',         'project_costs',   'fornecedor_id'),
      ('fk_project_costs_fornecedor_servico', 'project_costs',   'fornecedor_servico_id'),
      ('fk_payables_project',                 'payables',        'project_id'),
      ('fk_reimbursements_project',           'reimbursements',  'project_id'),
      ('fk_budget_versions_contact',          'budget_versions', 'contact_id')
    ) AS t(minha, tabela, coluna)
  LOOP
    -- quantas FKs existem nessa mesma coluna?
    SELECT count(*) INTO n
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = ('public.' || alvo.tabela)::regclass
      AND a.attname = alvo.coluna;

    IF n > 1 THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', alvo.tabela, alvo.minha);
      RAISE NOTICE 'removida a duplicada % em %.%', alvo.minha, alvo.tabela, alvo.coluna;
    END IF;
  END LOOP;
END $$;

-- Conferência (aba Results): deve vir VAZIO = nenhuma coluna com FK duplicada.
SELECT t.relname AS tabela, a.attname AS coluna, count(*) AS fks
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f'
  AND t.relname IN ('project_costs', 'payables', 'reimbursements', 'budget_versions')
GROUP BY 1, 2 HAVING count(*) > 1;
