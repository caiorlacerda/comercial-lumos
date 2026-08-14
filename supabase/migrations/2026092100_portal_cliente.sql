-- PORTAL DO CLIENTE (Fase 1) — dashboard público por projeto, via token.
--
-- Substitui a "planilha de entregas": o cliente vê num link só as entregas de
-- vídeo (com o player de revisão que já existe), as etapas do projeto, os
-- arquivos marcados como entrega e um resumo financeiro SEM valores.
--
-- Segurança: mesmo padrão maduro da revisão de vídeo — a tabela fica fechada
-- por RLS e o público só acessa pela RPC SECURITY DEFINER, que devolve uma
-- LISTA BRANCA de campos (nada de custos, margens, responsáveis internos).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Tabela de portais (1 link por projeto; pode revogar e regerar)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_portals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- 12 chars URL-safe (72 bits) — mais entropia que o link de revisão, já que
  -- o portal expõe o projeto inteiro.
  token            text NOT NULL UNIQUE DEFAULT translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_'),
  active           boolean NOT NULL DEFAULT true,
  show_financeiro  boolean NOT NULL DEFAULT false,
  -- Quem aparece no card "Seu atendimento" (nome + e-mail).
  contact_user_id  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_by       uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_opened_at   timestamptz,
  opened_count     integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS project_portals_project_idx ON public.project_portals (project_id);

ALTER TABLE public.project_portals ENABLE ROW LEVEL SECURITY;

-- Time gerencia (mesma regra de quem gerencia entregas); anon nunca lê a tabela.
DROP POLICY IF EXISTS manage_project_portals ON public.project_portals;
CREATE POLICY manage_project_portals ON public.project_portals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.project_portals TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) RPC pública: tudo que o portal mostra, numa chamada só
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_client_portal(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal   RECORD;
  v_project  RECORD;
  v_contact  RECORD;
  v_fin      jsonb := NULL;
  v_result   jsonb;
  u          RECORD;
BEGIN
  SELECT * INTO v_portal FROM project_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;

  SELECT id, name, code, status, data_fim, budget_id
  INTO v_project FROM projects WHERE id = v_portal.project_id;
  IF v_project IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;

  -- Aviso "cliente abriu o portal" (com freio de 60 min pra não virar spam).
  IF v_portal.last_opened_at IS NULL OR v_portal.last_opened_at < now() - interval '60 minutes' THEN
    FOR u IN
      SELECT DISTINCT a.id FROM app_users a
      WHERE a.status = 'ativo'
        AND (a.role IN ('admin', 'atendimento') OR a.id = v_portal.contact_user_id)
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

  -- Garante link de revisão pra cada vídeo do projeto (o player público
  -- precisa do token por grupo; marca d'água ligada por padrão).
  INSERT INTO review_links (video_version_id, group_id)
  SELECT DISTINCT ON (vv.group_id) vv.id, vv.group_id
  FROM video_versions vv
  WHERE vv.project_id = v_project.id
    AND NOT EXISTS (
      SELECT 1 FROM review_links rl WHERE rl.group_id = vv.group_id AND rl.active = true
    )
  ORDER BY vv.group_id, vv.versao DESC;

  -- Contato do card "Seu atendimento".
  IF v_portal.contact_user_id IS NOT NULL THEN
    SELECT full_name, email INTO v_contact FROM app_users WHERE id = v_portal.contact_user_id AND status = 'ativo';
  END IF;

  -- Financeiro SEM valores: em dia? próximo vencimento pendente?
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
    'portal', jsonb_build_object('show_financeiro', v_portal.show_financeiro),
    'project', jsonb_build_object(
      'name', v_project.name, 'code', v_project.code,
      'status', v_project.status, 'data_fim', v_project.data_fim
    ),
    -- Contagem de tarefas por etapa (o front deriva os marcos). Só números.
    'stages', (
      SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
      FROM (
        SELECT status, count(*) AS n
        FROM project_tasks
        WHERE project_id = v_project.id AND deleted_at IS NULL
        GROUP BY status
      ) s
    ),
    -- Entregas: 1 item por vídeo (versão mais nova do grupo) + token do player.
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
        )
      ) ORDER BY COALESCE(e.uploaded_at, e.created_at) DESC)
      FROM (
        SELECT DISTINCT ON (vv.group_id) vv.*
        FROM video_versions vv
        WHERE vv.project_id = v_project.id
        ORDER BY vv.group_id, vv.versao DESC
      ) e
    ), '[]'::jsonb),
    -- Arquivos marcados como entrega (categoria "Entrega" nos documentos).
    'arquivos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', d.name, 'url', d.url, 'kind', d.kind) ORDER BY d.created_at DESC)
      FROM project_documents d
      WHERE d.project_id = v_project.id AND d.tag = 'entrega'
    ), '[]'::jsonb),
    'financeiro', v_fin,
    'contato', CASE WHEN v_contact IS NULL THEN NULL
      ELSE jsonb_build_object('nome', v_contact.full_name, 'email', v_contact.email) END,
    -- Atividade: decisões do cliente + entregas novas. "Quem" interno nunca vaza.
    'atividade', COALESCE((
      SELECT jsonb_agg(t.x ORDER BY (t.x->>'quando') DESC)
      FROM (
        SELECT raw.x
        FROM (
          SELECT jsonb_build_object('tipo', 'decisao', 'file_name', vv.file_name,
            'decisao', vv.client_decision, 'quem', vv.client_decided_by, 'quando', vv.client_decided_at) AS x
          FROM video_versions vv
          WHERE vv.project_id = v_project.id AND vv.client_decided_at IS NOT NULL
          UNION ALL
          SELECT jsonb_build_object('tipo', 'entrega', 'file_name', vv.file_name,
            'versao', vv.versao, 'quando', COALESCE(vv.uploaded_at, vv.created_at))
          FROM video_versions vv
          WHERE vv.project_id = v_project.id
        ) raw
        ORDER BY (raw.x->>'quando') DESC NULLS LAST
        LIMIT 8
      ) t
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_client_portal(text) TO anon, authenticated;
