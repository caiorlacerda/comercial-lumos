-- Thumbnail do vídeo de revisão.
--
-- O Google Drive NÃO gera thumbnail para arquivos enviados pela service account
-- (hasThumbnail = false permanente), então capturamos um frame no navegador e
-- guardamos aqui (data URL JPEG pequeno, ~15–40 KB). É preenchido quando o vídeo
-- é aberto na revisão interna.
ALTER TABLE public.video_versions ADD COLUMN IF NOT EXISTS thumb_url text;
