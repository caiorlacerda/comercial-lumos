-- Migration: Fase 2 — Lançamentos + Dashboard mensal
-- Created: 2026-06-20

-- 1. CLEAN UP: Drop old cash_flow_entries table if exists
DROP TABLE IF EXISTS cash_flow_entries;

-- 2. TABLE: lancamentos_financeiros
CREATE TABLE IF NOT EXISTS lancamentos_financeiros (
  id                    uuid primary key default gen_random_uuid(),
  tipo                  text not null check (tipo in ('entrada','saida')),
  valor                 numeric(12,2) not null,
  data                  date not null,
  descricao             text not null,

  cliente_id            uuid not null references clients(id),
  categoria_id          uuid not null references categorias(id),
  tipo_servico_id       uuid not null references tipos_servico(id),
  projeto_financeiro_id uuid references projetos_financeiro(id) ON DELETE SET NULL,

  origem                text default 'manual',  -- 'manual' | 'import_extrato' | 'auto'
  created_at            timestamptz default now()
);

-- 3. VIEW: vw_resumo_mensal
CREATE OR REPLACE VIEW vw_resumo_mensal as
select
  date_trunc('month', data)::date                                   as mes,
  coalesce(sum(valor) filter (where tipo = 'entrada'), 0)          as entradas,
  coalesce(sum(valor) filter (where tipo = 'saida'), 0)            as saidas,
  coalesce(sum(valor) filter (where tipo = 'entrada'), 0)
    - coalesce(sum(valor) filter (where tipo = 'saida'), 0)        as lucro
from lancamentos_financeiros
group by 1
order by 1;

-- 4. ROW LEVEL SECURITY (RLS)
ALTER TABLE lancamentos_financeiros ENABLE ROW LEVEL SECURITY;

-- SELECT policies: allow select for admin and producao
CREATE POLICY select_lancamentos_financeiros ON lancamentos_financeiros
  FOR SELECT USING (get_user_role() IN ('admin', 'producao'));

-- ALL policies: allow full access for admin users only
CREATE POLICY admin_lancamentos_financeiros ON lancamentos_financeiros
  FOR ALL USING (get_user_role() = 'admin');
