-- Biblioteca de locações reutilizáveis por cliente. Cada linha é um endereço
-- "favorito" (ex.: o estúdio ou escritório do cliente), pra não precisar
-- redigitar em toda Ordem do Dia nova.
CREATE TABLE IF NOT EXISTS public.client_locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  endereco   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_locations_client_id_idx ON public.client_locations(client_id);

ALTER TABLE public.client_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_locations_all ON public.client_locations FOR ALL TO authenticated USING (true) WITH CHECK (true);
