-- Reembolso: extração automática por IA passa a sugerir fornecedor e
-- categoria na hora de anexar a nota. As duas colunas ficam opcionais —
-- reembolsos já existentes continuam válidos com os dois campos em branco.
-- Reaproveita o enum expense_category que project_expenses e payables já
-- usam, em vez de criar uma taxonomia nova só pra reembolso.
ALTER TABLE public.reimbursements
  ADD COLUMN IF NOT EXISTS supplier text,
  ADD COLUMN IF NOT EXISTS category expense_category;

-- Conferência: as duas colunas têm que aparecer.
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'reimbursements'
  AND column_name IN ('supplier', 'category')
ORDER BY column_name;
