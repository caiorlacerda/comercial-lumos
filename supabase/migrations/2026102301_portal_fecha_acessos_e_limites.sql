-- PORTAL DO CLIENTE: FECHA ACESSOS ANTIGOS E COLOCA LIMITES (segurança, lote do portal)
--
-- 1) get_client_portal (v1) ainda estava aberta a qualquer pessoa: não respeita "exigir login",
--    "projeto visível" nem a janela de 90 dias. O app usa só a v2. Fecha para todos.
-- 2) Tokens legados por projeto (project_portals): se existir um ativo, as funções do portal
--    RECRIAM sozinhas o portal do cliente (já sem "exigir login") mesmo depois de ele ser
--    revogado no modal. Desativa todos; o modal nem tem mais tela para eles. Para reverter um
--    em particular: UPDATE project_portals SET active = true WHERE id = '...'.
-- 3) portal_pedir_diaria: tamanhos, e-mail, data (até 1 ano), duração (30 min a 24 h) e teto de
--    30 pedidos em aberto por cliente.
-- 4) marcar_item_boas_vindas: nome com até 80 caracteres e no máximo um aviso ao time a cada
--    10 minutos por item.
-- Pressupõe as migrations 2026093334 e 2026093346 aplicadas (as duas funções abaixo vêm delas).

