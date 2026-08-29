-- O CLIENTE PASSA A VER O QUE JÁ PEDIU NAS VERSÕES ANTERIORES
--
-- Comentário nasce preso a UMA versão. Quando o editor sobe a v02, o link do
-- cliente passa a mostrar só os comentários da v02 — e tudo que ele pediu na
-- v01 some da vista dele. Na prática o cliente perde a régua pra conferir se
-- foi atendido, e acaba repetindo pedido ou cobrando por fora.
--
-- Agora get_public_review devolve, além dos comentários da versão atual, o
-- histórico das anteriores agrupado por versão. Nada é copiado nem movido: os
-- comentários continuam onde sempre estiveram, só passam a ser LIDOS junto.
--
-- Só entra versão que teve comentário de cliente, então o histórico não fica
-- poluído de versão vazia.

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

  -- Fase interna: o cliente não vê nada, nem o nome do arquivo.
  IF v.status IN ('EM_REVISAO_INTERNA', 'ALTERACOES_INTERNAS') THEN
    RETURN jsonb_build_object('error', 'em_revisao_interna');
  END IF;

  SELECT jsonb_build_object(
    'link', jsonb_build_object('token', l.token, 'watermark', l.watermark, 'allow_download', l.allow_download),
    'video', jsonb_build_object(
      'id', v.id, 'versao', v.versao, 'file_name', v.file_name, 'status', v.status,
      'project_name', v.project_name, 'width', v.width, 'height', v.height,
      'duration_ms', v.duration_ms, 'size_bytes', v.size_bytes, 'mime_type', v.mime_type,
      'fps', v.fps, 'created_at', v.created_at,
      'client_decision', v.client_decision, 'client_decided_by', v.client_decided_by,
      'client_decided_at', v.client_decided_at,
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
    ), '[]'::jsonb),

    -- Histórico: o que o cliente pediu nas versões anteriores deste mesmo vídeo.
    -- Sem anotações de desenho aqui de propósito: elas foram feitas sobre outro
    -- corte e desenhar por cima da versão nova induziria a erro.
    'historico', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'versao', vh.versao,
        'criada_em', vh.created_at,
        'comments', vh.comentarios
      ) ORDER BY vh.versao DESC)
      FROM (
        SELECT vv2.versao, vv2.created_at,
               jsonb_agg(jsonb_build_object(
                 'id', c2.id, 'author_name', c2.author_name,
                 'timecode_ms', c2.timecode_ms, 'body', c2.body,
                 'resolved', c2.resolved, 'created_at', c2.created_at
               ) ORDER BY c2.timecode_ms) AS comentarios
        FROM video_versions vv2
        JOIN review_comments c2 ON c2.video_version_id = vv2.id AND c2.is_team = false
        WHERE vv2.group_id = g AND vv2.id <> v.id
        GROUP BY vv2.versao, vv2.created_at
      ) vh
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_public_review(text) TO anon, authenticated;
