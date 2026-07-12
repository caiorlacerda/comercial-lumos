-- Tour de boas-vindas: mostrado só no primeiro login. A flag tour_seen marca
-- quem já viu; admins podem "reenviar" o tour zerando essa flag (o app mostra
-- de novo no próximo acesso da pessoa).
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS tour_seen boolean NOT NULL DEFAULT false;
