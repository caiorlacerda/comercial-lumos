-- 2026102802_app_users_protege_acesso.sql
-- IMPEDE QUE UMA PESSOA ALTERE O PRÓPRIO ACESSO (cargo, status, permissões)
--
-- Problema: a policy "Users can update their own presence status" deixa qualquer pessoa logada
-- atualizar a PRÓPRIA linha de app_users, e o papel 'authenticated' pode atualizar todas as colunas.
-- Na prática, alguém do time podia gravar o próprio role = 'admin' (ou o próprio custom_permissions)
-- direto pela API e se liberar sozinho, em qualquer permissão do app.
--
-- Correção: gatilho que, nas chamadas vindas do app (papéis authenticated/anon), só deixa
-- ADMIN mudar as colunas de acesso. O resto continua livre para a própria pessoa
-- (nome, foto, telefone, presença, last_seen, tour_seen, barra_rolagem_grande, revisor_fixo...).
--
--   · SQL Editor, funções SECURITY DEFINER do banco e Edge Functions (service_role) NÃO são afetados,
--     pois rodam com outro papel; convites, vínculo de perfil e exclusão de usuário seguem iguais;
--   · as telas Equipe/Usuários e "Quem edita" seguem funcionando, pois só admin as usa.
--
-- Rodar à mão no SQL Editor do Supabase. Seguro rodar mais de uma vez.

CREATE OR REPLACE FUNCTION public.app_users_protege_acesso()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Só vigia quem chega pela API do app.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF public.get_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF NEW.role               IS DISTINCT FROM OLD.role
  OR NEW.status             IS DISTINCT FROM OLD.status
  OR NEW.custom_permissions IS DISTINCT FROM OLD.custom_permissions
  OR NEW.hidden             IS DISTINCT FROM OLD.hidden
  OR NEW.auth_user_id       IS DISTINCT FROM OLD.auth_user_id
  OR NEW.email              IS DISTINCT FROM OLD.email
  OR NEW.invited_by         IS DISTINCT FROM OLD.invited_by
  OR NEW.joined_at          IS DISTINCT FROM OLD.joined_at
  THEN
    RAISE EXCEPTION 'Só administradores podem alterar cargo, status e permissões.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_users_protege_acesso ON public.app_users;
CREATE TRIGGER app_users_protege_acesso
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.app_users_protege_acesso();

-- Conferência: o gatilho deve aparecer ao lado do app_users_updated_at.
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.app_users'::regclass AND NOT tgisinternal
ORDER BY tgname;
