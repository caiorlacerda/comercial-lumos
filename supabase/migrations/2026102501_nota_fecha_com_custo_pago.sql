-- COBRANÇA DE NOTA: CUSTO PAGO FECHA A COBRANÇA EM QUALQUER ETAPA
--
-- Antes, pagar o custo só cancelava a cobrança que ainda não tinha saído
-- (status 'agendada'). Quem já tinha recebido o e-mail continuava "e-mail
-- enviado" para sempre, mesmo com o job pago (caso real: custo de R$ 550 pago,
-- cobrança aberta). Agora, custo pago marca como 'paga' a cobrança ligada a ele
-- que estiver em 'email_enviado' ou 'nota_recebida'.
--
-- O gatilho existente (trg_custo_propaga_pagamento) continua cancelando as
-- 'agendada'; este roda depois dele (ordem alfabética) e só pega o que sobrou.

CREATE OR REPLACE FUNCTION public.fn_nota_fecha_com_custo_pago()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE nota_requests
  SET status = 'paga', updated_at = now()
  WHERE cost_id = NEW.id AND status IN ('email_enviado', 'nota_recebida');
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.fn_nota_fecha_com_custo_pago() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_nota_fecha_com_custo_pago() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_nota_fecha_com_custo_pago() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_nota_fecha_com_custo_pago ON public.project_costs;
CREATE TRIGGER trg_nota_fecha_com_custo_pago
  AFTER UPDATE ON public.project_costs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'pago')
  EXECUTE FUNCTION public.fn_nota_fecha_com_custo_pago();

-- Acerto das que já ficaram abertas (guarda cópia na própria execução).
DO $$
DECLARE n integer;
BEGIN
  CREATE TABLE IF NOT EXISTS public.nota_requests_backup_20261025 AS
    SELECT * FROM public.nota_requests WHERE false;
  ALTER TABLE public.nota_requests_backup_20261025 ENABLE ROW LEVEL SECURITY;

  INSERT INTO public.nota_requests_backup_20261025
    SELECT nr.* FROM public.nota_requests nr
    JOIN public.project_costs c ON c.id = nr.cost_id
    WHERE nr.status IN ('email_enviado', 'nota_recebida') AND c.status = 'pago';

  UPDATE public.nota_requests nr
  SET status = 'paga', updated_at = now()
  FROM public.project_costs c
  WHERE c.id = nr.cost_id AND nr.status IN ('email_enviado', 'nota_recebida') AND c.status = 'pago';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% cobrança(s) aberta(s) de custo já pago marcada(s) como paga(s)', n;
END $$;
