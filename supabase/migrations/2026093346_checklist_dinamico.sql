-- O checklist deixa de ter 4 chaves fixas — item_key válido é qualquer um
-- que exista em client_welcome_doc_itens do doc publicado daquele cliente.
-- "Item manual" (sem arquivo) passa a ser requer_arquivo = false, em vez
-- de comparar contra a string 'acessos'.

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
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  SELECT name INTO v_client_name FROM clients WHERE id = v_portal.client_id;

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

  INSERT INTO client_boas_vindas_itens (client_id, item_key, tipo, concluido_por, concluido_em, welcome_doc_item_id)
  VALUES (v_portal.client_id, p_item_key, 'manual', v_concluido_por, now(), v_item.id)
  ON CONFLICT (client_id, item_key)
  DO UPDATE SET concluido_por = EXCLUDED.concluido_por, concluido_em = now(), welcome_doc_item_id = EXCLUDED.welcome_doc_item_id;

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

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_item_boas_vindas(text, text, text) TO anon, authenticated;

-- Conferência (rodar à mão depois de aplicar):
-- SELECT marcar_item_boas_vindas('token-invalido', 'qualquer', 'x');
-- -- deve devolver {"error": "invalid"}.
