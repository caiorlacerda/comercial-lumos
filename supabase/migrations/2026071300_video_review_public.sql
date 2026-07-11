-- Revisão de vídeo Fase 3 — link público, identificação, comentários e anotações.

-- 0) Specs do vídeo (preenchidas pelo drive-watch a partir do Drive)
ALTER TABLE public.video_versions ADD COLUMN IF NOT EXISTS width       integer;
ALTER TABLE public.video_versions ADD COLUMN IF NOT EXISTS height      integer;
ALTER TABLE public.video_versions ADD COLUMN IF NOT EXISTS duration_ms bigint;
ALTER TABLE public.video_versions ADD COLUMN IF NOT EXISTS size_bytes  bigint;
ALTER TABLE public.video_versions ADD COLUMN IF NOT EXISTS mime_type   text;

-- 1) Link público por versão (configurações do que o cliente pode fazer)
CREATE TABLE IF NOT EXISTS public.review_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_version_id  uuid NOT NULL REFERENCES public.video_versions(id) ON DELETE CASCADE,
  token             text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  watermark         boolean NOT NULL DEFAULT true,
  allow_download    boolean NOT NULL DEFAULT false,
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_links_version ON public.review_links(video_version_id);

-- 2) Quem abriu o link (identificação por nome)
CREATE TABLE IF NOT EXISTS public.review_viewers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_link_id uuid NOT NULL REFERENCES public.review_links(id) ON DELETE CASCADE,
  name           text NOT NULL,
  first_seen     timestamptz DEFAULT now(),
  last_seen      timestamptz DEFAULT now()
);

-- 3) Comentários (por timecode) — autor pode ser viewer (cliente) ou equipe
CREATE TABLE IF NOT EXISTS public.review_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_version_id  uuid NOT NULL REFERENCES public.video_versions(id) ON DELETE CASCADE,
  viewer_id         uuid REFERENCES public.review_viewers(id) ON DELETE SET NULL,
  author_name       text NOT NULL,
  is_team           boolean NOT NULL DEFAULT false,
  timecode_ms       integer NOT NULL DEFAULT 0,
  body              text NOT NULL DEFAULT '',
  resolved          boolean NOT NULL DEFAULT false,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_comments_version ON public.review_comments(video_version_id);

-- 4) Anotações vetoriais sobre o frame (coords normalizadas 0–1)
CREATE TABLE IF NOT EXISTS public.review_annotations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id  uuid NOT NULL REFERENCES public.review_comments(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('draw','arrow','rect','image')),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT now()
);

-- RLS: leitura interna autenticada; o público acessa SÓ pelos RPCs abaixo.
ALTER TABLE public.review_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_viewers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_comments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth manage review_links" ON public.review_links;
CREATE POLICY "auth manage review_links" ON public.review_links FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth read review_viewers" ON public.review_viewers;
CREATE POLICY "auth read review_viewers" ON public.review_viewers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth manage review_comments" ON public.review_comments;
CREATE POLICY "auth manage review_comments" ON public.review_comments FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth read review_annotations" ON public.review_annotations;
CREATE POLICY "auth read review_annotations" ON public.review_annotations FOR SELECT TO authenticated USING (true);

-- ==========================================================================
-- RPCs públicos (SECURITY DEFINER): o cliente anon usa SÓ estes.
-- ==========================================================================

-- Lê tudo o que o link mostra (settings + specs + comentários + anotações)
CREATE OR REPLACE FUNCTION public.get_public_review(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; v record; result jsonb;
BEGIN
  SELECT * INTO l FROM review_links WHERE token = p_token AND active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid'); END IF;
  SELECT vv.*, p.name AS project_name FROM video_versions vv
    JOIN projects p ON p.id = vv.project_id WHERE vv.id = l.video_version_id INTO v;

  SELECT jsonb_build_object(
    'link', jsonb_build_object('token', l.token, 'watermark', l.watermark, 'allow_download', l.allow_download),
    'video', jsonb_build_object(
      'id', v.id, 'versao', v.versao, 'file_name', v.file_name, 'status', v.status,
      'project_name', v.project_name, 'width', v.width, 'height', v.height,
      'duration_ms', v.duration_ms, 'size_bytes', v.size_bytes, 'mime_type', v.mime_type,
      'created_at', v.created_at
    ),
    'comments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'author_name', c.author_name, 'is_team', c.is_team,
        'timecode_ms', c.timecode_ms, 'body', c.body, 'resolved', c.resolved,
        'created_at', c.created_at,
        'annotations', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', a.type, 'data', a.data))
                                 FROM review_annotations a WHERE a.comment_id = c.id), '[]'::jsonb)
      ) ORDER BY c.timecode_ms)
      FROM review_comments c WHERE c.video_version_id = v.id
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;

-- Identifica o espectador (cria/atualiza pelo nome)
CREATE OR REPLACE FUNCTION public.review_identify(p_token text, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l_id uuid; v_id uuid;
BEGIN
  SELECT id INTO l_id FROM review_links WHERE token = p_token AND active = true;
  IF l_id IS NULL THEN RAISE EXCEPTION 'link inválido'; END IF;
  INSERT INTO review_viewers (review_link_id, name) VALUES (l_id, trim(p_name)) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- Adiciona comentário do cliente (com anotações opcionais)
CREATE OR REPLACE FUNCTION public.review_add_comment(
  p_token text, p_viewer_id uuid, p_timecode_ms integer, p_body text, p_annotations jsonb DEFAULT '[]'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; c_id uuid; a jsonb;
BEGIN
  SELECT * INTO l FROM review_links WHERE token = p_token AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'link inválido'; END IF;

  INSERT INTO review_comments (video_version_id, viewer_id, author_name, is_team, timecode_ms, body)
  SELECT l.video_version_id, p_viewer_id, COALESCE(rv.name, 'Cliente'), false, GREATEST(p_timecode_ms, 0), COALESCE(p_body, '')
  FROM (SELECT name FROM review_viewers WHERE id = p_viewer_id) rv
  RETURNING id INTO c_id;

  IF c_id IS NULL THEN  -- viewer_id inválido: registra sem nome
    INSERT INTO review_comments (video_version_id, author_name, timecode_ms, body)
    VALUES (l.video_version_id, 'Cliente', GREATEST(p_timecode_ms,0), COALESCE(p_body,'')) RETURNING id INTO c_id;
  END IF;

  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_annotations, '[]'::jsonb)) LOOP
    INSERT INTO review_annotations (comment_id, type, data)
    VALUES (c_id, COALESCE(a->>'type','draw'), COALESCE(a->'data','{}'::jsonb));
  END LOOP;

  RETURN c_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_public_review(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_identify(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_add_comment(text, uuid, integer, text, jsonb) TO anon, authenticated;
