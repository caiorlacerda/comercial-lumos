-- PORTAL DO CLIENTE: tolerância de 2 dias na regra "Atenção por tarefa interna atrasada".
-- Decisão do dono: uma tarefa nossa atrasada por 1 ou 2 dias é rotina de produção e não deve
-- mudar o que o cliente vê. Só passa a contar quando o prazo (data_fim) estourou há MAIS de 2 dias
-- (data de hoje em America/Sao_Paulo). Todo o resto continua rígido, sem tolerância:
--   * fim do projeto passou => Atrasado;
--   * entrega ao cliente (data_entrega_cliente) vencida => Atrasado;
--   * fim do projeto em até 3 dias com trabalho em etapa nossa => Atenção;
--   * lógica de "No prazo" e casos sem datas (NULL).
-- Muda só o ramo "tarefa interna com prazo estourado" de portal_saude_calcular (e o texto do motivo).
-- Pré-requisito: 2026102402_portal_saude_funcoes.sql. Idempotente: pode rodar mais de uma vez.
DO $$
BEGIN
  IF to_regprocedure('public.portal_saude_calcular(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102402_portal_saude_funcoes.sql.';
  END IF;
END $$;

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
  -- Tolerância de 2 dias: só conta a tarefa cujo prazo estourou há MAIS de 2 dias (data_fim < hoje - 2).
  -- Atraso de 1 ou 2 dias não muda a saúde do projeto. As demais regras acima e abaixo são rígidas.
  SELECT count(*) INTO v_n FROM project_tasks t
  WHERE t.project_id = p_project_id AND t.deleted_at IS NULL AND t.status = ANY (v_nossas)
    AND t.data_fim IS NOT NULL AND t.data_fim::date < v_hoje - 2;
  IF v_n > 0 THEN
    estado := 'atencao'; motivo := v_n || ' tarefa(s) interna(s) com prazo estourado há mais de 2 dias'; RETURN;
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

-- Permissões (reafirmadas para o arquivo ser autocontido): função interna, expõe o motivo; só o servidor.
REVOKE ALL ON FUNCTION public.portal_saude_calcular(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_saude_calcular(uuid) TO service_role;

-- CONFERÊNCIA (esperado): anon_executa = false e authenticated_executa = false.
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_executa
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'portal_saude_calcular';

-- ROLLBACK (comentado): para voltar à regra anterior, rode de novo o arquivo inteiro 2026102402_portal_saude_funcoes.sql
-- (é idempotente e recria a função como era); desfazer este arquivo não afeta o cron.
