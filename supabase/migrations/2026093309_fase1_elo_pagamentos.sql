-- FASE 1 DA VERDADE ÚNICA — O ELO DOS PAGAMENTOS
--
-- Hierarquia decidida: CUSTOS DE PROJETO é o mestre. Conta a pagar, reembolso
-- e cobrança de nota refletem a partir dele. Pagou em qualquer tela (custo,
-- conta a pagar, reembolso ou nota), o banco propaga pros outros — com
-- convergência garantida: cada gatilho só age quando o valor realmente muda,
-- então a cadeia para sozinha, sem loop.
--
-- Não muda informação existente: colunas novas do legado são derivadas do
-- próprio registro (um payable com paid_at preenchido ganha status 'pago' na
-- coluna NOVA — nada que já existia é alterado). Vínculos retroativos não são
-- adivinhados; os elos valem daqui pra frente.

SET lock_timeout = '15s';

-- ── 1. Conta a pagar ganha origem e chaves de volta ───────────────────────
ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS origem           text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS reimbursement_id uuid,
  ADD COLUMN IF NOT EXISTS cost_id          uuid,
  ADD COLUMN IF NOT EXISTS fornecedor_id    uuid,
  ADD COLUMN IF NOT EXISTS fixed_cost_id    uuid,
  ADD COLUMN IF NOT EXISTS competencia      date,
  ADD COLUMN IF NOT EXISTS paid_by          uuid,
  ADD COLUMN IF NOT EXISTS status           text;

-- A coluna nova 'status' materializa o que cada registro já diz (paid_at).
UPDATE public.payables
SET status = CASE WHEN paid_at IS NULL THEN 'pendente' ELSE 'pago' END
WHERE status IS NULL;
ALTER TABLE public.payables ALTER COLUMN status SET DEFAULT 'pendente';

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.payables ADD CONSTRAINT fk_payables_reimbursement
      FOREIGN KEY (reimbursement_id) REFERENCES public.reimbursements(id) ON DELETE SET NULL NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.payables ADD CONSTRAINT fk_payables_cost
      FOREIGN KEY (cost_id) REFERENCES public.project_costs(id) ON DELETE CASCADE NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.payables ADD CONSTRAINT fk_payables_fornecedor
      FOREIGN KEY (fornecedor_id) REFERENCES public.fornecedores(id) ON DELETE SET NULL NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.payables ADD CONSTRAINT fk_payables_fixed_cost
      FOREIGN KEY (fixed_cost_id) REFERENCES public.fixed_costs(id) ON DELETE SET NULL NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.payables ADD CONSTRAINT fk_payables_paid_by
      FOREIGN KEY (paid_by) REFERENCES public.app_users(id) ON DELETE SET NULL NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.payables ADD CONSTRAINT chk_payables_status
      CHECK (status IN ('pendente', 'pago', 'cancelado')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payables_reimbursement
  ON public.payables (reimbursement_id) WHERE reimbursement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payables_cost
  ON public.payables (cost_id) WHERE cost_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payables_fixed_cost_mes
  ON public.payables (fixed_cost_id, competencia) WHERE fixed_cost_id IS NOT NULL;

-- Reembolso ganha quem pagou; custo fixo ganha dia de vencimento.
ALTER TABLE public.reimbursements ADD COLUMN IF NOT EXISTS paid_by uuid;
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.reimbursements ADD CONSTRAINT fk_reimbursements_paid_by
      FOREIGN KEY (paid_by) REFERENCES public.app_users(id) ON DELETE SET NULL NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
ALTER TABLE public.fixed_costs ADD COLUMN IF NOT EXISTS due_day int NOT NULL DEFAULT 5;

-- ── 2. Quem é o usuário logado (pra carimbar quem pagou/aprovou) ──────────
CREATE OR REPLACE FUNCTION public.fn_app_user_atual()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM app_users WHERE auth_user_id = auth.uid() AND status = 'ativo';
$$;

-- ── 3. HUB: pagamento do custo propaga pros espelhos ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_custo_propaga_pagamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- conta a pagar espelho (direta ou do reembolso deste custo)
  UPDATE payables p
  SET paid_at = NEW.paid_at,
      status  = CASE WHEN NEW.status = 'pago' THEN 'pago' ELSE 'pendente' END,
      paid_by = NEW.paid_by,
      updated_at = now()
  WHERE (p.cost_id = NEW.id
         OR (NEW.reimbursement_id IS NOT NULL AND p.reimbursement_id = NEW.reimbursement_id))
    AND (p.paid_at IS DISTINCT FROM NEW.paid_at
         OR p.status IS DISTINCT FROM CASE WHEN NEW.status = 'pago' THEN 'pago' ELSE 'pendente' END);

  -- reembolso de origem: pago ↔ aprovado acompanha o custo
  IF NEW.reimbursement_id IS NOT NULL THEN
    UPDATE reimbursements r
    SET status  = CASE WHEN NEW.status = 'pago' THEN 'pago'::reimbursement_status ELSE 'aprovado'::reimbursement_status END,
        paid_at = CASE WHEN NEW.status = 'pago' THEN COALESCE(NEW.paid_at, now()) ELSE NULL END,
        paid_by = CASE WHEN NEW.status = 'pago' THEN NEW.paid_by ELSE NULL END,
        updated_at = now()
    WHERE r.id = NEW.reimbursement_id
      AND r.status IN ('aprovado', 'pago')
      AND r.status IS DISTINCT FROM CASE WHEN NEW.status = 'pago' THEN 'pago'::reimbursement_status ELSE 'aprovado'::reimbursement_status END;
  END IF;

  -- custo pago cancela cobrança de nota ainda não enviada (na hora, não só no cron)
  IF NEW.status = 'pago' THEN
    UPDATE nota_requests SET status = 'cancelada', updated_at = now()
    WHERE cost_id = NEW.id AND status = 'agendada';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_custo_propaga_pagamento ON public.project_costs;
CREATE TRIGGER trg_custo_propaga_pagamento
  AFTER UPDATE ON public.project_costs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.paid_at IS DISTINCT FROM NEW.paid_at)
  EXECUTE FUNCTION public.fn_custo_propaga_pagamento();

