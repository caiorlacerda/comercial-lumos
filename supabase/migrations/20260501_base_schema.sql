-- Base Schema Migration: Initializes original tables and enums
-- Created: 2026-05-01

-- 1. ENUMS (Safe creation)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'budget_category') THEN
    CREATE TYPE budget_category AS ENUM ('digital', 'filme', 'live');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'budget_status') THEN
    CREATE TYPE budget_status AS ENUM ('rascunho', 'em_negociacao', 'aprovado', 'reprovado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_group') THEN
    CREATE TYPE item_group AS ENUM ('equipe', 'equipamentos', 'edicao', 'producao');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unit_label') THEN
    CREATE TYPE unit_label AS ENUM ('diaria', 'hora', 'video', 'unidade', 'pacote', 'pessoa', 'noite', 'trecho', 'km', 'evento');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'producao', 'basico');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('ativo', 'inativo');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE payment_method AS ENUM ('pix', 'transferencia', 'boleto', 'cartao_credito', 'cartao_debito', 'dinheiro', 'cheque', 'outro');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_category') THEN
    CREATE TYPE expense_category AS ENUM ('equipe', 'equipamento', 'locacao', 'transporte', 'alimentacao', 'hospedagem', 'marketing', 'software', 'impostos', 'servicos_terceiros', 'manutencao', 'outro');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reimbursement_status') THEN
    CREATE TYPE reimbursement_status AS ENUM ('pendente', 'aprovado', 'pago', 'rejeitado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receivable_status') THEN
    CREATE TYPE receivable_status AS ENUM ('aguardando', 'parcial', 'recebido', 'inadimplente', 'cancelado');
  END IF;
END$$;

-- 2. HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- 3. TABLES

-- app_users
CREATE TABLE IF NOT EXISTS app_users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id      uuid UNIQUE,
  full_name         text NOT NULL,
  email             text NOT NULL UNIQUE,
  role              user_role NOT NULL DEFAULT 'basico',
  job_title         text,
  status            user_status NOT NULL DEFAULT 'ativo',
  custom_permissions jsonb DEFAULT '{}',
  invited_by        uuid REFERENCES app_users(id),
  joined_at         timestamptz DEFAULT now(),
  last_seen_at      timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- clients
CREATE TABLE IF NOT EXISTS clients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  contact_name text,
  email        text,
  phone        text,
  notes        text,
  created_at   timestamptz DEFAULT now()
);

-- budgets
CREATE TABLE IF NOT EXISTS budgets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid REFERENCES clients(id) ON DELETE SET NULL,
  code              text UNIQUE NOT NULL,
  project_name      text NOT NULL,
  category          budget_category NOT NULL,
  status            budget_status NOT NULL DEFAULT 'rascunho',
  active_version_id uuid,
  created_by        uuid,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- budget_versions
CREATE TABLE IF NOT EXISTS budget_versions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id            uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  version_number       integer NOT NULL DEFAULT 1,
  margin_pct           numeric NOT NULL DEFAULT 0.40,
  nf_pct               numeric NOT NULL DEFAULT 0.18,
  lumos_overhead_pct   numeric NOT NULL DEFAULT 0.10,
  discount_value       numeric NOT NULL DEFAULT 0,
  notes_internal       text,
  notes_client         text,
  payment_terms        text DEFAULT '60 dias após emissão da NF',
  validity_days        integer DEFAULT 7,
  created_at           timestamptz DEFAULT now(),
  created_by           uuid,
  UNIQUE(budget_id, version_number)
);

