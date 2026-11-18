-- MODELOS DE ORÇAMENTO: GARANTE AS COLUNAS QUE A TELA USA
--
-- O app guarda um "Modelo de Orçamento" como um orçamento marcado com budgets.is_template = true
-- e uma categoria em budgets.template_category:
--   • editor da proposta, menu ⋮ > "Salvar como Orçamento Padrão" (BudgetEditorPage.tsx, handleSaveAsTemplate)
--   • /templates > aba "Modelos de Orçamento" (Templates.tsx, fetchTemplates)
--   • Home do admin (useAdminHome.ts: .eq('is_template', false))
-- Mas NENHUMA migration do repositório cria essas duas colunas (nem o 20260501_base_schema.sql).
-- Se o banco de produção não as tem, o "Salvar como Orçamento Padrão" falha com
-- "Could not find the 'template_category' column of 'budgets' in the schema cache" e a aba
-- /templates volta vazia. Se já existem (criadas à mão no painel, como indica o histórico do app),
-- esta migration NÃO faz nada além de registrar as colunas no repositório.
--
-- Seguro rodar mais de uma vez. Não mexe em dados: nenhum orçamento muda de modelo ou deixa de ser.
-- Não depende de nenhuma outra migration.
--
-- ═══ ANTES DE RODAR (opcional, só leitura): como está em produção ═══════════════════════════
-- Cole e rode um bloco por vez no SQL Editor. Nada abaixo altera dados.
--
-- A) As colunas existem? (0 linhas = não existem, e esta migration resolve)
--      SELECT column_name, data_type, is_nullable, column_default
--      FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'budgets'
--        AND column_name IN ('is_template', 'template_category') ORDER BY 1;
--
-- B) (só se A trouxe as 2 colunas) Quantos modelos existem hoje, e se há linhas com NULL:
--      SELECT is_template, count(*) FROM public.budgets GROUP BY 1 ORDER BY 1;
--      SELECT id, code, project_name, template_category, status
--      FROM public.budgets WHERE is_template ORDER BY template_category;
--
-- C) Relações entre budgets e budget_versions. Esperado: 2 linhas (budget_versions_budget_id_fkey e
--    budgets_active_version_fkey). Com 2, a consulta da aba /templates sem "dica" de relação dá erro
--    "more than one relationship" e a aba aparece vazia (é o que este PR corrige no frontend):
--      SELECT conname, conrelid::regclass AS de, confrelid::regclass AS para
--      FROM pg_constraint
--      WHERE contype = 'f'
--        AND ((conrelid = 'public.budgets'::regclass AND confrelid = 'public.budget_versions'::regclass)
--          OR (conrelid = 'public.budget_versions'::regclass AND confrelid = 'public.budgets'::regclass));
--
-- D) RLS e políticas de budgets (o repositório não tem nenhuma migration disso):
--      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.budgets'::regclass;
--      SELECT policyname, permissive, cmd, roles, qual, with_check
--      FROM pg_policies WHERE schemaname = 'public' AND tablename = 'budgets' ORDER BY cmd, policyname;
--
-- E) Gatilhos de budgets:
--      SELECT tgname, pg_get_triggerdef(oid) AS definicao
--      FROM pg_trigger WHERE tgrelid = 'public.budgets'::regclass AND NOT tgisinternal ORDER BY 1;
-- ═══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS is_template      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_category text;

-- Faz a API (PostgREST) enxergar as colunas na hora, sem esperar o cache de esquema renovar.
NOTIFY pgrst, 'reload schema';

-- CONFERÊNCIA: as duas colunas têm que aparecer.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'budgets'
  AND column_name IN ('is_template', 'template_category')
ORDER BY 1;

-- PLANO DE VOLTA: não há. A migration só acrescenta colunas que o app já usa e não altera dados;
-- se as colunas já existiam, nada mudou. (Remover as colunas quebraria o editor, a aba /templates
-- e a Home do admin.)