DO $$
BEGIN
  IF to_regprocedure('public.portal_pedir_diaria(text, uuid, date, numeric, text, text, text, text)') IS NULL
     OR to_regprocedure('public.marcar_item_boas_vindas(text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: faltam portal_pedir_diaria e/ou marcar_item_boas_vindas (migrations 2026093334 e 2026093346).';
  END IF;
END $$;

-- 1) ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.get_client_portal(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_client_portal(text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.get_client_portal(text) FROM anon;
    REVOKE ALL ON FUNCTION public.get_client_portal(text) FROM authenticated;
  END IF;
END $$;

-- 2) ---------------------------------------------------------------------------
DO $$
DECLARE n integer;
BEGIN
  IF to_regclass('public.project_portals') IS NOT NULL THEN
    UPDATE public.project_portals SET active = false WHERE active;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '% token(s) legado(s) por projeto desativado(s)', n;
  END IF;
END $$;

-- 3) ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_pedir_diaria(
  p_token text, p_project_id uuid, p_data date, p_duracao numeric,
  p_local text, p_descricao text, p_nome text, p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_pessoa uuid := NULL;
  v_email  text;
  v_nome   text;
  v_ok     boolean;
  v_fora   boolean := false;
  v_meta   int;
  v_feito  bigint;
  v_id     uuid;
  v_client_id uuid;
BEGIN
  -- Entradas absurdas morrem antes de qualquer consulta: o pedido é aberto a quem tem
  -- o link e dispara aviso para o time.
  IF p_data IS NULL OR p_data > current_date + 365 THEN
    RETURN jsonb_build_object('error','data_invalida');
  END IF;
  IF p_duracao IS NOT NULL AND (p_duracao < 0.5 OR p_duracao > 24) THEN
    RETURN jsonb_build_object('error','duracao_invalida');
  END IF;
  IF char_length(COALESCE(p_nome,'')) > 80 OR char_length(COALESCE(p_email,'')) > 120
     OR char_length(COALESCE(p_local,'')) > 200 OR char_length(COALESCE(p_descricao,'')) > 2000 THEN
    RETURN jsonb_build_object('error','texto_longo');
  END IF;

  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;

  IF v_portal IS NULL THEN
    SELECT pr.client_id INTO v_client_id
    FROM project_portals pp JOIN projects pr ON pr.id = pp.project_id
    WHERE pp.token = p_token AND pp.active = true;
    IF v_client_id IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;
    SELECT * INTO v_portal FROM client_portals WHERE client_id = v_client_id AND active = true;
    IF v_portal IS NULL THEN
      INSERT INTO client_portals (client_id) VALUES (v_client_id) RETURNING * INTO v_portal;
    END IF;
  END IF;

  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email',''));
    SELECT id, nome, email INTO v_pessoa, v_nome, v_email FROM client_users
    WHERE client_id = v_portal.client_id AND lower(email) = v_email AND ativo;
    IF v_pessoa IS NULL THEN RETURN jsonb_build_object('error','sem_acesso'); END IF;
    -- client_users.nome é opcional; diaria_pedidos.nome não é. Mesmo padrão
    -- da get_client_portal_v2 para o mesmo problema.
    v_nome := COALESCE(v_nome, split_part(v_email, '@', 1));
  ELSE
    v_nome  := NULLIF(btrim(p_nome), '');
    v_email := lower(NULLIF(btrim(p_email), ''));
    IF v_nome IS NULL OR v_email IS NULL THEN RETURN jsonb_build_object('error','sem_nome'); END IF;
    IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      RETURN jsonb_build_object('error','email_invalido');
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND p.client_id = v_portal.client_id AND p.portal_visivel
      AND (v_pessoa IS NULL
           OR NOT EXISTS (SELECT 1 FROM client_user_projects WHERE client_user_id = v_pessoa)
           OR p.id IN (SELECT project_id FROM client_user_projects WHERE client_user_id = v_pessoa))
  ) INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object('error','sem_acesso'); END IF;

  -- Teto de pedidos em aberto por cliente: cada um bloqueia uma data para o cliente de
  -- verdade e avisa o time. Quem passar disso fala com a Lumos.
  IF (SELECT count(*) FROM diaria_pedidos WHERE client_id = v_portal.client_id AND estado = 'pendente') >= 30 THEN
    RETURN jsonb_build_object('error','muitos_pedidos');
  END IF;

  IF p_data < current_date + GREATEST(v_portal.antecedencia_dias, 2) THEN
    RETURN jsonb_build_object('error','cedo');
  END IF;
  IF EXISTS (SELECT 1 FROM agenda_bloqueios WHERE data = p_data) THEN
    RETURN jsonb_build_object('error','dia_bloqueado');
  END IF;
  IF EXISTS (SELECT 1 FROM project_diarias WHERE data = p_data) THEN
    RETURN jsonb_build_object('error','dia_ocupado');
  END IF;
  IF EXISTS (SELECT 1 FROM agenda_semana_fechada WHERE dia_semana = EXTRACT(DOW FROM p_data)::int) THEN
    RETURN jsonb_build_object('error','dia_semana_fechado');
  END IF;
  IF EXISTS (SELECT 1 FROM diaria_pedidos
             WHERE client_id = v_portal.client_id AND data_desejada = p_data AND estado = 'pendente') THEN
    RETURN jsonb_build_object('error','repetido');
  END IF;
  IF btrim(COALESCE(p_descricao,'')) = '' THEN
    RETURN jsonb_build_object('error','sem_descricao');
  END IF;

  -- Congela a leitura do pacote NO MOMENTO DO PEDIDO: se o mês virar antes da
  -- resposta, o que o cliente viu na tela continua valendo. É o mês da DATA
  -- PEDIDA, e é o mesmo mês que a tela agora lê em `pacotes`.
  SELECT x.meta, x.realizado INTO v_meta, v_feito
  FROM escopo_do_mes(p_project_id, date_trunc('month', p_data)::date) x
  WHERE x.chave = 'diarias' AND x.periodo = 'mes' LIMIT 1;
  IF v_meta IS NOT NULL AND v_feito >= v_meta THEN v_fora := true; END IF;

  INSERT INTO diaria_pedidos (project_id, client_id, client_user_id, nome, email,
    data_desejada, duracao_horas, local, descricao, fora_do_pacote)
  VALUES (p_project_id, v_portal.client_id, v_pessoa, v_nome, v_email,
    p_data, COALESCE(p_duracao, 10), NULLIF(btrim(p_local),''), btrim(p_descricao), v_fora)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'fora_do_pacote', v_fora);
-- O pré-teste de 'repetido' olha o índice único parcial antes de inserir, mas
-- duas chamadas simultâneas passam as duas pelo pré-teste. Quem perder a
-- corrida do INSERT recebe o erro tratado, não um 23505 cru.
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('error','repetido');
END; $$;

