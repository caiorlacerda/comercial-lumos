-- Fee mensal: projetos recorrentes (ex.: contrato semestral com valor fixo
-- por mês e adendos pontuais) ganham reconhecimento próprio na proposta.
-- Hoje não existe NENHUM lugar que registre "este projeto é fee mensal" —
-- nem na proposta, nem depois. payment_plan ganha um terceiro valor; os
-- campos abaixo guardam o que foi proposto (início, fim, valor mensal,
-- adendos) e se isso deve aparecer no PDF. Tudo opcional — não afeta
-- nenhuma proposta existente.
ALTER TABLE public.budget_versions
  ADD COLUMN IF NOT EXISTS fee_mensal_inicio date,
  ADD COLUMN IF NOT EXISTS fee_mensal_fim date,
  ADD COLUMN IF NOT EXISTS fee_mensal_valor numeric,
  ADD COLUMN IF NOT EXISTS fee_mensal_adendos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fee_mensal_mostrar_na_proposta boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.budget_versions.fee_mensal_adendos IS
  'Lista de valores extras pontuais por mês: [{"mes": "2026-09", "valor": 50000}, ...]. Vazio quando o contrato só tem o fixo mensal.';

-- payment_plan passa a aceitar também 'fee_mensal', além de a_vista/entrada_saldo.
ALTER TABLE public.budget_versions DROP CONSTRAINT IF EXISTS chk_payment_plan;
ALTER TABLE public.budget_versions ADD CONSTRAINT chk_payment_plan
  CHECK (payment_plan IS NULL OR payment_plan IN ('a_vista', 'entrada_saldo', 'fee_mensal')) NOT VALID;

-- Conferência: as colunas novas têm que aparecer, e a regra tem que listar os três planos.
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'budget_versions'
  AND column_name IN ('fee_mensal_inicio', 'fee_mensal_fim', 'fee_mensal_valor', 'fee_mensal_adendos', 'fee_mensal_mostrar_na_proposta')
ORDER BY column_name;
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_payment_plan';
