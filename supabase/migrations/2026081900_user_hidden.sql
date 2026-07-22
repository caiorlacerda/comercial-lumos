-- Contas ocultas: usuários de teste/visão que não aparecem na Equipe nem no
-- seletor de responsável, mas funcionam para login (ver a visão de cada cargo).
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
