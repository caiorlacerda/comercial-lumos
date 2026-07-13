-- Reembolso aprovado -> vira custo do projeto (project_costs).
--
-- Contexto: quando alguém solicita um reembolso vinculado a um projeto e o admin
-- aprova, esse valor precisa aparecer nos custos daquele projeto. Até aqui a
-- aprovação só gerava uma conta a pagar (payables), nunca um project_cost.
--
-- 1) Liga cada custo ao reembolso que o originou (dedupe + limpeza em cascata).
-- 2) Permite custo em projeto sem orçamento (reembolso pode cair num projeto
--    criado na mão, sem budget vinculado).
-- 3) Ajusta o gatilho de soma de custos para também cobrir projetos SEM
--    orçamento (antes só somava quando havia proposta_id).

-- 1. Vínculo project_costs -> reimbursements ------------------------------------
ALTER TABLE public.project_costs
  ADD COLUMN IF NOT EXISTS reimbursement_id uuid
    REFERENCES public.reimbursements(id) ON DELETE CASCADE;

-- Um reembolso gera no máximo um custo (idempotência do fluxo de aprovação).
CREATE UNIQUE INDEX IF NOT EXISTS project_costs_reimbursement_id_key
  ON public.project_costs (reimbursement_id)
  WHERE reimbursement_id IS NOT NULL;

-- 2. Projetos sem orçamento também podem ter custos ----------------------------
ALTER TABLE public.project_costs ALTER COLUMN budget_id DROP NOT NULL;

-- 3. Recalcula custos_total cobrindo projeto COM e SEM orçamento ---------------
CREATE OR REPLACE FUNCTION public.sync_project_costs_to_financeiro()
RETURNS TRIGGER AS $$
DECLARE
  v_project_id UUID;
  v_budget_id  UUID;
  v_total      NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_project_id := OLD.project_id;
    v_budget_id  := OLD.budget_id;
  ELSE
    v_project_id := NEW.project_id;
    v_budget_id  := NEW.budget_id;
  END IF;

  -- Resolve o orçamento a partir do projeto, se o custo não trouxer budget_id.
  IF v_budget_id IS NULL AND v_project_id IS NOT NULL THEN
    SELECT budget_id INTO v_budget_id FROM public.projects WHERE id = v_project_id;
  END IF;

  IF v_budget_id IS NOT NULL THEN
    -- Projeto COM orçamento: soma por budget (direto ou via projects).
    SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM public.project_costs
    WHERE budget_id = v_budget_id
       OR project_id IN (SELECT id FROM public.projects WHERE budget_id = v_budget_id);

    UPDATE public.projetos_financeiro
    SET custos_total = v_total
    WHERE proposta_id = v_budget_id;

  ELSIF v_project_id IS NOT NULL THEN
    -- Projeto SEM orçamento: soma por project_id e atualiza a linha do projeto.
    SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM public.project_costs
    WHERE project_id = v_project_id;

    UPDATE public.projetos_financeiro
    SET custos_total = v_total
    WHERE project_id = v_project_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
