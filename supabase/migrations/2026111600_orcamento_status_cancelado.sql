-- Novo status de orçamento: "cancelado" = aprovado e depois caiu (diferente de "reprovado", que é o não antes de fechar).
-- Só acrescenta o rótulo ao tipo; não mexe em nenhum dado. Precisa rodar ANTES do arquivo 2026111601
-- (um rótulo novo de enum só pode ser usado depois que esta transação termina).
ALTER TYPE public.budget_status ADD VALUE IF NOT EXISTS 'cancelado';
