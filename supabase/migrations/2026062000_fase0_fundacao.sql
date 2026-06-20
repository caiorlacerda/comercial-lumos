-- Migration: Fase 0 — Fundação dimensional
-- Created: 2026-06-20

-- 1. ENUMS (Safe creation)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'icp_tipo') THEN
        CREATE TYPE icp_tipo AS ENUM ('icp_1', 'icp_2');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_titulo') THEN
        CREATE TYPE status_titulo AS ENUM ('emitir_nf', 'pedido_nf_feito', 'esperando_pagamento', 'pagamento_atraso', 'pagamento_recebido');
    END IF;
END$$;

-- 2. TABLES
CREATE TABLE IF NOT EXISTS categorias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text not null unique,           -- 'Digital' | 'Filme' | 'Live'
  ordem       int default 0,
  ativo       boolean default true
);

CREATE TABLE IF NOT EXISTS tipos_servico (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id uuid not null references categorias(id) ON DELETE CASCADE,
  nome         text not null,
  ativo        boolean default true,
  unique (categoria_id, nome)
);

CREATE TABLE IF NOT EXISTS config_financeiro (
  id              int primary key default 1,
  nf_percent      numeric(5,4) not null default 0.18,  -- 18%
  margem_default  numeric(5,4) not null default 0.40,  -- 40%
  atualizado_em   timestamptz default now(),
  constraint single_row check (id = 1)
);

-- 3. SEED INITIAL DATA
INSERT INTO config_financeiro (id, nf_percent, margem_default)
VALUES (1, 0.1800, 0.4000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO categorias (nome, ordem) VALUES
  ('Digital', 10),
  ('Filme', 20),
  ('Live', 30)
ON CONFLICT (nome) DO NOTHING;

-- Seed tipos_servico
INSERT INTO tipos_servico (categoria_id, nome)
SELECT id, 'Criação de Conteúdo' FROM categorias WHERE nome = 'Digital'
ON CONFLICT DO NOTHING;

INSERT INTO tipos_servico (categoria_id, nome)
SELECT id, 'Cliente Mensal' FROM categorias WHERE nome = 'Digital'
ON CONFLICT DO NOTHING;

INSERT INTO tipos_servico (categoria_id, nome)
SELECT id, 'Cursos' FROM categorias WHERE nome = 'Digital'
ON CONFLICT DO NOTHING;

INSERT INTO tipos_servico (categoria_id, nome)
SELECT id, 'Serviço Individual' FROM categorias WHERE nome = 'Digital'
ON CONFLICT DO NOTHING;

INSERT INTO tipos_servico (categoria_id, nome)
SELECT id, 'Cobertura de Eventos' FROM categorias WHERE nome = 'Digital'
ON CONFLICT DO NOTHING;

INSERT INTO tipos_servico (categoria_id, nome)
SELECT id, 'Institucional' FROM categorias WHERE nome = 'Filme'
ON CONFLICT DO NOTHING;

INSERT INTO tipos_servico (categoria_id, nome)
SELECT id, 'Publicidade' FROM categorias WHERE nome = 'Filme'
ON CONFLICT DO NOTHING;

INSERT INTO tipos_servico (categoria_id, nome)
SELECT id, 'Comercial de TV' FROM categorias WHERE nome = 'Filme'
ON CONFLICT DO NOTHING;

INSERT INTO tipos_servico (categoria_id, nome)
SELECT id, 'Transmissão / Estrutura' FROM categorias WHERE nome = 'Live'
ON CONFLICT DO NOTHING;

INSERT INTO tipos_servico (categoria_id, nome)
SELECT id, 'Cliente Mensal' FROM categorias WHERE nome = 'Live'
ON CONFLICT DO NOTHING;

-- 4. ROW LEVEL SECURITY (RLS)
ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_servico ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_financeiro ENABLE ROW LEVEL SECURITY;

-- Helper get_user_role function if not exists
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT role::text FROM app_users WHERE auth_user_id = auth.uid() AND status = 'ativo';
$$ LANGUAGE sql SECURITY DEFINER;

-- SELECT policies: allow select for all authenticated users
CREATE POLICY select_categorias ON categorias
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY select_tipos_servico ON tipos_servico
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY select_config_financeiro ON config_financeiro
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ALL policies: allow full access for admin users only
CREATE POLICY admin_categorias ON categorias
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY admin_tipos_servico ON tipos_servico
  FOR ALL USING (get_user_role() = 'admin');

CREATE POLICY admin_config_financeiro ON config_financeiro
  FOR ALL USING (get_user_role() = 'admin');
