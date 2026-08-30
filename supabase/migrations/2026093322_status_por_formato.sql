-- CADA FORMATO COM O SEU STATUS, E A TAREFA REFLETINDO O CONJUNTO
--
-- A mesma peça sai em 16:9, 9:16 e 1:1, e elas andam em ritmos diferentes: o
-- 16:9 pode estar aprovado enquanto o 1:1 voltou com ajuste do cliente. O
-- status de cada vídeo sempre foi uma coluna própria, então isso já era
-- possível — o que atrapalhava era a regra "a tarefa manda", que reescrevia o
-- status do vídeo, e a regra inversa, em que QUALQUER vídeo que se movia
-- carimbava a tarefa inteira. Com três formatos, o último a se mexer ganhava, e
-- a tarefa passava a mentir sobre os outros dois.
--
-- A regra nova, em um lugar só: o vídeo é dono do próprio status, e a TAREFA
-- passa a refletir o conjunto — ela mostra a etapa do formato MAIS ATRASADO.
-- Com 16:9 aprovado e 1:1 em ajustes, a tarefa fica em Ajustes, porque ainda há
-- trabalho a fazer. Só quando todos os formatos estão aprovados é que a tarefa
-- fecha. É a leitura que interessa a quem olha o quadro: "esta entrega ainda
-- precisa de alguém?".
--
-- Mora no banco porque quem decide não é só o app: a página do cliente também
-- move vídeo (review_decide), e duas cópias da mesma regra viram duas regras
-- diferentes na primeira mudança.

-- Só a versão ATUAL de cada vídeo conta. Versão antiga guarda o status de
-- quando foi substituída e não diz nada sobre o que falta hoje.
CREATE OR REPLACE FUNCTION public.status_tarefa_pelos_videos(p_task_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE min(
      CASE vv.status
        WHEN 'EM_REVISAO_INTERNA'  THEN 1
        WHEN 'ALTERACOES_INTERNAS' THEN 2
        WHEN 'EM_REVISAO_CLIENTE'  THEN 3
        WHEN 'ALTERACOES_CLIENTE'  THEN 4
        WHEN 'APROVADO'            THEN 5
      END)
    WHEN 1 THEN 'revisao_interna'
    WHEN 2 THEN 'alteracoes'
    WHEN 3 THEN 'revisao_cliente'
    WHEN 4 THEN 'alteracoes'
    WHEN 5 THEN 'concluido'
  END
  FROM video_versions vv
  WHERE vv.task_id = p_task_id
    AND vv.id = (
      SELECT v2.id FROM video_versions v2
      WHERE COALESCE(v2.group_id, v2.id) = COALESCE(vv.group_id, vv.id)
      ORDER BY v2.versao DESC LIMIT 1
    );
$$;

-- Tarefa sem vídeo nenhum não é tocada: nem toda tarefa é entrega de vídeo.
CREATE OR REPLACE FUNCTION public.sincronizar_status_tarefa(p_task_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE novo text;
BEGIN
  IF p_task_id IS NULL THEN RETURN NULL; END IF;
  novo := public.status_tarefa_pelos_videos(p_task_id);
  IF novo IS NULL THEN RETURN NULL; END IF;
  UPDATE project_tasks SET status = novo
  WHERE id = p_task_id AND status IS DISTINCT FROM novo;
  RETURN novo;
END; $$;

GRANT EXECUTE ON FUNCTION public.status_tarefa_pelos_videos(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_status_tarefa(uuid) TO authenticated, anon;

-- A decisão do cliente passa a usar a mesma regra. Antes ela carimbava a tarefa
-- como concluída assim que UM vídeo era aprovado — com três formatos, aprovar o
-- 16:9 dava a tarefa por encerrada com o 1:1 ainda em pé.
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

-- Conferência: mostra, pra cada tarefa com mais de um vídeo, o status que ela
-- deveria ter pela regra nova. Nada é alterado por esta consulta.
SELECT t.id, t.titulo, t.status AS status_hoje,
       public.status_tarefa_pelos_videos(t.id) AS status_pela_regra
FROM project_tasks t
WHERE EXISTS (SELECT 1 FROM video_versions v WHERE v.task_id = t.id)
ORDER BY 4, 2;
