-- aprovar_orcamento(): para de zerar a parcela e de reescrever a venda.
--
-- Três correções na função vigente (supabase/migrations/2026093358_fee_mensal_funcoes.sql), o resto fica IDÊNTICO:
--   1) Parcela zerada (achados A1/C1): apaga o placeholder de R$ 0 que o gatilho legado cria, antes de gerar as parcelas.
--   2) valor_vendido (achado A2): se já existem parcelas, ele segue a soma delas em vez do preço ao vivo. Isso impede que
--      cada salvamento do orçamento aprovado "desencontre" o vendido do que foi faturado.
--   3) Centavos (achado C9): o preço sai arredondado a 2 casas (a parcela guardava 6000,004528).
--
-- Efeito só para aprovações e salvamentos DAQUI PARA FRENTE; nenhum dado existente é alterado por este arquivo.
-- CREATE OR REPLACE mantém as permissões atuais da função. Seguro rodar mais de uma vez.

CREATE OR REPLACE FUNCTION public.aprovar_orcamento(p_budget_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b RECORD;
  v_versao RECORD;
  v_custo numeric := 0;
  v_total numeric := 0;
  v_denom numeric;
  v_project uuid;
  v_nf numeric;
  v_cat uuid;
  v_plan text;
  v_dias int;
  v_entrada_pct numeric;
  v_entrada numeric;
  v_criadas int := 0;
  v_adendo jsonb;
BEGIN
  SELECT id, project_name, code, client_id, category, active_version_id, status
    INTO b FROM budgets WHERE id = p_budget_id;
  IF b IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'orcamento_nao_encontrado'); END IF;
  IF b.active_version_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'sem_versao_ativa'); END IF;

  SELECT * INTO v_versao FROM budget_versions WHERE id = b.active_version_id;
  v_plan := v_versao.payment_plan;
  IF v_plan = 'fee_mensal' AND (
    v_versao.fee_mensal_inicio IS NULL OR v_versao.fee_mensal_fim IS NULL
    OR v_versao.fee_mensal_valor IS NULL OR v_versao.fee_mensal_valor <= 0
    OR v_versao.fee_mensal_fim < v_versao.fee_mensal_inicio
  ) THEN
    -- fee mensal marcado mas ainda sem os números: trata como "a definir",
    -- igual a uma proposta sem nenhum plano de pagamento escolhido ainda.
    -- Nunca deixa o dinheiro sumir do radar só porque faltou preencher.
    v_plan := NULL;
  END IF;

  IF v_plan = 'fee_mensal' THEN
    -- fee mensal: o valor vendido é a soma do cronograma (fixo × meses +
    -- adendos) — é o que foi contratado de verdade, não a fórmula de
    -- margem (que não se aplica a um valor fixo recorrente).
    IF EXISTS (SELECT 1 FROM receivables WHERE budget_id = p_budget_id AND origem = 'fee_mensal') THEN
      -- Já existe cronograma real (aprovação anterior, ou o Financeiro
      -- configurou/estendeu depois) — usa a soma de verdade, nunca
      -- recalcula da proposta, pra não desfazer extensão/adendo que o
      -- Financeiro já tiver feito.
      SELECT COALESCE(sum(total_amount), 0) INTO v_total
      FROM receivables WHERE budget_id = p_budget_id AND origem = 'fee_mensal' AND status <> 'cancelado';
    ELSE
      v_total := COALESCE(v_versao.fee_mensal_valor, 0) * GREATEST(
        (extract(year from v_versao.fee_mensal_fim)::int - extract(year from v_versao.fee_mensal_inicio)::int) * 12
        + (extract(month from v_versao.fee_mensal_fim)::int - extract(month from v_versao.fee_mensal_inicio)::int) + 1,
        0);
      FOR v_adendo IN SELECT * FROM jsonb_array_elements(COALESCE(v_versao.fee_mensal_adendos, '[]'::jsonb))
      LOOP
        IF NOT (v_adendo->>'mes' ~ '^\d{4}-\d{2}$') OR COALESCE((v_adendo->>'valor')::numeric, 0) <= 0 THEN
          CONTINUE;
        END IF;
        v_total := v_total + COALESCE((v_adendo->>'valor')::numeric, 0);
      END LOOP;
    END IF;
  ELSE
    -- valor de venda pela mesma fórmula do app:
    -- conta antiga: custo / (1 - margem) - desconto.
    -- conta nova (imposto_reajusta_preco): custo / (1 - margem - imposto) - desconto.
    SELECT COALESCE(sum(unit_cost * quantity), 0) INTO v_custo
    FROM budget_items WHERE version_id = b.active_version_id;
    IF v_custo > 0 THEN
      IF COALESCE(v_versao.imposto_reajusta_preco, false) THEN
        v_denom := GREATEST(1 - COALESCE(v_versao.margin_pct, 0) - COALESCE(v_versao.nf_pct, 0), 0.05);
      ELSE
        v_denom := GREATEST(1 - COALESCE(v_versao.margin_pct, 0), 0.05);
      END IF;
      -- Em centavos: a parcela e o valor_vendido nascem iguais (antes a parcela guardava casas longas, ex.: 6000,004528).
      v_total := round(GREATEST(v_custo / v_denom - COALESCE(v_versao.discount_value, 0), 0), 2);
    END IF;
  END IF;

  -- projeto (idempotente)
  SELECT id INTO v_project FROM projects WHERE budget_id = p_budget_id;
  IF v_project IS NULL THEN
    INSERT INTO projects (name, code, budget_id, client_id)
    VALUES (b.project_name, b.code, b.id, b.client_id)
    RETURNING id INTO v_project;
  ELSIF b.code IS NOT NULL THEN
    UPDATE projects SET code = b.code
    WHERE id = v_project AND (code IS NULL OR code IN ('', '----'));
  END IF;

  -- parcelas conforme a condição de pagamento da proposta.
  -- Condição pode não estar definida ainda (acontece: fecha o projeto e o
  -- combinado de pagamento vem depois). Nesse caso nasce UMA parcela com o
  -- valor cheio e SEM vencimento, marcada como "a definir": o dinheiro não
  -- some do radar, e o financeiro define o parcelamento quando souber.
  v_dias := COALESCE(v_versao.payment_days, 30);
  v_entrada_pct := COALESCE(v_versao.payment_entry_pct, 50);

  -- O gatilho legado budgets_approval_trigger (só existe em produção) cria, ao gravar status='aprovado', uma parcela
  -- PLACEHOLDER de R$ 0 ("o front atualiza com o valor real"), e o front não atualiza mais. Como as parcelas só nascem
  -- quando NÃO existe nenhuma, esse R$ 0 ficava para sempre (#279, #286, #287, #292: R$ 40.147,80 fora do A Receber).
  -- Apaga só esse placeholder: aguardando, zerado, nada recebido e sem número de parcela. Nunca toca em parcela real.
  IF v_total > 0 THEN
    DELETE FROM receivables
    WHERE budget_id = p_budget_id AND status = 'aguardando'
      AND COALESCE(total_amount, 0) = 0 AND COALESCE(received_amount, 0) = 0 AND parcela_numero IS NULL;
  END IF;

  IF v_total > 0 AND NOT EXISTS (SELECT 1 FROM receivables WHERE budget_id = p_budget_id) THEN
    IF v_plan = 'fee_mensal' THEN
      v_criadas := public.gerar_parcelas_fee_mensal(
        b.id, b.active_version_id, v_project, b.client_id, b.project_name,
        v_versao.fee_mensal_inicio, v_versao.fee_mensal_fim,
        v_versao.fee_mensal_valor, v_versao.fee_mensal_adendos
      );
      IF v_criadas = 0 THEN
        -- fee mensal mal configurado (datas/valor faltando): não deixa o
        -- dinheiro sumir do radar, nasce "a definir" igual ao plano nulo.
        INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                                 total_amount, due_date, status, parcela_numero, parcela_total, origem)
        VALUES (b.id, b.active_version_id, v_project, b.project_name, b.client_id,
                v_total, NULL, 'aguardando', 1, 1, 'proposta');
        v_criadas := 1;
      END IF;
    ELSIF v_plan IS NULL THEN
      INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                               total_amount, due_date, status, parcela_numero, parcela_total, origem)
      VALUES (b.id, b.active_version_id, v_project, b.project_name, b.client_id,
              v_total, NULL, 'aguardando', 1, 1, 'proposta');
      v_criadas := 1;
    ELSIF v_plan = 'entrada_saldo' THEN
      v_entrada := round(v_total * v_entrada_pct / 100, 2);
      INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                               total_amount, due_date, status, parcela_numero, parcela_total, origem)
      VALUES
        (b.id, b.active_version_id, v_project, b.project_name || ' · entrada', b.client_id,
         v_entrada, CURRENT_DATE, 'aguardando', 1, 2, 'proposta'),
        (b.id, b.active_version_id, v_project, b.project_name || ' · saldo', b.client_id,
         v_total - v_entrada, CURRENT_DATE + v_dias, 'aguardando', 2, 2, 'proposta');
      v_criadas := 2;
    ELSE
      INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                               total_amount, due_date, status, parcela_numero, parcela_total, origem)
      VALUES (b.id, b.active_version_id, v_project, b.project_name, b.client_id,
              v_total, CURRENT_DATE + v_dias, 'aguardando', 1, 1, 'proposta');
      v_criadas := 1;
    END IF;
  END IF;

  -- registro financeiro do projeto
  SELECT nf_percent INTO v_nf FROM config_financeiro WHERE id = 1;
  SELECT id INTO v_cat FROM categorias
  WHERE lower(nome) = lower(b.category::text) LIMIT 1;

  IF EXISTS (SELECT 1 FROM projetos_financeiro WHERE proposta_id = p_budget_id) THEN
    UPDATE projetos_financeiro
    -- Já existem parcelas? Então o vendido é o que foi contratado (a soma delas), nunca o preço ao vivo da proposta.
    -- Antes, cada salvamento de um orçamento aprovado reescrevia valor_vendido com o preço atual sem tocar nas parcelas.
    SET project_id = v_project,
        valor_vendido = COALESCE(
          (SELECT NULLIF(sum(COALESCE(r.valor_previsto, r.total_amount)), 0)
             FROM receivables r WHERE r.budget_id = p_budget_id AND r.status <> 'cancelado'),
          v_total),
        updated_at = now()
    WHERE proposta_id = p_budget_id;
  ELSE
    INSERT INTO projetos_financeiro (proposta_id, project_id, cliente_id, categoria_id,
                                     valor_vendido, nf_percent, custos_total, status_titulo,
                                     origem, pendente_preenchimento)
    VALUES (p_budget_id, v_project, b.client_id, v_cat, v_total, COALESCE(v_nf, 0.18), 0,
            'emitir_nf', 'auto_aprovacao', true);
  END IF;

  -- o orçamento fica aprovado no mesmo movimento
  UPDATE budgets SET status = 'aprovado' WHERE id = p_budget_id AND status IS DISTINCT FROM 'aprovado';

  RETURN jsonb_build_object('ok', true, 'project_id', v_project,
                            'valor', v_total, 'parcelas_criadas', v_criadas);
END; $$;
