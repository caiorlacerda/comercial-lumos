-- 1) HORA DE ENTREGA NA TAREFA — "até que horas precisa ser entregue".
-- 2) REVISÃO INTERNA DE VERDADE no link público (bug da Tawany): o mesmo link
--    serve as duas fases, mas cada fase tem a decisão certa.
--    · Vídeo em revisão INTERNA: quem aprova é o time → status vira
--      EM_REVISAO_CLIENTE (aí sim copia o link pro cliente); pedir alteração
--      vira ALTERACOES_INTERNAS. Nada disso grava decisão de cliente.
--    · Vídeo em revisão do CLIENTE: como sempre foi (aprovado/ajustes).
--    · O review_decide antigo passa a RECUSAR decisão enquanto o vídeo está
--      na fase interna — ninguém mais "aprova como cliente" sem querer.

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS hora_entrega time;

-- ── Decisão do CLIENTE: ganha a trava de fase ──────────────────────────────
CREATE OR REPLACE FUNCTION public.review_decide(
  p_token     text,
  p_viewer_id uuid,
  p_decision  text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link      RECORD;
  v_version   RECORD;
  v_name      text;
  v_status    text;
  v_task      uuid;
  v_admin     RECORD;
BEGIN
  IF p_decision NOT IN ('aprovado', 'ajustes') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'decisao_invalida');
  END IF;

  SELECT * INTO v_link FROM review_links WHERE token = p_token AND active = true;
  IF v_link IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'link_invalido'); END IF;

  SELECT * INTO v_version
  FROM video_versions
  WHERE COALESCE(group_id, id) = COALESCE(v_link.group_id, v_link.video_version_id)
  ORDER BY versao DESC LIMIT 1;
  IF v_version IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'video_nao_encontrado'); END IF;

  -- Fase interna não aceita decisão de cliente.
  IF v_version.status IN ('EM_REVISAO_INTERNA', 'ALTERACOES_INTERNAS') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'em_revisao_interna');
  END IF;

  SELECT name INTO v_name FROM review_viewers WHERE id = p_viewer_id;
  v_name   := COALESCE(v_name, 'Cliente');
  v_status := CASE WHEN p_decision = 'aprovado' THEN 'APROVADO' ELSE 'ALTERACOES_CLIENTE' END;
  v_task   := v_version.task_id;

  UPDATE video_versions
  SET status = v_status,
      client_decision = p_decision,
      client_decided_by = v_name,
      client_decided_at = now(),
      updated_at = now()
  WHERE id = v_version.id;

  IF v_task IS NOT NULL THEN
    UPDATE project_tasks
    SET status = CASE WHEN p_decision = 'aprovado' THEN 'concluido' ELSE 'alteracoes' END
    WHERE id = v_task;
  END IF;

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
      'producao', 'high',
      CASE WHEN p_decision = 'aprovado' THEN 'Cliente aprovou 🎉' ELSE 'Cliente pediu ajustes' END,
      v_name || CASE WHEN p_decision = 'aprovado' THEN ' aprovou "' ELSE ' pediu ajustes em "' END || v_version.file_name || '".',
      '/producao/projetos?projectId=' || v_version.project_id::text,
      jsonb_build_object('video_version_id', v_version.id, 'decision', p_decision)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'status', v_status, 'by', v_name);
END; $$;

-- ── Decisão INTERNA: aprova e libera pro cliente, ou pede alteração ────────
CREATE OR REPLACE FUNCTION public.review_decide_interna(
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
  v_admin     RECORD;
BEGIN
  IF p_decision NOT IN ('aprovado', 'ajustes') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'decisao_invalida');
  END IF;

  SELECT * INTO v_link FROM review_links WHERE token = p_token AND active = true;
  IF v_link IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'link_invalido'); END IF;

  SELECT * INTO v_version
  FROM video_versions
  WHERE COALESCE(group_id, id) = COALESCE(v_link.group_id, v_link.video_version_id)
  ORDER BY versao DESC LIMIT 1;
  IF v_version IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'video_nao_encontrado'); END IF;

  -- Só vale na fase interna.
  IF v_version.status NOT IN ('EM_REVISAO_INTERNA', 'ALTERACOES_INTERNAS') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nao_esta_em_revisao_interna');
  END IF;

  SELECT name INTO v_name FROM review_viewers WHERE id = p_viewer_id;
  v_name   := COALESCE(v_name, 'Time Lumos');
  v_status := CASE WHEN p_decision = 'aprovado' THEN 'EM_REVISAO_CLIENTE' ELSE 'ALTERACOES_INTERNAS' END;
  v_task   := v_version.task_id;

  -- Aprovação interna zera qualquer decisão antiga de cliente: o vídeo chega
  -- limpo na fase do cliente.
  UPDATE video_versions
  SET status = v_status,
      client_decision = NULL,
      client_decided_by = NULL,
      client_decided_at = NULL,
      updated_at = now()
  WHERE id = v_version.id;

  IF v_task IS NOT NULL THEN
    UPDATE project_tasks
    SET status = CASE WHEN p_decision = 'aprovado' THEN 'revisao_cliente' ELSE 'alteracoes' END
    WHERE id = v_task;
  END IF;

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
      'comentarios_cliente_video', 'producao', 'normal',
      CASE WHEN p_decision = 'aprovado' THEN 'Revisão interna aprovou ✓' ELSE 'Revisão interna pediu alterações' END,
      v_name || CASE WHEN p_decision = 'aprovado'
        THEN ' aprovou "' || v_version.file_name || '" — pronto pra enviar ao cliente.'
        ELSE ' pediu alterações em "' || v_version.file_name || '".' END,
      '/producao/projetos?projectId=' || v_version.project_id::text,
      jsonb_build_object('video_version_id', v_version.id, 'decision', p_decision, 'interna', true)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'status', v_status, 'by', v_name, 'interna', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.review_decide(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_decide_interna(text, uuid, text) TO anon, authenticated;
