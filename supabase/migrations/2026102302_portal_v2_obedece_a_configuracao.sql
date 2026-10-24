-- PORTAL DO CLIENTE: A FUNÇÃO GRANDE (get_client_portal_v2) PASSA A OBEDECER AO QUE O TIME CONFIGURA
--
-- 1) "Blocos" (escopo, cronograma, arquivos, atividade) desligados no modal agora são aplicados NO
--    BANCO: antes a função devolvia tudo e só a tela escondia, e qualquer pessoa com o link via
--    os dados na resposta.
-- 2) Cronograma e etapas: só as etapas que a tela do cliente conhece (roteiro, captação, edição,
--    revisão do cliente, alterações, concluído, entregue). A revisão INTERNA aparece como edição,
--    em vez de "Sua revisão: agora" quando a Lumos ainda está revisando por dentro. Fila, pausa e
--    outros estados internos não saem mais.
-- 3) Financeiro (em dia / próximo vencimento) de quem tem acesso restrito a certos projetos soma só
--    os projetos dele, em vez de todos do cliente.
-- 4) Sem portal legado: token que não é de um portal ATIVO é inválido (antes recriava o portal).
-- 5) A contagem de aberturas sobe no máximo uma vez a cada 30 minutos (recarregar e o time clicando
--    em "Abrir" inflavam o número).
-- Pressupõe a migration 2026093340 (esta função é a mesma, com as mudanças acima).

