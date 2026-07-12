-- Link do site de cada serviço no cofre de Acessos & Senhas. Um hyperlink por
-- serviço (compartilhado pelas linhas do mesmo serviço).
ALTER TABLE public.access_credentials ADD COLUMN IF NOT EXISTS url text;
