-- SEGURANÇA DA REVISÃO DE VÍDEO (lote 1)
--
-- 1) review_decide volta a recusar decisão de cliente em vídeo ainda em revisão
--    interna (a trava existia em 2026093200 e se perdeu em 2026093322).
-- 2) review_add_comment e review_identify ganham limites (tamanho e frequência) e
--    review_add_comment recusa comentário em fase interna.
-- 3) review_update_comment ganha o mesmo limite de tamanho.
-- 4) review_decide_interna (sem uso no app) fecha de vez para anon/PUBLIC.
--
-- ANTES DE RODAR: este arquivo assume que 2026093322_status_por_formato.sql JÁ foi
-- aplicado (review_decide chama sincronizar_status_tarefa). O bloco abaixo aborta
-- sem alterar nada se a função não existir.

DO $$
BEGIN
  IF to_regprocedure('public.sincronizar_status_tarefa(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026093322_status_por_formato.sql (falta sincronizar_status_tarefa).';
  END IF;
END $$;

-- 1) ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_decide(
  p_token     text,
  p_viewer_id uuid,
  p_decision  text   -- 'aprovado' | 'ajustes'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link      RECORD;
  v_version   RECORD;
  v_name      text;
  v_status    text;
  v_task      uuid;
  v_proj      uuid;
  v_file      text;
  v_admin     RECORD;
BEGIN
  IF p_decision NOT IN ('aprovado', 'ajustes') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'decisao_invalida');
  END IF;

  SELECT * INTO v_link FROM review_links WHERE token = p_token AND active = true;
  IF v_link IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'link_invalido'); END IF;

  -- Sempre decide sobre a versão ATUAL do grupo (é a que o cliente está vendo).
  SELECT * INTO v_version
  FROM video_versions
  WHERE COALESCE(group_id, id) = COALESCE(v_link.group_id, v_link.video_version_id)
  ORDER BY versao DESC LIMIT 1;
  IF v_version IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'video_nao_encontrado'); END IF;

  -- Fase interna não aceita decisão de cliente. A versão de 2026093322 perdeu esta
  -- trava (existia em 2026093200): quem tinha o token aprovava, pela API, um vídeo
  -- que a equipe ainda estava revisando.
  IF v_version.status IN ('EM_REVISAO_INTERNA', 'ALTERACOES_INTERNAS') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'em_revisao_interna');
  END IF;

  -- O nome só vale se o espectador pertence a ESTE link (senão vira 'Cliente').
  SELECT name INTO v_name FROM review_viewers WHERE id = p_viewer_id AND review_link_id = v_link.id;
  v_name   := COALESCE(v_name, 'Cliente');
  v_status := CASE WHEN p_decision = 'aprovado' THEN 'APROVADO' ELSE 'ALTERACOES_CLIENTE' END;
  v_task   := v_version.task_id;
  v_proj   := v_version.project_id;
  v_file   := v_version.file_name;

  UPDATE video_versions
  SET status = v_status,
      client_decision = p_decision,
      client_decided_by = v_name,
      client_decided_at = now(),
      updated_at = now()
  WHERE id = v_version.id;

  -- A tarefa segue o conjunto dos formatos dela, não o último que se mexeu.
  PERFORM public.sincronizar_status_tarefa(v_task);

  -- Avisa o time: admins, quem tem a tarefa e os colaboradores dela.
  FOR v_admin IN
    SELECT DISTINCT u.id
    FROM app_users u
    WHERE u.status = 'ativo'
      AND (
        u.role IN ('admin', 'atendimento')
        OR u.id = (SELECT responsavel_id FROM project_tasks WHERE id = v_task)
        OR u.id IN (SELECT user_id FROM task_collaborators WHERE task_id = v_task)
      )
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      v_admin.id,
      CASE WHEN p_decision = 'aprovado' THEN 'video_aprovado_cliente' ELSE 'video_ajustes_cliente' END,
      'producao',
      'high',
      CASE WHEN p_decision = 'aprovado' THEN 'Cliente aprovou um vídeo 🎉' ELSE 'Cliente pediu ajustes' END,
      v_name || CASE WHEN p_decision = 'aprovado' THEN ' aprovou "' ELSE ' pediu ajustes em "' END || COALESCE(v_file, 'vídeo') || '".',
      '/producao/projetos?projectId=' || COALESCE(v_proj::text, '') || '&tab=entregas',
      jsonb_build_object('video_version_id', v_version.id, 'project_id', v_proj, 'decision', p_decision)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'status', v_status, 'by', v_name);
END; $$;

GRANT EXECUTE ON FUNCTION public.review_decide(text, uuid, text) TO anon, authenticated;

