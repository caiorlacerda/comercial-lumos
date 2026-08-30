-- CADA PESSOA DO CLIENTE VÊ O QUE É DELA
--
-- O portal era um link: quem tivesse o endereço via a conta inteira. Isso serve
-- pro cliente pequeno, e não serve pro grande — lá dentro tem gente de marketing
-- que só cuida de uma frente, e mandar o link com tudo é entregar mais do que
-- foi combinado mostrar.
--
-- Agora existe login por pessoa, ligado por cliente. Entrada por e-mail, sem
-- senha: senha em portal de cliente vira "esqueci minha senha" toda semana, e a
-- Lumos vira suporte de senha.
--
-- Com o login ligado, o link aberto para de valer para aquele cliente. Manter
-- os dois seria uma porta dos fundos que anula a restrição que acabou de ser
-- criada.

-- ───────────────────────────────────────────────────────────────
-- 1) As pessoas do cliente e o que cada uma alcança
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  email         text NOT NULL,
  nome          text,
  ativo         boolean NOT NULL DEFAULT true,
  -- Preenchido no primeiro login: liga a pessoa ao usuário que o Supabase criou.
  auth_user_id  uuid,
  created_by    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS client_users_email_idx
  ON public.client_users (client_id, lower(email));

-- Sem linha aqui = vê todos os projetos do portal. O caso comum não dá trabalho;
-- restringir é o que exige um clique.
CREATE TABLE IF NOT EXISTS public.client_user_projects (
  client_user_id uuid NOT NULL REFERENCES public.client_users(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  PRIMARY KEY (client_user_id, project_id)
);

ALTER TABLE public.client_portals
  ADD COLUMN IF NOT EXISTS exige_login boolean NOT NULL DEFAULT false;

ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_user_projects ENABLE ROW LEVEL SECURITY;

-- Quem administra é o time da Lumos. O portal nunca lê estas tabelas direto:
-- tudo passa pelas funções abaixo.
DROP POLICY IF EXISTS manage_client_users ON public.client_users;
CREATE POLICY manage_client_users ON public.client_users
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'producao'))
  WITH CHECK (public.get_user_role() IN ('admin', 'producao'));

DROP POLICY IF EXISTS manage_client_user_projects ON public.client_user_projects;
CREATE POLICY manage_client_user_projects ON public.client_user_projects
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'producao'))
  WITH CHECK (public.get_user_role() IN ('admin', 'producao'));

GRANT ALL ON public.client_users, public.client_user_projects TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- 2) Este e-mail pode entrar neste portal?
-- ───────────────────────────────────────────────────────────────
-- Chamada antes de mandar o link de entrada. A tela responde a mesma coisa nos
-- dois casos ("se este e-mail tiver acesso, o link chegou"), pra não virar um
-- jeito de descobrir quem trabalha no cliente.
CREATE OR REPLACE FUNCTION public.portal_pode_entrar(p_token text, p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM client_portals cp
    JOIN client_users cu ON cu.client_id = cp.client_id
    WHERE cp.token = p_token AND cp.active
      AND cu.ativo
      AND lower(cu.email) = lower(trim(p_email))
  );
$$;

