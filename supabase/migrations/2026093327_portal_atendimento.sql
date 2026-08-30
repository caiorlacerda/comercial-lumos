-- ATENDIMENTO COM CARA E COM CAMINHO
--
-- A aba Atendimento mostrava nome, cargo e um "Escrever" que abria e-mail. Só
-- que o cliente pergunta pelo canal em que ele já fala com a gente, e isso hoje
-- é WhatsApp e Slack. Sem eles, o portal empurra todo mundo pro e-mail, que é
-- justamente o canal mais lento.
--
-- Agora aparecem a foto de quem cuida da conta e três caminhos: WhatsApp, Slack
-- e e-mail. O Slack é campo novo; o WhatsApp e a foto já existiam no cadastro
-- da equipe e passam a ser aproveitados.

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS slack text;

COMMENT ON COLUMN public.team_members.slack IS
  'Link do perfil no Slack (https://…slack.com/team/U…) ou o @ da pessoa.';

CREATE OR REPLACE FUNCTION public.get_client_portal_v2(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal    RECORD;
  v_client    RECORD;
  v_client_id uuid;
  v_abrir     uuid := NULL;
  v_avisar    boolean := false;
  v_fin       jsonb := NULL;
  v_result    jsonb;
  u           RECORD;
  c_visiveis  text[] := ARRAY['EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO'];
  c_mes       date := date_trunc('month', current_date)::date;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;

  IF v_portal IS NULL THEN
    SELECT pr.client_id, pp.project_id INTO v_client_id, v_abrir
    FROM project_portals pp JOIN projects pr ON pr.id = pp.project_id
    WHERE pp.token = p_token AND pp.active = true;
    IF v_client_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;
    SELECT * INTO v_portal FROM client_portals WHERE client_id = v_client_id AND active = true;
    IF v_portal IS NULL THEN
      INSERT INTO client_portals (client_id) VALUES (v_client_id) RETURNING * INTO v_portal;
    END IF;
  END IF;

  SELECT id, name INTO v_client FROM clients WHERE id = v_portal.client_id;
  IF v_client IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;

  v_avisar := v_portal.last_opened_at IS NULL OR v_portal.last_opened_at < now() - interval '60 minutes';
  IF v_avisar THEN
    FOR u IN
      SELECT DISTINCT a.id FROM app_users a
      WHERE a.status = 'ativo'
        AND (a.role IN ('admin', 'atendimento') OR a.id = ANY(v_portal.contact_user_ids))
    LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (
        u.id, 'cliente_abriu_link', 'producao', 'normal',
        'Cliente abriu o portal 👀',
        v_client.name || ' abriu o portal.',
        '/producao',
        jsonb_build_object('client_portal_id', v_portal.id, 'client_id', v_client.id)
      );
    END LOOP;
  END IF;
  UPDATE client_portals
  SET last_opened_at = now(), opened_count = opened_count + 1
  WHERE id = v_portal.id;

  INSERT INTO review_links (video_version_id, group_id)
  SELECT DISTINCT ON (vv.group_id) vv.id, vv.group_id
  FROM video_versions vv
  JOIN projects p ON p.id = vv.project_id
  WHERE p.client_id = v_client.id
    AND vv.status = ANY(c_visiveis)
    AND NOT EXISTS (SELECT 1 FROM review_links rl WHERE rl.group_id = vv.group_id AND rl.active = true)
  ORDER BY vv.group_id, vv.versao DESC;

  IF v_portal.show_financeiro THEN
    SELECT jsonb_build_object(
      'em_dia', NOT EXISTS (
        SELECT 1 FROM receivables r
        JOIN projects p ON p.budget_id = r.budget_id
        WHERE p.client_id = v_client.id
          AND r.status NOT IN ('recebido', 'cancelado')
          AND r.due_date IS NOT NULL AND r.due_date < current_date
      ),
      'proximo_vencimento', (
        SELECT MIN(r.due_date) FROM receivables r
        JOIN projects p ON p.budget_id = r.budget_id
        WHERE p.client_id = v_client.id
          AND r.status NOT IN ('recebido', 'cancelado')
          AND r.due_date IS NOT NULL AND r.due_date >= current_date
      )
    ) INTO v_fin;
  END IF;

  SELECT jsonb_build_object(
    'cliente', jsonb_build_object('nome', v_client.name),
    'portal', jsonb_build_object('show_financeiro', v_portal.show_financeiro, 'blocks', v_portal.blocks),
    'abrir_projeto', v_abrir,
    'projetos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.name, 'code', p.code, 'status', p.status,
        'data_inicio', p.data_inicio, 'data_fim', p.data_fim,
        'entregas', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'file_name', e.file_name, 'versao', e.versao, 'status', e.status,
            'largura', e.width, 'altura', e.height,
            'client_decision', e.client_decision,
            'client_decided_by', e.client_decided_by,
            'client_decided_at', e.client_decided_at,
            'entregue_em', COALESCE(e.entregue_em, e.uploaded_at, e.created_at),
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
          ) ORDER BY COALESCE(e.entregue_em, e.created_at) DESC)
          FROM (
            SELECT DISTINCT ON (vv.group_id) vv.*
            FROM video_versions vv
            WHERE vv.project_id = p.id AND vv.status = ANY(c_visiveis)
            ORDER BY vv.group_id, vv.versao DESC
          ) e
        ), '[]'::jsonb),
        'cronograma', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'etapa', c.status, 'n', c.n, 'inicio', c.inicio, 'fim', c.fim, 'prazo_cliente', c.prazo))
          FROM (
            SELECT status, count(*) AS n, min(data_inicio) AS inicio,
                   max(data_fim) AS fim, min(data_entrega_cliente) AS prazo
            FROM project_tasks
            WHERE project_id = p.id AND deleted_at IS NULL
            GROUP BY status
          ) c
        ), '[]'::jsonb),
        'stages', (
          SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
          FROM (
            SELECT status, count(*) AS n FROM project_tasks
            WHERE project_id = p.id AND deleted_at IS NULL GROUP BY status
          ) s
        ),
        'escopo', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('rotulo', x.rotulo, 'meta', x.meta, 'realizado', x.realizado))
          FROM escopo_do_mes(p.id, c_mes) x
          WHERE x.periodo = 'mes'
        ), '[]'::jsonb),
        'arquivos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('name', d.name, 'url', d.url, 'kind', d.kind) ORDER BY d.created_at DESC)
          FROM project_documents d
          WHERE d.project_id = p.id AND d.tag = 'entrega'
        ), '[]'::jsonb)
      ) ORDER BY (p.status = 'concluido'), p.created_at DESC)
      FROM projects p
      WHERE p.client_id = v_client.id
        AND p.portal_visivel
        AND (p.status <> 'concluido' OR p.updated_at > now() - interval '90 days')
    ), '[]'::jsonb),

    -- Atendimento: cara e caminhos. O WhatsApp sai do cadastro da equipe e, na
    -- falta dele, do telefone do login. Só entra o que está preenchido: botão
    -- que não leva a lugar nenhum é pior que botão que não existe.
    'contatos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'nome', a.full_name,
        'email', a.email,
        'cargo', COALESCE(NULLIF(a.job_title, ''), tm.role_title),
        'foto', COALESCE(NULLIF(a.avatar_url, ''), tm.photo_url),
        'whatsapp', COALESCE(NULLIF(tm.whatsapp, ''), NULLIF(a.phone, '')),
        'slack', NULLIF(tm.slack, '')
      ) ORDER BY array_position(v_portal.contact_user_ids, a.id))
      FROM app_users a
      LEFT JOIN team_members tm ON tm.app_user_id = a.id
      WHERE a.id = ANY(v_portal.contact_user_ids) AND a.status = 'ativo'
    ), '[]'::jsonb),

    'financeiro', v_fin,
    'atividade', COALESCE((
      SELECT jsonb_agg(t.x ORDER BY (t.x->>'quando') DESC)
      FROM (
        SELECT raw.x FROM (
          SELECT jsonb_build_object('tipo', 'decisao', 'projeto', p.name,
            'file_name', vv.file_name, 'decisao', vv.client_decision,
            'quem', vv.client_decided_by, 'quando', vv.client_decided_at) AS x
          FROM video_versions vv JOIN projects p ON p.id = vv.project_id
          WHERE p.client_id = v_client.id AND p.portal_visivel
            AND vv.status = ANY(c_visiveis) AND vv.client_decided_at IS NOT NULL
          UNION ALL
          SELECT jsonb_build_object('tipo', 'entrega', 'projeto', p.name,
            'file_name', vv.file_name, 'versao', vv.versao,
            'quando', COALESCE(vv.entregue_em, vv.uploaded_at, vv.created_at))
          FROM video_versions vv JOIN projects p ON p.id = vv.project_id
          WHERE p.client_id = v_client.id AND p.portal_visivel
            AND vv.status = ANY(c_visiveis)
        ) raw
        ORDER BY (raw.x->>'quando') DESC NULLS LAST
        LIMIT 12
      ) t
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_v2(text) TO anon, authenticated;

-- Conferência: quem está como contato de portal e o que já tem preenchido.
SELECT a.full_name,
       (a.avatar_url IS NOT NULL) AS tem_foto,
       COALESCE(tm.whatsapp, a.phone) AS whatsapp,
       tm.slack
FROM app_users a
LEFT JOIN team_members tm ON tm.app_user_id = a.id
WHERE a.id IN (SELECT unnest(contact_user_ids) FROM client_portals WHERE active);