-- Add circular FK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budgets_active_version_fkey') THEN
    ALTER TABLE budgets
      ADD CONSTRAINT budgets_active_version_fkey
      FOREIGN KEY (active_version_id) REFERENCES budget_versions(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END$$;

-- item_catalog
CREATE TABLE IF NOT EXISTS item_catalog (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_group        item_group NOT NULL,
  subcategory       text,
  name              text NOT NULL,
  default_unit_cost numeric,
  unit_label        text NOT NULL DEFAULT 'diaria',
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz DEFAULT now()
);

-- budget_items
CREATE TABLE IF NOT EXISTS budget_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       uuid NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  catalog_item_id  uuid REFERENCES item_catalog(id) ON DELETE SET NULL,
  item_group       item_group NOT NULL,
  name             text NOT NULL,
  unit_cost        numeric NOT NULL DEFAULT 0,
  quantity         numeric NOT NULL DEFAULT 1,
  unit_label       text NOT NULL DEFAULT 'diaria',
  override_margin  numeric,
  sort_order       integer NOT NULL DEFAULT 0
);

-- projects
CREATE TABLE IF NOT EXISTS projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  code         text,
  budget_id    uuid REFERENCES budgets(id) ON DELETE SET NULL,
  client_id    uuid REFERENCES clients(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now()
);

-- project_costs
CREATE TABLE IF NOT EXISTS project_costs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id       uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  description     text NOT NULL,
  amount          numeric NOT NULL,
  cost_date       date NOT NULL,
  category        expense_category NOT NULL,
  payment_method  payment_method,
  supplier        text,
  responsible_id  uuid REFERENCES app_users(id) ON DELETE SET NULL,
  notes           text,
  drive_folder_id text,
  attachments     jsonb DEFAULT '[]',
  created_by      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- payables
CREATE TABLE IF NOT EXISTS payables (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description       text NOT NULL,
  amount            numeric NOT NULL,
  due_date          date NOT NULL,
  paid_at           timestamptz,
  category          expense_category NOT NULL,
  payment_method    payment_method,
  supplier          text,
  responsible_id    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  tags              text[] DEFAULT '{}',
  notes             text,
  drive_folder_id   text,
  attachments       jsonb DEFAULT '[]',
  created_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- receivables
CREATE TABLE IF NOT EXISTS receivables (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id           uuid REFERENCES budgets(id) ON DELETE SET NULL,
  budget_version_id   uuid REFERENCES budget_versions(id) ON DELETE SET NULL,
  description         text NOT NULL,
  client_id           uuid REFERENCES clients(id) ON DELETE SET NULL,
  total_amount        numeric NOT NULL,
  received_amount     numeric NOT NULL DEFAULT 0,
  due_date            date,
  received_at         timestamptz,
  status              receivable_status NOT NULL DEFAULT 'aguardando',
  payment_method      payment_method,
  notes               text,
  created_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- reimbursements
CREATE TABLE IF NOT EXISTS reimbursements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  description     text NOT NULL,
  amount          numeric NOT NULL,
  expense_date    date NOT NULL,
  payment_method  payment_method NOT NULL,
  status          reimbursement_status NOT NULL DEFAULT 'pendente',
  notes           text,
  drive_folder_id text,
  attachments     jsonb DEFAULT '[]',
  reviewed_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ordens_do_dia
CREATE TABLE IF NOT EXISTS ordens_do_dia (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         text NOT NULL,
  titulo         text NOT NULL,
  data_producao  date,
  clima          text,
  ponto_encontro jsonb,
  locacao        jsonb,
  contatos       jsonb,
  equipe         jsonb,
  plano_acao     jsonb,
  talentos       jsonb,
  secoes_ativas  jsonb,
  created_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- user_activity_log
CREATE TABLE IF NOT EXISTS user_activity_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES app_users(id) ON DELETE CASCADE,
  action      text NOT NULL,
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

-- 4. TRIGGERS UPDATED_AT
CREATE TRIGGER app_users_updated_at BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER payables_updated_at BEFORE UPDATE ON payables FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER receivables_updated_at BEFORE UPDATE ON receivables FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER reimbursements_updated_at BEFORE UPDATE ON reimbursements FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER project_costs_updated_at BEFORE UPDATE ON project_costs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER ordens_do_dia_updated_at BEFORE UPDATE ON ordens_do_dia FOR EACH ROW EXECUTE FUNCTION update_updated_at();
