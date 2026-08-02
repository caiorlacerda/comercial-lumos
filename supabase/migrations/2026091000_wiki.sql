-- Wiki (base de conhecimento estilo GitBook).
-- Espaços = "coleções"/livros; páginas = árvore (parent_id) dentro de um espaço.
-- Permissão: todo mundo do time LÊ e EDITA (decisão do produto).

CREATE TABLE IF NOT EXISTS public.wiki_spaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL DEFAULT 'Novo espaço',
  icon        text DEFAULT '📘',
  ordem       int NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wiki_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id    uuid NOT NULL REFERENCES public.wiki_spaces(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES public.wiki_pages(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'Sem título',
  content     text NOT NULL DEFAULT '',   -- HTML do editor (sanitizado no render)
  icon        text,                        -- emoji opcional
  ordem       int NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_space ON public.wiki_pages(space_id);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_parent ON public.wiki_pages(parent_id);

-- RLS: qualquer usuário autenticado lê e edita (wiki colaborativa do time).
ALTER TABLE public.wiki_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wiki_pages  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wiki_spaces_all ON public.wiki_spaces;
CREATE POLICY wiki_spaces_all ON public.wiki_spaces
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS wiki_pages_all ON public.wiki_pages;
CREATE POLICY wiki_pages_all ON public.wiki_pages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.wiki_spaces TO authenticated;
GRANT ALL ON public.wiki_pages  TO authenticated;

-- Realtime (pra a árvore/página atualizar ao vivo quando alguém edita).
ALTER PUBLICATION supabase_realtime ADD TABLE public.wiki_spaces;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wiki_pages;

-- Semente: um espaço "Onboarding" com uma página de boas-vindas.
DO $$
DECLARE sp uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.wiki_spaces) THEN
    INSERT INTO public.wiki_spaces (name, icon, ordem) VALUES ('Onboarding', '👋', 0) RETURNING id INTO sp;
    INSERT INTO public.wiki_pages (space_id, title, icon, ordem, content)
    VALUES (sp, 'Bem-vindo à Lumos', '👋', 0,
      '<h2>O que é a Wiki</h2><p>Aqui a gente reúne os documentos oficiais, processos e tutoriais do time. Qualquer pessoa pode criar e editar páginas, todo mundo lê.</p><h2>Como começar</h2><p>Crie uma página nova no menu à esquerda e comece a documentar o que você aprende.</p>');
  END IF;
END $$;
