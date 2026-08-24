-- FASE 2 DA VERDADE ÚNICA — O ELO DA RECEITA
--
-- Não muda NENHUMA informação existente: os títulos que já existem viram
-- "parcela 1 de 1" (informação derivada do próprio registro), nada é apagado
-- nem recalculado. O que muda é daqui pra frente.
--
-- 1) Condição de pagamento vira estruturada na proposta (à vista com prazo,
--    ou 50% no fechamento + 50% N dias após a NF), no lugar do texto livre.
-- 2) Aprovar orçamento vira UMA função transacional no banco: projeto,
--    parcelas e registro financeiro nascem juntos ou nada nasce.
-- 3) Status do projeto passa a ser DERIVADO das parcelas (fim dos dois
--    vocabulários que se desencontravam).

SET lock_timeout = '15s';

-- ── 1. Condição de pagamento estruturada ──────────────────────────────────
ALTER TABLE public.budget_versions
  ADD COLUMN IF NOT EXISTS payment_plan text,      -- a_vista | entrada_saldo
  ADD COLUMN IF NOT EXISTS payment_days int,       -- prazo da parcela única / do saldo
  ADD COLUMN IF NOT EXISTS payment_entry_pct numeric;  -- % da entrada (padrão 50)

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.budget_versions ADD CONSTRAINT chk_payment_plan
      CHECK (payment_plan IS NULL OR payment_plan IN ('a_vista', 'entrada_saldo')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ── 2. Parcelas nos títulos a receber ─────────────────────────────────────
ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS parcela_numero int,
  ADD COLUMN IF NOT EXISTS parcela_total  int,
  ADD COLUMN IF NOT EXISTS project_id     uuid,
  ADD COLUMN IF NOT EXISTS origem         text NOT NULL DEFAULT 'manual';

-- Títulos que já existem: viram "1 de 1" e ganham origem 'proposta' quando
-- vieram de orçamento. É leitura do próprio registro, não alteração de valor.
UPDATE public.receivables
SET parcela_numero = COALESCE(parcela_numero, 1),
    parcela_total  = COALESCE(parcela_total, 1),
    origem = CASE WHEN budget_id IS NOT NULL THEN 'proposta' ELSE origem END
WHERE parcela_numero IS NULL OR parcela_total IS NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.receivables ADD CONSTRAINT fk_receivables_project
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- A trava antiga (1 título por orçamento) dá lugar a 1 por parcela.
DROP INDEX IF EXISTS uq_receivables_budget;
CREATE UNIQUE INDEX IF NOT EXISTS uq_receivables_budget_parcela
  ON public.receivables (budget_id, parcela_numero) WHERE budget_id IS NOT NULL;

-- ── 3. Status do projeto derivado das parcelas ────────────────────────────
-- Regra: tudo recebido → pagamento_recebido; algo vencido em aberto →
-- pagamento_atraso; senão, mantém o que o time definiu manualmente
-- (emitir_nf / pedido_nf_feito / esperando_pagamento).
CREATE OR REPLACE FUNCTION public.fn_receivable_reflete_projeto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_budget uuid := COALESCE(NEW.budget_id, OLD.budget_id);
  v_total numeric;
  v_recebido numeric;
  v_vencido int;
  v_novo status_titulo;
BEGIN
  IF v_budget IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(sum(total_amount), 0), COALESCE(sum(received_amount), 0),
         count(*) FILTER (WHERE received_amount < total_amount AND due_date < CURRENT_DATE)
    INTO v_total, v_recebido, v_vencido
  FROM receivables
  WHERE budget_id = v_budget AND status <> 'cancelado';

  IF v_total > 0 AND v_recebido >= v_total THEN
    v_novo := 'pagamento_recebido';
  ELSIF v_vencido > 0 THEN
    v_novo := 'pagamento_atraso';
  ELSE
    v_novo := NULL;  -- sem veredito: não mexe no que o time escolheu
  END IF;

  IF v_novo IS NOT NULL THEN
    UPDATE projetos_financeiro
    SET status_titulo = v_novo,
        data_recebido = CASE WHEN v_novo = 'pagamento_recebido'
                             THEN COALESCE(data_recebido, CURRENT_DATE) ELSE data_recebido END,
        updated_at = now()
    WHERE proposta_id = v_budget AND status_titulo IS DISTINCT FROM v_novo;
  END IF;

  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_receivable_reflete_projeto ON public.receivables;
CREATE TRIGGER trg_receivable_reflete_projeto
  AFTER INSERT OR UPDATE OF received_amount, total_amount, status, due_date OR DELETE
  ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION public.fn_receivable_reflete_projeto();

-- ── 4. Aprovar orçamento: uma função, tudo ou nada ────────────────────────
CREATE OR REPLACE FUNCTION public.aprovar_orcamento(p_budget_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b RECORD;
  v_versao RECORD;
  v_custo numeric := 0;
  v_total numeric := 0;
  v_project uuid;
  v_nf numeric;
  v_cat uuid;
  v_plan text;
  v_dias int;
  v_entrada_pct numeric;
  v_entrada numeric;
  v_criadas int := 0;
BEGIN
  SELECT id, project_name, code, client_id, category, active_version_id, status
    INTO b FROM budgets WHERE id = p_budget_id;
  IF b IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'orcamento_nao_encontrado'); END IF;
  IF b.active_version_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'sem_versao_ativa'); END IF;

  SELECT * INTO v_versao FROM budget_versions WHERE id = b.active_version_id;

  -- valor de venda pela mesma fórmula do app: custo / (1 - margem) - desconto
  SELECT COALESCE(sum(unit_cost * quantity), 0) INTO v_custo
  FROM budget_items WHERE version_id = b.active_version_id;
  IF v_custo > 0 AND COALESCE(v_versao.margin_pct, 0) < 1 THEN
    v_total := GREATEST(v_custo / (1 - COALESCE(v_versao.margin_pct, 0)) - COALESCE(v_versao.discount_value, 0), 0);
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

  -- parcelas conforme a condição de pagamento da proposta
  v_plan := COALESCE(v_versao.payment_plan, 'a_vista');
  v_dias := COALESCE(v_versao.payment_days, 30);
  v_entrada_pct := COALESCE(v_versao.payment_entry_pct, 50);

  IF v_total > 0 AND NOT EXISTS (SELECT 1 FROM receivables WHERE budget_id = p_budget_id) THEN
    IF v_plan = 'entrada_saldo' THEN
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
  WHERE lower(nome) = lower(COALESCE(b.category, '')) LIMIT 1;

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

