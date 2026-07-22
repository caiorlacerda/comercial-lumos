-- Prazo de entrega ao cliente por tarefa (separado do prazo de edição = data_fim).
-- Visível só para admin/produção/atendimento no app (o front controla).
ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS data_entrega_cliente date;
