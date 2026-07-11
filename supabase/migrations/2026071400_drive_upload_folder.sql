-- Guarda o ID da pasta de upload do projeto (06_ENTREGA/01_REVISAO) para
-- linkar direto no app — o editor clica e abre a pasta certa no Drive.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS drive_upload_folder_id text;
