-- Bem-vindo à Lumos: checklist de onboarding do cliente novo (logo, brand
-- book, guidelines, acessos). Uma linha só existe quando o item foi
-- preenchido — sem linha = pendente. Ver spec:
-- docs/superpowers/specs/2026-09-06-portal-bem-vindo-a-lumos-design.md

CREATE TABLE IF NOT EXISTS public.client_boas_vindas_itens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  item_key      text NOT NULL CHECK (item_key IN ('logo', 'brand_book', 'guidelines', 'acessos')),
  tipo          text NOT NULL CHECK (tipo IN ('arquivo', 'manual')),
  drive_file_id text,
  nome_arquivo  text,
  concluido_em  timestamptz NOT NULL DEFAULT now(),
  concluido_por text,
  UNIQUE (client_id, item_key)
);

ALTER TABLE public.client_boas_vindas_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read boas vindas" ON public.client_boas_vindas_itens;
CREATE POLICY "authenticated read boas vindas"
  ON public.client_boas_vindas_itens FOR SELECT TO authenticated
  USING (true);

-- anon nunca lê/grava direto: só pelas duas funções abaixo (SECURITY DEFINER)
-- e pela edge function (service_role, que ignora RLS).
GRANT ALL ON public.client_boas_vindas_itens TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Leitura: status dos 4 itens pro cliente que abriu a aba
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_boas_vindas_lumos(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_client RECORD;
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
BEGIN
  IF p_item_key <> 'acessos' THEN
    RETURN jsonb_build_object('error', 'item_precisa_de_arquivo');
  END IF;

  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  INSERT INTO client_boas_vindas_itens (client_id, item_key, tipo, concluido_por, concluido_em)
  VALUES (v_portal.client_id, p_item_key, 'manual', NULLIF(trim(p_nome_pessoa), ''), now())
  ON CONFLICT (client_id, item_key)
  DO UPDATE SET concluido_por = EXCLUDED.concluido_por, concluido_em = now();

  SELECT name INTO v_client_name FROM clients WHERE id = v_portal.client_id;

  -- Bloco isolado de propósito: se notificar falhar (ex.: coluna nova em
  -- "notifications" que este banco ainda não tem), o item continua marcado.
  -- Mesmo princípio do gatilho de Drive: aviso nunca derruba a ação principal.
  BEGIN
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, scope)
    SELECT a.id, 'boas_vindas_item_enviado', 'producao', 'normal',
      'Bem-vindo à Lumos: novo item concluído',
      v_client_name || ' marcou "Acessos" como concluído.',
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
-- SELECT proname FROM pg_proc WHERE proname IN ('get_boas_vindas_lumos', 'marcar_item_boas_vindas');
-- -- deve devolver as duas linhas.
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'client_boas_vindas_itens';
-- -- deve devolver as 8 colunas: id, client_id, item_key, tipo, drive_file_id, nome_arquivo, concluido_em, concluido_por.
