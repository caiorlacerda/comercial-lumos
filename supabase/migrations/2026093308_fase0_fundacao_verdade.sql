-- FASE 0 DA VERDADE ÚNICA — FUNDAÇÃO
--
-- Não muda NENHUMA informação existente. Três coisas:
-- 1) Oficializa no versionamento as colunas que já existem em produção mas
--    não estavam em migration nenhuma (em produção viram no-op).
-- 2) Cria as travas de unicidade que o código já assume. Se houver dado
--    duplicado, a trava daquela chave é PULADA com um aviso (nada é apagado)
--    e o diagnóstico final lista o que precisa de decisão humana.
-- 3) Valida status com regra de banco, só pra dados novos (NOT VALID).

SET lock_timeout = '15s';

-- ── 1. Oficializar o que já existe em produção ────────────────────────────
ALTER TABLE public.project_costs
  ADD COLUMN IF NOT EXISTS fornecedor_id         uuid,
  ADD COLUMN IF NOT EXISTS fornecedor_servico_id uuid,
  ADD COLUMN IF NOT EXISTS payment_due_date      date;

ALTER TABLE public.payables       ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.reimbursements ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.projects       ADD COLUMN IF NOT EXISTS production_value numeric;
ALTER TABLE public.budget_versions ADD COLUMN IF NOT EXISTS contact_id uuid;

-- FKs com NOT VALID: valem pra dados novos sem exigir limpeza do legado.
-- LIÇÃO DO HOTFIX 2026093310: só cria a FK se a coluna ainda não tem NENHUMA
-- (produção tinha FKs criadas fora do versionamento; duplicar a relação
-- quebra os joins do app com PGRST201 — foi o sumiço dos custos no detalhe).
DO $$
DECLARE
  alvo record;
  n int;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('fk_project_costs_fornecedor',         'project_costs',   'fornecedor_id',         'fornecedores',        'SET NULL'),
      ('fk_project_costs_fornecedor_servico', 'project_costs',   'fornecedor_servico_id', 'fornecedor_servicos', 'SET NULL'),
      ('fk_payables_project',                 'payables',        'project_id',            'projects',            'SET NULL'),
      ('fk_reimbursements_project',           'reimbursements',  'project_id',            'projects',            'SET NULL'),
      ('fk_budget_versions_contact',          'budget_versions', 'contact_id',            'client_contacts',     'SET NULL')
    ) AS t(nome, tabela, coluna, ref, acao)
  LOOP
    SELECT count(*) INTO n
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = ('public.' || alvo.tabela)::regclass
      AND a.attname = alvo.coluna;

    IF n = 0 THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE %s NOT VALID',
        alvo.tabela, alvo.nome, alvo.coluna, alvo.ref, alvo.acao
      );
    ELSE
      RAISE NOTICE 'coluna %.% já tem FK — nada a criar', alvo.tabela, alvo.coluna;
    END IF;
  END LOOP;
END $$;

-- ── 2. Travas de unicidade (puladas com aviso se houver duplicata) ────────
DO $$
DECLARE
  alvo record;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('uq_receivables_budget',        'receivables',         'budget_id'),
      ('uq_projfin_proposta',          'projetos_financeiro', 'proposta_id'),
      ('uq_projfin_project',           'projetos_financeiro', 'project_id'),
      ('uq_projects_budget',           'projects',            'budget_id')
    ) AS t(idx, tabela, coluna)
  LOOP
    BEGIN
      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (%I) WHERE %I IS NOT NULL',
        alvo.idx, alvo.tabela, alvo.coluna, alvo.coluna
      );
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'PULADO %s: há duplicatas em %.% — ver diagnóstico no final', alvo.idx, alvo.tabela, alvo.coluna;
    END;
  END LOOP;
END $$;

-- ── 3. Status com regra de banco (só valida daqui pra frente) ─────────────
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.project_costs
      ADD CONSTRAINT chk_project_costs_status
      CHECK (status IN ('pendente', 'pago')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ── DIAGNÓSTICO (aparece na aba Results; não altera nada) ─────────────────
-- Linhas aqui = duplicatas que impedem a trava daquela chave. Se vier vazio,
-- todas as travas entraram.
SELECT 'receivables.budget_id' AS chave, budget_id::text AS valor, count(*) AS repetido
FROM public.receivables WHERE budget_id IS NOT NULL GROUP BY budget_id HAVING count(*) > 1
UNION ALL
SELECT 'projetos_financeiro.proposta_id', proposta_id::text, count(*)
FROM public.projetos_financeiro WHERE proposta_id IS NOT NULL GROUP BY proposta_id HAVING count(*) > 1
UNION ALL
SELECT 'projetos_financeiro.project_id', project_id::text, count(*)
FROM public.projetos_financeiro WHERE project_id IS NOT NULL GROUP BY project_id HAVING count(*) > 1
UNION ALL
SELECT 'projects.budget_id', budget_id::text, count(*)
FROM public.projects WHERE budget_id IS NOT NULL GROUP BY budget_id HAVING count(*) > 1
ORDER BY 1, 3 DESC;
