-- 2026093334_semana_fechada.sql
-- A produtora passa a poder fechar um dia da semana inteiro (domingo, por
-- exemplo), não só datas avulsas. E o piso de antecedência do pedido passa a
-- ter um mínimo de dois dias, mesmo quando o portal está configurado com 0 ou
-- 1: ninguém pede diária pra amanhã.
--
-- Nada aqui altera as migrações 2026093329 a 2026093333, que já rodaram em
-- produção: tudo é CREATE OR REPLACE, e a tabela nova usa CREATE TABLE IF NOT
-- EXISTS.

-- ───────────────────────────────────────────────────────────────
-- 1) Dias da semana fechados
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agenda_semana_fechada (
  dia_semana int PRIMARY KEY CHECK (dia_semana BETWEEN 0 AND 6),  -- 0 = domingo, igual ao EXTRACT(DOW)
  motivo     text,
  criado_por uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agenda_semana_fechada ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time le e escreve semana fechada" ON public.agenda_semana_fechada;
CREATE POLICY "time le e escreve semana fechada" ON public.agenda_semana_fechada
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Começa vazia: nenhum dia fechado por padrão.

-- ───────────────────────────────────────────────────────────────
-- 2) portal_agenda: dia da semana fechado, motivo, e piso de 2 dias
-- ───────────────────────────────────────────────────────────────
-- Precedência dos estados, nesta ordem exata: data bloqueada em
-- agenda_bloqueios vence tudo; depois dia com diária marcada (ocupado); depois
-- dia da semana fechado (bloqueado, com motivo); depois cedo; senão livre. Um
-- domingo que já tem gravação marcada aparece como ocupado, não como fechado,
-- porque isso é mais verdadeiro do que dizer que a agenda está fechada.
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
-- 3) portal_pedir_diaria: mesmo piso de 2 dias, e recusa dia da semana fechado
-- ───────────────────────────────────────────────────────────────
-- O piso usa exatamente a mesma conta de portal_agenda
-- (current_date + GREATEST(antecedencia_dias, 2)), pra tela e servidor nunca
-- discordarem sobre o que é "cedo demais".
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
