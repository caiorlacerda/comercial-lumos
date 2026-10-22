-- AVISO DE COMENTÁRIOS DO CLIENTE TAMBÉM PARA OS COLABORADORES DA TAREFA
--
-- notify_client_comments (cron a cada 5 min, lote 30 min depois do último
-- comentário) avisava só admin, atendimento e o responsável da tarefa. Quem era
-- colaborador da tarefa, inclusive os revisores fixos, não recebia. A decisão do
-- cliente (review_decide) já incluía os colaboradores. Só a lista de destinatários
-- muda; o resto da função é igual à de 2026081000_video_task_link.sql.

CREATE OR REPLACE FUNCTION public.notify_client_comments()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         record;
  dest      record;
  v_project uuid;
  v_nome    text;
  v_qtd     integer;
  v_autores text;
BEGIN
  FOR r IN
    SELECT vv.group_id,
           MAX(c.created_at)                       AS ultimo_comentario,
           COALESCE(s.notified_up_to, '-infinity') AS notified_up_to
    FROM review_comments c
    JOIN video_versions vv ON vv.id = c.video_version_id
    LEFT JOIN review_notify_state s ON s.group_id = vv.group_id
    WHERE c.is_team = false
      AND c.created_at > COALESCE(s.notified_up_to, '-infinity')
    GROUP BY vv.group_id, s.notified_up_to
    HAVING MAX(c.created_at) <= now() - interval '30 minutes'
  LOOP
    -- Projeto e nome do vídeo (versão mais recente do grupo).
    SELECT vv.project_id, vv.file_name INTO v_project, v_nome
    FROM video_versions vv
    WHERE vv.group_id = r.group_id
    ORDER BY vv.versao DESC
    LIMIT 1;

    -- Só os comentários do lote (posteriores ao último aviso).
    SELECT count(*), string_agg(DISTINCT c.author_name, ', ')
      INTO v_qtd, v_autores
    FROM review_comments c
    JOIN video_versions vv ON vv.id = c.video_version_id
    WHERE vv.group_id = r.group_id
      AND c.is_team = false
      AND c.created_at > r.notified_up_to;

    IF COALESCE(v_qtd, 0) = 0 THEN CONTINUE; END IF;

    -- Destinatários: o EDITOR (responsável da tarefa vinculada) + os COLABORADORES da
    -- tarefa (inclui os revisores fixos, que entram como colaboradores) + atendimento
    -- + admin. A decisão do cliente (review_decide) já avisava os colaboradores; o
    -- lote de comentários não, e eles ficavam sem saber do retorno.
    FOR dest IN
      SELECT DISTINCT u.id
      FROM app_users u
      WHERE u.status = 'ativo'
        AND (
          u.role IN ('admin', 'atendimento')
          OR u.id IN (
            SELECT t.responsavel_id
            FROM video_versions vv
            JOIN project_tasks t ON t.id = vv.task_id
            WHERE vv.group_id = r.group_id AND t.responsavel_id IS NOT NULL
          )
          OR u.id IN (
            SELECT tc.user_id
            FROM video_versions vv
            JOIN task_collaborators tc ON tc.task_id = vv.task_id
            WHERE vv.group_id = r.group_id
          )
        )
    LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (
        dest.id, 'comentarios_cliente_video', 'producao', 'high',
        'Comentários novos do cliente',
        v_qtd || CASE WHEN v_qtd = 1 THEN ' comentário novo de ' ELSE ' comentários novos de ' END
          || COALESCE(v_autores, 'cliente') || ' em "' || COALESCE(v_nome, 'vídeo') || '".',
        '/producao/projetos?projectId=' || v_project::text,
        jsonb_build_object('group_id', r.group_id, 'project_id', v_project, 'qtd', v_qtd)
      );
    END LOOP;

    -- Marca até onde já avisei (o próximo lote começa daqui).
    INSERT INTO review_notify_state (group_id, notified_up_to, last_notified_at)
    VALUES (r.group_id, r.ultimo_comentario, now())
    ON CONFLICT (group_id) DO UPDATE
      SET notified_up_to   = EXCLUDED.notified_up_to,
          last_notified_at = EXCLUDED.last_notified_at;
  END LOOP;
END; $$;

-- CONFERÊNCIA: a função existe e o cron continua agendado (deve devolver 1 linha).
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'notify-client-comments-5min';
