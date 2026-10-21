-- REMOVE A TRAVA ANTIGA "UM TÍTULO POR ORÇAMENTO" QUE AINDA EXISTE EM PRODUÇÃO
--
-- Sintoma: ao definir o parcelamento (principalmente Fee mensal, que gera um título por mês
-- mais um por adendo), o Financeiro mostra:
--   duplicate key value violates unique constraint "receivables_budget_id_unique"
--
-- Causa: a migration 2026093311 trocou a regra "1 título por orçamento" por "1 título por
-- parcela" (índice uq_receivables_budget_parcela em (budget_id, parcela_numero)), mas só
-- derrubou o índice `uq_receivables_budget`. A trava `receivables_budget_id_unique` foi criada
-- fora das migrations, com outro nome, e continuou valendo. Qualquer parcelamento com mais de
-- um título por orçamento (entrada + saldo, fee mensal) bate nela na segunda parcela.
--
-- Segura: só remove a trava se ela for EXATAMENTE `UNIQUE (budget_id)`. Se a definição for outra,
-- aborta com erro e não altera nada. Não toca em dados. A proteção contra duplicidade continua
-- sendo o índice por parcela. Rodar mais de uma vez é inofensivo.

DO $$
DECLARE
  d text;
BEGIN
  -- caso 1: é uma constraint
  SELECT pg_get_constraintdef(c.oid) INTO d
  FROM pg_constraint c
  WHERE c.conrelid = 'public.receivables'::regclass AND c.conname = 'receivables_budget_id_unique';

  IF d IS NOT NULL THEN
    IF replace(d, ' ', '') = 'UNIQUE(budget_id)' THEN
      ALTER TABLE public.receivables DROP CONSTRAINT receivables_budget_id_unique;
    ELSE
      RAISE EXCEPTION 'receivables_budget_id_unique tem definição inesperada (%). Nada foi alterado.', d;
    END IF;
    RETURN;
  END IF;

  -- caso 2: é só um índice único solto
  SELECT indexdef INTO d
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'receivables' AND indexname = 'receivables_budget_id_unique';

  IF d IS NOT NULL THEN
    IF d ILIKE '%UNIQUE%' AND d ILIKE '%(budget_id)%' AND d NOT ILIKE '%WHERE%' THEN
      EXECUTE 'DROP INDEX public.receivables_budget_id_unique';
    ELSE
      RAISE EXCEPTION 'índice receivables_budget_id_unique tem definição inesperada (%). Nada foi alterado.', d;
    END IF;
  END IF;
END $$;

-- A conferência em produção mostrou OUTRO resquício da mesma trava: o índice `uq_receivables_budget`
-- (UNIQUE em budget_id) ainda existia e o índice por parcela `uq_receivables_budget_parcela` não.
-- Ou seja, esse trecho da migration 2026093311 nunca chegou a rodar lá. Faz agora: derruba o
-- índice antigo e cria o por parcela (idempotente).
DROP INDEX IF EXISTS public.uq_receivables_budget;
CREATE UNIQUE INDEX IF NOT EXISTS uq_receivables_budget_parcela
  ON public.receivables (budget_id, parcela_numero) WHERE budget_id IS NOT NULL;