-- 2) ---------------------------------------------------------------------------
-- Quem é o espectador: nome de 1 a 80 caracteres e no máximo 60 identificações
-- novas por link por hora (o espectador real se identifica uma vez por aparelho).
CREATE OR REPLACE FUNCTION public.review_identify(p_token text, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l_id uuid; v_id uuid; v_nome text := trim(COALESCE(p_name, ''));
BEGIN
  SELECT id INTO l_id FROM review_links WHERE token = p_token AND active = true;
  IF l_id IS NULL THEN RAISE EXCEPTION 'link inválido'; END IF;
  IF char_length(v_nome) < 1 OR char_length(v_nome) > 80 THEN RAISE EXCEPTION 'nome inválido'; END IF;
  IF (SELECT count(*) FROM review_viewers
      WHERE review_link_id = l_id AND first_seen > now() - interval '1 hour') >= 60 THEN
    RAISE EXCEPTION 'muitas identificações neste link, tente mais tarde';
  END IF;
  INSERT INTO review_viewers (review_link_id, name) VALUES (l_id, v_nome) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- Comentário do cliente: só depois da liberação para o cliente, com até 4000
-- caracteres, até 50 desenhos (máx. ~200 KB no total) e limites de frequência
-- (200 por espectador e 600 por vídeo, a cada 10 minutos; cabe colar um retorno inteiro).
CREATE OR REPLACE FUNCTION public.review_add_comment(
  p_token text, p_viewer_id uuid, p_timecode_ms integer, p_body text, p_annotations jsonb DEFAULT '[]'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; g uuid; vv_id uuid; vv_status text; c_id uuid; a jsonb; v_viewer uuid;
BEGIN
  SELECT * INTO l FROM review_links WHERE token = p_token AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'link inválido'; END IF;
  g := COALESCE(l.group_id, (SELECT group_id FROM video_versions WHERE id = l.video_version_id));
  SELECT id, status INTO vv_id, vv_status FROM video_versions WHERE group_id = g ORDER BY versao DESC LIMIT 1;
  IF vv_id IS NULL THEN RAISE EXCEPTION 'sem versão'; END IF;

  IF vv_status IN ('EM_REVISAO_INTERNA', 'ALTERACOES_INTERNAS') THEN
    RAISE EXCEPTION 'vídeo em revisão interna';
  END IF;
  IF char_length(COALESCE(p_body, '')) > 4000 THEN RAISE EXCEPTION 'comentário longo demais'; END IF;
  IF jsonb_typeof(COALESCE(p_annotations, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_annotations, '[]'::jsonb)) > 50
     OR pg_column_size(COALESCE(p_annotations, '[]'::jsonb)) > 200000 THEN
    RAISE EXCEPTION 'anotações inválidas';
  END IF;

  -- O espectador só vale se for DESTE link.
  SELECT id INTO v_viewer FROM review_viewers WHERE id = p_viewer_id AND review_link_id = l.id;

  IF (SELECT count(*) FROM review_comments
      WHERE video_version_id = vv_id AND is_team = false AND created_at > now() - interval '10 minutes') >= 600
     OR (v_viewer IS NOT NULL AND (SELECT count(*) FROM review_comments
      WHERE viewer_id = v_viewer AND created_at > now() - interval '10 minutes') >= 200) THEN
    RAISE EXCEPTION 'muitos comentários em pouco tempo, tente de novo em alguns minutos';
  END IF;

  INSERT INTO review_comments (video_version_id, viewer_id, author_name, is_team, timecode_ms, body)
  SELECT vv_id, v_viewer, COALESCE(rv.name, 'Cliente'), false, GREATEST(p_timecode_ms, 0), COALESCE(p_body, '')
  FROM (SELECT name FROM review_viewers WHERE id = v_viewer) rv
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

-- 3) ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_update_comment(
  p_token text, p_viewer_id uuid, p_comment_id uuid, p_body text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; n integer;
BEGIN
  IF p_viewer_id IS NULL THEN RAISE EXCEPTION 'sem identificação'; END IF;
  IF char_length(COALESCE(p_body, '')) > 4000 THEN RAISE EXCEPTION 'comentário longo demais'; END IF;
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

GRANT EXECUTE ON FUNCTION public.review_identify(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_add_comment(text, uuid, integer, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_update_comment(text, uuid, uuid, text) TO anon, authenticated;

-- 4) ---------------------------------------------------------------------------
-- Sem uso no app. No Supabase um REVOKE ... FROM anon sozinho não basta (PUBLIC e o
-- grant direto de 'authenticated' continuam), então fecha de PUBLIC e anon e deixa
-- explícito só para quem está logado.
DO $$
BEGIN
  IF to_regprocedure('public.review_decide_interna(text, uuid, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.review_decide_interna(text, uuid, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.review_decide_interna(text, uuid, text) FROM anon;
    GRANT EXECUTE ON FUNCTION public.review_decide_interna(text, uuid, text) TO authenticated;
  END IF;
END $$;

-- CONFERÊNCIA (deve devolver as quatro linhas com anon_executa = false só na última):
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('review_decide', 'review_identify', 'review_add_comment', 'review_decide_interna')
ORDER BY 1;
