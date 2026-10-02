-- Linka o "recebido" de Custos de Projeto com Contas a Receber (os dois
-- lados viviam separados — o Vini marca "Pagamento Recebido" em Custos de
-- Projeto, mas isso nunca chegava em Contas a Receber).
--
-- Já existe o caminho contrário: fn_receivable_reflete_projeto (ver
-- 2026093311_fase2_elo_receita.sql) atualiza projetos_financeiro.status_titulo
-- quando as parcelas de receivables somam o total. Esta migration cria o
-- gatilho espelhado, na outra direção: quando status_titulo vira
-- 'pagamento_recebido' em projetos_financeiro (a marcação manual do Vini),
-- quita as parcelas em aberto desse orçamento em receivables.
--
-- Guard "IS DISTINCT FROM" nos dois lados evita loop entre os dois gatilhos
-- (o segundo UPDATE não muda nada quando já está tudo igual, então não
-- dispara o primeiro de novo).
--
-- Projetos sem proposta_id/budget_id (criados fora do fluxo de aprovação de
-- orçamento) continuam sem elo possível — mesma limitação que já existia no
-- sentido contrário.
--
-- BUG ENCONTRADO NO CAMINHO: projetos_financeiro nunca teve coluna
-- updated_at, mas 5 lugares já assumiam que ela existia —
-- fn_receivable_reflete_projeto (2026093311), aprovar_orcamento
-- (2026093349 e 2026093358, este último já na produção) e agora o gatilho
-- novo abaixo. Isso quer dizer que fn_receivable_reflete_projeto (o gatilho
-- que atualiza projetos_financeiro quando um recebimento é registrado em
-- Contas a Receber) FALHA com "column updated_at does not exist" toda vez
-- que o veredito (recebido/atrasado) muda — bem provavelmente a causa real
-- de o Vini ter migrado pra marcar tudo em Custos de Projeto. Corrigido
-- aqui, de vez, criando a coluna que já devia existir.
ALTER TABLE public.projetos_financeiro
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.fn_projeto_financeiro_reflete_receivable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status_titulo = 'pagamento_recebido'
     AND OLD.status_titulo IS DISTINCT FROM 'pagamento_recebido'
     AND NEW.proposta_id IS NOT NULL THEN
    UPDATE public.receivables
    SET status = 'recebido',
        received_amount = total_amount,
        received_at = COALESCE(received_at, NEW.data_recebido::timestamptz, now())
    WHERE budget_id = NEW.proposta_id
      AND status <> 'cancelado'
      AND (status IS DISTINCT FROM 'recebido' OR received_amount IS DISTINCT FROM total_amount);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_projeto_financeiro_reflete_receivable ON public.projetos_financeiro;
CREATE TRIGGER trg_projeto_financeiro_reflete_receivable
  AFTER UPDATE OF status_titulo ON public.projetos_financeiro
  FOR EACH ROW EXECUTE FUNCTION public.fn_projeto_financeiro_reflete_receivable();

-- Conferência: a função e o gatilho existem.
SELECT proname FROM pg_proc WHERE proname = 'fn_projeto_financeiro_reflete_receivable';
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_projeto_financeiro_reflete_receivable';
