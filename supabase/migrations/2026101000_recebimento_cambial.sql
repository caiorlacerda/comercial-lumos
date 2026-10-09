-- RECEBIMENTO EM REAIS CONVERTIDOS (orçamento em dólar, Fase 2)
--
-- O cliente paga em US$, o banco converte, e o que entra na conta em reais depende
-- da cotação do dia. Esta RPC fecha o título de uma proposta em dólar com o valor
-- REALMENTE recebido em reais (maior ou menor que o previsto).
--
-- Tudo num único UPDATE (total_amount, received_amount, status, received_at juntos):
-- o gatilho trg_receivable_reflete_projeto compara apenas somas e, vendo a linha já
-- final, fecha o projeto quando todas as parcelas estão recebidas. Dois UPDATEs
-- fariam o projeto reabrir por um instante. NÃO se usa a configuração
-- lumos.reconciliando: ela desligaria o espelhamento com Custos de Projeto.
--
-- valor_previsto guarda o total em reais ANTES do ajuste (preenchido uma única vez);
-- é dele que sai a referência em US$ na tela (previsto ÷ cotação travada da versão).
-- O valor_vendido do projeto continua sendo o previsto em reais (não muda aqui).
--
-- Aditiva e segura de rodar antes do deploy do front.

ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS valor_previsto numeric;

COMMENT ON COLUMN public.receivables.valor_previsto IS
  'Total em reais antes do ajuste pelo valor realmente recebido (propostas em dólar). Preenchido uma única vez.';

CREATE OR REPLACE FUNCTION public.registrar_recebimento_cambial(
  p_receivable_id uuid,
  p_valor_brl     numeric,
  p_data          date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          receivables%ROWTYPE;
  v_moeda    text;
  v_previsto numeric;
  v_valor    numeric;
BEGIN
  IF NOT public.pode_ver_financeiro() THEN
    RAISE EXCEPTION 'Sem permissão para registrar recebimentos.' USING ERRCODE = '42501';
  END IF;

  IF p_valor_brl IS NULL OR p_valor_brl <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'valor_invalido');
  END IF;
  IF p_data IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'data_invalida');
  END IF;
  v_valor := round(p_valor_brl, 2);

  SELECT * INTO r FROM receivables WHERE id = p_receivable_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nao_encontrado');
  END IF;
  IF r.status IN ('cancelado', 'recebido') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'status_invalido');
  END IF;

  SELECT bv.currency INTO v_moeda FROM budget_versions bv WHERE bv.id = r.budget_version_id;
  IF v_moeda IS DISTINCT FROM 'USD' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nao_e_dolar');
  END IF;

  v_previsto := COALESCE(r.valor_previsto, r.total_amount);

  UPDATE receivables
     SET valor_previsto  = v_previsto,
         total_amount    = v_valor,
         received_amount = v_valor,
         status          = 'recebido',
         received_at     = p_data::timestamp AT TIME ZONE 'UTC',
         updated_at      = now()
   WHERE id = r.id;

  INSERT INTO reconciliacao_recebimento_log (receivable_id, antes, depois)
  VALUES (
    r.id,
    jsonb_build_object('total_amount', r.total_amount, 'received_amount', r.received_amount, 'status', r.status),
    jsonb_build_object('total_amount', v_valor, 'received_amount', v_valor, 'status', 'recebido',
                       'valor_previsto', v_previsto, 'moeda_origem', 'USD', 'por', auth.uid())
  );

  RETURN jsonb_build_object('ok', true, 'previsto', v_previsto, 'recebido', v_valor, 'diferenca', v_valor - v_previsto);
END;
$$;

-- No Supabase o REVOKE FROM PUBLIC sozinho não fecha o acesso de anon.
REVOKE ALL ON FUNCTION public.registrar_recebimento_cambial(uuid, numeric, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_recebimento_cambial(uuid, numeric, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_recebimento_cambial(uuid, numeric, date) TO authenticated;
