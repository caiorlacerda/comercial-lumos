-- MARCAR COMENTÁRIO COMO RESOLVIDO
--
-- A coluna 'resolved' existe desde o começo da revisão de vídeo, mas nunca teve
-- quem a escrevesse: era um campo morto. Sem ele, filtrar "pendentes" e
-- "resolvidos" na revisão seria enfeite — a lista diria que está tudo em aberto
-- para sempre.
--
-- Por que RPC e não policy: a policy de UPDATE permite só o AUTOR editar o
-- próprio comentário, e isso está certo para o TEXTO (ninguém reescreve o pedido
-- do outro). Mas resolver é outra coisa: quem atende o pedido raramente é quem
-- pediu, e comentário de cliente nem tem autor interno. Então o toggle passa por
-- aqui, onde a regra é "qualquer pessoa ativa da equipe pode marcar", sem afrouxar
-- a edição de texto.

CREATE OR REPLACE FUNCTION public.review_marcar_resolvido(
  p_comment_id uuid,
  p_resolvido  boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user record;
BEGIN
  SELECT id, full_name INTO v_user
  FROM app_users WHERE auth_user_id = auth.uid() AND status = 'ativo';
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem_permissao');
  END IF;

  UPDATE review_comments SET resolved = p_resolvido WHERE id = p_comment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'comentario_nao_encontrado');
  END IF;

  RETURN jsonb_build_object('ok', true, 'resolved', p_resolvido, 'por', v_user.full_name);
END; $$;

REVOKE EXECUTE ON FUNCTION public.review_marcar_resolvido(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_marcar_resolvido(uuid, boolean) TO authenticated;

-- Conferência: deve devolver a função.
SELECT proname FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname = 'review_marcar_resolvido';
