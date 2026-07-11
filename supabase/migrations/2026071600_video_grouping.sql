-- Agrupamento de versões (stacks): cada "vídeo" é um group_id; as versões
-- pertencem a um grupo. Cada vídeo existente hoje é um vídeo separado → vira
-- seu próprio grupo. O link do cliente segue o GRUPO (mostra a versão mais nova).

ALTER TABLE public.video_versions ADD COLUMN IF NOT EXISTS group_id uuid;
UPDATE public.video_versions SET group_id = gen_random_uuid() WHERE group_id IS NULL;
ALTER TABLE public.video_versions ALTER COLUMN group_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.video_versions ALTER COLUMN group_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_video_versions_group ON public.video_versions(group_id);

ALTER TABLE public.review_links ADD COLUMN IF NOT EXISTS group_id uuid;
UPDATE public.review_links rl SET group_id = vv.group_id
  FROM public.video_versions vv WHERE rl.video_version_id = vv.id AND rl.group_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_review_links_group ON public.review_links(group_id);

-- ==========================================================================
-- RPCs: o link resolve sempre a versão ATUAL (maior versão) do grupo.
-- ==========================================================================
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
      'fps', v.fps, 'created_at', v.created_at
    ),
    'comments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'author_name', c.author_name, 'is_team', c.is_team,
        'timecode_ms', c.timecode_ms, 'body', c.body, 'resolved', c.resolved, 'created_at', c.created_at,
        'annotations', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', a.type, 'data', a.data))
                                 FROM review_annotations a WHERE a.comment_id = c.id), '[]'::jsonb)
      ) ORDER BY c.timecode_ms)
      FROM review_comments c WHERE c.video_version_id = v.id
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.review_add_comment(
  p_token text, p_viewer_id uuid, p_timecode_ms integer, p_body text, p_annotations jsonb DEFAULT '[]'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; g uuid; vv_id uuid; c_id uuid; a jsonb;
BEGIN
  SELECT * INTO l FROM review_links WHERE token = p_token AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'link inválido'; END IF;
  g := COALESCE(l.group_id, (SELECT group_id FROM video_versions WHERE id = l.video_version_id));
  SELECT id INTO vv_id FROM video_versions WHERE group_id = g ORDER BY versao DESC LIMIT 1;
  IF vv_id IS NULL THEN RAISE EXCEPTION 'sem versão'; END IF;

  INSERT INTO review_comments (video_version_id, viewer_id, author_name, is_team, timecode_ms, body)
  SELECT vv_id, p_viewer_id, COALESCE(rv.name, 'Cliente'), false, GREATEST(p_timecode_ms, 0), COALESCE(p_body, '')
  FROM (SELECT name FROM review_viewers WHERE id = p_viewer_id) rv
  RETURNING id INTO c_id;

  IF c_id IS NULL THEN
    INSERT INTO review_comments (video_version_id, author_name, timecode_ms, body)
    VALUES (vv_id, 'Cliente', GREATEST(p_timecode_ms, 0), COALESCE(p_body, '')) RETURNING id INTO c_id;
  END IF;

  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_annotations, '[]'::jsonb)) LOOP
    INSERT INTO review_annotations (comment_id, type, data)
    VALUES (c_id, COALESCE(a->>'type','draw'), COALESCE(a->'data','{}'::jsonb));
  END LOOP;
  RETURN c_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_public_review(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_add_comment(text, uuid, integer, text, jsonb) TO anon, authenticated;
