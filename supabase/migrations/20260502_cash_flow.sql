-- ─── Lumos Intranet: Cash Flow & Fixed Costs Migration ───────────────────────
-- Created: 2026-05-02
-- Tables: fixed_costs, cash_flow_entries
-- RLS: disabled (internal admin tool)

-- ─── fixed_costs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fixed_costs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  amount          decimal(12,2) NOT NULL DEFAULT 0,
  category        text NOT NULL DEFAULT 'outros',
  payment_method  text DEFAULT 'manual',
  paid_by         text DEFAULT 'Lumos',
  is_active       boolean DEFAULT true,
  notes           text,
  sort_order      int DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- RLS disabled for now
ALTER TABLE fixed_costs DISABLE ROW LEVEL SECURITY;

-- ─── cash_flow_entries ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cash_flow_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date   date NOT NULL,
  type         text NOT NULL CHECK (type IN ('entrada', 'saida')),
  amount       decimal(12,2) NOT NULL,
  category     text,
  description  text NOT NULL,
  project_name text,
  notes        text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- RLS disabled for now
ALTER TABLE cash_flow_entries DISABLE ROW LEVEL SECURITY;

-- ─── Pre-load fixed costs data ────────────────────────────────────────────────

INSERT INTO fixed_costs (name, amount, category, payment_method, paid_by, is_active, sort_order) VALUES
  -- Espaço
  ('Aluguel',          2000.00,  'espaco',       'manual',    'Lumos', true,  10),
  ('Condomínio',        615.00,  'espaco',       'manual',    'Lumos', true,  20),
  ('Luz',               81.55,  'espaco',       'manual',    'Lumos', true,  30),
  ('Internet',          99.00,  'espaco',       'manual',    'Lumos', true,  40),

  -- Software
  ('Adobe',            165.00,  'software',     'cartao',    'Lumos', true,  50),
  ('Artlist',           62.88,  'software',     'cartao',    'Lumos', true,  60),
  ('Frame IO',         180.00,  'software',     'cartao',    'Lumos', true,  70),
  ('Mister Horse',     115.00,  'software',     'cartao',    'Lumos', true,  80),
  ('Envato',           200.00,  'software',     'cartao',    'Lumos', true,  90),
  ('Google',           350.00,  'software',     'cartao',    'Lumos', true, 100),
  ('Click Up',         280.00,  'software',     'cartao',    'Lumos', true, 110),

  -- Serviços
  ('G&G (contador)',   698.99,  'servicos',     'manual',    'Lumos', true, 120),

  -- Equipe
  ('Geovana Souza',   3000.00,  'equipe',       'manual',    'Lumos', true, 130),
  ('Vinícius Gimenez',4300.00,  'equipe',       'manual',    'Lumos', true, 140),
  ('Tawany Rein',     5700.00,  'equipe',       'manual',    'Lumos', true, 150),
  ('Samantha',        5500.00,  'equipe',       'manual',    'Lumos', true, 160),
  ('Leone',           2500.00,  'equipe',       'manual',    'Lumos', true, 170);
