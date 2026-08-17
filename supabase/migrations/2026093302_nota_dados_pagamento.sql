-- COBRANÇA DE NOTA v2: o fornecedor confirma PIX e dados bancários junto com
-- a nota (pedido do Vini). O que ele informar atualiza o cadastro
-- (fornecedores.payment_info) e fica guardado na própria cobrança.

ALTER TABLE public.nota_requests
  ADD COLUMN IF NOT EXISTS dados_pagamento text;

-- Prefill do campo na página pública: o Pix que já temos no cadastro.
CREATE OR REPLACE FUNCTION public.get_nota_request(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v RECORD;
BEGIN
  SELECT nr.id, nr.descricao, nr.valor, nr.pagar_em, nr.status, nr.nota_arquivo,
         f.nome AS fornecedor_nome, f.payment_info, p.name AS projeto_nome
  INTO v
  FROM nota_requests nr
  JOIN fornecedores f ON f.id = nr.fornecedor_id
  LEFT JOIN projects p ON p.id = nr.project_id
  WHERE nr.token = p_token AND nr.status <> 'cancelada';

  IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'link_invalido'); END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'fornecedor', v.fornecedor_nome,
    'projeto', v.projeto_nome,
    'descricao', v.descricao,
    'valor', v.valor,
    'pagar_em', v.pagar_em,
    'status', v.status,
    'arquivo', v.nota_arquivo -> 'name',
    'pix_atual', v.payment_info
  );
END; $$;

-- submit_nota ganha o parâmetro dos dados de pagamento (assinatura nova,
-- então a antiga sai pra não virar overload ambíguo).
DROP FUNCTION IF EXISTS public.submit_nota(text, text, text);

CREATE OR REPLACE FUNCTION public.submit_nota(
  p_token text,
  p_path text,
  p_file_name text,
  p_dados_pagamento text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v RECORD;
  v_admin RECORD;
BEGIN
  SELECT nr.*, f.nome AS fornecedor_nome INTO v
  FROM nota_requests nr JOIN fornecedores f ON f.id = nr.fornecedor_id
  WHERE nr.token = p_token AND nr.status IN ('agendada', 'email_enviado', 'nota_recebida');
  IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'link_invalido'); END IF;

  UPDATE nota_requests
  SET nota_arquivo = jsonb_build_object('name', p_file_name, 'path', p_path),
      nota_enviada_at = now(),
      status = 'nota_recebida',
      dados_pagamento = COALESCE(NULLIF(trim(p_dados_pagamento), ''), dados_pagamento),
      updated_at = now()
  WHERE id = v.id;

  -- Mantém o cadastro do fornecedor com o Pix mais recente.
  IF NULLIF(trim(p_dados_pagamento), '') IS NOT NULL THEN
    UPDATE fornecedores SET payment_info = trim(p_dados_pagamento), updated_at = now()
    WHERE id = v.fornecedor_id;
  END IF;

  FOR v_admin IN
    SELECT id FROM app_users WHERE status = 'ativo' AND role = 'admin'
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      v_admin.id, 'nota_fiscal_recebida', 'financeiro', 'high',
      'Nota fiscal recebida 📄',
      v.fornecedor_nome || ' enviou a nota do job "' || v.descricao || '"'
        || CASE WHEN NULLIF(trim(p_dados_pagamento), '') IS NOT NULL THEN ' e confirmou os dados de pagamento' ELSE '' END
        || '. Pagamento previsto pra ' || to_char(v.pagar_em, 'DD/MM/YYYY') || '.',
      '/producao/fornecedores?tab=notas',
      jsonb_build_object('nota_request_id', v.id)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_nota_request(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_nota(text, text, text, text) TO anon, authenticated;
