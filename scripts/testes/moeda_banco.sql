-- Teste do banco LOCAL para a migration 2026100900. Não rodar em produção.
-- Tudo termina em ROLLBACK: não deixa nada para trás.
-- Rodar: docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/moeda_banco.sql
BEGIN;

-- Aprovar um orçamento dispara notificação (precisa de usuários); aqui não interessa.
ALTER TABLE public.budgets DISABLE TRIGGER trg_budget_approved_notification;

-- O banco local (montado só pelas migrations) não tem 3 colunas que existem em
-- produção e que a RPC pública lê (foram criadas fora das migrations). Cria aqui,
-- dentro da transação (o ROLLBACK desfaz); em produção já existem e é no-op.
ALTER TABLE public.budget_versions ADD COLUMN IF NOT EXISTS public_token uuid;
ALTER TABLE public.budget_items    ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.clients         ADD COLUMN IF NOT EXISTS agency_name text;

CREATE FUNCTION pg_temp.deve_falhar(p_sql text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK   %', p_msg;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (esperava erro): %', p_msg;
END $$;

DO $$
DECLARE
  v_b uuid; v_v uuid; v_cur text; v_json json;
BEGIN
  INSERT INTO budgets (code, project_name, category, status)
  VALUES ('TESTE-USD', 'Teste dólar', 'digital', 'rascunho') RETURNING id INTO v_b;
  INSERT INTO budget_versions (budget_id, version_number, public_token)
  VALUES (v_b, 1, gen_random_uuid()) RETURNING id INTO v_v;

  -- 1) padrão é BRL
  SELECT currency INTO v_cur FROM budget_versions WHERE id = v_v;
  IF v_cur <> 'BRL' THEN RAISE EXCEPTION 'FALHOU: padrão deveria ser BRL (veio %)', v_cur; END IF;
  RAISE NOTICE 'OK   padrão é BRL';

  -- 2) USD exige cotação; fonte e margem têm que ser válidas
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET currency = ''USD'' WHERE id = %L', v_v), 'USD sem cotação é recusado');
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET fx_source = ''xyz'' WHERE id = %L', v_v), 'fonte inválida é recusada');
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET fx_spread_pct = 1.5 WHERE id = %L', v_v), 'margem de segurança de 150 por cento é recusada');

  -- 3) USD com cotação é aceito
  UPDATE budget_versions
     SET currency = 'USD', fx_market_rate = 5, fx_spread_pct = 0.03, fx_rate = 4.85, fx_source = 'manual'
   WHERE id = v_v;
  RAISE NOTICE 'OK   USD com cotação é aceito';

  -- 4) RPC pública devolve moeda e cotação
  v_json := get_public_budget_by_token((SELECT public_token FROM budget_versions WHERE id = v_v));
  IF v_json->>'currency' <> 'USD' OR (v_json->>'fx_rate')::numeric <> 4.85 THEN
    RAISE EXCEPTION 'FALHOU: RPC pública sem moeda/cotação: %', v_json;
  END IF;
  RAISE NOTICE 'OK   RPC pública devolve currency e fx_rate';

  -- 5) orçamento aprovado: moeda e cotação travadas
  UPDATE budgets SET status = 'aprovado' WHERE id = v_b;
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET fx_rate = 4.80 WHERE id = %L', v_v), 'cotação travada com orçamento aprovado');
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET currency = ''BRL'' WHERE id = %L', v_v), 'moeda travada com orçamento aprovado');
  UPDATE budget_versions SET fx_rate = 4.85, notes_client = 'ok' WHERE id = v_v;
  RAISE NOTICE 'OK   gravar o mesmo valor e outros campos continua permitido';

  -- 6) volta para negociação: destrava
  UPDATE budgets SET status = 'em_negociacao' WHERE id = v_b;
  UPDATE budget_versions SET fx_market_rate = 5.1, fx_rate = 4.947 WHERE id = v_v;
  RAISE NOTICE 'OK   destrava ao voltar para em negociação';

  -- 7) cotacoes_dia aceita um registro por dia
  INSERT INTO cotacoes_dia (data, compra, venda) VALUES ('2026-10-08', 5.0113, 5.0119)
  ON CONFLICT (data) DO UPDATE SET compra = EXCLUDED.compra, venda = EXCLUDED.venda;
  INSERT INTO cotacoes_dia (data, compra, venda) VALUES ('2026-10-08', 5.0200, 5.0210)
  ON CONFLICT (data) DO UPDATE SET compra = EXCLUDED.compra, venda = EXCLUDED.venda;
  IF (SELECT count(*) FROM cotacoes_dia WHERE data = '2026-10-08') <> 1 THEN
    RAISE EXCEPTION 'FALHOU: cotacoes_dia deveria ter 1 registro por dia';
  END IF;
  RAISE NOTICE 'OK   cotacoes_dia guarda um registro por dia';
END $$;

ROLLBACK;
