-- LUMOS BUDGET STUDIO - DATABASE SCHEMA

-- 1. ENUMS
CREATE TYPE budget_category AS ENUM ('digital', 'filme', 'live');
CREATE TYPE budget_status AS ENUM ('rascunho', 'em_negociacao', 'aprovado', 'reprovado');
CREATE TYPE item_group AS ENUM ('equipe', 'equipamentos', 'edicao', 'producao');
CREATE TYPE unit_label AS ENUM ('diaria', 'hora', 'video', 'unidade', 'pacote', 'pessoa', 'noite', 'trecho', 'km', 'evento');

-- 2. TABLES

-- Clientes
CREATE TABLE clients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  contact_name text,
  email        text,
  phone        text,
  notes        text,
  created_at   timestamptz DEFAULT now()
);

-- Orçamentos (container)
CREATE TABLE budgets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid REFERENCES clients(id),
  code              text UNIQUE NOT NULL, -- ex: '0192'
  project_name      text NOT NULL,
  category          budget_category NOT NULL,
  status            budget_status NOT NULL DEFAULT 'rascunho',
  active_version_id uuid, -- FK circular para budget_versions (adicionado após criar a tabela)
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Versões de orçamento
CREATE TABLE budget_versions (
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
  created_by           uuid REFERENCES auth.users(id),
  UNIQUE(budget_id, version_number)
);

-- Adicionar FK circular
ALTER TABLE budgets
  ADD CONSTRAINT budgets_active_version_fkey
  FOREIGN KEY (active_version_id) REFERENCES budget_versions(id) DEFERRABLE INITIALLY DEFERRED;

-- Catálogo de itens
CREATE TABLE item_catalog (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_group        item_group NOT NULL,
  subcategory       text,
  name              text NOT NULL,
  default_unit_cost numeric, -- null = "a definir"
  unit_label        text NOT NULL DEFAULT 'diaria',
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz DEFAULT now()
);

-- Itens de cada versão
CREATE TABLE budget_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       uuid NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  catalog_item_id  uuid REFERENCES item_catalog(id), -- nullable = item avulso
  item_group       item_group NOT NULL,
  name             text NOT NULL,
  unit_cost        numeric NOT NULL DEFAULT 0,
  quantity         numeric NOT NULL DEFAULT 1,
  unit_label       text NOT NULL DEFAULT 'diaria',
  override_margin  numeric, -- nullable: sobrescreve margin_pct da versão
  sort_order       integer NOT NULL DEFAULT 0
);

-- 3. INDICES
CREATE INDEX idx_budgets_client ON budgets(client_id);
CREATE INDEX idx_budgets_status ON budgets(status);
CREATE INDEX idx_budget_versions_budget ON budget_versions(budget_id);
CREATE INDEX idx_budget_items_version ON budget_items(version_id);
CREATE INDEX idx_item_catalog_group ON item_catalog(item_group) WHERE is_active = true;

-- 4. TRIGGER: UPDATED_AT
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budgets_updated_at
  BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. GERADOR DE CÓDIGO
CREATE SEQUENCE budget_code_seq START 1;

