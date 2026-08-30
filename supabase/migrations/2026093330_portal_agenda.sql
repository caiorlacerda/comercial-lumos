-- 2026093330_portal_agenda.sql
-- O calendário que o cliente enxerga. Devolve o ESTADO do dia, nunca o dono
-- dele: quantos clientes temos e quando estamos parados não é assunto do
-- cliente.
CREATE INDEX IF NOT EXISTS idx_project_diarias_data ON public.project_diarias(data);

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
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;

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
