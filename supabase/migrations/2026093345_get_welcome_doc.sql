-- Leitura completa do Welcome Doc pro cliente: seções (com variáveis, pro
-- front interpolar), lista de itens do checklist já cruzada com o status
-- de quem já preencheu. Mesmo padrão de porta que get_boas_vindas_lumos já
-- usa (2026093343).

CREATE OR REPLACE FUNCTION public.get_welcome_doc(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_client RECORD;
  v_doc    RECORD;
  v_tpl    RECORD;
  v_email  text;
  v_pessoa_id uuid := NULL;
  v_itens  jsonb;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  SELECT id, name INTO v_client FROM clients WHERE id = v_portal.client_id;
  IF v_client IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_email = '' THEN
      RETURN jsonb_build_object('error', 'precisa_login');
    END IF;
    SELECT id INTO v_pessoa_id FROM client_users
    WHERE client_id = v_client.id AND lower(email) = v_email AND ativo;
    IF v_pessoa_id IS NULL THEN
      RETURN jsonb_build_object('error', 'sem_acesso');
    END IF;
  END IF;

  SELECT * INTO v_doc FROM client_welcome_docs
  WHERE client_id = v_client.id AND status = 'published';
  IF v_doc IS NULL THEN
    RETURN jsonb_build_object(
      'cliente', jsonb_build_object('id', v_client.id, 'nome', v_client.name),
      'doc', NULL,
      'itens', '[]'::jsonb
    );
  END IF;

  SELECT * INTO v_tpl FROM client_welcome_doc_templates WHERE id = v_doc.template_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'item_key', i.item_key,
    'group_key', i.group_key,
    'titulo', i.titulo,
    'descricao', i.descricao,
    'requer_arquivo', i.requer_arquivo,
    'sort_order', i.sort_order,
    'feito', s.id IS NOT NULL,
    'nome_arquivo', s.nome_arquivo,
    'concluido_em', s.concluido_em,
    'concluido_por', s.concluido_por
  ) ORDER BY i.sort_order), '[]'::jsonb)
  INTO v_itens
  FROM client_welcome_doc_itens i
  LEFT JOIN client_boas_vindas_itens s
    ON s.welcome_doc_item_id = i.id AND s.client_id = v_client.id
  WHERE i.welcome_doc_id = v_doc.id;

  RETURN jsonb_build_object(
    'cliente', jsonb_build_object('id', v_client.id, 'nome', v_client.name),
    'doc', jsonb_build_object(
      'sections', v_tpl.sections,
      'variables', v_tpl.variables,
      'values', v_doc.values
    ),
    'itens', v_itens
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_welcome_doc(text) TO anon, authenticated;

-- Conferência (rodar à mão depois de aplicar, com um doc de teste publicado):
-- SELECT get_welcome_doc('<token-de-um-portal-com-doc-publicado>');
-- -- deve devolver cliente + doc + itens.
-- SELECT get_welcome_doc('<token-de-um-cliente-sem-doc-publicado>');
-- -- deve devolver cliente + doc: null + itens: [].
