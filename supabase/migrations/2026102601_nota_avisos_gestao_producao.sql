-- COBRANÇA DE NOTA: GESTÃO DE PRODUÇÃO TAMBÉM RECEBE OS AVISOS
--
-- A tela Financeiro › Notas passou a abrir para a Gestão de Produção (papel
-- 'producao', permissão notas_fornecedores), mas os avisos automáticos só iam
-- para admin. Agora vão para admin E producao:
--   · nota_fiscal_recebida   (fornecedor enviou a nota pelo link: submit_nota)
--   · nota_cobranca_travada  e  nota_sem_resposta  (resumos diários: nota_gerar_alertas)
-- Só muda o filtro de quem recebe; o resto das duas funções fica como estava.
-- Não há deploy de função: o e-mail ao fornecedor não é afetado.
-- Os grants atuais (submit_nota para o link público; nota_gerar_alertas só para
-- o servidor) são mantidos pelo CREATE OR REPLACE.

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
    FOR u IN SELECT id FROM app_users WHERE status = 'ativo' AND NOT hidden AND role IN ('admin', 'producao') LOOP
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
    FOR u IN SELECT id FROM app_users WHERE status = 'ativo' AND NOT hidden AND role IN ('admin', 'producao') LOOP
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

CREATE OR REPLACE FUNCTION public.submit_nota(
  p_token text,
  p_path text,
  p_file_name text,
  p_dados_pagamento text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v RECORD;
  v_admin RECORD;
BEGIN
  SELECT nr.*, f.nome AS fornecedor_nome INTO v
  FROM nota_requests nr JOIN fornecedores f ON f.id = nr.fornecedor_id
  WHERE nr.token = p_token AND nr.status IN ('agendada', 'email_enviado', 'nota_recebida');
  IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'link_invalido'); END IF;

  UPDATE nota_requests
  SET nota_arquivo = jsonb_build_object('name', p_file_name, 'path', p_path),
      nota_enviada_at = now(),
      status = 'nota_recebida',
      dados_pagamento = COALESCE(NULLIF(trim(p_dados_pagamento), ''), dados_pagamento),
      updated_at = now()
  WHERE id = v.id;

  IF NULLIF(trim(p_dados_pagamento), '') IS NOT NULL THEN
    UPDATE fornecedores SET payment_info = trim(p_dados_pagamento), updated_at = now()
    WHERE id = v.fornecedor_id;
  END IF;

  FOR v_admin IN
    SELECT id FROM app_users WHERE status = 'ativo' AND role IN ('admin', 'producao')
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      v_admin.id, 'nota_fiscal_recebida', 'financeiro', 'high',
      'Nota fiscal recebida 📄',
      v.fornecedor_nome || ' enviou a nota do job "' || v.descricao || '"'
        || CASE WHEN NULLIF(trim(p_dados_pagamento), '') IS NOT NULL THEN ' e confirmou os dados de pagamento' ELSE '' END
        || '. Pagamento previsto pra ' || to_char(v.pagar_em, 'DD/MM/YYYY') || '.',
      '/financeiro/notas',
      jsonb_build_object('nota_request_id', v.id)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END; $$;
