-- Novo cargo "social_media" (Social Media da produtora). Vê o mesmo que editor
-- e atendimento: toda a Produção + Início + Configurações. Só adiciona o valor
-- ao enum; os defaults de permissão ficam no app (ROLE_DEFAULTS).
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'social_media';
