-- Migration: Geração automática e atômica de códigos de orçamento (#ANO-SEQ)
-- Created: 2026-06-25

-- 1. Função para gerar o próximo código com lock exclusivo de tabela para garantir atomicidade
CREATE OR REPLACE FUNCTION generate_next_budget_code()
RETURNS text AS $$
DECLARE
  current_year text;
  next_seq integer;
BEGIN
  -- Bloqueia a tabela budgets em modo exclusivo curto para evitar condições de corrida em inserts concorrentes.
  -- EXCLUSIVE MODE bloqueia comandos concorrentes de INSERT/UPDATE/DELETE na tabela,
  -- mas permite SELECT normal.
  LOCK TABLE budgets IN EXCLUSIVE MODE;

  -- Pega o ano corrente
  current_year := to_char(now(), 'YYYY');

  -- Calcula o maior sequencial numérico global no final de qualquer código e soma 1
  SELECT COALESCE(MAX(NULLIF(substring(code from '([0-9]+)$'), '')::integer), 0) + 1
  INTO next_seq
  FROM budgets;

  -- Retorna no formato #ANO-SEQ
  RETURN '#' || current_year || '-' || next_seq;
END;
$$ LANGUAGE plpgsql;

-- 2. Função acionada pelo trigger BEFORE INSERT para associar o código se ele for '----', NULL ou vazio
CREATE OR REPLACE FUNCTION budgets_assign_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '----' OR NEW.code = '' THEN
    NEW.code := generate_next_budget_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger na tabela budgets
DROP TRIGGER IF EXISTS budgets_before_insert_code ON budgets;
CREATE TRIGGER budgets_before_insert_code
  BEFORE INSERT ON budgets
  FOR EACH ROW
  EXECUTE FUNCTION budgets_assign_code();

-- 4. Redefinição da função RPC next_budget_code para manter compatibilidade retroativa e informativa
CREATE OR REPLACE FUNCTION next_budget_code()
RETURNS text AS $$
DECLARE
  current_year text;
  next_seq integer;
BEGIN
  current_year := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(NULLIF(substring(code from '([0-9]+)$'), '')::integer), 0) + 1
  INTO next_seq
  FROM budgets;
  RETURN '#' || current_year || '-' || next_seq;
END;
$$ LANGUAGE plpgsql;
