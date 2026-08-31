-- 2026093336_equipe_da_gravacao.sql
-- Cada gravação marcada vira um cartão clicável na tela, e por isso passa a
-- vir com id, duração, descrição e equipe. A equipe é informação nossa: só sai
-- do banco quando a Lumos autorizar aquele cliente
-- (`client_portals.mostrar_equipe`). Desligada, a lista volta vazia, porque
-- esconder na tela não esconde do navegador. E mesmo autorizada, cada pessoa vai
-- só com nome e função, nunca e-mail, telefone ou valor.
--
-- Nada aqui altera as migrações 2026093329 a 2026093335, que já rodaram em
-- produção: a coluna nova é ADD COLUMN IF NOT EXISTS, e a função é
-- CREATE OR REPLACE.

-- ───────────────────────────────────────────────────────────────
-- 1) Autorização para mostrar a equipe
-- ───────────────────────────────────────────────────────────────
-- Começa desligada, inclusive para os portais que já existem: quem já tinha
-- link não passa a ver a equipe por causa desta migração.
ALTER TABLE public.client_portals
  ADD COLUMN IF NOT EXISTS mostrar_equipe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.client_portals.mostrar_equipe IS
  'Liga a equipe de cada gravação no portal deste cliente, em todos os projetos dele. Só nome e função.';

-- ───────────────────────────────────────────────────────────────
-- 2) portal_agenda: gravação com detalhes
-- ───────────────────────────────────────────────────────────────
-- A precedência dos estados do dia continua exatamente a mesma de 2026093334:
-- data bloqueada em agenda_bloqueios vence tudo; depois dia com diária marcada
-- (ocupado); depois dia da semana fechado (bloqueado, com motivo); depois cedo;
-- senão livre.
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
  -- Frase padrão por dia da semana, usada quando a tabela não tem motivo
  -- escrito. Índice 1 = domingo (DOW 0) até índice 7 = sábado (DOW 6).
  v_dias_prep text[] := ARRAY['aos domingos','às segundas','às terças','às quartas','às quintas','às sextas','aos sábados'];
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
        END,
        'motivo', CASE
          WHEN b.data IS NOT NULL THEN b.motivo
          WHEN EXISTS (SELECT 1 FROM project_diarias pd WHERE pd.data = d.dia::date) THEN NULL
          WHEN f.dia_semana IS NOT NULL THEN COALESCE(f.motivo, 'Não gravamos ' || v_dias_prep[f.dia_semana + 1])
          ELSE NULL
        END
      ) ORDER BY d.dia)
      FROM generate_series(v_ini, v_fim, interval '1 day') AS d(dia)
      LEFT JOIN agenda_bloqueios b ON b.data = d.dia::date
      LEFT JOIN agenda_semana_fechada f ON f.dia_semana = EXTRACT(DOW FROM d.dia)::int
    ), '[]'::jsonb),
    -- Cada gravação com o que o cartão da tela abre: duração, descrição e a
    -- equipe daquele dia. A equipe só existe aqui quando o portal do cliente
    -- está autorizado; senão a lista sai vazia do banco, e não há o que
    -- esconder na tela. De cada pessoa vai só nome e função.
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
        ), '[]'::jsonb) ELSE '[]'::jsonb END
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
