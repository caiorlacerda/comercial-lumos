-- PORTAL DO CLIENTE (Pacote B): prazo de revisão visível ao cliente e contagem de versões.
--   1) Coluna de configuração por cliente: client_portals.prazo_revisao_dias (dias ÚTEIS, de 1 a 30; vazio = sem prazo).
--   2) portal_somar_dias_uteis: soma dias úteis a uma data (função interna, só o servidor executa).
--   3) portal_visao_projetos passa a devolver, por projeto, revisoes[{review_token, n_versoes, prazo}].
--
-- ATENÇÃO — ao rodar este arquivo, TODOS os portais existentes ganham o padrão de 3 dias úteis (DEFAULT 3).
-- Na prática: o cliente passa a ver "Responder até…" nos vídeos que esperam por ele assim que o front-end
-- do PR seguinte for ao ar, e a rotina de lembrete da próxima migration contará os atrasos a partir desse prazo.
-- Quem não deve ter prazo precisa ficar com o campo vazio (NULL) no modal do portal. A conferência no fim mostra
-- quantos portais ficaram com prazo.
--
-- Regras da contagem: sábado e domingo não contam; FERIADOS NÃO SÃO CONSIDERADOS (só fins de semana).
-- O dia de partida é a data de entrega do vídeo (entregue_em, senão uploaded_at, senão created_at) no fuso
-- America/Sao_Paulo. O prazo só existe para vídeo esperando o cliente (EM_REVISAO_CLIENTE).
--
-- Pré-requisitos: 2026102403_portal_visao_projetos.sql. Idempotente (pode rodar de novo).
DO $$
BEGIN
  IF to_regprocedure('public.portal_visao_projetos(text)') IS NULL OR to_regprocedure('public.portal_contexto(text)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102403_portal_visao_projetos.sql.';
  END IF;
END $$;

SET lock_timeout = '15s';

ALTER TABLE public.client_portals
  ADD COLUMN IF NOT EXISTS prazo_revisao_dias integer DEFAULT 3;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'client_portals_prazo_revisao_dias_check'
                   AND conrelid = 'public.client_portals'::regclass) THEN
    ALTER TABLE public.client_portals
      ADD CONSTRAINT client_portals_prazo_revisao_dias_check
      CHECK (prazo_revisao_dias IS NULL OR prazo_revisao_dias BETWEEN 1 AND 30);
  END IF;
END $$;

-- Interna: soma p_dias dias úteis a p_data (sábado e domingo não contam; feriados não entram).
CREATE OR REPLACE FUNCTION public.portal_somar_dias_uteis(p_data date, p_dias integer)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v date := p_data; n integer := 0;
BEGIN
  IF p_data IS NULL OR p_dias IS NULL THEN RETURN NULL; END IF;
  WHILE n < p_dias LOOP
    v := v + 1;
    IF extract(isodow FROM v) < 6 THEN n := n + 1; END IF;
  END LOOP;
  RETURN v;
END; $$;
-- O Supabase concede EXECUTE a anon/authenticated em funções novas: revoga de forma explícita.
REVOKE ALL ON FUNCTION public.portal_somar_dias_uteis(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_somar_dias_uteis(date, integer) TO service_role;

-- Mesma função de 2026102403_portal_visao_projetos.sql, com duas mudanças: v_prazo (lido do portal pelo token)
-- e a chave 'revisoes' em cada projeto.
CREATE OR REPLACE FUNCTION public.portal_visao_projetos(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ctx RECORD;
  v_res jsonb;
  v_prazo integer;
BEGIN
  SELECT * INTO v_ctx FROM public.portal_contexto(p_token);
  IF v_ctx.o_erro IS NOT NULL THEN RETURN jsonb_build_object('error', v_ctx.o_erro); END IF;

  -- Prazo de revisão do cliente (dias úteis; NULL = sem prazo).
  SELECT cp.prazo_revisao_dias INTO v_prazo FROM client_portals cp WHERE cp.token = p_token AND cp.active;

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
        ), '[]'::jsonb) END,
        -- Um item por vídeo disponível ao cliente (versão mais nova entre as visíveis) que tem link de revisão ativo.
        -- O prazo só vale para vídeo esperando o cliente e só se o cliente tem prazo configurado.
        'revisoes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'review_token', rt.token,
                   'n_versoes', nv.n,
                   'prazo', CASE WHEN e.status = 'EM_REVISAO_CLIENTE' AND v_prazo IS NOT NULL
                                 THEN public.portal_somar_dias_uteis(
                                        (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date,
                                        v_prazo)
                            END)
                   ORDER BY COALESCE(e.entregue_em, e.uploaded_at, e.created_at) DESC, rt.token)
          FROM (
            SELECT DISTINCT ON (COALESCE(vv.group_id, vv.id)) vv.*
            FROM video_versions vv
            WHERE vv.project_id = p.id
              AND vv.status IN ('EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO')
            ORDER BY COALESCE(vv.group_id, vv.id), vv.versao DESC
          ) e
          JOIN LATERAL (
            SELECT rl.token FROM review_links rl
            WHERE rl.group_id = e.group_id AND rl.active
            ORDER BY rl.created_at DESC LIMIT 1
          ) rt ON true
          JOIN LATERAL (
            SELECT count(*)::int AS n FROM video_versions x
            WHERE COALESCE(x.group_id, x.id) = COALESCE(e.group_id, e.id)
          ) nv ON true
        ), '[]'::jsonb)
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

-- Permissões (CREATE OR REPLACE mantém, mas reafirmamos): a visão é a única função aberta ao portal.
REVOKE ALL ON FUNCTION public.portal_visao_projetos(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_visao_projetos(text) TO anon, authenticated, service_role;

-- ROLLBACK (comentado): volta a visão para a versão de 2026102403 (reexecute aquele arquivo), depois:
-- DROP FUNCTION IF EXISTS public.portal_somar_dias_uteis(date, integer);
-- ALTER TABLE public.client_portals DROP CONSTRAINT IF EXISTS client_portals_prazo_revisao_dias_check;
-- ALTER TABLE public.client_portals DROP COLUMN IF EXISTS prazo_revisao_dias;

-- CONFERÊNCIA (último comando; esperado: portal_visao_projetos -> true / true; portal_somar_dias_uteis -> false / false;
-- portais = total de portais, com_prazo = quantos ficaram com prazo configurado).
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_executa,
       (SELECT count(*) FROM public.client_portals)                                    AS portais,
       (SELECT count(*) FROM public.client_portals WHERE prazo_revisao_dias IS NOT NULL) AS com_prazo
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('portal_visao_projetos', 'portal_somar_dias_uteis') ORDER BY 1;
