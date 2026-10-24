-- PORTAL DO CLIENTE: o que o portal mostra de novo (saúde, pendências, equipe), separado de get_client_portal_v2.
-- Mesmas regras de acesso do portal: token ativo, login quando exigido, projetos restritos por pessoa.
DO $$
BEGIN
  IF to_regclass('public.portal_pendencias') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102401_portal_clareza_tabelas.sql.';
  END IF;
  IF to_regclass('public.client_welcome_docs') IS NULL
     OR to_regclass('public.client_welcome_doc_itens') IS NULL THEN
    RAISE EXCEPTION 'Abortado: faltam as tabelas do Bem-vindo (2026093344_welcome_doc_schema.sql e 2026093346_checklist_dinamico.sql).';
  END IF;
END $$;

-- Interna: resolve quem está olhando. Nunca exposta a visitante.
CREATE OR REPLACE FUNCTION public.portal_contexto(
  p_token text,
  OUT o_erro text, OUT o_client_id uuid, OUT o_pessoa_id uuid, OUT o_restrito boolean, OUT o_mostrar_equipe boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_email  text;
BEGIN
  o_restrito := false; o_mostrar_equipe := false;
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF NOT FOUND THEN o_erro := 'invalid'; RETURN; END IF;
  o_client_id := v_portal.client_id;
  o_mostrar_equipe := COALESCE(v_portal.mostrar_equipe, false);

  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_email = '' THEN o_erro := 'precisa_login'; RETURN; END IF;
    SELECT cu.id INTO o_pessoa_id FROM client_users cu
    WHERE cu.client_id = v_portal.client_id AND lower(cu.email) = v_email AND cu.ativo;
    IF o_pessoa_id IS NULL THEN o_erro := 'sem_acesso'; RETURN; END IF;
    o_restrito := EXISTS (SELECT 1 FROM client_user_projects cup WHERE cup.client_user_id = o_pessoa_id);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.portal_visao_projetos(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ctx RECORD;
  v_res jsonb;
BEGIN
  SELECT * INTO v_ctx FROM public.portal_contexto(p_token);
  IF v_ctx.o_erro IS NOT NULL THEN RETURN jsonb_build_object('error', v_ctx.o_erro); END IF;

  SELECT jsonb_build_object(
    'projetos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'saude', CASE WHEN s.exibida IS NULL THEN NULL ELSE jsonb_build_object('estado', s.exibida) END,
        'pendencias', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', pe.id, 'texto', pe.texto, 'prazo', pe.prazo)
                           ORDER BY pe.prazo NULLS LAST, pe.created_at)
          FROM portal_pendencias pe WHERE pe.project_id = p.id AND pe.client_id = p.client_id AND pe.concluida_em IS NULL
        ), '[]'::jsonb),
        'equipe', CASE WHEN NOT v_ctx.o_mostrar_equipe THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'nome', a.full_name,
            'funcao', COALESCE(NULLIF(a.job_title, ''), tm.role_title),
            'foto', COALESCE(NULLIF(a.avatar_url, ''), tm.photo_url)
          ) ORDER BY e.ordem)
          FROM project_portal_equipe e
          JOIN app_users a ON a.id = e.app_user_id AND a.status = 'ativo' AND NOT a.hidden
          LEFT JOIN team_members tm ON tm.app_user_id = a.id
          WHERE e.project_id = p.id
        ), '[]'::jsonb) END
      ) ORDER BY (p.status = 'concluido'), p.created_at DESC)
      FROM projects p
      LEFT JOIN project_portal_saude s ON s.project_id = p.id
      WHERE p.client_id = v_ctx.o_client_id
        AND p.portal_visivel
        AND (p.status <> 'concluido' OR p.updated_at > now() - interval '90 days')
        AND (NOT v_ctx.o_restrito OR p.id IN (
              SELECT cup.project_id FROM client_user_projects cup WHERE cup.client_user_id = v_ctx.o_pessoa_id))
    ), '[]'::jsonb),
    'pendencias_cliente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', pe.id, 'texto', pe.texto, 'prazo', pe.prazo)
                       ORDER BY pe.prazo NULLS LAST, pe.created_at)
      FROM portal_pendencias pe
      WHERE pe.client_id = v_ctx.o_client_id AND pe.project_id IS NULL AND pe.concluida_em IS NULL
    ), '[]'::jsonb),
    -- Bem-vindo dirigido por modelo: itens do documento PUBLICADO do cliente que ainda não foram
    -- concluídos (a conclusão casa por welcome_doc_item_id). Sem documento publicado: lista vazia.
    'boas_vindas_pendentes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('chave', i.item_key, 'titulo', i.titulo) ORDER BY i.sort_order, i.item_key)
      FROM client_welcome_docs d
      JOIN client_welcome_doc_itens i ON i.welcome_doc_id = d.id
      WHERE d.client_id = v_ctx.o_client_id AND d.status = 'published'
        AND NOT EXISTS (
          SELECT 1 FROM client_boas_vindas_itens b
          WHERE b.client_id = d.client_id AND b.welcome_doc_item_id = i.id)
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END; $$;

-- Permissões: o contexto é interno (nem visitante nem usuário logado do portal chamam direto);
-- só a visão é pública, como o resto do portal. A visão é SECURITY DEFINER (dono postgres), então
-- consegue chamar o contexto mesmo sem o privilégio de quem a executa.
REVOKE ALL ON FUNCTION public.portal_contexto(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_contexto(text) TO service_role;
REVOKE ALL ON FUNCTION public.portal_visao_projetos(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_visao_projetos(text) TO anon, authenticated, service_role;

-- CONFERÊNCIA (esperado: portal_contexto -> false / false; portal_visao_projetos -> true / true).
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_executa
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('portal_contexto', 'portal_visao_projetos') ORDER BY 1;

-- ROLLBACK (comentado)
-- DROP FUNCTION IF EXISTS public.portal_visao_projetos(text), public.portal_contexto(text);
