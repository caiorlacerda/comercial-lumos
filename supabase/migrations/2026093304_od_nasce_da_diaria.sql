-- ORDEM DO DIA NASCE DE UMA DIÁRIA: vínculo pra saber qual diária já virou
-- OD (o modal de criação mostra "já tem OD" e abre a existente).
ALTER TABLE public.ordens_do_dia
  ADD COLUMN IF NOT EXISTS diaria_id uuid REFERENCES public.project_diarias(id) ON DELETE SET NULL;