GRANT EXECUTE ON FUNCTION public.portal_pode_entrar(text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3) O portal passa a conhecer quem entrou
-- ───────────────────────────────────────────────────────────────
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
  v_pessoa    RECORD;
  v_restrito  boolean := false;
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

  -- Porta: com login ligado, o link sozinho não abre mais nada.
  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_email = '' THEN
      RETURN jsonb_build_object('error', 'precisa_login',
                                'cliente', jsonb_build_object('nome', v_client.name));
    END IF;
    SELECT * INTO v_pessoa FROM client_users
    WHERE client_id = v_client.id AND lower(email) = v_email AND ativo;
    IF v_pessoa IS NULL THEN
      RETURN jsonb_build_object('error', 'sem_acesso',
                                'cliente', jsonb_build_object('nome', v_client.name));
    END IF;
    UPDATE client_users SET auth_user_id = auth.uid(), last_login_at = now()
    WHERE id = v_pessoa.id;
    v_restrito := EXISTS (SELECT 1 FROM client_user_projects WHERE client_user_id = v_pessoa.id);
  END IF;

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
        COALESCE(v_pessoa.nome, v_pessoa.email, v_client.name) || ' abriu o portal.',
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
    'portal', jsonb_build_object('show_financeiro', v_portal.show_financeiro,
                                 'blocks', v_portal.blocks,
                                 'exige_login', v_portal.exige_login),
    'voce', CASE WHEN v_pessoa.id IS NULL THEN NULL ELSE
      jsonb_build_object('nome', COALESCE(v_pessoa.nome, split_part(v_pessoa.email, '@', 1)),
                         'email', v_pessoa.email) END,
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
        AND (NOT v_restrito OR p.id IN (
              SELECT cup.project_id FROM client_user_projects cup
              WHERE cup.client_user_id = v_pessoa.id))
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
            AND (NOT v_restrito OR p.id IN (
                  SELECT cup.project_id FROM client_user_projects cup
                  WHERE cup.client_user_id = v_pessoa.id))
          UNION ALL
          SELECT jsonb_build_object('tipo', 'entrega', 'projeto', p.name,
            'file_name', vv.file_name, 'versao', vv.versao,
            'quando', COALESCE(vv.entregue_em, vv.uploaded_at, vv.created_at))
          FROM video_versions vv JOIN projects p ON p.id = vv.project_id
          WHERE p.client_id = v_client.id AND p.portal_visivel
            AND vv.status = ANY(c_visiveis)
            AND (NOT v_restrito OR p.id IN (
                  SELECT cup.project_id FROM client_user_projects cup
                  WHERE cup.client_user_id = v_pessoa.id))
        ) raw
        ORDER BY (raw.x->>'quando') DESC NULLS LAST
        LIMIT 12
      ) t
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_v2(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────
-- 4) As capas seguem a mesma porta
-- ───────────────────────────────────────────────────────────────
-- Sem isto, quem conhecesse o código de um vídeo veria a capa de um projeto
-- que não é dele.
CREATE OR REPLACE FUNCTION public.portal_capas(p_token text, p_review_tokens text[])
RETURNS TABLE (review_token text, capa text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client   uuid;
  v_login    boolean := false;
  v_pessoa   uuid;
  v_restrito boolean := false;
BEGIN
  SELECT cp.client_id, cp.exige_login INTO v_client, v_login
  FROM client_portals cp WHERE cp.token = p_token AND cp.active;

  IF v_client IS NULL THEN
    SELECT pr.client_id INTO v_client
    FROM project_portals pp JOIN projects pr ON pr.id = pp.project_id
    WHERE pp.token = p_token AND pp.active;
  END IF;

  IF v_client IS NULL THEN RETURN; END IF;

  IF v_login THEN
    SELECT cu.id INTO v_pessoa FROM client_users cu
    WHERE cu.client_id = v_client AND cu.ativo
      AND lower(cu.email) = lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_pessoa IS NULL THEN RETURN; END IF;
    v_restrito := EXISTS (SELECT 1 FROM client_user_projects WHERE client_user_id = v_pessoa);
  END IF;

  RETURN QUERY
  SELECT rl.token, v.thumb_url
  FROM review_links rl
  JOIN LATERAL (
    SELECT vv.* FROM video_versions vv
    WHERE COALESCE(vv.group_id, vv.id) = COALESCE(rl.group_id, rl.video_version_id)
    ORDER BY vv.versao DESC LIMIT 1
  ) v ON true
  JOIN projects p ON p.id = v.project_id
  WHERE rl.active
    AND rl.token = ANY(p_review_tokens)
    AND p.client_id = v_client
    AND p.portal_visivel
    AND v.status IN ('EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO')
    AND v.thumb_url IS NOT NULL
    AND (NOT v_restrito OR p.id IN (
          SELECT cup.project_id FROM client_user_projects cup WHERE cup.client_user_id = v_pessoa));
END; $$;

GRANT EXECUTE ON FUNCTION public.portal_capas(text, text[]) TO anon, authenticated;

-- Conferência: nenhum cliente exige login ainda (o padrão é continuar como está).
SELECT c.name, cp.exige_login, count(cu.id) AS pessoas
FROM client_portals cp
JOIN clients c ON c.id = cp.client_id
LEFT JOIN client_users cu ON cu.client_id = cp.client_id
WHERE cp.active GROUP BY 1, 2;
