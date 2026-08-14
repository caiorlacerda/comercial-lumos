-- PORTAL DO CLIENTE — o cliente só vê o que JÁ FOI LIBERADO pra ele.
--
-- Antes, a RPC devolvia TODOS os vídeos do projeto — inclusive os que estão em
-- revisão interna ou em alteração interna, ou seja, corte que o time ainda está
-- mexendo. Agora entra só o que passou pela aprovação interna e foi enviado ao
-- cliente: EM_REVISAO_CLIENTE, ALTERACOES_CLIENTE e APROVADO.
--
-- Vale pras entregas E pra atividade (o feed também citava vídeo interno).

CREATE OR REPLACE FUNCTION public.get_client_portal(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal   RECORD;
  v_project  RECORD;
  v_fin      jsonb := NULL;
  v_result   jsonb;
  u          RECORD;
  -- Etapas que o cliente pode ver. Fora daqui = trabalho interno da Lumos.
  c_visiveis text[] := ARRAY['EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO'];
BEGIN
  SELECT * INTO v_portal FROM project_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;

  SELECT id, name, code, status, data_fim, budget_id
  INTO v_project FROM projects WHERE id = v_portal.project_id;
  IF v_project IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;

  IF v_portal.last_opened_at IS NULL OR v_portal.last_opened_at < now() - interval '60 minutes' THEN
    FOR u IN
      SELECT DISTINCT a.id FROM app_users a
      WHERE a.status = 'ativo'
        AND (a.role IN ('admin', 'atendimento') OR a.id = ANY(v_portal.contact_user_ids))
    LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (
        u.id, 'cliente_abriu_link', 'producao', 'normal',
        'Cliente abriu o portal 👀',
        'O portal do projeto "' || v_project.name || '" foi aberto.',
        '/producao/projetos?projectId=' || v_project.id::text,
        jsonb_build_object('portal_id', v_portal.id, 'project_id', v_project.id)
      );
    END LOOP;
  END IF;
  UPDATE project_portals
  SET last_opened_at = now(), opened_count = opened_count + 1
  WHERE id = v_portal.id;

  -- Link de revisão só pros vídeos que o cliente pode ver.
  INSERT INTO review_links (video_version_id, group_id)
  SELECT DISTINCT ON (vv.group_id) vv.id, vv.group_id
  FROM video_versions vv
  WHERE vv.project_id = v_project.id
    AND vv.status = ANY(c_visiveis)
    AND NOT EXISTS (
      SELECT 1 FROM review_links rl WHERE rl.group_id = vv.group_id AND rl.active = true
    )
  ORDER BY vv.group_id, vv.versao DESC;

  IF v_portal.show_financeiro AND v_project.budget_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'em_dia', NOT EXISTS (
        SELECT 1 FROM receivables r
        WHERE r.budget_id = v_project.budget_id
          AND r.status NOT IN ('recebido', 'cancelado')
          AND r.due_date IS NOT NULL AND r.due_date < current_date
      ),
      'proximo_vencimento', (
        SELECT MIN(r.due_date) FROM receivables r
        WHERE r.budget_id = v_project.budget_id
          AND r.status NOT IN ('recebido', 'cancelado')
          AND r.due_date IS NOT NULL AND r.due_date >= current_date
      )
    ) INTO v_fin;
  END IF;

  SELECT jsonb_build_object(
    'portal', jsonb_build_object('show_financeiro', v_portal.show_financeiro, 'blocks', v_portal.blocks),
    'project', jsonb_build_object(
      'name', v_project.name, 'code', v_project.code,
      'status', v_project.status, 'data_fim', v_project.data_fim
    ),
    'stages', (
      SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
      FROM (
        SELECT status, count(*) AS n
        FROM project_tasks
        WHERE project_id = v_project.id AND deleted_at IS NULL
        GROUP BY status
      ) s
    ),
    -- Só o que foi liberado pro cliente (1 item por vídeo, versão mais nova).
    'entregas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'file_name', e.file_name,
        'versao', e.versao,
        'status', e.status,
        'client_decision', e.client_decision,
        'client_decided_by', e.client_decided_by,
        'client_decided_at', e.client_decided_at,
        'thumb_url', e.thumb_url,
        'entregue_em', COALESCE(e.uploaded_at, e.created_at),
        'review_token', (
          SELECT rl.token FROM review_links rl
          WHERE rl.group_id = e.group_id AND rl.active = true
          ORDER BY rl.created_at DESC LIMIT 1
        ),
        'allow_download', COALESCE((
          SELECT rl.allow_download FROM review_links rl
          WHERE rl.group_id = e.group_id AND rl.active = true
          ORDER BY rl.created_at DESC LIMIT 1
        ), false)
      ) ORDER BY COALESCE(e.uploaded_at, e.created_at) DESC)
      FROM (
        SELECT DISTINCT ON (vv.group_id) vv.*
        FROM video_versions vv
        WHERE vv.project_id = v_project.id
          AND vv.status = ANY(c_visiveis)
        ORDER BY vv.group_id, vv.versao DESC
      ) e
    ), '[]'::jsonb),
    'arquivos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', d.name, 'url', d.url, 'kind', d.kind) ORDER BY d.created_at DESC)
      FROM project_documents d
      WHERE d.project_id = v_project.id AND d.tag = 'entrega'
    ), '[]'::jsonb),
    'financeiro', v_fin,
    'contatos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nome', a.full_name, 'email', a.email, 'cargo', a.job_title)
                       ORDER BY array_position(v_portal.contact_user_ids, a.id))
      FROM app_users a
      WHERE a.id = ANY(v_portal.contact_user_ids) AND a.status = 'ativo'
    ), '[]'::jsonb),
    -- Atividade também só fala de vídeo que o cliente conhece.
    'atividade', COALESCE((
      SELECT jsonb_agg(t.x ORDER BY (t.x->>'quando') DESC)
      FROM (
        SELECT raw.x
        FROM (
          SELECT jsonb_build_object('tipo', 'decisao', 'file_name', vv.file_name,
            'decisao', vv.client_decision, 'quem', vv.client_decided_by, 'quando', vv.client_decided_at) AS x
          FROM video_versions vv
          WHERE vv.project_id = v_project.id
            AND vv.status = ANY(c_visiveis)
            AND vv.client_decided_at IS NOT NULL
          UNION ALL
          SELECT jsonb_build_object('tipo', 'entrega', 'file_name', vv.file_name,
            'versao', vv.versao, 'quando', COALESCE(vv.uploaded_at, vv.created_at))
          FROM video_versions vv
          WHERE vv.project_id = v_project.id
            AND vv.status = ANY(c_visiveis)
        ) raw
        ORDER BY (raw.x->>'quando') DESC NULLS LAST
        LIMIT 8
      ) t
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_client_portal(text) TO anon, authenticated;
