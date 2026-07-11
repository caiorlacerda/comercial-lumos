-- Metadados de upload para a lista estilo Frame.io do painel de revisão.
-- uploaded_by/uploaded_at vêm do Drive (drive-watch); fps fica p/ um probe futuro.
ALTER TABLE public.video_versions ADD COLUMN IF NOT EXISTS uploaded_by text;
ALTER TABLE public.video_versions ADD COLUMN IF NOT EXISTS uploaded_at timestamptz;
ALTER TABLE public.video_versions ADD COLUMN IF NOT EXISTS fps numeric;
