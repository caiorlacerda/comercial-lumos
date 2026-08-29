-- O LINK DE REVISÃO PASSA A SER SÓ DO CLIENTE
--
-- Como estava: existia um link só, e a página pública decidia o que mostrar
-- olhando o STATUS do vídeo. Enquanto o vídeo estava em revisão interna, esse
-- mesmo link exibia a tela interna — e review_decide_interna estava liberada
-- para 'anon'. Ou seja, um link repassado ao cliente por engano não só mostrava
-- material cru: o cliente conseguia dar o "aprovado" que era da equipe.
--
-- Como fica: revisão interna acontece DENTRO da plataforma, onde já existe o
-- menu de aprovar e pedir alteração, protegido por login e permissão. O link
-- público existe para uma coisa só, o cliente, e só funciona na fase do cliente.
--
-- Assim o erro humano deixa de ser possível, em vez de ser desencorajado.

-- ── 1) Ninguém decide a etapa interna de fora da plataforma ────────────────
REVOKE EXECUTE ON FUNCTION public.review_decide_interna(text, uuid, text) FROM anon;

-- ── 2) O link público não abre material em revisão interna ─────────────────
-- Devolve um aviso em vez do vídeo. Um link vazado (ou reencaminhado depois que
-- o vídeo voltou pra ajustes internos) não expõe nada.
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
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_public_review(text) TO anon, authenticated;

-- ── 3) Conferência ────────────────────────────────────────────────────────
-- anon NÃO pode mais executar review_decide_interna. Deve voltar vazio.
SELECT p.proname, a.rolname AS quem_pode
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) ax
JOIN pg_roles a ON a.oid = ax.grantee
WHERE n.nspname = 'public' AND p.proname = 'review_decide_interna'
  AND a.rolname = 'anon';