DO $$
BEGIN
  IF to_regprocedure('public.get_client_portal_v2(text)') IS NULL
     OR to_regprocedure('public.automacao_ativa(text)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026093340_automacoes.sql.';
  END IF;
END $$;

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
  v_email     text;
  -- Escalares, e não um RECORD: sem login a variável nunca é preenchida, e ler
  -- um campo de RECORD não atribuído derruba a função inteira.
  v_pessoa_id    uuid := NULL;
  v_pessoa_nome  text := NULL;
  v_pessoa_email text := NULL;
  v_restrito     boolean := false;
  c_visiveis  text[] := ARRAY['EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO'];
  c_mes       date := date_trunc('month', current_date)::date;
  -- Blocos que o time liga/desliga no modal: antes o banco devolvia tudo e só a tela
  -- escondia. Agora o que está desligado nem sai daqui. Ausente = ligado.
  b_escopo     boolean;
  b_cronograma boolean;
  b_arquivos   boolean;
  b_atividade  boolean;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;

  -- Token que não é de um portal ATIVO é inválido. Antes, um token legado por projeto
  -- recriava sozinho o portal do cliente (sem "exigir login") mesmo depois de revogado.
  IF v_portal IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;

  b_escopo     := COALESCE((v_portal.blocks ->> 'escopo')::boolean, true);
  b_cronograma := COALESCE((v_portal.blocks ->> 'cronograma')::boolean, true);
  b_arquivos   := COALESCE((v_portal.blocks ->> 'arquivos')::boolean, true);
  b_atividade  := COALESCE((v_portal.blocks ->> 'atividade')::boolean, true);

  SELECT id, name INTO v_client FROM clients WHERE id = v_portal.client_id;
  IF v_client IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;

  -- Porta: com login ligado, o link sozinho não abre mais nada.
  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_email = '' THEN
      RETURN jsonb_build_object('error', 'precisa_login',
                                'cliente', jsonb_build_object('nome', v_client.name));
    END IF;
    SELECT id, nome, email INTO v_pessoa_id, v_pessoa_nome, v_pessoa_email
    FROM client_users
    WHERE client_id = v_client.id AND lower(email) = v_email AND ativo;
    IF v_pessoa_id IS NULL THEN
      RETURN jsonb_build_object('error', 'sem_acesso',
                                'cliente', jsonb_build_object('nome', v_client.name));
    END IF;
    UPDATE client_users SET auth_user_id = auth.uid(), last_login_at = now()
    WHERE id = v_pessoa_id;
    v_restrito := EXISTS (SELECT 1 FROM client_user_projects WHERE client_user_id = v_pessoa_id);
  END IF;

  -- AUTOMAÇÃO cliente_abriu_portal_avisa: desligada, ninguém é avisado. A
  -- contagem de aberturas logo abaixo continua rodando de qualquer jeito.
  v_avisar := public.automacao_ativa('cliente_abriu_portal_avisa')
              AND (v_portal.last_opened_at IS NULL
                   OR v_portal.last_opened_at < now() - interval '60 minutes');
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
        COALESCE(v_pessoa_nome, v_pessoa_email, v_client.name) || ' abriu o portal.',
        '/producao',
        jsonb_build_object('client_portal_id', v_portal.id, 'client_id', v_client.id)
      );
    END LOOP;
  END IF;
  -- Uma abertura a cada 30 minutos: recarregar a página, trocar de aba do navegador ou o
  -- time clicando em "Abrir" não inflam mais o contador.
  UPDATE client_portals
  SET last_opened_at = now(), opened_count = opened_count + 1
  WHERE id = v_portal.id
    AND (last_opened_at IS NULL OR last_opened_at < now() - interval '30 minutes');

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
          AND (NOT v_restrito OR p.id IN (
                SELECT cup.project_id FROM client_user_projects cup WHERE cup.client_user_id = v_pessoa_id))
      ),
      'proximo_vencimento', (
        SELECT MIN(r.due_date) FROM receivables r
        JOIN projects p ON p.budget_id = r.budget_id
        WHERE p.client_id = v_client.id
          AND r.status NOT IN ('recebido', 'cancelado')
          AND r.due_date IS NOT NULL AND r.due_date >= current_date
          AND (NOT v_restrito OR p.id IN (
                SELECT cup.project_id FROM client_user_projects cup WHERE cup.client_user_id = v_pessoa_id))
      )
    ) INTO v_fin;
  END IF;

  SELECT jsonb_build_object(
    'cliente', jsonb_build_object('nome', v_client.name),
    'portal', jsonb_build_object('show_financeiro', v_portal.show_financeiro,
                                 'blocks', v_portal.blocks,
                                 'exige_login', v_portal.exige_login),
    'voce', CASE WHEN v_pessoa_id IS NULL THEN NULL ELSE
      jsonb_build_object('nome', COALESCE(v_pessoa_nome, split_part(v_pessoa_email, '@', 1)),
                         'email', v_pessoa_email) END,
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
        -- Só as etapas que a tela do cliente conhece. A revisão INTERNA é trabalho da Lumos:
        -- para o cliente ela segue como edição, até o vídeo chegar a ele. Fila, pausa e
        -- demais estados internos não saem daqui.
        'cronograma', CASE WHEN NOT b_cronograma THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'etapa', c.etapa, 'n', c.n, 'inicio', c.inicio, 'fim', c.fim, 'prazo_cliente', c.prazo))
          FROM (
            SELECT CASE WHEN status = 'revisao_interna' THEN 'em_progresso' ELSE status END AS etapa,
                   count(*) AS n, min(data_inicio) AS inicio,
                   max(data_fim) AS fim, min(data_entrega_cliente) AS prazo
            FROM project_tasks
            WHERE project_id = p.id AND deleted_at IS NULL
              AND status IN ('roteiro', 'captacao', 'em_progresso', 'revisao_interna',
                             'revisao_cliente', 'alteracoes', 'concluido', 'entregue')
            GROUP BY 1
          ) c
        ), '[]'::jsonb) END,
        'stages', CASE WHEN NOT b_cronograma THEN '{}'::jsonb ELSE (
          SELECT COALESCE(jsonb_object_agg(s.etapa, s.n), '{}'::jsonb)
          FROM (
            SELECT CASE WHEN status = 'revisao_interna' THEN 'em_progresso' ELSE status END AS etapa,
                   count(*) AS n
            FROM project_tasks
            WHERE project_id = p.id AND deleted_at IS NULL
              AND status IN ('roteiro', 'captacao', 'em_progresso', 'revisao_interna',
                             'revisao_cliente', 'alteracoes', 'concluido', 'entregue')
            GROUP BY 1
          ) s
        ) END,
        'escopo', CASE WHEN NOT b_escopo THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(jsonb_build_object('rotulo', x.rotulo, 'meta', x.meta, 'realizado', x.realizado))
          FROM escopo_do_mes(p.id, c_mes) x
          WHERE x.periodo = 'mes'
        ), '[]'::jsonb) END,
        'arquivos', CASE WHEN NOT b_arquivos THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(jsonb_build_object('name', d.name, 'url', d.url, 'kind', d.kind) ORDER BY d.created_at DESC)
          FROM project_documents d
          WHERE d.project_id = p.id AND d.tag = 'entrega'
        ), '[]'::jsonb) END
      ) ORDER BY (p.status = 'concluido'), p.created_at DESC)
      FROM projects p
      WHERE p.client_id = v_client.id
        AND p.portal_visivel
        AND (p.status <> 'concluido' OR p.updated_at > now() - interval '90 days')
        AND (NOT v_restrito OR p.id IN (
              SELECT cup.project_id FROM client_user_projects cup
              WHERE cup.client_user_id = v_pessoa_id))
    ), '[]'::jsonb),
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
    'atividade', CASE WHEN NOT b_atividade THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(t.x ORDER BY (t.x->>'quando') DESC)
      FROM (
        SELECT raw.x FROM (
          SELECT jsonb_build_object('tipo', 'decisao', 'projeto', p.name,
            'file_name', vv.file_name, 'decisao', vv.client_decision,
            'quem', vv.client_decided_by, 'quando', vv.client_decided_at) AS x
          FROM video_versions vv JOIN projects p ON p.id = vv.project_id
          WHERE p.client_id = v_client.id AND p.portal_visivel
            AND vv.status = ANY(c_visiveis) AND vv.client_decided_at IS NOT NULL
            AND (NOT v_restrito OR p.id IN (
                  SELECT cup.project_id FROM client_user_projects cup
                  WHERE cup.client_user_id = v_pessoa_id))
          UNION ALL
          SELECT jsonb_build_object('tipo', 'entrega', 'projeto', p.name,
            'file_name', vv.file_name, 'versao', vv.versao,
            'quando', COALESCE(vv.entregue_em, vv.uploaded_at, vv.created_at))
          FROM video_versions vv JOIN projects p ON p.id = vv.project_id
          WHERE p.client_id = v_client.id AND p.portal_visivel
            AND vv.status = ANY(c_visiveis)
            AND (NOT v_restrito OR p.id IN (
                  SELECT cup.project_id FROM client_user_projects cup
                  WHERE cup.client_user_id = v_pessoa_id))
        ) raw
        ORDER BY (raw.x->>'quando') DESC NULLS LAST
        LIMIT 12
      ) t
    ), '[]'::jsonb) END
  ) INTO v_result;

  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_v2(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_client_portal_v2(text) IS
  'Tudo o que o portal do cliente mostra, numa consulta só. Respeita os blocos ligados no modal, mostra só etapas que o cliente entende e soma o financeiro só dos projetos permitidos. Com a automação cliente_abriu_portal_avisa ligada, avisa o time na primeira abertura de cada hora.';

-- CONFERÊNCIA: a função continua aberta ao portal público (true).
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_client_portal_v2';
