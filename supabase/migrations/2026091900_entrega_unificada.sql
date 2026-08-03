-- FASE 2 — Entrega unificada (tarefa + vídeo são a mesma coisa)
--
-- 1) Sincronia nos DOIS sentidos: mudar o status da tarefa (em qualquer tela:
--    hub, Board, Timeline, Calendário) passa a mover o vídeo junto. Antes só
--    vídeo→tarefa funcionava, e no vínculo.
-- 2) Versões automáticas: "VÍDEO 6_v02.mp4" entra como v02 do mesmo vídeo,
--    sem precisar arrastar uma linha sobre a outra (e sem matar o link do
--    cliente, que é do grupo).
-- 3) O cliente decide: botão de aprovar/pedir ajustes no link público, com
--    registro de quem e quando, e aviso pro time.
-- 4) Comentário solto do cliente NÃO derruba mais o vídeo pra "Ajustes"
--    (elogio virava pedido de alteração).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) TAREFA → VÍDEO (fecha o ciclo da sincronia)
-- ───────────────────────────────────────────────────────────────────────────

-- Espelho SQL do taskStatusToVideo() do app (src/lib/reviewStatus.ts).
-- Recebe o status da tarefa + o status atual do vídeo, devolve o novo status do
-- vídeo (ou NULL quando não há motivo pra mexer).
CREATE OR REPLACE FUNCTION public.task_status_to_video(p_task_status text, p_current text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  fase_cliente boolean := p_current IN ('EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE');
BEGIN
  CASE p_task_status
    WHEN 'revisao_interna' THEN RETURN 'EM_REVISAO_INTERNA';
    WHEN 'revisao_cliente' THEN RETURN 'EM_REVISAO_CLIENTE';
    WHEN 'aprov_interna'   THEN RETURN 'EM_REVISAO_CLIENTE';
    WHEN 'alteracoes'      THEN RETURN CASE WHEN fase_cliente THEN 'ALTERACOES_CLIENTE' ELSE 'ALTERACOES_INTERNAS' END;
    WHEN 'entregue'        THEN RETURN 'APROVADO';
    WHEN 'concluido'       THEN RETURN 'APROVADO';
    ELSE
      -- na_fila, em_progresso, pausado, aguard_*: o vídeo está em revisão
      -- interna. Não puxa de volta um vídeo que já foi pro cliente ou aprovado.
      RETURN CASE WHEN fase_cliente OR p_current = 'APROVADO' THEN NULL ELSE 'EM_REVISAO_INTERNA' END;
  END CASE;
END; $$;

CREATE OR REPLACE FUNCTION public.sync_task_status_to_video()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_next text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- Move a versão ATUAL (maior versão) de cada vídeo vinculado a esta tarefa.
  FOR r IN
    SELECT DISTINCT ON (COALESCE(group_id::text, id::text))
           id, status
    FROM video_versions
    WHERE task_id = NEW.id
    ORDER BY COALESCE(group_id::text, id::text), versao DESC
  LOOP
    v_next := public.task_status_to_video(NEW.status, r.status);
    IF v_next IS NOT NULL AND v_next <> r.status THEN
      UPDATE video_versions SET status = v_next, updated_at = now() WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao sincronizar vídeo da tarefa %: %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_task_status_to_video ON public.project_tasks;
CREATE TRIGGER trg_sync_task_status_to_video
  AFTER UPDATE OF status ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_task_status_to_video();

-- ───────────────────────────────────────────────────────────────────────────
-- 2) VERSÕES AUTOMÁTICAS (agrupa pelo nome do arquivo)
--    Substitui a função de auto-vínculo: agora ela agrupa PRIMEIRO e depois
--    resolve a tarefa (assim a v02 herda a tarefa da v01 automaticamente).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.autolink_video_to_task()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base       text;
  v_norm       text;
  v_task       uuid;
  v_group_task uuid;
  v_group      uuid;
  v_maxv       int;
BEGIN
  -- Nome sem extensão e sem sufixo de versão (_v01, -v2, v03…).
  v_base := regexp_replace(COALESCE(NEW.file_name, ''), '\.[^.]+$', '');
  v_base := regexp_replace(v_base, '[ _-]*v[0-9]+$', '', 'i');
  v_norm := public.norm_label(v_base);

  -- (a) Agrupamento: existe outro vídeo do projeto com o mesmo nome-base?
  --     Então este arquivo é uma VERSÃO NOVA dele.
  IF v_norm <> '' THEN
    SELECT COALESCE(group_id, id) INTO v_group
    FROM video_versions
    WHERE project_id = NEW.project_id
      AND id <> NEW.id
      AND public.norm_label(
            regexp_replace(regexp_replace(file_name, '\.[^.]+$', ''), '[ _-]*v[0-9]+$', '', 'i')
          ) = v_norm
    ORDER BY versao DESC
    LIMIT 1;

    IF v_group IS NOT NULL THEN
      SELECT COALESCE(MAX(versao), 0) INTO v_maxv
      FROM video_versions WHERE COALESCE(group_id, id) = v_group;
      NEW.group_id := v_group;
      NEW.versao   := v_maxv + 1;
    END IF;
  END IF;

  -- (b) Vínculo com a tarefa (respeita o que já veio preenchido).
  IF NEW.task_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT task_id INTO v_group_task
  FROM video_versions
  WHERE group_id = NEW.group_id AND task_id IS NOT NULL
  LIMIT 1;
  IF v_group_task IS NOT NULL THEN
    NEW.task_id := v_group_task;
    RETURN NEW;
  END IF;

  IF v_norm <> '' THEN
    SELECT id INTO v_task
    FROM project_tasks
    WHERE project_id = NEW.project_id
      AND public.norm_label(titulo) = v_norm
    LIMIT 1;
  END IF;

  NEW.task_id := v_task;
  RETURN NEW;
END; $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) O CLIENTE DECIDE (aprovar / pedir ajustes) no link público
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.video_versions
  ADD COLUMN IF NOT EXISTS client_decision    text,
  ADD COLUMN IF NOT EXISTS client_decided_by  text,
  ADD COLUMN IF NOT EXISTS client_decided_at  timestamptz;

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

  SELECT name INTO v_name FROM review_viewers WHERE id = p_viewer_id;
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

  -- Espelha na tarefa (a régua unificada da Fase 2).
  IF v_task IS NOT NULL THEN
    UPDATE project_tasks
    SET status = CASE WHEN p_decision = 'aprovado' THEN 'concluido' ELSE 'alteracoes' END
    WHERE id = v_task;
  END IF;

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

-- get_public_review passa a devolver a decisão (o link mostra "já aprovado").
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
      'client_decided_at', v.client_decided_at),
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

-- ───────────────────────────────────────────────────────────────────────────
-- 4) Comentário do cliente deixa de mudar status sozinho.
--    Quem decide "ajustes" agora é o botão (review_decide). Um elogio ou uma
--    dúvida não derrubam mais o vídeo. A notificação em lote continua igual.
-- ───────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_client_comment_sets_alteracoes ON public.review_comments;
