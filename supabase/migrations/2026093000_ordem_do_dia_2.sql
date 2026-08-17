-- ORDEM DO DIA 2.0 — a call sheet completa, no formato do benchmark.
--
-- Os campos que já existiam continuam valendo como estão (plano_acao é o
-- cronograma, talentos é o elenco, equipe é a ficha técnica). Entram os que
-- faltavam pra página nova. Nada de dado migrado: a página lê o antigo e
-- escreve no novo.

ALTER TABLE public.ordens_do_dia
  ADD COLUMN IF NOT EXISTS hora_inicio  time,
  ADD COLUMN IF NOT EXISTS hora_fim     time,
  ADD COLUMN IF NOT EXISTS aprovacao    text NOT NULL DEFAULT 'rascunho',
  ADD COLUMN IF NOT EXISTS call_times   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS regras       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS locacoes     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS objetos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS figurino     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS equipamentos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS roteiros     jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.ordens_do_dia DROP CONSTRAINT IF EXISTS ordens_aprovacao_check;
ALTER TABLE public.ordens_do_dia ADD CONSTRAINT ordens_aprovacao_check
  CHECK (aprovacao IN ('rascunho', 'aprovada'));
