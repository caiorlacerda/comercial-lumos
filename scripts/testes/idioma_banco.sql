-- Teste do banco LOCAL para a migration 2026101100. Não rodar em produção.
-- Rodar: docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/idioma_banco.sql
BEGIN;

CREATE FUNCTION pg_temp.deve_falhar(p_sql text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK   %', p_msg;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (esperava check_violation): %', p_msg;
END $$;

DO $$
DECLARE
  v_cli uuid; v_b uuid; v_v uuid; v_lang text; v_tr jsonb;
BEGIN
  INSERT INTO clients (name) VALUES ('Cliente teste idioma') RETURNING id INTO v_cli;
  INSERT INTO budgets (code, project_name, category, status, client_id)
  VALUES ('TESTE-IDI', 'Teste idioma', 'digital', 'em_negociacao', v_cli) RETURNING id INTO v_b;
  INSERT INTO budget_versions (budget_id, version_number) VALUES (v_b, 1) RETURNING id INTO v_v;

  -- 1) padrão: português, sem traduções
  SELECT pdf_language, translations INTO v_lang, v_tr FROM budget_versions WHERE id = v_v;
  IF v_lang <> 'pt' OR v_tr IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: padrão deveria ser pt/null (veio %, %)', v_lang, v_tr;
  END IF;
  RAISE NOTICE 'OK   padrão é pt e sem traduções';

  -- 2) idioma inválido é recusado
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET pdf_language = ''fr'' WHERE id = %L', v_v), 'idioma fora de pt/en é recusado');

  -- 3) en + glossário jsonb é aceito e volta igual
  UPDATE budget_versions
     SET pdf_language = 'en',
         translations = '{"versao":1,"textos":{"Diária de câmera":"Camera day rate"}}'::jsonb
   WHERE id = v_v;
  SELECT pdf_language, translations INTO v_lang, v_tr FROM budget_versions WHERE id = v_v;
  IF v_lang <> 'en' OR v_tr->'textos'->>'Diária de câmera' <> 'Camera day rate' THEN
    RAISE EXCEPTION 'FALHOU: en/translations não voltaram (%, %)', v_lang, v_tr;
  END IF;
  RAISE NOTICE 'OK   en e glossário são gravados e lidos de volta';

  -- 4) o gatilho da trava de moeda NÃO bloqueia mudança de idioma com orçamento aprovado
  UPDATE budgets SET status = 'aprovado' WHERE id = v_b;
  UPDATE budget_versions SET pdf_language = 'pt', translations = NULL WHERE id = v_v;
  RAISE NOTICE 'OK   idioma e traduções continuam editáveis com o orçamento aprovado';
END $$;

ROLLBACK;
