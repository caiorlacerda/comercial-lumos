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
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;

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
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND p.client_id = v_portal.client_id AND p.portal_visivel
      AND (v_pessoa IS NULL
           OR NOT EXISTS (SELECT 1 FROM client_user_projects WHERE client_user_id = v_pessoa)
           OR p.id IN (SELECT project_id FROM client_user_projects WHERE client_user_id = v_pessoa))
  ) INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object('error','sem_acesso'); END IF;

  IF p_data < current_date + v_portal.antecedencia_dias THEN
    RETURN jsonb_build_object('error','cedo');
  END IF;
  IF EXISTS (SELECT 1 FROM agenda_bloqueios WHERE data = p_data) THEN
    RETURN jsonb_build_object('error','dia_bloqueado');
  END IF;
  IF EXISTS (SELECT 1 FROM project_diarias WHERE data = p_data) THEN
    RETURN jsonb_build_object('error','dia_ocupado');
  END IF;
  IF EXISTS (SELECT 1 FROM diaria_pedidos
             WHERE client_id = v_portal.client_id AND data_desejada = p_data AND estado = 'pendente') THEN
    RETURN jsonb_build_object('error','repetido');
  END IF;
  IF btrim(COALESCE(p_descricao,'')) = '' THEN
    RETURN jsonb_build_object('error','sem_descricao');
  END IF;

  -- Congela a leitura do pacote NO MOMENTO DO PEDIDO: se o mês virar antes da
  -- resposta, o que o cliente viu na tela continua valendo.
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

-- Com login ligado, só quem pediu pode cancelar: o link do portal não é
-- credencial, é convite. Sem login, o cliente é uma coisa só e continua
-- cancelando qualquer pedido pendente dele.
CREATE OR REPLACE FUNCTION public.portal_cancelar_pedido(p_token text, p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_pessoa uuid := NULL;
  v_email  text;
  v_p      RECORD;
  v_n      int;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;

  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    SELECT id INTO v_pessoa FROM client_users
    WHERE client_id = v_portal.client_id AND lower(email) = v_email AND ativo;
    IF v_pessoa IS NULL THEN RETURN jsonb_build_object('error','sem_acesso'); END IF;
  END IF;

  SELECT * INTO v_p FROM diaria_pedidos
  WHERE id = p_pedido_id AND client_id = v_portal.client_id AND estado = 'pendente';
  IF v_p IS NULL THEN RETURN jsonb_build_object('error','nao_encontrado'); END IF;

  IF v_pessoa IS NOT NULL AND v_p.client_user_id IS DISTINCT FROM v_pessoa THEN
    RETURN jsonb_build_object('error','sem_acesso');
  END IF;

  UPDATE diaria_pedidos SET estado = 'cancelado'
  WHERE id = p_pedido_id AND client_id = v_portal.client_id AND estado = 'pendente';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('error','nao_encontrado'); END IF;
  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.portal_pedir_diaria(text, uuid, date, numeric, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_cancelar_pedido(text, uuid) TO anon, authenticated;
