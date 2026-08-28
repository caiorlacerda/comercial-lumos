-- O link do cliente também toca pela CDN
--
-- get_public_review passa a devolver o endereço do manifesto HLS. Sem isso, a
-- página pública continuaria puxando o arquivo pela nossa função (~1,8s por
-- pedaço) enquanto a equipe interna já assiste rápido — e é justamente o
-- cliente quem costuma estar na pior internet.
--
-- Só acrescenta dois campos ao objeto 'video'. O resto do retorno é idêntico,
-- então nada que já consome essa função quebra. Quando stream_status não for
-- 'pronto', vem nulo e a página usa o caminho de hoje.

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
      'fps', v.fps, 'created_at', v.created_at,
      'client_decision', v.client_decision, 'client_decided_by', v.client_decided_by,
      'client_decided_at', v.client_decided_at,
      -- Novos: de onde o player deve puxar quando a cópia já está pronta.
      'stream_hls', v.stream_hls, 'stream_status', v.stream_status),
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

GRANT EXECUTE ON FUNCTION public.get_public_review(text) TO anon, authenticated;
