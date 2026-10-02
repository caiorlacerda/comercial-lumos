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

-- definir_parcelamento: descoberto ao aplicar esta migration que a função
-- nunca existiu de fato em produção (0 linhas em pg_proc sob qualquer
-- assinatura) — só o código-fonte da migration 2026093311, nunca aplicado.
-- Isso significa que "Financeiro redefine parcelamento" (a_vista/entrada_saldo,
-- ParcelamentoModal.tsx) nunca funcionou de verdade até agora. Recriando aqui
-- com o corpo original e inalterado dessa migration, antes de aplicar o
-- REVOKE/GRANT que é o propósito original deste arquivo.
CREATE OR REPLACE FUNCTION public.definir_parcelamento(
  p_budget_id uuid,
  p_plan text,                          -- a_vista | entrada_saldo
  p_days int DEFAULT 30,
  p_entry_pct numeric DEFAULT 50,
  p_base date DEFAULT NULL              -- data de referência (padrão: hoje)
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b RECORD;
  v_total numeric;
  v_recebido numeric;
  v_saldo numeric;
  v_entrada numeric;
  v_base date := COALESCE(p_base, CURRENT_DATE);
  v_prox int;
  v_criadas int := 0;
BEGIN
  IF p_plan NOT IN ('a_vista', 'entrada_saldo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'plano_invalido');
  END IF;

  SELECT id, project_name, client_id, active_version_id INTO b FROM budgets WHERE id = p_budget_id;
  IF b IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'orcamento_nao_encontrado'); END IF;

  SELECT COALESCE(valor_vendido, 0) INTO v_total FROM projetos_financeiro WHERE proposta_id = p_budget_id;
  IF COALESCE(v_total, 0) <= 0 THEN
    SELECT COALESCE(sum(total_amount), 0) INTO v_total FROM receivables
    WHERE budget_id = p_budget_id AND status <> 'cancelado';
  END IF;

  SELECT COALESCE(sum(received_amount), 0) INTO v_recebido FROM receivables
  WHERE budget_id = p_budget_id AND status <> 'cancelado';

  v_saldo := GREATEST(COALESCE(v_total, 0) - COALESCE(v_recebido, 0), 0);
  IF v_saldo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nada_em_aberto');
  END IF;

  -- some com as parcelas ainda intocadas; o que teve recebimento permanece
  DELETE FROM receivables
  WHERE budget_id = p_budget_id AND COALESCE(received_amount, 0) = 0 AND status <> 'cancelado';

  SELECT COALESCE(max(parcela_numero), 0) INTO v_prox FROM receivables WHERE budget_id = p_budget_id;

  IF p_plan = 'entrada_saldo' THEN
    v_entrada := round(v_saldo * COALESCE(p_entry_pct, 50) / 100, 2);
    INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                             total_amount, due_date, status, parcela_numero, parcela_total, origem)
    VALUES
      (b.id, b.active_version_id, (SELECT id FROM projects WHERE budget_id = b.id),
       b.project_name || ' · entrada', b.client_id, v_entrada, v_base, 'aguardando',
       v_prox + 1, v_prox + 2, 'proposta'),
      (b.id, b.active_version_id, (SELECT id FROM projects WHERE budget_id = b.id),
       b.project_name || ' · saldo', b.client_id, v_saldo - v_entrada,
       v_base + COALESCE(p_days, 30), 'aguardando', v_prox + 2, v_prox + 2, 'proposta');
    v_criadas := 2;
  ELSE
    INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                             total_amount, due_date, status, parcela_numero, parcela_total, origem)
    VALUES (b.id, b.active_version_id, (SELECT id FROM projects WHERE budget_id = b.id),
            b.project_name, b.client_id, v_saldo, v_base + COALESCE(p_days, 30),
            'aguardando', v_prox + 1, v_prox + 1, 'proposta');
    v_criadas := 1;
  END IF;

  -- guarda a condição na proposta, pra ficar registrado e sair no PDF
  UPDATE budget_versions
  SET payment_plan = p_plan, payment_days = COALESCE(p_days, 30),
      payment_entry_pct = CASE WHEN p_plan = 'entrada_saldo' THEN COALESCE(p_entry_pct, 50) END
  WHERE id = b.active_version_id;

  RETURN jsonb_build_object('ok', true, 'parcelas_criadas', v_criadas,
                            'saldo_distribuido', v_saldo, 'ja_recebido', v_recebido);
END; $$;

-- fecha de vez, só authenticated.
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