GRANT EXECUTE ON FUNCTION public.aprovar_orcamento(uuid) TO authenticated;

-- ── 5. Proposta editada depois de aprovada: parcelas em aberto acompanham ─
CREATE OR REPLACE FUNCTION public.fn_versao_reajusta_parcelas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_budget uuid;
  v_custo numeric := 0;
  v_total numeric := 0;
  v_abertas int;
  v_recebido numeric;
BEGIN
  SELECT id INTO v_budget FROM budgets WHERE active_version_id = NEW.id AND status = 'aprovado';
  IF v_budget IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(sum(unit_cost * quantity), 0) INTO v_custo FROM budget_items WHERE version_id = NEW.id;
  IF v_custo > 0 AND COALESCE(NEW.margin_pct, 0) < 1 THEN
    v_total := GREATEST(v_custo / (1 - COALESCE(NEW.margin_pct, 0)) - COALESCE(NEW.discount_value, 0), 0);
  END IF;
  IF v_total <= 0 THEN RETURN NEW; END IF;

  SELECT count(*), COALESCE(sum(received_amount), 0) INTO v_abertas, v_recebido
  FROM receivables WHERE budget_id = v_budget AND received_amount < total_amount AND status <> 'cancelado';

  -- só mexe no que ainda não foi recebido, e distribui o que falta entre elas
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

DROP TRIGGER IF EXISTS trg_versao_reajusta_parcelas ON public.budget_versions;
CREATE TRIGGER trg_versao_reajusta_parcelas
  AFTER UPDATE OF margin_pct, discount_value ON public.budget_versions
  FOR EACH ROW EXECUTE FUNCTION public.fn_versao_reajusta_parcelas();

-- ── Conferência (aba Results) ─────────────────────────────────────────────
SELECT 'títulos existentes preservados como 1 de 1' AS item,
       count(*) FILTER (WHERE parcela_numero = 1 AND parcela_total = 1) AS qtd,
       count(*) AS total_titulos
FROM public.receivables;
