-- Migration: Update Project Tasks status check constraint
-- Created At: 2026-07-03

BEGIN;

-- 1. Atualizar status antigos 'a_fazer' para 'iniciar' para não violar a nova constraint
UPDATE public.project_tasks 
SET status = 'iniciar' 
WHERE status = 'a_fazer';

-- 2. Alterar o valor DEFAULT da coluna status
ALTER TABLE public.project_tasks 
  ALTER COLUMN status SET DEFAULT 'iniciar';

-- 3. Remover constraint antiga
ALTER TABLE public.project_tasks 
  DROP CONSTRAINT IF EXISTS project_tasks_status_check;

-- 4. Adicionar a nova constraint com todos os 12 status
ALTER TABLE public.project_tasks 
  ADD CONSTRAINT project_tasks_status_check 
  CHECK (status IN (
    'iniciar', 'pausado', 'aguard_captacao', 'aguard_material', 
    'na_fila', 'em_progresso', 'revisao_interna', 'aprov_interna', 
    'revisao_cliente', 'alteracoes', 
    'entregue', 'concluido'
  ));

COMMIT;
