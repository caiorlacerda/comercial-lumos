-- Fee mensal: gera uma conta a receber por mês (+ uma por adendo) em vez de
-- uma conta só com o valor total do período. A geração mora numa função só
-- (gerar_parcelas_fee_mensal), reaproveitada pela aprovação do orçamento E
-- pela tela do Financeiro — nunca duas lógicas que podem divergir.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) O gerador — uma conta por mês + uma por adendo
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gerar_parcelas_fee_mensal(
  p_budget_id   uuid,
  p_versao_id   uuid,
  p_project_id  uuid,
  p_client_id   uuid,
  p_nome        text,
  p_inicio      date,
  p_fim         date,
  p_valor       numeric,
  p_adendos     jsonb
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mes        date;
  v_criadas    int := 0;
  v_prox       int;
  v_adendo     jsonb;
  v_mes_adendo date;
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR COALESCE(p_valor, 0) <= 0 THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(max(parcela_numero), 0) INTO v_prox
  FROM receivables WHERE budget_id = p_budget_id;

  -- uma conta por mês, vencimento no dia 1
  v_mes := date_trunc('month', p_inicio)::date;
  WHILE v_mes <= p_fim LOOP
    v_prox := v_prox + 1;
    INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                             total_amount, due_date, status, parcela_numero, parcela_total, origem)
    VALUES (p_budget_id, p_versao_id, p_project_id,
            p_nome || ' · ' || to_char(v_mes, 'MM/YYYY'), p_client_id,
            p_valor, v_mes, 'aguardando', v_prox, v_prox, 'fee_mensal');
    v_criadas := v_criadas + 1;
    v_mes := (v_mes + interval '1 month')::date;
  END LOOP;

  -- uma conta extra por adendo, no mês certo
  FOR v_adendo IN SELECT * FROM jsonb_array_elements(COALESCE(p_adendos, '[]'::jsonb))
  LOOP
    v_mes_adendo := to_date(v_adendo->>'mes', 'YYYY-MM');
    v_prox := v_prox + 1;
    INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                             total_amount, due_date, status, parcela_numero, parcela_total, origem)
    VALUES (p_budget_id, p_versao_id, p_project_id,
            p_nome || ' · ' || to_char(v_mes_adendo, 'MM/YYYY') || ' · Adendo', p_client_id,
            (v_adendo->>'valor')::numeric, v_mes_adendo, 'aguardando', v_prox, v_prox, 'fee_mensal');
    v_criadas := v_criadas + 1;
  END LOOP;

  -- parcela_total final: só nas linhas desta geração, pro total real
  UPDATE receivables SET parcela_total = v_prox
  WHERE budget_id = p_budget_id AND origem = 'fee_mensal';

  RETURN v_criadas;
END; $$;

REVOKE ALL ON FUNCTION public.gerar_parcelas_fee_mensal(uuid, uuid, uuid, uuid, text, date, date, numeric, jsonb) FROM PUBLIC;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Financeiro configura do zero (quando não veio pronto da proposta)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.definir_fee_mensal(
  p_budget_id uuid,
  p_inicio    date,
  p_fim       date,
  p_valor     numeric,
  p_adendos   jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b RECORD;
  v_criadas int;
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RETURN jsonb_build_object('ok', false, 'error', 'periodo_invalido');
  END IF;
  IF COALESCE(p_valor, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'valor_invalido');
  END IF;

  SELECT id, project_name, client_id, active_version_id INTO b FROM budgets WHERE id = p_budget_id;
  IF b IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'orcamento_nao_encontrado'); END IF;

  -- some com as parcelas ainda intocadas; o que teve recebimento permanece
  -- (mesma regra de ouro do definir_parcelamento)
  DELETE FROM receivables
  WHERE budget_id = p_budget_id AND COALESCE(received_amount, 0) = 0 AND status <> 'cancelado';

  v_criadas := public.gerar_parcelas_fee_mensal(
    b.id, b.active_version_id, (SELECT id FROM projects WHERE budget_id = b.id), b.client_id,
    b.project_name, p_inicio, p_fim, p_valor, p_adendos
  );

  IF v_criadas = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nada_gerado');
  END IF;

  UPDATE projetos_financeiro
  SET valor_vendido = (SELECT COALESCE(sum(total_amount), 0) FROM receivables WHERE budget_id = p_budget_id AND status <> 'cancelado'),
      updated_at = now()
  WHERE proposta_id = p_budget_id;

  UPDATE budget_versions
  SET payment_plan = 'fee_mensal',
      fee_mensal_inicio = p_inicio, fee_mensal_fim = p_fim,
      fee_mensal_valor = p_valor, fee_mensal_adendos = COALESCE(p_adendos, '[]'::jsonb)
  WHERE id = b.active_version_id;

  RETURN jsonb_build_object('ok', true, 'parcelas_criadas', v_criadas);
END; $$;

