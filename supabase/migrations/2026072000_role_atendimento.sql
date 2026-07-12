-- Novo cargo "atendimento" (vê o mesmo que editor: toda a Produção + Início +
-- Configurações). Adiciona o valor ao enum user_role.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'atendimento';
