-- O CLIENTE PASSA A TROCAR DE VERSÃO, IGUAL À EQUIPE
--
-- Hoje o link do cliente mostra só a versão mais nova. Ele até LÊ o que pediu
-- antes (histórico), mas não consegue ASSISTIR a versão anterior — então
-- "compare a v01 com a v02" continua sendo trabalho de quem atende: exportar,
-- subir em outro lugar, mandar por fora. Do nosso lado esse botão já existe.
--
-- Aqui a função devolve TODAS as versões do grupo que o cliente pode ver, cada
-- uma com o endereço do vídeo na CDN e com os comentários dela. Quem escolhe
-- qual assistir é a página; o streaming já sabia servir versão específica
-- (review-stream, parâmetro ?versao=), só faltava o cliente saber que existem.
--
-- O que NÃO muda: comentário interno continua fora. O filtro is_team = false
-- vale para todas as versões, não só para a atual — o corte de versão não pode
-- virar porta de entrada pro que a equipe conversa entre si.
--
-- Versão que nunca saiu da revisão interna fica fora, pela mesma regra que já
-- vale para a atual: o cliente não vê material que ainda não foi liberado, nem
-- o nome do arquivo. A exceção é a versão em que ELE MESMO comentou: se tem
-- pedido dele ali, ela esteve na mão dele — e esconder justamente essa quebraria
-- o histórico "o que você pediu antes", que já existe e sai desta mesma lista.

CREATE OR REPLACE FUNCTION public.get_public_review(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; g uuid; v record; v_versoes jsonb; result jsonb;
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

  -- Uma lista só, usada pelo seletor de versões E pelo histórico. Antes o
  -- histórico era montado por conta própria; duas consultas contando a mesma
  -- história é como nasce divergência.
  SELECT jsonb_agg(x ORDER BY (x->>'versao')::int DESC) INTO v_versoes
  FROM (
    SELECT jsonb_build_object(
      'id', vv2.id, 'versao', vv2.versao, 'file_name', vv2.file_name,
      'created_at', vv2.created_at, 'status', vv2.status,
      'width', vv2.width, 'height', vv2.height, 'duration_ms', vv2.duration_ms,
      'size_bytes', vv2.size_bytes, 'mime_type', vv2.mime_type,
      'stream_hls', vv2.stream_hls, 'stream_status', vv2.stream_status,
      'comments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', c.id, 'author_name', c.author_name, 'is_team', c.is_team, 'viewer_id', c.viewer_id,
          'timecode_ms', c.timecode_ms, 'body', c.body, 'resolved', c.resolved,
          'created_at', c.created_at, 'edited_at', c.edited_at,
          'annotations', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', a.type, 'data', a.data))
                                   FROM review_annotations a WHERE a.comment_id = c.id), '[]'::jsonb)
        ) ORDER BY c.timecode_ms)
        FROM review_comments c
        WHERE c.video_version_id = vv2.id AND c.is_team = false
      ), '[]'::jsonb)
    ) AS x
    FROM video_versions vv2
    WHERE vv2.group_id = g
      AND (
        vv2.status NOT IN ('EM_REVISAO_INTERNA', 'ALTERACOES_INTERNAS')
        OR EXISTS (SELECT 1 FROM review_comments c2
                   WHERE c2.video_version_id = vv2.id AND c2.is_team = false)
      )
  ) t;
  v_versoes := COALESCE(v_versoes, '[]'::jsonb);

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
    'versoes', v_versoes,
    'comments', COALESCE((
      SELECT e->'comments' FROM jsonb_array_elements(v_versoes) e
      WHERE (e->>'id') = v.id::text
    ), '[]'::jsonb),

    -- Histórico: o que o cliente pediu nas outras versões. Continua saindo daqui
    -- porque a página ainda o mostra em bloco, agrupado por versão.
    'historico', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'versao', (e->>'versao')::int,
        'criada_em', e->>'created_at',
        'comments', e->'comments'
      ) ORDER BY (e->>'versao')::int DESC)
      FROM jsonb_array_elements(v_versoes) e
      WHERE (e->>'id') <> v.id::text AND jsonb_array_length(e->'comments') > 0
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_public_review(text) TO anon, authenticated;

-- Conferência: troque pelo token de um link real com mais de uma versão.
-- Deve listar as versões (da mais nova pra mais antiga) e NENHUM is_team = true.
-- SELECT jsonb_array_length(get_public_review('SEU_TOKEN')->'versoes');
