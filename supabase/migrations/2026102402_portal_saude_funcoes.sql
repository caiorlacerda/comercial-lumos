-- PORTAL DO CLIENTE: cálculo da saúde do projeto, aviso à equipe e liberação para o cliente.
-- Piora é segurada por 24 h e avisa a equipe; melhora aparece na hora.
-- Spec: docs/superpowers/specs/2026-10-24-portal-clareza-status-design.md (seções 2 e 3)
DO $$
BEGIN
  IF to_regclass('public.project_portal_saude') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102401_portal_clareza_tabelas.sql.';
  END IF;
  IF to_regprocedure('public.automacao_ativa(text)') IS NULL
     OR to_regprocedure('public.current_app_user_id()') IS NULL THEN
    RAISE EXCEPTION 'Abortado: faltam automacao_ativa() ou current_app_user_id().';
  END IF;
END $$;

-- Ordem dos estados: sem indicador < no prazo < atenção < atrasado.
CREATE OR REPLACE FUNCTION public.portal_saude_ordem(p_estado text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_estado WHEN 'no_prazo' THEN 1 WHEN 'atencao' THEN 2 WHEN 'atrasado' THEN 3 ELSE 0 END
$$;

-- As regras, num lugar só. Para ajustar a calibragem, mexa aqui e em mais nenhum lugar.
CREATE OR REPLACE FUNCTION public.portal_saude_calcular(p_project_id uuid, OUT estado text, OUT motivo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hoje   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_fim    date;
  v_status text;
  v_nossas text[] := ARRAY['roteiro', 'captacao', 'em_progresso', 'revisao_interna', 'alteracoes'];
  v_n      integer;
BEGIN
  SELECT p.data_fim::date, p.status INTO v_fim, v_status FROM projects p WHERE p.id = p_project_id;
  IF NOT FOUND OR v_status IN ('concluido', 'cancelado', 'arquivado') THEN
    estado := NULL; motivo := 'Projeto encerrado ou inexistente'; RETURN;
  END IF;

  -- Atrasado: o fim do projeto passou, ou há entrega ao cliente vencida em etapa nossa.
  IF v_fim IS NOT NULL AND v_fim < v_hoje THEN
    estado := 'atrasado'; motivo := 'Data de fim do projeto (' || to_char(v_fim, 'DD/MM') || ') já passou'; RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM project_tasks t
  WHERE t.project_id = p_project_id AND t.deleted_at IS NULL AND t.status = ANY (v_nossas)
    AND t.data_entrega_cliente IS NOT NULL AND t.data_entrega_cliente::date < v_hoje;
  IF v_n > 0 THEN
    estado := 'atrasado'; motivo := v_n || ' tarefa(s) com prazo de entrega ao cliente vencido'; RETURN;
  END IF;

  -- Atenção: fim em até 3 dias com trabalho em etapa nossa, ou tarefa nossa com prazo estourado.
  IF v_fim IS NOT NULL AND v_fim <= v_hoje + 3 AND EXISTS (
       SELECT 1 FROM project_tasks t
       WHERE t.project_id = p_project_id AND t.deleted_at IS NULL AND t.status = ANY (v_nossas)) THEN
    estado := 'atencao'; motivo := 'Fim do projeto em ' || to_char(v_fim, 'DD/MM') || ' com trabalho ainda em etapa interna'; RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM project_tasks t
  WHERE t.project_id = p_project_id AND t.deleted_at IS NULL AND t.status = ANY (v_nossas)
    AND t.data_fim IS NOT NULL AND t.data_fim::date < v_hoje;
  IF v_n > 0 THEN
    estado := 'atencao'; motivo := v_n || ' tarefa(s) interna(s) com prazo estourado'; RETURN;
  END IF;

  -- No prazo: só quando há alguma data para sustentar a afirmação.
  IF v_fim IS NOT NULL OR EXISTS (
       SELECT 1 FROM project_tasks t
       WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
         AND (t.data_fim IS NOT NULL OR t.data_entrega_cliente IS NOT NULL)) THEN
    estado := 'no_prazo'; motivo := 'Sem sinais de atraso'; RETURN;
  END IF;

  estado := NULL; motivo := 'Sem datas para avaliar';
END; $$;

-- Recalcula e aplica a regra das 24 h. Sem argumento, passa por todos os projetos do portal.
CREATE OR REPLACE FUNCTION public.portal_recalcular_saude(p_project_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r          RECORD;
  v_calc     RECORD;
  v_atual    project_portal_saude%ROWTYPE;
  v_piora    boolean;
  v_tem_portal boolean;
  v_avisar   boolean;
  v_rotulo   text;
  u          RECORD;
BEGIN
  -- O agendador roda sem usuário; quem estiver logado precisa ser da equipe.
  IF auth.uid() IS NOT NULL AND NOT public.is_team() THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;
  v_avisar := public.automacao_ativa('portal_saude_avisa');

  FOR r IN
    SELECT p.id, p.name, p.client_id, p.portal_visivel
    FROM projects p
    WHERE (p_project_id IS NULL OR p.id = p_project_id)
      AND (p.portal_visivel OR EXISTS (SELECT 1 FROM project_portal_saude s WHERE s.project_id = p.id))
  LOOP
    SELECT * INTO v_calc FROM public.portal_saude_calcular(r.id);
    INSERT INTO project_portal_saude (project_id) VALUES (r.id) ON CONFLICT DO NOTHING;
    SELECT * INTO v_atual FROM project_portal_saude WHERE project_id = r.id;

    v_piora := v_calc.estado IN ('atencao', 'atrasado')
               AND public.portal_saude_ordem(v_calc.estado) > public.portal_saude_ordem(v_atual.exibida);
    v_tem_portal := r.portal_visivel
                    AND EXISTS (SELECT 1 FROM client_portals cp WHERE cp.client_id = r.client_id AND cp.active);

    IF NOT v_piora OR NOT v_tem_portal THEN
      -- Igual, melhora, ou ninguém está olhando: o que o cliente vê acompanha o calculado.
      UPDATE project_portal_saude SET
        calculada = v_calc.estado, exibida = v_calc.estado, motivo = v_calc.motivo,
        calculada_desde = CASE WHEN calculada IS DISTINCT FROM v_calc.estado THEN now() ELSE calculada_desde END,
        liberar_em = NULL, updated_at = now()
      WHERE project_id = r.id;

    ELSIF v_atual.calculada IS DISTINCT FROM v_calc.estado OR v_atual.liberar_em IS NULL THEN
      -- Piora nova: segura por 24 h e avisa a equipe.
      UPDATE project_portal_saude SET
        calculada = v_calc.estado, motivo = v_calc.motivo, calculada_desde = now(),
        liberar_em = now() + interval '24 hours', liberada_por = NULL, updated_at = now()
      WHERE project_id = r.id;

      IF v_avisar THEN
        v_rotulo := CASE v_calc.estado WHEN 'atrasado' THEN 'Atrasado' ELSE 'Atenção' END;
        FOR u IN
          SELECT DISTINCT a.id FROM app_users a
          WHERE a.status = 'ativo'
            AND (a.role IN ('admin', 'atendimento')
                 OR a.id IN (SELECT unnest(cp.contact_user_ids) FROM client_portals cp
                             WHERE cp.client_id = r.client_id AND cp.active))
        LOOP
          INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
          VALUES (
            u.id, 'portal_saude_piora', 'producao', 'high',
            r.name || ' vai aparecer como ' || v_rotulo || ' para o cliente',
            'Em 24 horas o portal do cliente passa a mostrar "' || v_rotulo || '". Corrija a causa ou abra o projeto e clique em Mostrar agora.',
            '/producao/projetos?projectId=' || r.id::text,
            jsonb_build_object('project_id', r.id, 'estado', v_calc.estado)
          );
        END LOOP;
      END IF;

    ELSIF v_atual.liberar_em <= now() THEN
      -- Passaram as 24 h: o cliente passa a ver.
      UPDATE project_portal_saude SET
        exibida = v_calc.estado, motivo = v_calc.motivo, liberar_em = NULL, updated_at = now()
      WHERE project_id = r.id;

    ELSE
      UPDATE project_portal_saude SET motivo = v_calc.motivo, updated_at = now() WHERE project_id = r.id;
    END IF;
  END LOOP;
END; $$;

-- "Mostrar agora": a equipe libera já o que está segurado.
CREATE OR REPLACE FUNCTION public.portal_saude_liberar(p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_team() THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  UPDATE project_portal_saude
  SET exibida = calculada, liberar_em = NULL, liberada_por = public.current_app_user_id(), updated_at = now()
  WHERE project_id = p_project_id;
END; $$;

-- Permissões: nada para visitante; a equipe logada e o servidor executam.
REVOKE ALL ON FUNCTION public.portal_saude_ordem(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_saude_calcular(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_recalcular_saude(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_saude_liberar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_saude_ordem(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_saude_calcular(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_recalcular_saude(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_saude_liberar(uuid) TO authenticated, service_role;

-- CONFERÊNCIA: nenhuma das quatro executa como visitante (anon_executa = false nas quatro).
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('portal_saude_ordem', 'portal_saude_calcular', 'portal_recalcular_saude', 'portal_saude_liberar')
ORDER BY 1;

-- ROLLBACK (comentado)
-- DROP FUNCTION IF EXISTS public.portal_saude_liberar(uuid), public.portal_recalcular_saude(uuid),
--   public.portal_saude_calcular(uuid), public.portal_saude_ordem(text);