REVOKE ALL ON FUNCTION public.definir_fee_mensal(uuid, date, date, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.definir_fee_mensal(uuid, date, date, numeric, jsonb) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Acrescentar UMA conta a um cronograma que já existe (adendo novo, ou
--    estender o contrato com mais um mês) — nunca mexe no que já estava lá.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adicionar_parcela_fee_mensal(
  p_budget_id uuid,
  p_mes       date,
  p_valor     numeric,
  p_eh_adendo boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b      RECORD;
  v_prox int;
  v_mes  date := date_trunc('month', p_mes)::date;
  v_desc text;
BEGIN
  IF COALESCE(p_valor, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'valor_invalido');
  END IF;

  SELECT id, project_name, client_id, active_version_id INTO b FROM budgets WHERE id = p_budget_id;
  IF b IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'orcamento_nao_encontrado'); END IF;

  SELECT COALESCE(max(parcela_numero), 0) + 1 INTO v_prox FROM receivables WHERE budget_id = p_budget_id;
  v_desc := b.project_name || ' · ' || to_char(v_mes, 'MM/YYYY') || CASE WHEN p_eh_adendo THEN ' · Adendo' ELSE '' END;

  INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                           total_amount, due_date, status, parcela_numero, parcela_total, origem)
  VALUES (b.id, b.active_version_id, (SELECT id FROM projects WHERE budget_id = b.id), v_desc, b.client_id,
          p_valor, v_mes, 'aguardando', v_prox, v_prox, 'fee_mensal');

  UPDATE receivables SET parcela_total = v_prox WHERE budget_id = p_budget_id AND origem = 'fee_mensal';

  UPDATE projetos_financeiro
  SET valor_vendido = (SELECT COALESCE(sum(total_amount), 0) FROM receivables WHERE budget_id = p_budget_id AND status <> 'cancelado'),
      updated_at = now()
  WHERE proposta_id = p_budget_id;

  RETURN jsonb_build_object('ok', true);
END; $$;

REVOKE ALL ON FUNCTION public.adicionar_parcela_fee_mensal(uuid, date, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adicionar_parcela_fee_mensal(uuid, date, numeric, boolean) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) aprovar_orcamento() ganha o terceiro caminho
-- ───────────────────────────────────────────────────────────────────────────
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

  IF v_plan = 'fee_mensal' THEN
    -- fee mensal: o valor vendido é a soma do cronograma (fixo × meses +
    -- adendos) — é o que foi contratado de verdade, não a fórmula de
    -- margem (que não se aplica a um valor fixo recorrente).
    v_total := COALESCE(v_versao.fee_mensal_valor, 0) * GREATEST(
      (extract(year from v_versao.fee_mensal_fim)::int - extract(year from v_versao.fee_mensal_inicio)::int) * 12
      + (extract(month from v_versao.fee_mensal_fim)::int - extract(month from v_versao.fee_mensal_inicio)::int) + 1,
      0);
    FOR v_adendo IN SELECT * FROM jsonb_array_elements(COALESCE(v_versao.fee_mensal_adendos, '[]'::jsonb))
    LOOP
      v_total := v_total + COALESCE((v_adendo->>'valor')::numeric, 0);
    END LOOP;
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
      v_total := GREATEST(v_custo / v_denom - COALESCE(v_versao.discount_value, 0), 0);
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
    SET project_id = v_project, valor_vendido = v_total, updated_at = now()
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

-- ───────────────────────────────────────────────────────────────────────────
-- 5) O gatilho que redistribui em partes iguais passa a ignorar fee mensal
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_versao_reajusta_parcelas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_budget uuid;
  v_custo numeric := 0;
  v_total numeric := 0;
  v_abertas int;
  v_recebido numeric;
BEGIN
  -- Fee mensal nunca é redistribuído sozinho: se o preço mudar de verdade,
  -- quem ajusta o cronograma é o Financeiro, na mão.
  IF NEW.payment_plan = 'fee_mensal' THEN RETURN NEW; END IF;

  SELECT id INTO v_budget FROM budgets WHERE active_version_id = NEW.id AND status = 'aprovado';
  IF v_budget IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(sum(unit_cost * quantity), 0) INTO v_custo FROM budget_items WHERE version_id = NEW.id;
  IF v_custo > 0 AND COALESCE(NEW.margin_pct, 0) < 1 THEN
    v_total := GREATEST(v_custo / (1 - COALESCE(NEW.margin_pct, 0)) - COALESCE(NEW.discount_value, 0), 0);
  END IF;
  IF v_total <= 0 THEN RETURN NEW; END IF;

  SELECT count(*), COALESCE(sum(received_amount), 0) INTO v_abertas, v_recebido
  FROM receivables WHERE budget_id = v_budget AND received_amount < total_amount AND status <> 'cancelado';

  IF v_abertas > 0 AND v_total > v_recebido THEN
    UPDATE receivables
    SET total_amount = round((v_total - v_recebido) / v_abertas, 2),
        budget_version_id = NEW.id,
        notes = COALESCE(notes || E'\n', '') || 'Valor ajustado em ' || to_char(now(), 'DD/MM/YYYY') || ' (proposta editada).',
        updated_at = now()
    WHERE budget_id = v_budget AND received_amount < total_amount AND status <> 'cancelado';
  END IF;

  RETURN NEW;
END; $$;

-- Conferência: as três funções novas têm que existir, e aprovar_orcamento/
-- fn_versao_reajusta_parcelas têm que estar com a definição atualizada
-- (procure 'fee_mensal' no corpo — tem que aparecer nas duas).
SELECT proname FROM pg_proc
WHERE proname IN ('gerar_parcelas_fee_mensal', 'definir_fee_mensal', 'adicionar_parcela_fee_mensal')
ORDER BY proname;
SELECT pg_get_functiondef('public.aprovar_orcamento(uuid)'::regprocedure) ILIKE '%fee_mensal%' AS aprovar_orcamento_atualizada;
SELECT pg_get_functiondef('public.fn_versao_reajusta_parcelas()'::regprocedure) ILIKE '%fee_mensal%' AS trigger_atualizado;
