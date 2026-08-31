-- 2026093337_ordem_no_portal.sql
-- A ordem do dia chega ao portal do cliente, e só a parte dela que é do
-- cliente.
--
-- 1) `ordens_do_dia.nota_cliente`: o recado do que o CLIENTE precisa
--    providenciar no dia. Os campos que já existiam (`objetos`, `figurino`,
--    `regras`) são internos e nasceram cheios de coisa que não é dele, então
--    não dava pra reaproveitar nenhum: o recado do cliente precisava de um
--    campo próprio, escrito sabendo que ele lê.
--
-- 2) `portal_agenda` passa a mandar, em cada gravação, a chave `ordem`, com
--    exatamente três coisas: ponto de encontro (nome e endereço), o
--    cronograma do dia (só hora e o que acontece) e essa nota. E só quando a
--    ordem do dia está APROVADA e é a ordem daquela diária
--    (`ordens_do_dia.diaria_id`). Rascunho não vai pro portal, e não existe
--    interruptor novo: a aprovação é o portão.
--
--    O que fica de fora não é escondido na tela, é escondido do banco, porque
--    o que desce fica no navegador do cliente. Não saem daqui: horário de
--    chamada de cada pessoa (`call_times`), equipamentos, figurino, objetos,
--    regras internas, contatos, talentos, locações, clima e a equipe da ordem.
--    Do cronograma sai só `inicio` e `descricao`: responsável, tipo, locação e
--    marcação de paralelo ficam do lado de cá.
--
-- Nada aqui altera as migrações 2026093329 a 2026093336, que já rodaram em
-- produção: a coluna nova é ADD COLUMN IF NOT EXISTS, e a função é
-- CREATE OR REPLACE. O resto do retorno de `portal_agenda` continua idêntico
-- ao de 2026093336, inclusive o dia sem motivo e a equipe atrás de
-- `client_portals.mostrar_equipe`.

-- ───────────────────────────────────────────────────────────────
-- 1) O recado que o cliente lê
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.ordens_do_dia
  ADD COLUMN IF NOT EXISTS nota_cliente text;

COMMENT ON COLUMN public.ordens_do_dia.nota_cliente IS
  'O que o CLIENTE precisa providenciar no dia. Sai no portal dele quando a ordem do dia está aprovada. Texto público: nada interno aqui.';

-- ───────────────────────────────────────────────────────────────
-- 2) portal_agenda: a gravação passa a levar a ordem do dia junto
-- ───────────────────────────────────────────────────────────────
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

  -- Piso de 2 dias: portal configurado com antecedência 0 ou 1 nunca deixa
  -- pedir para amanhã.
  v_cedo := current_date + GREATEST(v_portal.antecedencia_dias, 2);

  RETURN jsonb_build_object(
    'antecedencia_dias', v_portal.antecedencia_dias,
    'dias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'data', d.dia::date,
        'estado', CASE
          WHEN b.data IS NOT NULL THEN 'bloqueado'
          WHEN EXISTS (SELECT 1 FROM project_diarias pd WHERE pd.data = d.dia::date) THEN 'ocupado'
          WHEN f.dia_semana IS NOT NULL THEN 'bloqueado'
          WHEN d.dia < v_cedo THEN 'cedo'
          ELSE 'livre'
        END
      ) ORDER BY d.dia)
      FROM generate_series(v_ini, v_fim, interval '1 day') AS d(dia)
      LEFT JOIN agenda_bloqueios b ON b.data = d.dia::date
      LEFT JOIN agenda_semana_fechada f ON f.dia_semana = EXTRACT(DOW FROM d.dia)::int
    ), '[]'::jsonb),
    -- Cada gravação com o que o cartão da tela abre: duração, descrição, a
    -- equipe daquele dia e agora a ordem do dia. A equipe só existe aqui
    -- quando o portal do cliente está autorizado; senão a lista sai vazia do
    -- banco, e não há o que esconder na tela. De cada pessoa vai só nome e
    -- função.
    'agendadas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pd.id, 'nome', pd.nome, 'data', pd.data, 'hora_inicio', pd.hora_inicio,
        'hora_fim', pd.hora_fim, 'local', pd.local,
        'duracao_horas', pd.duracao_horas, 'descricao', pd.descricao,
        'equipe', CASE WHEN v_portal.mostrar_equipe THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', e.nome, 'funcao', e.funcao) ORDER BY e.nome)
          FROM (
            SELECT COALESCE(u.full_name, fo.nome) AS nome,
                   NULLIF(btrim(dm.funcao), '')   AS funcao
            FROM diaria_members dm
            LEFT JOIN app_users u   ON u.id  = dm.user_id
            LEFT JOIN fornecedores fo ON fo.id = dm.freela_id
            WHERE dm.diaria_id = pd.id
          ) e
          WHERE e.nome IS NOT NULL
        ), '[]'::jsonb) ELSE '[]'::jsonb END,
        -- A ordem do dia daquela diária, e só se estiver aprovada. Três
        -- chaves, montadas uma a uma: nada de devolver a linha inteira nem o
        -- jsonb cru de `ponto_encontro`, que pode ter mais coisa dentro.
        'ordem', (
          SELECT jsonb_build_object(
            'ponto_encontro', CASE
              WHEN NULLIF(btrim(COALESCE(od.ponto_encontro->>'nome', '')), '') IS NULL
               AND NULLIF(btrim(COALESCE(od.ponto_encontro->>'endereco', '')), '') IS NULL
              THEN NULL
              ELSE jsonb_build_object(
                'nome',     NULLIF(btrim(COALESCE(od.ponto_encontro->>'nome', '')), ''),
                'endereco', NULLIF(btrim(COALESCE(od.ponto_encontro->>'endereco', '')), ''))
            END,
            -- O minuto a minuto na ordem em que foi escrito, com hora e o que
            -- acontece. Linha sem nada dos dois não vira linha na tela dele.
            'cronograma', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'hora',      NULLIF(btrim(COALESCE(m.item->>'inicio', '')), ''),
                       'descricao', NULLIF(btrim(COALESCE(m.item->>'descricao', '')), ''))
                     ORDER BY m.ord)
              FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(od.plano_acao) = 'array' THEN od.plano_acao ELSE '[]'::jsonb END
                   ) WITH ORDINALITY AS m(item, ord)
              WHERE NULLIF(btrim(COALESCE(m.item->>'inicio', '')), '') IS NOT NULL
                 OR NULLIF(btrim(COALESCE(m.item->>'descricao', '')), '') IS NOT NULL
            ), '[]'::jsonb),
            'nota_cliente', NULLIF(btrim(COALESCE(od.nota_cliente, '')), '')
          )
          FROM ordens_do_dia od
          WHERE od.diaria_id = pd.id AND od.aprovacao = 'aprovada'
          ORDER BY od.updated_at DESC NULLS LAST, od.created_at DESC NULLS LAST
          LIMIT 1
        )
      ) ORDER BY pd.data)
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
