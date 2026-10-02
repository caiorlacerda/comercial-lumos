-- public.fornecedores nunca teve uma migration própria de CREATE TABLE — foi
-- criada direto no Studio em algum momento; as migrations seguintes (FK de
-- project_tasks.responsavel_freela_id em 2026082400, tipo/cidade em
-- 2026093300, etc.) sempre assumiram que ela já existia. Isso impedia
-- recriar o banco do zero com `supabase start` (descoberto só agora).
--
-- Reconstruída por inferência do uso real no código (nenhuma introspecção
-- direta da produção foi possível nesta sessão):
--   - src/types/fornecedor.ts: id, nome, cnpj, telefone, email, payment_info,
--     notes, created_at, updated_at, created_by.
--   - src/pages/CadastroFornecedorPublico.tsx (autocadastro público, anon):
--     insere também origem='autocadastro', status_cadastro='pendente' — e
--     NUNCA lê de volta (comentário no próprio arquivo: "sem retornar via
--     SELECT para contornar RLS de leitura"), confirmando que anon só tem
--     INSERT, nunca SELECT.
--   - src/pages/Fornecedores.tsx: aprova com
--     update({status_cadastro: 'aprovado'}) — logo default é 'aprovado'
--     (cadastro manual pelo time já nasce aprovado; só autocadastro começa
--     pendente).
--   - tipo/cidade ficam de fora daqui de propósito: continuam sendo
--     adicionadas por 2026093300_fornecedores_tipo_cidade_e_notas.sql
--     (ADD COLUMN IF NOT EXISTS), pra não reescrever a história da migration.
--
-- Vale conferir contra a produção antes de confiar cegamente nisso.
CREATE TABLE IF NOT EXISTS public.fornecedores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  cnpj            text,
  telefone        text,
  email           text,
  payment_info    text,
  notes           text,
  origem          text NOT NULL DEFAULT 'manual',
  status_cadastro text NOT NULL DEFAULT 'aprovado',
  created_by      uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fornecedores authenticated all" ON public.fornecedores;
CREATE POLICY "fornecedores authenticated all" ON public.fornecedores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Autocadastro público (/cadastro-fornecedor): anon só insere.
DROP POLICY IF EXISTS "fornecedores anon insert" ON public.fornecedores;
CREATE POLICY "fornecedores anon insert" ON public.fornecedores
  FOR INSERT TO anon WITH CHECK (true);

GRANT ALL ON public.fornecedores TO authenticated;
GRANT INSERT ON public.fornecedores TO anon;

-- public.fornecedor_servicos — mesma situação: nunca teve CREATE TABLE
-- próprio (2026073100_faxina_servicos.sql e 2026093308_fase0_fundacao_verdade.sql
-- só fazem UPDATE/ALTER assumindo que ela já existe). Reconstruída de
-- src/types/fornecedor.ts (FornecedorServico) + CadastroFornecedorPublico.tsx
-- (autocadastro público insere serviços como anon, junto com o fornecedor).
CREATE TABLE IF NOT EXISTS public.fornecedor_servicos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  tipo_servico  text NOT NULL,
  valor         numeric,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fornecedor_servicos_fornecedor ON public.fornecedor_servicos(fornecedor_id);

ALTER TABLE public.fornecedor_servicos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fornecedor_servicos authenticated all" ON public.fornecedor_servicos;
CREATE POLICY "fornecedor_servicos authenticated all" ON public.fornecedor_servicos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "fornecedor_servicos anon insert" ON public.fornecedor_servicos;
CREATE POLICY "fornecedor_servicos anon insert" ON public.fornecedor_servicos
  FOR INSERT TO anon WITH CHECK (true);

GRANT ALL ON public.fornecedor_servicos TO authenticated;
GRANT INSERT ON public.fornecedor_servicos TO anon;
