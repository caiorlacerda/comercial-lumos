-- Mural de recados: feed persistente de avisos do time (estilo mural/feed).
-- Todos os usuários ativos leem; só admin cria/edita/remove/fixa.

CREATE TABLE IF NOT EXISTS public.mural_posts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  title      text,
  content    text NOT NULL,
  pinned     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mural_posts_feed ON public.mural_posts (pinned DESC, created_at DESC);

ALTER TABLE public.mural_posts ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário autenticado.
DROP POLICY IF EXISTS "mural read" ON public.mural_posts;
CREATE POLICY "mural read" ON public.mural_posts FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Escrita (criar/editar/remover): só admin.
DROP POLICY IF EXISTS "mural insert" ON public.mural_posts;
CREATE POLICY "mural insert" ON public.mural_posts FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "mural update" ON public.mural_posts;
CREATE POLICY "mural update" ON public.mural_posts FOR UPDATE
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "mural delete" ON public.mural_posts;
CREATE POLICY "mural delete" ON public.mural_posts FOR DELETE
  USING (public.get_user_role() = 'admin');

-- Realtime: o feed atualiza sozinho quando um recado é criado/editado/removido.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mural_posts;
EXCEPTION
  WHEN duplicate_object THEN NULL; -- já está na publicação
  WHEN undefined_object THEN NULL; -- publicação não existe neste ambiente
END $$;
