-- COBRANÇA DE NOTA, FASE 2: LEMBRETES AUTOMÁTICOS E AVISOS PARA O TIME
--
-- 1) nota_requests.lembretes_enviados: quantos lembretes automáticos já saíram
--    (a função nota-cron manda até 2: 5 e 7 dias depois do último e-mail).
-- 2) nota_requests.alerta_travada_at / alerta_sem_resposta_at: marcam que o time
--    já foi avisado daquela cobrança, para não repetir o aviso todo dia.
-- 3) nota_gerar_alertas(): uma vez por dia cria, para cada admin ativo, no
--    máximo DUAS notificações-resumo (nunca uma por cobrança):
--      · "não vão sair": cobrança agendada, com envio previsto em até 2 dias (ou já
--        passado), sem valor ou com fornecedor sem e-mail;
--      · "ainda não chegou": e-mail enviado, sem nota, com pagamento previsto em
--        até 5 dias (ou já vencido).
--    Respeita a chave "nota_alertas" de Configurações → Automações.
-- 4) pg_cron: roda todo dia às 12:05 UTC (09:05 de Brasília).
--
-- As cobranças que JÁ estão com e-mail enviado recebem lembretes_enviados = 2
-- no acerto abaixo: elas não ganham lembrete automático (muitas podem já ter
-- mandado a nota por e-mail para o financeiro, e cobrar de novo seria chato).
-- Elas entram no aviso do time, que decide caso a caso.

DO $$
BEGIN
  IF to_regprocedure('public.automacao_ativa(text)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: falta automacao_ativa() (2026093340_automacoes.sql).';
  END IF;
END $$;

ALTER TABLE public.nota_requests
  ADD COLUMN IF NOT EXISTS lembretes_enviados    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alerta_travada_at     timestamptz,
  ADD COLUMN IF NOT EXISTS alerta_sem_resposta_at timestamptz;

-- Já esperando a nota antes desta fase: sem lembrete automático.
UPDATE public.nota_requests SET lembretes_enviados = 2
WHERE status = 'email_enviado' AND lembretes_enviados = 0;

CREATE OR REPLACE FUNCTION public.nota_gerar_alertas()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hoje        date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_total       integer := 0;
  v_sem_valor   integer;
  v_sem_email   integer;
  v_atrasadas   integer;
  v_proximas    integer;
  v_nomes       text;
  v_texto       text;
  u             RECORD;
BEGIN
  IF NOT public.automacao_ativa('nota_alertas') THEN RETURN 0; END IF;
  -- Uma chamada manual não pode se sobrepor à do cron.
  PERFORM pg_advisory_xact_lock(hashtext('nota_gerar_alertas'));

  -- ── 1) Cobranças agendadas que não vão sair sozinhas ───────────────────────
  CREATE TEMP TABLE IF NOT EXISTS _nota_travadas (id uuid, falta text) ON COMMIT DROP;
  TRUNCATE _nota_travadas;
  INSERT INTO _nota_travadas
    SELECT n.id, CASE WHEN COALESCE(f.email, '') = '' THEN 'email' ELSE 'valor' END
    FROM nota_requests n JOIN fornecedores f ON f.id = n.fornecedor_id
    WHERE n.status = 'agendada' AND n.alerta_travada_at IS NULL
      AND n.enviar_em <= v_hoje + 2
      AND (COALESCE(f.email, '') = '' OR n.valor IS NULL);

  SELECT count(*) FILTER (WHERE falta = 'valor'), count(*) FILTER (WHERE falta = 'email')
  INTO v_sem_valor, v_sem_email FROM _nota_travadas;

  IF v_sem_valor + v_sem_email > 0 THEN
    v_texto := concat_ws(' · ',
      CASE WHEN v_sem_valor > 0 THEN v_sem_valor || ' sem valor definido' END,
      CASE WHEN v_sem_email > 0 THEN v_sem_email || ' com fornecedor sem e-mail' END);
    FOR u IN SELECT id FROM app_users WHERE status = 'ativo' AND NOT hidden AND role = 'admin' LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (u.id, 'nota_cobranca_travada', 'financeiro', 'high',
        'Cobranças de nota que não vão sair 📄',
        v_texto || '. Sem isso o e-mail automático não sai. Defina o valor ou cadastre o e-mail do fornecedor.',
        '/financeiro/notas', jsonb_build_object('semValor', v_sem_valor, 'semEmail', v_sem_email));
    END LOOP;
    UPDATE nota_requests SET alerta_travada_at = now() WHERE id IN (SELECT id FROM _nota_travadas);
    v_total := v_total + 1;
  END IF;

  -- ── 2) Nota que ainda não chegou e o pagamento está perto (ou venceu) ──────
  CREATE TEMP TABLE IF NOT EXISTS _nota_sem_resposta (id uuid, nome text, pagar_em date) ON COMMIT DROP;
  TRUNCATE _nota_sem_resposta;
  INSERT INTO _nota_sem_resposta
    SELECT n.id, f.nome, n.pagar_em
    FROM nota_requests n JOIN fornecedores f ON f.id = n.fornecedor_id
    WHERE n.status = 'email_enviado' AND n.alerta_sem_resposta_at IS NULL
      AND n.pagar_em <= v_hoje + 5;

  SELECT count(*) FILTER (WHERE pagar_em < v_hoje), count(*) FILTER (WHERE pagar_em >= v_hoje)
  INTO v_atrasadas, v_proximas FROM _nota_sem_resposta;

  IF v_atrasadas + v_proximas > 0 THEN
    SELECT string_agg(nome, ', ') INTO v_nomes FROM (
      SELECT DISTINCT nome FROM _nota_sem_resposta ORDER BY nome LIMIT 3) x;
    v_texto := concat_ws(' · ',
      CASE WHEN v_atrasadas > 0 THEN v_atrasadas || ' com pagamento previsto já vencido' END,
      CASE WHEN v_proximas > 0 THEN v_proximas || ' com pagamento previsto nos próximos 5 dias' END);
    FOR u IN SELECT id FROM app_users WHERE status = 'ativo' AND NOT hidden AND role = 'admin' LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (u.id, 'nota_sem_resposta', 'financeiro', 'high',
        'Notas que ainda não chegaram 📄',
        v_texto || ', sem nota registrada (' || v_nomes || CASE WHEN v_atrasadas + v_proximas > 3 THEN ' e outros' ELSE '' END
          || '). Se a nota já chegou por e-mail, registre na tela Notas.',
        '/financeiro/notas', jsonb_build_object('vencidas', v_atrasadas, 'proximas', v_proximas));
    END LOOP;
    UPDATE nota_requests SET alerta_sem_resposta_at = now() WHERE id IN (SELECT id FROM _nota_sem_resposta);
    v_total := v_total + 1;
  END IF;

  RETURN v_total;
END; $$;

-- Só o servidor (cron e service_role) executa; a equipe logada não chama pelo app.
REVOKE ALL ON FUNCTION public.nota_gerar_alertas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nota_gerar_alertas() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nota_gerar_alertas() TO service_role;

-- Rotina diária (pg_cron, SQL direto, sem HTTP). Idempotente.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron não habilitado: função criada, mas a rotina diária NÃO foi agendada.';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nota-alertas';
  PERFORM cron.schedule('nota-alertas', '5 12 * * *', 'SELECT public.nota_gerar_alertas()');
END $$;

-- CONFERÊNCIA (esperado: 1 linha, active = true).
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'nota-alertas';
