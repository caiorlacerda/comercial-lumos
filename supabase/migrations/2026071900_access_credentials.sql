-- Cofre de acessos/senhas dos serviços da Lumos (lista compartilhada, estilo
-- planilha). Credenciais sensíveis: leitura/escrita SÓ para admin e produção.
CREATE TABLE IF NOT EXISTS public.access_credentials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service     text NOT NULL DEFAULT '',      -- ex.: Google Emails, Frame, Adobe
  login       text NOT NULL DEFAULT '',
  password    text NOT NULL DEFAULT '',
  assigned_to text DEFAULT '',               -- "Tá com quem?" (Comercial, Sócios…)
  ordem       integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE public.access_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manage_access_credentials ON public.access_credentials;
CREATE POLICY manage_access_credentials ON public.access_credentials FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin','producao'))
  WITH CHECK (public.get_user_role() IN ('admin','producao'));
GRANT ALL ON public.access_credentials TO authenticated, service_role;
CREATE INDEX IF NOT EXISTS idx_access_service ON public.access_credentials(service, ordem);
