-- public.client_contacts (contatos de um cliente — ClientModal.tsx,
-- ClientProfile.tsx) nunca teve uma migration própria de CREATE TABLE — foi
-- criada direto no Studio em algum momento. A primeira referência em migration
-- é a FK de budget_versions.contact_id em 2026093308_fase0_fundacao_verdade.sql,
-- que assume a tabela já existindo. Isso impedia recriar o banco do zero com
-- `supabase start` (descoberto só agora).
--
-- Reconstruída de src/utils/financials.ts (interface ClientContact) +
-- src/components/clients/ClientModal.tsx (CRUD real: ordena por created_at,
-- is_primary é o primeiro contato da lista). Uso é só autenticado (dentro do
-- AuthWrapper) — sem necessidade de acesso anon.
--
-- Vale conferir contra a produção antes de confiar cegamente nisso.
CREATE TABLE IF NOT EXISTS public.client_contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name       text NOT NULL,
  email      text,
  phone      text,
  role       text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_client ON public.client_contacts(client_id);

ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_contacts authenticated all" ON public.client_contacts;
CREATE POLICY "client_contacts authenticated all" ON public.client_contacts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.client_contacts TO authenticated;
