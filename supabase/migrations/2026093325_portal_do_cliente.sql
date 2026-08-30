-- UM LINK POR CLIENTE, COM UMA ABA POR PROJETO
--
-- O portal era por projeto: cliente com seis projetos recebia seis links, seis
-- lugares pra procurar e nenhum lugar que respondesse "o que a Lumos precisa de
-- mim hoje?". Agora o link é do CLIENTE e cada projeto é uma aba.
--
-- Os links antigos continuam valendo: quem abrir um token de projeto cai no
-- portal do cliente com aquela aba aberta. Ninguém precisa reenviar nada.

-- ───────────────────────────────────────────────────────────────
-- 1) O portal do cliente
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_portals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- 12 chars URL-safe. Mesma entropia do portal de projeto; o alcance é maior,
  -- então revogar é um clique e o último acesso fica registrado.
  token            text NOT NULL UNIQUE DEFAULT translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_'),
  active           boolean NOT NULL DEFAULT true,
  show_financeiro  boolean NOT NULL DEFAULT false,
  blocks           jsonb NOT NULL DEFAULT '{"escopo": true, "cronograma": true, "arquivos": true, "atividade": true}'::jsonb,
  contact_user_ids uuid[] NOT NULL DEFAULT '{}',
  created_by       uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_opened_at   timestamptz,
  opened_count     integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS client_portals_client_idx ON public.client_portals (client_id) WHERE active;

ALTER TABLE public.client_portals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manage_client_portals ON public.client_portals;
CREATE POLICY manage_client_portals ON public.client_portals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.client_portals TO authenticated, service_role;

-- Interruptor por projeto: nem todo projeto do cliente deve aparecer pra ele.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS portal_visivel boolean NOT NULL DEFAULT true;

-- ───────────────────────────────────────────────────────────────
-- 2) Tudo que o portal mostra, numa consulta só
-- ───────────────────────────────────────────────────────────────
-- Aceita o token do CLIENTE e também o token antigo, de projeto: neste caso
-- devolve o mesmo portal do cliente, dizendo qual aba abrir.
CREATE OR REPLACE FUNCTION public.get_client_portal_v2(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal    RECORD;
  v_client    RECORD;
  -- Separado do RECORD de propósito: o Postgres não deixa um RECORD dividir a
  -- lista de um SELECT ... INTO com outra variável.
  v_client_id uuid;
  v_abrir     uuid := NULL;     -- aba a abrir, quando vem de link antigo
  v_avisar    boolean := false;
  v_fin       jsonb := NULL;
  v_result    jsonb;
  u           RECORD;
  c_visiveis  text[] := ARRAY['EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO'];
  c_mes       date := date_trunc('month', current_date)::date;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;

  -- Link antigo (de projeto): acha o cliente dele e segue no portal do cliente.
  IF v_portal IS NULL THEN
    SELECT pr.client_id, pp.project_id INTO v_client_id, v_abrir
    FROM project_portals pp JOIN projects pr ON pr.id = pp.project_id
    WHERE pp.token = p_token AND pp.active = true;
    IF v_client_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;
    SELECT * INTO v_portal FROM client_portals WHERE client_id = v_client_id AND active = true;
    -- Cliente ainda sem portal: cria na hora, pra o link antigo não morrer.
    IF v_portal IS NULL THEN
      INSERT INTO client_portals (client_id) VALUES (v_client_id) RETURNING * INTO v_portal;
    END IF;
  END IF;

  SELECT id, name INTO v_client FROM clients WHERE id = v_portal.client_id;
  IF v_client IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;

  -- Aviso ao time, com freio de uma hora pra não virar spam.
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

  -- Todo vídeo visível precisa de um link de revisão pra poder ser aberto.
  INSERT INTO review_links (video_version_id, group_id)
  SELECT DISTINCT ON (vv.group_id) vv.id, vv.group_id
  FROM video_versions vv
  JOIN projects p ON p.id = vv.project_id
  WHERE p.client_id = v_client.id
    AND vv.status = ANY(c_visiveis)
    AND NOT EXISTS (SELECT 1 FROM review_links rl WHERE rl.group_id = vv.group_id AND rl.active = true)
  ORDER BY vv.group_id, vv.versao DESC;

  -- Financeiro do CLIENTE: situação e data, nunca valores.
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

    -- Projetos que o cliente pode ver: ativos, mais os encerrados há pouco
    -- (ele volta atrás de arquivo meses depois), menos os desligados no painel.
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

        -- O combinado do mês, se este projeto tiver contrato por volume.
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

    'contatos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nome', a.full_name, 'email', a.email, 'cargo', a.job_title)
                       ORDER BY array_position(v_portal.contact_user_ids, a.id))
      FROM app_users a
      WHERE a.id = ANY(v_portal.contact_user_ids) AND a.status = 'ativo'
    ), '[]'::jsonb),

    'financeiro', v_fin,

    -- O diário é do cliente inteiro: é o que só um link por cliente permite.
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

-- Conferência: cria o portal do Vitru e mostra quantos projetos e quantas
-- entregas ele veria. Troque o nome do cliente se quiser testar com outro.
-- INSERT INTO client_portals (client_id) SELECT id FROM clients WHERE name = 'Vitru'
--   ON CONFLICT DO NOTHING;
-- SELECT jsonb_array_length(get_client_portal_v2((SELECT token FROM client_portals cp
--   JOIN clients c ON c.id = cp.client_id WHERE c.name = 'Vitru'))->'projetos') AS projetos;
