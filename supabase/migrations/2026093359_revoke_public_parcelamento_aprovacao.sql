-- CORREÇÃO DE SEGURANÇA: duas funções financeiras SECURITY DEFINER que nunca
-- tiveram o acesso padrão do Postgres fechado — por padrão, toda função nova
-- no schema public ganha EXECUTE de PUBLIC, e no Supabase especificamente
-- 'anon' e 'authenticated' também recebem grant direto (não é só herança de
-- PUBLIC — por isso REVOKE ... FROM PUBLIC sozinho não fecha o buraco; esse
-- mesmo erro apareceu e foi corrigido nas funções de fee mensal, ver
-- 2026093358_fee_mensal_funcoes.sql).
--
-- definir_parcelamento: só é chamada pelo Financeiro, por gente logada
-- (ParcelamentoModal.tsx). Nunca precisa ser 'anon'.
--
-- aprovar_orcamento: ESSA PRECISA CONTINUAR aceitando 'anon' — a página
-- pública de aprovação (/aprovar/:token, fora do AuthWrapper, sem login)
-- chama ela direto via syncBudgetApprovalFlow quando o cliente aprova a
-- proposta pelo link. Por isso aqui não é um REVOKE, é deixar o GRANT
-- explícito em vez de depender do grant implícito do Supabase — mesmo
-- resultado prático, mas intencional e auditável.

-- definir_parcelamento: fecha de vez, só authenticated.
REVOKE ALL ON FUNCTION public.definir_parcelamento(uuid, text, int, numeric, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.definir_parcelamento(uuid, text, int, numeric, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.definir_parcelamento(uuid, text, int, numeric, date) TO authenticated;

-- aprovar_orcamento: revoga o grant implícito/difuso de PUBLIC e recria só
-- os dois grants que ela de fato precisa, explicitamente.
REVOKE ALL ON FUNCTION public.aprovar_orcamento(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aprovar_orcamento(uuid) TO anon, authenticated;

-- Conferência: nenhuma das duas pode sobrar com PUBLIC; aprovar_orcamento
-- tem que listar anon e authenticated; definir_parcelamento só authenticated.
SELECT proname, proacl FROM pg_proc
WHERE proname IN ('definir_parcelamento', 'aprovar_orcamento')
ORDER BY proname;