-- ── 4. Conta a pagar paga → volta pro hub ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_payable_propaga_pagamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pago boolean := NEW.paid_at IS NOT NULL;
  v_achou_custo boolean := false;
BEGIN
  -- espelha no custo (direto ou via reembolso); o hub repropaga o resto
  UPDATE project_costs c
  SET status  = CASE WHEN v_pago THEN 'pago' ELSE 'pendente' END,
      paid_at = NEW.paid_at,
      paid_by = COALESCE(NEW.paid_by, fn_app_user_atual()),
      updated_at = now()
  WHERE (c.id = NEW.cost_id
         OR (NEW.reimbursement_id IS NOT NULL AND c.reimbursement_id = NEW.reimbursement_id))
    AND c.paid_at IS DISTINCT FROM NEW.paid_at;
  v_achou_custo := FOUND;

  -- reembolso interno (sem projeto, sem custo espelho): direto
  IF NOT v_achou_custo AND NEW.reimbursement_id IS NOT NULL THEN
    UPDATE reimbursements r
    SET status  = CASE WHEN v_pago THEN 'pago'::reimbursement_status ELSE 'aprovado'::reimbursement_status END,
        paid_at = CASE WHEN v_pago THEN COALESCE(NEW.paid_at, now()) ELSE NULL END,
        paid_by = CASE WHEN v_pago THEN COALESCE(NEW.paid_by, fn_app_user_atual()) ELSE NULL END,
        updated_at = now()
    WHERE r.id = NEW.reimbursement_id
      AND r.status IN ('aprovado', 'pago')
      AND r.paid_at IS DISTINCT FROM NEW.paid_at;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_payable_propaga_pagamento ON public.payables;
