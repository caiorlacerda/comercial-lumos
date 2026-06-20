-- Migration: Fase 1 — Custos de Projeto + Contas a Receber
-- Created: 2026-06-20

-- 1. TABLE: projetos_financeiro
CREATE TABLE IF NOT EXISTS projetos_financeiro (
  id                          uuid primary key default gen_random_uuid(),
  proposta_id                 uuid references budgets(id) ON DELETE SET NULL,
  project_id                  uuid references projects(id) ON DELETE CASCADE,
  cliente_id                  uuid not null references clients(id),
  categoria_id                uuid references categorias(id) ON DELETE SET NULL,
  tipo_servico_id             uuid references tipos_servico(id) ON DELETE SET NULL,
  icp                         icp_tipo,
  valor_vendido               numeric(12,2) not null default 0,
  nf_percent                  numeric(5,4) not null,
  custos_total                numeric(12,2) not null default 0,
  data_recebimento_negociada  date,
  status_titulo               status_titulo not null default 'emitir_nf',
  data_recebido               date,
  origem                      text default 'auto_aprovacao',
  pendente_preenchimento      boolean default true,
  created_at                  timestamptz default now()
);

-- 2. VIEW: vw_rentabilidade
CREATE OR REPLACE VIEW vw_rentabilidade as
select
  p.*,
  round(p.valor_vendido * p.nf_percent, 2)                          as valor_nf,
  round(p.valor_vendido * (1 - p.nf_percent), 2)                   as receita_liquida,
  round(p.valor_vendido - p.custos_total, 2)                       as lucro_operacional,
  round(p.valor_vendido * (1 - p.nf_percent) - p.custos_total, 2)  as lucro_liquido,
  case when p.valor_vendido > 0
       then round((p.valor_vendido*(1-p.nf_percent) - p.custos_total)
                  / p.valor_vendido, 4)
       else 0 end                                                   as margem,
  (p.status_titulo = 'esperando_pagamento'
     and p.data_recebimento_negociada < current_date)               as vencido
from projetos_financeiro p;

-- 3. TRIGGER FUNCTION: sync_project_costs_to_financeiro
CREATE OR REPLACE FUNCTION sync_project_costs_to_financeiro()
RETURNS TRIGGER AS $$
DECLARE
  v_budget_id UUID;
  v_total NUMERIC;
BEGIN
  -- Determine budget_id
  IF TG_OP = 'DELETE' THEN
    v_budget_id := OLD.budget_id;
    IF v_budget_id IS NULL AND OLD.project_id IS NOT NULL THEN
      SELECT budget_id INTO v_budget_id FROM projects WHERE id = OLD.project_id;
    END IF;
  ELSE
    v_budget_id := NEW.budget_id;
    IF v_budget_id IS NULL AND NEW.project_id IS NOT NULL THEN
      SELECT budget_id INTO v_budget_id FROM projects WHERE id = NEW.project_id;
    END IF;
  END IF;

  IF v_budget_id IS NOT NULL THEN
    -- Sum all costs for this budget, directly or via projects table
    SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM project_costs
    WHERE budget_id = v_budget_id OR project_id IN (
      SELECT id FROM projects WHERE budget_id = v_budget_id
    );

    UPDATE projetos_financeiro
    SET custos_total = v_total
    WHERE proposta_id = v_budget_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 4. TRIGGER: trigger_sync_project_costs_to_financeiro
DROP TRIGGER IF EXISTS trigger_sync_project_costs_to_financeiro ON project_costs;
CREATE TRIGGER trigger_sync_project_costs_to_financeiro
AFTER INSERT OR UPDATE OR DELETE ON project_costs
FOR EACH ROW EXECUTE FUNCTION sync_project_costs_to_financeiro();

-- 5. ROW LEVEL SECURITY (RLS)
ALTER TABLE projetos_financeiro ENABLE ROW LEVEL SECURITY;

-- SELECT policies: allow select for admin and producao
CREATE POLICY select_projetos_financeiro ON projetos_financeiro
  FOR SELECT USING (get_user_role() IN ('admin', 'producao'));

-- ALL policies: allow full access for admin users only
CREATE POLICY admin_projetos_financeiro ON projetos_financeiro
  FOR ALL USING (get_user_role() = 'admin');
