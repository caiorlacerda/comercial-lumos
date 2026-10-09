-- Teste do banco LOCAL para a migration 2026101000. Não rodar em produção.
-- Tudo termina em ROLLBACK.
-- Rodar: docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/recebimento_cambial_banco.sql
BEGIN;

CREATE FUNCTION pg_temp.deve_falhar(p_sql text, p_msg text, p_sqlstate text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF p_sqlstate IS NOT NULL AND SQLSTATE <> p_sqlstate THEN
      RAISE EXCEPTION 'FALHOU: % (esperava SQLSTATE %, veio % - %)', p_msg, p_sqlstate, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'OK   %', p_msg;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (esperava erro): %', p_msg;
END $$;

DO $$
DECLARE
  v_admin uuid; v_cli uuid;
  v_b uuid; v_v uuid; v_b2 uuid; v_v2 uuid; v_b3 uuid; v_v3 uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_vv numeric;
  v_res jsonb; v_tot numeric; v_rec numeric; v_st text; v_prev numeric; v_dt date; v_n int; v_proj text;
BEGIN
  SELECT auth_user_id INTO v_admin FROM app_users
   WHERE role = 'admin' AND status = 'ativo' AND auth_user_id IS NOT NULL LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'FALHOU: não há admin ativo no banco local'; END IF;

  INSERT INTO clients (name) VALUES ('Cliente teste dólar') RETURNING id INTO v_cli;

  -- Proposta em US$ com duas parcelas de R$ 2.500 (cotação travada 4,85) e projeto financeiro.
  INSERT INTO budgets (code, project_name, category, status, client_id)
  VALUES ('TESTE-RCB', 'Teste recebimento', 'digital', 'em_negociacao', v_cli) RETURNING id INTO v_b;
  INSERT INTO budget_versions (budget_id, version_number, currency, fx_market_rate, fx_rate, fx_source)
  VALUES (v_b, 1, 'USD', 5, 4.85, 'manual') RETURNING id INTO v_v;
  INSERT INTO projetos_financeiro (proposta_id, cliente_id, valor_vendido, nf_percent, status_titulo)
  VALUES (v_b, v_cli, 5000, 0.18, 'esperando_pagamento');
  INSERT INTO receivables (budget_id, budget_version_id, description, client_id, total_amount, status, origem, parcela_numero, parcela_total)
  VALUES (v_b, v_v, 'Parcela 1', v_cli, 2500, 'aguardando', 'proposta', 1, 2) RETURNING id INTO v_r1;
  INSERT INTO receivables (budget_id, budget_version_id, description, client_id, total_amount, status, origem, parcela_numero, parcela_total)
  VALUES (v_b, v_v, 'Parcela 2', v_cli, 2500, 'aguardando', 'proposta', 2, 2) RETURNING id INTO v_r2;

  -- Proposta em R$ (não pode usar este fluxo).
  INSERT INTO budgets (code, project_name, category, status, client_id)
  VALUES ('TESTE-RCB2', 'Teste em reais', 'digital', 'em_negociacao', v_cli) RETURNING id INTO v_b2;
  INSERT INTO budget_versions (budget_id, version_number) VALUES (v_b2, 1) RETURNING id INTO v_v2;
  INSERT INTO receivables (budget_id, budget_version_id, description, client_id, total_amount, status, origem)
  VALUES (v_b2, v_v2, 'Em reais', v_cli, 1000, 'aguardando', 'proposta') RETURNING id INTO v_r3;

  -- 1) Grants: anon NÃO executa; authenticated executa.
  IF has_function_privilege('anon', 'public.registrar_recebimento_cambial(uuid,numeric,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU: anon não pode executar a RPC';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.registrar_recebimento_cambial(uuid,numeric,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU: authenticated deveria executar a RPC';
  END IF;
  RAISE NOTICE 'OK   grants: anon fechado, authenticated aberto';

  -- 2) Quem não é do financeiro é recusado.
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  PERFORM pg_temp.deve_falhar(format('SELECT registrar_recebimento_cambial(%L, 2600, ''2026-10-09'')', v_r1), 'usuário sem permissão é recusado (SQLSTATE 42501)', '42501');

  -- A partir daqui, como admin.
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- 3) Entradas inválidas.
  v_res := registrar_recebimento_cambial(v_r1, 0, '2026-10-09');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'valor_invalido' THEN RAISE EXCEPTION 'FALHOU: valor 0: %', v_res; END IF;
  v_res := registrar_recebimento_cambial(v_r1, 2600, NULL);
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'data_invalida' THEN RAISE EXCEPTION 'FALHOU: data nula: %', v_res; END IF;
  v_res := registrar_recebimento_cambial(gen_random_uuid(), 2600, '2026-10-09');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'nao_encontrado' THEN RAISE EXCEPTION 'FALHOU: id inexistente: %', v_res; END IF;
  v_res := registrar_recebimento_cambial(v_r3, 1000, '2026-10-09');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'nao_e_dolar' THEN RAISE EXCEPTION 'FALHOU: título em reais: %', v_res; END IF;
  v_res := registrar_recebimento_cambial(v_r1, 0.004, '2026-10-09');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'valor_invalido' THEN RAISE EXCEPTION 'FALHOU: valor 0,004 (arredonda para 0): %', v_res; END IF;
  v_res := registrar_recebimento_cambial(v_r1, 2600, '1996-09-01');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'data_invalida' THEN RAISE EXCEPTION 'FALHOU: data 1996-09-01: %', v_res; END IF;
  v_res := registrar_recebimento_cambial(v_r1, 2600, current_date + 30);
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'data_invalida' THEN RAISE EXCEPTION 'FALHOU: data no futuro: %', v_res; END IF;
  SELECT status::text INTO v_st FROM receivables WHERE id = v_r1;
  IF v_st = 'recebido' THEN RAISE EXCEPTION 'FALHOU: entrada inválida não pode gravar o recebimento'; END IF;
  RAISE NOTICE 'OK   valor 0,004, data 1996-09-01 e data no futuro são recusados sem gravar';
  RAISE NOTICE 'OK   entradas inválidas e título em reais são recusados';

  -- 4) Recebimento ACIMA do previsto (2600 > 2500): ajusta total e recebido, guarda o previsto.
  v_res := registrar_recebimento_cambial(v_r1, 2600, '2026-10-09');
  IF NOT (v_res->>'ok')::boolean OR (v_res->>'previsto')::numeric <> 2500 OR (v_res->>'recebido')::numeric <> 2600 OR (v_res->>'diferenca')::numeric <> 100 THEN
    RAISE EXCEPTION 'FALHOU: retorno do recebimento acima do previsto: %', v_res;
  END IF;
  SELECT total_amount, received_amount, status::text, valor_previsto, (received_at AT TIME ZONE 'UTC')::date
    INTO v_tot, v_rec, v_st, v_prev, v_dt FROM receivables WHERE id = v_r1;
  IF v_tot <> 2600 OR v_rec <> 2600 OR v_st <> 'recebido' OR v_prev <> 2500 OR v_dt <> '2026-10-09' THEN
    RAISE EXCEPTION 'FALHOU: linha após o recebimento: total %, recebido %, status %, previsto %, data %', v_tot, v_rec, v_st, v_prev, v_dt;
  END IF;
  RAISE NOTICE 'OK   recebimento acima do previsto ajusta total/recebido e guarda o previsto';

  -- 5) Auditoria: uma linha de log com antes/depois.
  SELECT count(*) INTO v_n FROM reconciliacao_recebimento_log
   WHERE receivable_id = v_r1 AND (antes->>'total_amount')::numeric = 2500 AND (depois->>'total_amount')::numeric = 2600
     AND (depois->>'valor_previsto')::numeric = 2500;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: esperava 1 linha de log, veio %', v_n; END IF;
  RAISE NOTICE 'OK   auditoria registrada em reconciliacao_recebimento_log';

  -- 6) Com a parcela 2 ainda aberta, o projeto NÃO fica recebido.
  SELECT status_titulo::text INTO v_proj FROM projetos_financeiro WHERE proposta_id = v_b;
  IF v_proj = 'pagamento_recebido' THEN RAISE EXCEPTION 'FALHOU: projeto não pode ficar recebido com parcela aberta'; END IF;
  RAISE NOTICE 'OK   projeto segue aberto enquanto há parcela aberta';

  -- 7) Já recebido: recusa. (não deixa ajustar de novo nem trocar o previsto)
  v_res := registrar_recebimento_cambial(v_r1, 9999, '2026-10-10');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'status_invalido' THEN RAISE EXCEPTION 'FALHOU: título já recebido: %', v_res; END IF;
  SELECT valor_previsto INTO v_prev FROM receivables WHERE id = v_r1;
  IF v_prev <> 2500 THEN RAISE EXCEPTION 'FALHOU: o previsto não pode mudar (veio %)', v_prev; END IF;
  RAISE NOTICE 'OK   título já recebido é recusado e o previsto não muda';

  -- 8) Recebimento ABAIXO do previsto (2300 < 2500) na última parcela: o projeto fecha.
  v_res := registrar_recebimento_cambial(v_r2, 2300, '2026-10-08');
  IF NOT (v_res->>'ok')::boolean OR (v_res->>'diferenca')::numeric <> -200 THEN RAISE EXCEPTION 'FALHOU: recebimento abaixo do previsto: %', v_res; END IF;
  SELECT status::text, total_amount, received_amount INTO v_st, v_tot, v_rec FROM receivables WHERE id = v_r2;
  IF v_st <> 'recebido' OR v_tot <> 2300 OR v_rec <> 2300 THEN RAISE EXCEPTION 'FALHOU: parcela 2: % % %', v_st, v_tot, v_rec; END IF;
  SELECT status_titulo::text INTO v_proj FROM projetos_financeiro WHERE proposta_id = v_b;
  IF v_proj <> 'pagamento_recebido' THEN RAISE EXCEPTION 'FALHOU: com todas as parcelas recebidas o projeto deveria fechar (veio %)', v_proj; END IF;
  RAISE NOTICE 'OK   recebimento abaixo do previsto fecha a parcela e o projeto';

  -- 9) Título cancelado: recusa (a checagem de status vem antes da de moeda).
  UPDATE receivables SET status = 'cancelado' WHERE id = v_r3;
  v_res := registrar_recebimento_cambial(v_r3, 100, '2026-10-08');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'status_invalido' THEN RAISE EXCEPTION 'FALHOU: título cancelado: %', v_res; END IF;
  RAISE NOTICE 'OK   título cancelado é recusado';

  -- 10) O valor vendido do projeto não muda com os recebimentos (continua o previsto em reais).
  SELECT valor_vendido INTO v_vv FROM projetos_financeiro WHERE proposta_id = v_b;
  IF v_vv <> 5000 THEN RAISE EXCEPTION 'FALHOU: valor_vendido mudou (veio %)', v_vv; END IF;
  RAISE NOTICE 'OK   valor_vendido do projeto segue 5000 após os recebimentos';

  -- 11) Projeto em US$ com UMA parcela: receber fecha o projeto com a data informada.
  INSERT INTO budgets (code, project_name, category, status, client_id)
  VALUES ('TESTE-RCB3', 'Teste parcela única', 'digital', 'em_negociacao', v_cli) RETURNING id INTO v_b3;
  INSERT INTO budget_versions (budget_id, version_number, currency, fx_market_rate, fx_rate, fx_source)
  VALUES (v_b3, 1, 'USD', 5, 4.85, 'manual') RETURNING id INTO v_v3;
  INSERT INTO projetos_financeiro (proposta_id, cliente_id, valor_vendido, nf_percent, status_titulo)
  VALUES (v_b3, v_cli, 3000, 0.18, 'esperando_pagamento');
  INSERT INTO receivables (budget_id, budget_version_id, description, client_id, total_amount, status, origem, parcela_numero, parcela_total)
  VALUES (v_b3, v_v3, 'Parcela única', v_cli, 3000, 'aguardando', 'proposta', 1, 1) RETURNING id INTO v_r4;
  v_res := registrar_recebimento_cambial(v_r4, 3123.45, '2026-10-07');
  IF NOT (v_res->>'ok')::boolean THEN RAISE EXCEPTION 'FALHOU: parcela única: %', v_res; END IF;
  SELECT status_titulo::text, data_recebido, valor_vendido INTO v_proj, v_dt, v_vv FROM projetos_financeiro WHERE proposta_id = v_b3;
  IF v_proj <> 'pagamento_recebido' OR v_dt <> '2026-10-07' OR v_vv <> 3000 THEN
    RAISE EXCEPTION 'FALHOU: projeto de parcela única: status %, data_recebido %, valor_vendido %', v_proj, v_dt, v_vv;
  END IF;
  RAISE NOTICE 'OK   parcela única em US$ fecha o projeto (pagamento_recebido, data_recebido = data informada, valor_vendido intacto)';
END $$;

ROLLBACK;