CREATE TRIGGER trg_payable_propaga_pagamento
  AFTER UPDATE ON public.payables
  FOR EACH ROW
  WHEN (OLD.paid_at IS DISTINCT FROM NEW.paid_at)
  EXECUTE FUNCTION public.fn_payable_propaga_pagamento();

-- ── 5. Workflow do reembolso vira responsabilidade do banco ───────────────
-- Carimbos automáticos (quem aprovou, quando pagou).
CREATE OR REPLACE FUNCTION public.fn_reembolso_carimbos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('aprovado', 'rejeitado') AND NEW.reviewed_at IS NULL THEN
      NEW.reviewed_by := fn_app_user_atual();
      NEW.reviewed_at := now();
    END IF;
    IF NEW.status = 'pago' AND NEW.paid_at IS NULL THEN
      NEW.paid_at := now();
      NEW.paid_by := COALESCE(NEW.paid_by, fn_app_user_atual());
    ELSIF NEW.status <> 'pago' AND OLD.status = 'pago' THEN
      NEW.paid_at := NULL;
      NEW.paid_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_reembolso_carimbos ON public.reimbursements;
CREATE TRIGGER trg_reembolso_carimbos
  BEFORE UPDATE ON public.reimbursements
  FOR EACH ROW EXECUTE FUNCTION public.fn_reembolso_carimbos();

-- Reflexos do status (o que o front fazia na mão, agora transacional).
CREATE OR REPLACE FUNCTION public.fn_reembolso_reflexos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nome text;
BEGIN
  IF NEW.status = 'aprovado' THEN
    SELECT full_name INTO v_nome FROM app_users WHERE id = NEW.requester_id;

    -- conta a pagar espelho, agora COM vínculo (uma por reembolso)
    INSERT INTO payables (description, amount, due_date, category, notes,
                          origem, reimbursement_id, project_id, status, created_by)
    SELECT 'Reembolso — ' || COALESCE(v_nome, 'funcionário'), NEW.amount, CURRENT_DATE,
           'outro', NEW.description, 'reembolso', NEW.id, NEW.project_id, 'pendente',
           fn_app_user_atual()
    WHERE NOT EXISTS (SELECT 1 FROM payables WHERE reimbursement_id = NEW.id);

    -- custo espelho no projeto: só CRIA; edições feitas no custo não são
    -- sobrescritas nunca mais
    IF NEW.project_id IS NOT NULL THEN
      INSERT INTO project_costs (project_id, description, amount, cost_date, category,
                                 responsible_id, notes, reimbursement_id, created_by, status)
      SELECT NEW.project_id, NEW.description, NEW.amount, NEW.expense_date, 'outro',
             NEW.requester_id, 'Reembolso — ' || COALESCE(v_nome, 'funcionário'),
             NEW.id, fn_app_user_atual(), 'pendente'
      WHERE NOT EXISTS (SELECT 1 FROM project_costs WHERE reimbursement_id = NEW.id);
    END IF;

  ELSIF NEW.status = 'pago' THEN
    -- paga o custo (o hub propaga pra conta a pagar); reembolso interno paga a conta direto
    UPDATE project_costs
    SET status = 'pago', paid_at = COALESCE(NEW.paid_at, now()),
        paid_by = COALESCE(NEW.paid_by, fn_app_user_atual()), updated_at = now()
    WHERE reimbursement_id = NEW.id AND status IS DISTINCT FROM 'pago';
    IF NOT FOUND THEN
      UPDATE payables
      SET paid_at = COALESCE(NEW.paid_at, now()), status = 'pago',
          paid_by = COALESCE(NEW.paid_by, fn_app_user_atual()), updated_at = now()
      WHERE reimbursement_id = NEW.id AND paid_at IS NULL;
    END IF;

  END IF;

  IF NEW.status = 'rejeitado' THEN
    DELETE FROM project_costs WHERE reimbursement_id = NEW.id;
    DELETE FROM payables WHERE reimbursement_id = NEW.id AND paid_at IS NULL;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_reembolso_reflexos ON public.reimbursements;
