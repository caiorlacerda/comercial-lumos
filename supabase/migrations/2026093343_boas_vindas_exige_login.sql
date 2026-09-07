-- Bem-vindo à Lumos: as duas RPCs do checklist passam a respeitar o
-- client_portals.exige_login, igual todo o resto do portal já faz.
--
-- Sem isto, com login ligado, quem tivesse só a URL do portal continuava
-- lendo o checklist e marcando item como concluído com qualquer nome digitado.
-- O padrão da porta é o mesmo da get_client_portal_v2 (2026093328) e da
-- portal_pedir_diaria (2026093331): sem sessão → 'precisa_login'; sessão que
-- não é de um client_users ativo daquele cliente → 'sem_acesso'.
--
-- CREATE OR REPLACE das duas funções que a 2026093342 criou: idempotente,
-- não mexe na tabela nem nos GRANTs (que continuam valendo).

-- ---------------------------------------------------------------------------
-- Leitura: status dos 4 itens pro cliente que abriu a aba
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_boas_vindas_lumos(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_client RECORD;
  v_itens  jsonb;
  v_email  text;
  -- Escalares, e não um RECORD: sem login a variável nunca é preenchida, e ler
  -- um campo de RECORD não atribuído derruba a função inteira.
  v_pessoa_id    uuid := NULL;
  v_pessoa_nome  text := NULL;
  v_pessoa_email text := NULL;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  SELECT id, name INTO v_client FROM clients WHERE id = v_portal.client_id;
  IF v_client IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  -- Porta: com login ligado, o link sozinho não abre mais nada.
  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_email = '' THEN
      RETURN jsonb_build_object('error', 'precisa_login',
                                'cliente', jsonb_build_object('nome', v_client.name));
    END IF;
    SELECT id, nome, email INTO v_pessoa_id, v_pessoa_nome, v_pessoa_email
    FROM client_users
    WHERE client_id = v_client.id AND lower(email) = v_email AND ativo;
    IF v_pessoa_id IS NULL THEN
      RETURN jsonb_build_object('error', 'sem_acesso',
                                'cliente', jsonb_build_object('nome', v_client.name));
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'item_key', item_key,
    'tipo', tipo,
    'nome_arquivo', nome_arquivo,
    'concluido_em', concluido_em,
    'concluido_por', concluido_por
  )), '[]'::jsonb)
  INTO v_itens
  FROM client_boas_vindas_itens
  WHERE client_id = v_client.id;

  RETURN jsonb_build_object(
    'cliente', jsonb_build_object('id', v_client.id, 'nome', v_client.name),
    'itens', v_itens
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_boas_vindas_lumos(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Item manual "Acessos": sem arquivo, só marca concluído
-- ---------------------------------------------------------------------------
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
BEGIN
  IF p_item_key <> 'acessos' THEN
    RETURN jsonb_build_object('error', 'item_precisa_de_arquivo');
  END IF;

  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  SELECT name INTO v_client_name FROM clients WHERE id = v_portal.client_id;

  -- Porta: com login ligado, o link sozinho não marca mais nada.
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
    -- Com sessão, quem assina é a sessão, não o texto que o navegador mandou.
    -- Mesmo princípio da portal_pedir_diaria; o COALESCE cobre client_users.nome
    -- nulo (opcional na tabela), igual a get_client_portal_v2 faz.
    v_concluido_por := COALESCE(v_pessoa_nome, split_part(v_pessoa_email, '@', 1));
  ELSE
    v_concluido_por := NULLIF(trim(p_nome_pessoa), '');
  END IF;

  INSERT INTO client_boas_vindas_itens (client_id, item_key, tipo, concluido_por, concluido_em)
  VALUES (v_portal.client_id, p_item_key, 'manual', v_concluido_por, now())
  ON CONFLICT (client_id, item_key)
  DO UPDATE SET concluido_por = EXCLUDED.concluido_por, concluido_em = now();

  -- Bloco isolado de propósito: se notificar falhar (ex.: coluna nova em
  -- "notifications" que este banco ainda não tem), o item continua marcado.
  -- Mesmo princípio do gatilho de Drive: aviso nunca derruba a ação principal.
  BEGIN
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, scope)
    SELECT a.id, 'boas_vindas_item_enviado', 'producao', 'normal',
      'Bem-vindo à Lumos: novo item concluído',
      v_client_name || ' marcou "Acessos" como concluído.',
      '/clientes/' || v_portal.client_id::text,
      'team'
    FROM app_users a
    WHERE a.status = 'ativo'
      AND (a.role IN ('admin', 'atendimento') OR a.id = ANY(v_portal.contact_user_ids));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'marcar_item_boas_vindas: notificação falhou: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_item_boas_vindas(text, text, text) TO anon, authenticated;

-- Conferência (rodar à mão depois de aplicar):
-- SELECT prosrc LIKE '%exige_login%' FROM pg_proc WHERE proname = 'get_boas_vindas_lumos';
-- -- deve devolver true.
-- SELECT prosrc LIKE '%exige_login%' FROM pg_proc WHERE proname = 'marcar_item_boas_vindas';
-- -- deve devolver true.
-- SELECT get_boas_vindas_lumos('_kXsb3iRhJAa');
-- -- portal sem login: deve devolver cliente + itens, igual antes.
