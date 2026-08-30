-- 2026093333_ajustes_pedido_diaria.sql
-- Leva de correção do pedido de diária, depois do ramo inteiro montado. Quatro
-- coisas que só apareceram olhando o conjunto:
--
--   1) o aviso de "diária extra" lia o pacote do MÊS CORRENTE, e o pedido era
--      gravado com o pacote do MÊS DA DATA PEDIDA. Como o calendário vai a 90
--      dias, a maioria das datas cai em outro mês, e o cliente via (ou deixava
--      de ver) um aviso de dinheiro que não batia com o que ia ser registrado;
--   2) o token antigo de projeto (project_portals) abre o portal, mas as três
--      funções novas não o conheciam: quem tinha link antigo lia "este link não
--      está mais ativo" ao entrar na aba Diárias;
--   3) a notificação do pedido apontava para ?aba=diarias, e a tela de projetos
--      lê ?tab=diarias;
--   4) apagar a gravação criada por um pedido deixava o pedido dizendo "aceito"
--      com diaria_id nulo, por causa do ON DELETE SET NULL.
--
-- Nada aqui altera as migrações que já rodaram: tudo é CREATE OR REPLACE.

-- ───────────────────────────────────────────────────────────────
-- 1) A agenda do portal: pacote POR MÊS, e o token antigo valendo
-- ───────────────────────────────────────────────────────────────
-- `pacote` continua sendo o mês corrente (é o bloco "Suas diárias neste mês").
-- `pacotes` é novo: um por mês que o calendário alcança, para a tela poder ler
-- o mês da data escolhida, que é exatamente o mês que portal_pedir_diaria usa
-- para decidir fora_do_pacote. Mês sem contrato por volume não entra no mapa,
-- e sem entrada não há aviso nenhum.
CREATE OR REPLACE FUNCTION public.portal_agenda(p_token text, p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_email  text;
  v_pessoa uuid := NULL;
  v_ok     boolean;
  v_ini    date := current_date;
  v_fim    date := current_date + 90;
  v_cedo   date;
  v_client_id uuid;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;

  -- Token antigo de projeto: o portal do cliente aceita, então a agenda também
  -- aceita. Mesma escada de get_client_portal_v2.
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
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    SELECT id INTO v_pessoa FROM client_users
    WHERE client_id = v_portal.client_id AND lower(email) = v_email AND ativo;
    IF v_pessoa IS NULL THEN RETURN jsonb_build_object('error','sem_acesso'); END IF;
  END IF;

  -- O projeto precisa ser do cliente, estar visível, e estar liberado pra esta
  -- pessoa quando ela tem projetos marcados.
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND p.client_id = v_portal.client_id AND p.portal_visivel
      AND (v_pessoa IS NULL
           OR NOT EXISTS (SELECT 1 FROM client_user_projects WHERE client_user_id = v_pessoa)
           OR p.id IN (SELECT project_id FROM client_user_projects WHERE client_user_id = v_pessoa))
  ) INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object('error','sem_acesso'); END IF;

  v_cedo := current_date + v_portal.antecedencia_dias;

  RETURN jsonb_build_object(
    'antecedencia_dias', v_portal.antecedencia_dias,
    'dias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('data', d.dia::date, 'estado',
        CASE
          WHEN EXISTS (SELECT 1 FROM agenda_bloqueios b WHERE b.data = d.dia) THEN 'bloqueado'
          WHEN EXISTS (SELECT 1 FROM project_diarias pd WHERE pd.data = d.dia)  THEN 'ocupado'
          WHEN d.dia < v_cedo THEN 'cedo'
          ELSE 'livre'
        END) ORDER BY d.dia)
      FROM generate_series(v_ini, v_fim, interval '1 day') AS d(dia)
    ), '[]'::jsonb),
    'agendadas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'nome', pd.nome, 'data', pd.data, 'hora_inicio', pd.hora_inicio,
        'hora_fim', pd.hora_fim, 'local', pd.local) ORDER BY pd.data)
      FROM project_diarias pd
      WHERE pd.project_id = p_project_id AND pd.data IS NOT NULL
        AND pd.data >= current_date - 30
    ), '[]'::jsonb),
    'pacote', (
      SELECT jsonb_build_object('meta', x.meta, 'realizado', x.realizado)
      FROM escopo_do_mes(p_project_id, date_trunc('month', current_date)::date) x
      WHERE x.chave = 'diarias' AND x.periodo = 'mes' LIMIT 1
    ),
    'pacotes', COALESCE((
      SELECT jsonb_object_agg(to_char(m.mes, 'YYYY-MM'),
               jsonb_build_object('meta', x.meta, 'realizado', x.realizado))
      FROM generate_series(date_trunc('month', v_ini::timestamp),
                           date_trunc('month', v_fim::timestamp),
                           interval '1 month') AS m(mes)
      CROSS JOIN LATERAL (
        SELECT e.meta, e.realizado
        FROM escopo_do_mes(p_project_id, m.mes::date) e
        WHERE e.chave = 'diarias' AND e.periodo = 'mes' LIMIT 1
      ) x
    ), '{}'::jsonb),
    'pedidos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', q.id, 'data_desejada', q.data_desejada, 'estado', q.estado,
        'motivo_recusa', q.motivo_recusa, 'fora_do_pacote', q.fora_do_pacote,
        'descricao', q.descricao) ORDER BY q.data_desejada)
      FROM diaria_pedidos q
      WHERE q.project_id = p_project_id
        AND (q.estado = 'pendente' OR q.respondido_em > now() - interval '30 days')
    ), '[]'::jsonb)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.portal_agenda(text, uuid) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────
