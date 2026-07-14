-- Editar/excluir comentário de revisão — APENAS os próprios.
--
-- Quem é o dono do comentário:
--   • Cliente (link público, anônimo): review_comments.viewer_id
--   • Time (logado): não havia dono confiável, só author_name (texto). Criamos
--     author_user_id para amarrar no app_users e conseguir travar por RLS.

-- 1) Dono do comentário do time + marca de edição.
ALTER TABLE public.review_comments
  ADD COLUMN IF NOT EXISTS author_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Backfill dos comentários antigos do time, casando pelo nome (melhor esforço:
-- sem isso, ninguém conseguiria editar/apagar o que já tinha escrito).
UPDATE public.review_comments c
SET author_user_id = u.id
FROM public.app_users u
WHERE c.is_team = true
  AND c.author_user_id IS NULL
  AND lower(trim(c.author_name)) = lower(trim(u.full_name));

-- 2) RLS do time: ler/escrever todos, mas EDITAR e APAGAR só os próprios.
DROP POLICY IF EXISTS "auth manage review_comments" ON public.review_comments;

DROP POLICY IF EXISTS select_review_comments ON public.review_comments;
CREATE POLICY select_review_comments ON public.review_comments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS insert_review_comments ON public.review_comments;
CREATE POLICY insert_review_comments ON public.review_comments
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS update_own_review_comments ON public.review_comments;
CREATE POLICY update_own_review_comments ON public.review_comments
  FOR UPDATE TO authenticated
  USING (author_user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()))
  WITH CHECK (author_user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS delete_own_review_comments ON public.review_comments;
CREATE POLICY delete_own_review_comments ON public.review_comments
  FOR DELETE TO authenticated
  USING (author_user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()));

-- 3) get_public_review devolve o viewer_id (para o cliente saber quais comentários
--    são dele) e o edited_at. Mantém: o cliente NÃO vê comentários internos.
CREATE OR REPLACE FUNCTION public.get_public_review(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; g uuid; v record; result jsonb;
BEGIN
  SELECT * INTO l FROM review_links WHERE token = p_token AND active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid'); END IF;
  g := COALESCE(l.group_id, (SELECT group_id FROM video_versions WHERE id = l.video_version_id));

  SELECT vv.*, p.name AS project_name INTO v
  FROM video_versions vv JOIN projects p ON p.id = vv.project_id
  WHERE vv.group_id = g ORDER BY vv.versao DESC LIMIT 1;
  IF v.id IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;

  SELECT jsonb_build_object(
    'link', jsonb_build_object('token', l.token, 'watermark', l.watermark, 'allow_download', l.allow_download),
    'video', jsonb_build_object(
      'id', v.id, 'versao', v.versao, 'file_name', v.file_name, 'status', v.status,
      'project_name', v.project_name, 'width', v.width, 'height', v.height,
      'duration_ms', v.duration_ms, 'size_bytes', v.size_bytes, 'mime_type', v.mime_type,
      'fps', v.fps, 'created_at', v.created_at),
    'comments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'author_name', c.author_name, 'is_team', c.is_team, 'viewer_id', c.viewer_id,
        'timecode_ms', c.timecode_ms, 'body', c.body, 'resolved', c.resolved,
        'created_at', c.created_at, 'edited_at', c.edited_at,
        'annotations', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', a.type, 'data', a.data))
                                 FROM review_annotations a WHERE a.comment_id = c.id), '[]'::jsonb)
      ) ORDER BY c.timecode_ms)
      FROM review_comments c WHERE c.video_version_id = v.id AND c.is_team = false
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;

-- 4) Cliente (anon) edita/apaga o PRÓPRIO comentário. SECURITY DEFINER: a checagem
--    de dono é feita aqui dentro (viewer_id) e o link precisa estar ativo.
CREATE OR REPLACE FUNCTION public.review_update_comment(
  p_token text, p_viewer_id uuid, p_comment_id uuid, p_body text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; n integer;
BEGIN
  IF p_viewer_id IS NULL THEN RAISE EXCEPTION 'sem identificação'; END IF;
  SELECT * INTO l FROM review_links WHERE token = p_token AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'link inválido'; END IF;

  UPDATE review_comments
  SET body = COALESCE(p_body, ''), edited_at = now()
  WHERE id = p_comment_id
    AND viewer_id = p_viewer_id      -- só o próprio
    AND is_team = false;             -- nunca um comentário interno
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'comentário não é seu'; END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.review_delete_comment(
  p_token text, p_viewer_id uuid, p_comment_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; n integer;
BEGIN
  IF p_viewer_id IS NULL THEN RAISE EXCEPTION 'sem identificação'; END IF;
  SELECT * INTO l FROM review_links WHERE token = p_token AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'link inválido'; END IF;

  -- review_annotations tem ON DELETE CASCADE, então os desenhos vão junto.
  DELETE FROM review_comments
  WHERE id = p_comment_id
    AND viewer_id = p_viewer_id
    AND is_team = false;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'comentário não é seu'; END IF;
  RETURN true;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_public_review(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_update_comment(text, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_delete_comment(text, uuid, uuid) TO anon, authenticated;