GRANT EXECUTE ON FUNCTION public.portal_pedir_diaria(text, uuid, date, numeric, text, text, text, text) TO anon, authenticated;

-- 4) ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_item_boas_vindas(
  p_token text, p_item_key text, p_nome_pessoa text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_client_name text;
  v_email text;
  v_pessoa_id    uuid := NULL;
  v_pessoa_nome  text := NULL;
  v_pessoa_email text := NULL;
  v_concluido_por text;
  v_item RECORD;
  v_ultimo timestamptz;
BEGIN
  IF char_length(COALESCE(p_nome_pessoa,'')) > 80 OR char_length(COALESCE(p_item_key,'')) > 120 THEN
    RETURN jsonb_build_object('error', 'texto_longo');
  END IF;

  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  SELECT name INTO v_client_name FROM clients WHERE id = v_portal.client_id;

  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_email = '' THEN
      RETURN jsonb_build_object('error', 'precisa_login',
                                'cliente', jsonb_build_object('nome', v_client_name));
    END IF;
    SELECT id, nome, email INTO v_pessoa_id, v_pessoa_nome, v_pessoa_email
    FROM client_users
    WHERE client_id = v_portal.client_id AND lower(email) = v_email AND ativo;
    IF v_pessoa_id IS NULL THEN
      RETURN jsonb_build_object('error', 'sem_acesso',
                                'cliente', jsonb_build_object('nome', v_client_name));
    END IF;
    v_concluido_por := COALESCE(v_pessoa_nome, split_part(v_pessoa_email, '@', 1));
  ELSE
    v_concluido_por := NULLIF(trim(p_nome_pessoa), '');
  END IF;

  SELECT i.* INTO v_item
  FROM client_welcome_doc_itens i
  JOIN client_welcome_docs d ON d.id = i.welcome_doc_id
  WHERE d.client_id = v_portal.client_id AND d.status = 'published' AND i.item_key = p_item_key;

  IF v_item IS NULL THEN
    RETURN jsonb_build_object('error', 'item_invalido');
  END IF;
  IF v_item.requer_arquivo THEN
    RETURN jsonb_build_object('error', 'item_precisa_de_arquivo');
  END IF;

  SELECT concluido_em INTO v_ultimo FROM client_boas_vindas_itens
  WHERE client_id = v_portal.client_id AND item_key = p_item_key;

  INSERT INTO client_boas_vindas_itens (client_id, item_key, tipo, concluido_por, concluido_em, welcome_doc_item_id)
  VALUES (v_portal.client_id, p_item_key, 'manual', v_concluido_por, now(), v_item.id)
  ON CONFLICT (client_id, item_key)
  DO UPDATE SET concluido_por = EXCLUDED.concluido_por, concluido_em = now(), welcome_doc_item_id = EXCLUDED.welcome_doc_item_id;

  -- Aviso ao time só se o item não foi marcado nos últimos 10 minutos: clicar de novo
  -- (ou um script) não vira uma enxurrada de notificações.
  IF v_ultimo IS NULL OR v_ultimo < now() - interval '10 minutes' THEN
  BEGIN
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, scope)
    SELECT a.id, 'boas_vindas_item_enviado', 'producao', 'normal',
      'Bem-vindo à Lumos: novo item concluído',
      v_client_name || ' marcou "' || v_item.titulo || '" como concluído.',
      '/clientes/' || v_portal.client_id::text,
      'team'
    FROM app_users a
    WHERE a.status = 'ativo'
      AND (a.role IN ('admin', 'atendimento') OR a.id = ANY(v_portal.contact_user_ids));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'marcar_item_boas_vindas: notificação falhou: %', SQLERRM;
  END;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_item_boas_vindas(text, text, text) TO anon, authenticated;

-- CONFERÊNCIA: a v1 não pode ser executada por anon (false); a v2 continua (true).
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('get_client_portal', 'get_client_portal_v2', 'portal_pedir_diaria', 'marcar_item_boas_vindas')
ORDER BY 1;
SELECT count(*) AS tokens_legados_ativos FROM public.project_portals WHERE active;