-- 2) Pedir e cancelar também aceitam o token antigo
-- ───────────────────────────────────────────────────────────────
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
  v_client_id uuid;
BEGIN
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

-- ───────────────────────────────────────────────────────────────
-- 3) A notificação leva pra aba certa
-- ───────────────────────────────────────────────────────────────
-- Projetos.tsx lê ?tab=, não ?aba=. Só o portal do cliente usa 'aba'. Com o
-- nome errado o link abria o projeto e parava na aba de entrada, que não é a
-- de diárias.
CREATE OR REPLACE FUNCTION public.notificar_pedido_de_diaria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u        RECORD;
  v_proj   text;
  v_quando text;
BEGIN
  SELECT name INTO v_proj FROM projects WHERE id = NEW.project_id;
  v_quando := to_char(NEW.data_desejada, 'DD/MM');
  FOR u IN
    SELECT id FROM app_users
    WHERE status = 'ativo' AND (role IN ('admin','producao') OR role = 'atendimento')
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      u.id, 'diaria_solicitada', 'producao', 'high',
      'Cliente pediu uma diária 📅',
      NEW.nome || ' pediu ' || v_quando || ' em ' || COALESCE(v_proj, 'um projeto') || '.',
      '/producao/projetos?projectId=' || NEW.project_id::text || '&tab=diarias',
      jsonb_build_object('pedido_id', NEW.id, 'project_id', NEW.project_id)
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notificar_pedido_de_diaria falhou para %: %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

-- ───────────────────────────────────────────────────────────────
-- 4) Apagar a gravação devolve o pedido para a fila
-- ───────────────────────────────────────────────────────────────
-- diaria_pedidos.diaria_id é ON DELETE SET NULL: apagar a diária deixava o
-- pedido em 'aceito' apontando pra nada. O cliente lia "Aceito", "Gravações
-- marcadas" não listava nada, e o dia voltava a livre no calendário. Gravação
-- desfeita é pedido em aberto de novo.
--
-- É BEFORE DELETE de propósito, não AFTER: a ação SET NULL da chave estrangeira
-- é ela mesma um gatilho AFTER DELETE nesta tabela, e a ordem entre dois AFTER
-- é a ordem alfabética dos nomes. Num AFTER, o vínculo `diaria_id = OLD.id`
-- pode já ter sido apagado antes de a gente olhar, e aí não sobra por onde
-- achar o pedido. No BEFORE o vínculo ainda está lá, e o SET NULL depois não
-- encontra mais nada pra fazer.
CREATE OR REPLACE FUNCTION public.pedido_volta_pra_fila()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id FROM diaria_pedidos WHERE diaria_id = OLD.id AND estado = 'aceito'
  LOOP
    BEGIN
      UPDATE diaria_pedidos
      SET estado = 'pendente', diaria_id = NULL, respondido_por = NULL, respondido_em = NULL
      WHERE id = p.id;
    EXCEPTION WHEN unique_violation THEN
      -- Já existe outro pedido pendente do mesmo cliente para o mesmo dia
      -- (idx_diaria_pedidos_um_por_dia). Voltar não cabe, e derrubar a exclusão
      -- da gravação por causa disso seria pior: o pedido fica cancelado, que é
      -- verdade, e a fila continua com um pedido só para aquele dia.
      UPDATE diaria_pedidos
      SET estado = 'cancelado', diaria_id = NULL
      WHERE id = p.id;
    END;
  END LOOP;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- Apagar a gravação nunca pode falhar por causa da arrumação do pedido.
  RAISE WARNING 'pedido_volta_pra_fila falhou para a diária %: %', OLD.id, SQLERRM;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_pedido_volta_pra_fila ON public.project_diarias;
CREATE TRIGGER trg_pedido_volta_pra_fila
  BEFORE DELETE ON public.project_diarias
  FOR EACH ROW EXECUTE FUNCTION public.pedido_volta_pra_fila();
