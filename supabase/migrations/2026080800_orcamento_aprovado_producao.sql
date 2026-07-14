-- "Fechamos um projeto novo!": a notificação de orçamento aprovado passa a ir
-- também para a PRODUÇÃO (antes só admin). É ela que dispara o popup de
-- comemoração em tempo real no cliente.
--
-- Mantém o resto igual ao original (2026070403): dispara só na transição para
-- 'aprovado', ignora quem aprovou (quando é um usuário logado) e isola erros.

CREATE OR REPLACE FUNCTION public.handle_budget_approved_notification()
RETURNS trigger AS $$
DECLARE
  active_user_id UUID;
  admin_record RECORD;
BEGIN
  IF OLD.status != 'aprovado' AND NEW.status = 'aprovado' THEN
    BEGIN
      active_user_id := (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'ativo');

      -- Admin E produção (o cliente aprova pela rota pública, então normalmente
      -- auth.uid() é nulo e ninguém é excluído).
      FOR admin_record IN
        SELECT id
        FROM public.app_users
        WHERE role IN ('admin', 'producao')
          AND status = 'ativo'
          AND id != COALESCE(active_user_id, '00000000-0000-0000-0000-000000000000')
      LOOP
        INSERT INTO public.notifications (
          user_id, event_type, category, priority, title, body, link, data
        ) VALUES (
          admin_record.id,
          'orcamento_aprovado',
          'comercial',
          'high',
          'Orçamento Aprovado',
          'O orçamento "' || NEW.project_name || '" (Código: ' || COALESCE(NEW.code, '') || ') foi aprovado pelo cliente.',
          '/comercial/orcamentos?id=' || COALESCE(NEW.id::text, ''),
          jsonb_build_object(
            'budget_id', NEW.id,
            'project_name', NEW.project_name,
            'code', COALESCE(NEW.code, '')
          )
        );
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error creating budget approved notifications for budget %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
