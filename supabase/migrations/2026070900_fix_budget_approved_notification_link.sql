-- Fix: link da notificação de orçamento aprovado apontava para uma rota inexistente
-- (/comercial/orcamentos?id=...). A rota real do editor de orçamento é /orcamentos/:id.
-- Recria apenas a função; o trigger trg_budget_approved_notification já a referencia.
CREATE OR REPLACE FUNCTION public.handle_budget_approved_notification()
RETURNS trigger AS $$
DECLARE
  active_user_id UUID;
  admin_record RECORD;
BEGIN
  -- Trigger condition: transition to 'aprovado'
  IF OLD.status != 'aprovado' AND NEW.status = 'aprovado' THEN
    BEGIN
      -- Retrieve active user from context
      active_user_id := (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'ativo');

      -- Loop through active admin users, excluding active_user_id
      FOR admin_record IN
        SELECT id
        FROM public.app_users
        WHERE role = 'admin'
          AND status = 'ativo'
          AND id != COALESCE(active_user_id, '00000000-0000-0000-0000-000000000000')
      LOOP
        INSERT INTO public.notifications (
          user_id,
          event_type,
          category,
          priority,
          title,
          body,
          link,
          data
        ) VALUES (
          admin_record.id,
          'orcamento_aprovado',
          'comercial',
          'high',
          'Orçamento Aprovado',
          'O orçamento "' || NEW.project_name || '" (Código: ' || COALESCE(NEW.code, '') || ') foi aprovado pelo cliente.',
          '/orcamentos/' || COALESCE(NEW.id::text, ''),
          jsonb_build_object(
            'budget_id', NEW.id
          )
        );
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      -- Error isolation
      RAISE WARNING 'Error creating budget approved notifications for budget %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
