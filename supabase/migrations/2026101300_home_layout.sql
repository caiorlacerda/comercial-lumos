-- PERSONALIZAÇÃO DA HOME
--
-- Cada pessoa pode mostrar, esconder e reordenar os blocos da Home. O layout é um JSON
-- por usuário: {"v":1,"ordem":["resumo","hoje",...],"ocultos":["atalhos"]}.
--
-- Reaproveita a tabela dashboard_preferences (uma linha por usuário, com RLS "só o próprio"),
-- que o dashboard financeiro já usa para a coluna `preferences`. A coluna nova é separada,
-- então um não sobrescreve o outro (o upsert do financeiro só toca user_id/preferences).
--
-- Aditiva e segura de rodar antes ou depois do deploy do front. Enquanto ela não existir,
-- a Home guarda a personalização só no navegador (não acompanha a pessoa entre aparelhos).

ALTER TABLE public.dashboard_preferences
  ADD COLUMN IF NOT EXISTS home_layout jsonb;

COMMENT ON COLUMN public.dashboard_preferences.home_layout IS
  'Layout da Home da pessoa: ordem dos blocos e blocos escondidos.';