CREATE OR REPLACE FUNCTION next_budget_code()
RETURNS text AS $$
BEGIN
  RETURN LPAD(nextval('budget_code_seq')::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- 6. RLS POLICIES
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access to authenticated users" ON clients FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Allow full access to authenticated users" ON budgets FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Allow full access to authenticated users" ON budget_versions FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Allow full access to authenticated users" ON budget_items FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Allow full access to authenticated users" ON item_catalog FOR ALL USING (auth.uid() IS NOT NULL);

-- 7. SEED DATA
INSERT INTO item_catalog (item_group, subcategory, name, default_unit_cost, unit_label) VALUES
('equipe', 'Direção', 'Diretor (Small)', 1200, 'diaria'),
('equipe', 'Direção', 'Diretor (Publi)', 3000, 'diaria'),
('equipe', 'Direção', 'Diretor de Fotografia', 3000, 'diaria'),
('equipe', 'Direção', 'Diretor de Arte', 500, 'diaria'),
('equipe', 'Direção', 'Roteirista', 200, 'diaria'),
('equipe', 'Captação', 'Cinegrafista', 1000, 'diaria'),
('equipe', 'Captação', 'Fotógrafo', 1000, 'diaria'),
('equipe', 'Captação', 'Piloto de Drone FPV', 3000, 'diaria'),
('equipe', 'Captação', 'Op. de TP', 800, 'diaria'),
('equipe', 'Captação', 'DTV', 1000, 'diaria'),
('equipe', 'Captação', 'Logger', 500, 'diaria'),
('equipe', 'Som', 'Áudio', 1000, 'diaria'),
('equipe', 'Iluminação', 'Gaffer', 700, 'diaria'),
('equipe', 'Pós-produção', 'Editor', 1800, 'diaria'),
('equipe', 'Pós-produção', 'Editor (CGI)', 15000, 'diaria'),
('equipe', 'Pós-produção', 'Motion Designer', 700, 'diaria'),
('equipe', 'Pós-produção', 'Colorista', 900, 'diaria'),
('equipe', 'Live / Transmissão', 'VMix', 1000, 'diaria'),
('equipe', 'Live / Transmissão', 'Social Media Manager', 2000, 'diaria'),
('equipe', 'Produção', 'Produtor', 1000, 'diaria'),
('equipe', 'Produção', 'Coordenador', 1500, 'diaria'),
('equipe', 'Produção', 'Assist. de produção', 550, 'diaria'),
('equipe', 'Produção', 'Atendimento', 400, 'diaria'),
('equipe', 'Produção', 'Coord. de pós-produção', null, 'diaria'),
('equipe', 'Arte / Elenco', 'Figurinista', 800, 'diaria'),
('equipe', 'Arte / Elenco', 'Maquiadora', 1000, 'diaria'),
('equipe', 'Arte / Elenco', 'Contra-Regra', 500, 'diaria'),
('equipe', 'Arte / Elenco', 'Segurança', 300, 'diaria'),
('equipe', 'Outros', 'Locução', 300, 'diaria'),
('equipe', 'Outros', 'Intérprete / Tradutor', null, 'diaria'),
('equipe', 'Outros', 'DJ / Sonoplasta', null, 'diaria'),
('equipamentos', null, 'FX3', 649, 'diaria'),
('equipamentos', null, 'FX30', 499, 'diaria'),
('equipamentos', null, 'BMPCC6K', 549, 'diaria'),
('equipamentos', null, 'Outra câmera', 549, 'diaria'),
('equipamentos', 'Lentes', 'Lente 16-35', 250, 'diaria'),
('equipamentos', 'Lentes', 'Lente 24-70', 250, 'diaria'),
('equipamentos', 'Lentes', 'Lente 70-200', 320, 'diaria'),
('equipamentos', 'Lentes', 'Outras lentes', 250, 'diaria'),
('equipamentos', 'Iluminação', 'Amaran 200x', 190, 'diaria'),
('equipamentos', 'Iluminação', 'Amaran 300c', 299, 'diaria'),
('equipamentos', 'Iluminação', 'Amaran 60x', 129, 'diaria'),
('equipamentos', 'Iluminação', 'Amaran T2C', 99, 'diaria'),
('equipamentos', 'Iluminação', 'Amaran T4C', 139, 'diaria'),
('equipamentos', 'Iluminação', 'Outra iluminação', 239, 'diaria'),
('equipamentos', 'Áudio', 'DJI Mic Lapela', 159, 'diaria'),
('equipamentos', 'Áudio', 'Deity S-Mic 2S Shotgun', 120, 'diaria'),
('equipamentos', 'Áudio', 'Zoom H6', 179, 'diaria'),
('equipamentos', 'Áudio', 'Kit Podcast', 1290, 'diaria'),
('equipamentos', 'Suporte', 'Ronin RS3PRO', 429, 'diaria'),
('equipamentos', null, 'DJI Mini 3 Pro', 449, 'diaria'),
('equipamentos', null, 'Insta360 X3 Câmera 360º', 399, 'diaria'),
('equipamentos', 'Iluminação', 'Softbox Aputure Light Dome II', 69, 'diaria'),
('equipamentos', 'Live', 'Atem Mini Pro', 350, 'diaria'),
('equipamentos', 'Suporte', 'Hydra Tilta', 600, 'diaria'),
('equipamentos', null, 'Bateria V-Mount', 299, 'diaria'),
('equipamentos', 'Live', 'Switcher VMix', 1000, 'diaria'),
('equipamentos', null, 'Sony NX5R', 420, 'diaria'),
('equipamentos', 'Live', 'Teradek Bolt 6 LT 750', 1000, 'diaria'),
('equipamentos', null, 'Rádios HT', 35, 'diaria'),
('equipamentos', null, 'Compania do TP', 800, 'diaria'),
('equipamentos', 'Áudio', 'Allen & Heat SQ 5', 600, 'diaria'),
('equipamentos', null, 'Monitor', 250, 'diaria'),
('equipamentos', 'Live', 'Transmissão Sem-fio', 250, 'diaria'),
('equipamentos', 'Suporte', 'Easy-Rig', 300, 'diaria'),
('equipamentos', 'Suporte', 'Follow-Focus', 350, 'diaria'),
('equipamentos', null, 'HD ou SSD 2TB', 1300, 'diaria'),
('equipamentos', null, 'HD ou SSD 4TB', 2300, 'diaria'),
('equipamentos', 'Áudio', 'Microfone Lapela', 350, 'diaria'),
('equipamentos', null, 'Intercom', 1000, 'diaria'),
('equipamentos', 'Iluminação', 'Painel de Led 2.5m x 3m', 8000, 'diaria'),
('equipamentos', null, 'NoBreak', 350, 'diaria'),
('edicao', 'Pós-produção', 'Decupagem', null, 'video'),
('edicao', 'Pós-produção', 'Montagem e edição', null, 'video'),
('edicao', 'Pós-produção', 'Correção de cor', null, 'video'),
('edicao', 'Pós-produção', 'Motion graphics', null, 'video'),
('edicao', 'Pós-produção', 'Mixagem e masterização de áudio', null, 'video'),
('edicao', 'Pós-produção', 'Finalização', null, 'video'),
('edicao', 'Assets', 'Banco de imagens', 299, 'unidade'),
('edicao', 'Assets', 'Assets 3D', null, 'unidade'),
('edicao', 'Assets', 'Trilha original', 2500, 'unidade'),
('edicao', 'Pacote', 'Pacote de pós-produção', null, 'pacote'),
('producao', null, 'Alimentação', 80, 'pessoa'),
('producao', null, 'Transporte (Van)', 500, 'diaria'),
('producao', null, 'Gasolina / Pedágio', 6.37, 'km'),
('producao', null, 'Hospedagem', 300, 'noite'),
('producao', null, 'Passagem Aérea', null, 'trecho'),
('producao', null, 'Cenário', null, 'unidade'),
('producao', null, 'Locação', null, 'diaria'),
('producao', null, 'Casting', null, 'unidade'),
('producao', null, 'Autorização de gravação', null, 'unidade'),
('producao', null, 'Bebidas, snacks & etc.', 40, 'pessoa'),
('producao', null, 'Aluguel de carro', 400, 'diaria'),
('producao', null, 'Logística', null, 'unidade'),
('producao', null, 'Roupas', null, 'unidade'),
('producao', null, 'Catering', null, 'unidade'),
('producao', null, 'Estúdio', 800, 'diaria'),
('producao', null, 'Internet dedicada', 7000, 'evento'),
('producao', null, 'Painel de Led', 8500, 'diaria'),
('producao', null, 'Programação de jogos', 3000, 'unidade'),
('producao', null, 'Produção de objetos', null, 'unidade'),
('producao', null, 'Segurança', 400, 'diaria'),
('producao', null, 'Libras', 500, 'video'),
('producao', null, 'Documentação', null, 'unidade');
