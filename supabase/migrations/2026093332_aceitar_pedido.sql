-- 2026093332_aceitar_pedido.sql
-- Aceitar cria a diária E fecha o pedido. Duas escritas que não podem ficar
-- pela metade: pedido aceito sem diária vira gravação que ninguém marcou.
CREATE OR REPLACE FUNCTION public.aceitar_pedido_diaria(p_pedido_id uuid, p_confirmar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p      RECORD;
  v_eu     uuid;
  v_dono   text;
  v_diaria uuid;
BEGIN
  SELECT id INTO v_eu FROM app_users WHERE auth_user_id = auth.uid() AND status = 'ativo';
  IF v_eu IS NULL THEN RETURN jsonb_build_object('error','sem_permissao'); END IF;

  -- Trava a linha: dois cliques simultâneos não podem os dois passar pelo
  -- IF abaixo e criar duas diárias pro mesmo pedido.
  SELECT * INTO v_p FROM diaria_pedidos WHERE id = p_pedido_id AND estado = 'pendente' FOR UPDATE;
  IF v_p IS NULL THEN RETURN jsonb_build_object('error','nao_encontrado'); END IF;

  -- Dia que ficou ocupado entre o pedido e a resposta: avisa em vez de recusar
  -- sozinha. Duas equipes no mesmo dia acontece, e quem decide é gente.
  SELECT string_agg(DISTINCT pr.name, ', ') INTO v_dono
  FROM project_diarias pd JOIN projects pr ON pr.id = pd.project_id
  WHERE pd.data = v_p.data_desejada;
  IF v_dono IS NOT NULL AND NOT p_confirmar THEN
    RETURN jsonb_build_object('error','dia_ocupado','ocupado_por', v_dono);
  END IF;

  INSERT INTO project_diarias (project_id, nome, data, duracao_horas, local, descricao, created_by)
  VALUES (v_p.project_id,
          'Gravação pedida pelo cliente',
          v_p.data_desejada, v_p.duracao_horas, v_p.local, v_p.descricao, v_eu)
  RETURNING id INTO v_diaria;

  UPDATE diaria_pedidos
  SET estado = 'aceito', diaria_id = v_diaria, respondido_por = v_eu, respondido_em = now()
  WHERE id = p_pedido_id AND estado = 'pendente';

  RETURN jsonb_build_object('ok', true, 'diaria_id', v_diaria);
END; $$;

GRANT EXECUTE ON FUNCTION public.aceitar_pedido_diaria(uuid, boolean) TO authenticated;