CREATE TRIGGER trg_reembolso_reflexos
  AFTER UPDATE ON public.reimbursements
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_reembolso_reflexos();

-- Excluir o reembolso limpa a conta a pagar não paga (o custo já cai por CASCADE).
CREATE OR REPLACE FUNCTION public.fn_reembolso_excluido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM payables WHERE reimbursement_id = OLD.id AND paid_at IS NULL;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_reembolso_excluido ON public.reimbursements;
CREATE TRIGGER trg_reembolso_excluido
  BEFORE DELETE ON public.reimbursements
  FOR EACH ROW EXECUTE FUNCTION public.fn_reembolso_excluido();

-- ── 6. Nota marcada como paga = custo pago ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nota_paga_paga_custo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cost_id IS NOT NULL THEN
    UPDATE project_costs
    SET status = 'pago', paid_at = COALESCE(paid_at, now()),
        paid_by = COALESCE(paid_by, fn_app_user_atual()), updated_at = now()
    WHERE id = NEW.cost_id AND status IS DISTINCT FROM 'pago';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_nota_paga_paga_custo ON public.nota_requests;
CREATE TRIGGER trg_nota_paga_paga_custo
  AFTER UPDATE ON public.nota_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'paga')
  EXECUTE FUNCTION public.fn_nota_paga_paga_custo();

-- ── 7. Custos fixos viram conta a pagar do mês, sozinhos ──────────────────
CREATE OR REPLACE FUNCTION public.gerar_payables_custos_fixos()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mes date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  v_criadas int;
BEGIN
  INSERT INTO payables (description, amount, due_date, category, notes,
                        origem, fixed_cost_id, competencia, status)
  SELECT fc.name || ' — ' || to_char(v_mes, 'MM/YYYY'),
         fc.amount,
         -- vence no due_day do mês (ou no último dia, se o mês for mais curto)
         LEAST(v_mes + (fc.due_day - 1), (v_mes + interval '1 month - 1 day')::date),
         CASE WHEN fc.category IN ('equipe','equipamento','locacao','transporte','alimentacao',
                                   'hospedagem','marketing','software','impostos',
                                   'servicos_terceiros','manutencao','outro')
              THEN fc.category::expense_category ELSE 'outro'::expense_category END,
         fc.notes, 'custo_fixo', fc.id, v_mes, 'pendente'
  FROM fixed_costs fc
  WHERE fc.is_active
    AND NOT EXISTS (
      SELECT 1 FROM payables p WHERE p.fixed_cost_id = fc.id AND p.competencia = v_mes
    );
  GET DIAGNOSTICS v_criadas = ROW_COUNT;
  RETURN v_criadas;
END; $$;

-- Todo dia 1º às 9h (Brasília). Pra gerar as do mês corrente agora, rode:
--   SELECT public.gerar_payables_custos_fixos();
DO $$
BEGIN
  PERFORM cron.unschedule('lumos-custos-fixos-mensal');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('lumos-custos-fixos-mensal', '0 12 1 * *',
                     $$SELECT public.gerar_payables_custos_fixos()$$);

-- ── Conferência (aba Results): gatilhos instalados ────────────────────────
SELECT event_object_table AS tabela, trigger_name
FROM information_schema.triggers
WHERE trigger_name IN ('trg_custo_propaga_pagamento', 'trg_payable_propaga_pagamento',
                       'trg_reembolso_carimbos', 'trg_reembolso_reflexos',
                       'trg_reembolso_excluido', 'trg_nota_paga_paga_custo')
GROUP BY 1, 2 ORDER BY 1, 2;
