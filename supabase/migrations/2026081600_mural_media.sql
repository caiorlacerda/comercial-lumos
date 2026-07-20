-- Mural: suporte a foto (upload) e vídeo (link do YouTube/Drive que vira player).

ALTER TABLE public.mural_posts
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS video_url text;

-- Bucket público para as fotos do mural.
INSERT INTO storage.buckets (id, name, public)
VALUES ('mural', 'mural', true)
ON CONFLICT (id) DO NOTHING;

-- Leitura pública (bucket público); escrita só admin.
DROP POLICY IF EXISTS "mural storage read" ON storage.objects;
CREATE POLICY "mural storage read" ON storage.objects FOR SELECT
  USING (bucket_id = 'mural');

DROP POLICY IF EXISTS "mural storage insert" ON storage.objects;
CREATE POLICY "mural storage insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'mural' AND public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "mural storage update" ON storage.objects;
CREATE POLICY "mural storage update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'mural' AND public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "mural storage delete" ON storage.objects;
CREATE POLICY "mural storage delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'mural' AND public.get_user_role() = 'admin');
