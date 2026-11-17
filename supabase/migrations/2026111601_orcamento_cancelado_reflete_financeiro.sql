-- ORÇAMENTO CANCELADO / REPROVADO DEPOIS DE APROVADO + PROTEÇÃO CONTRA EXCLUSÃO (achados C4, A11, C19).
--
-- 1) Quando um orçamento APROVADO passa a "cancelado" ou "reprovado":
--    · as parcelas que ainda não receberam nada viram "cancelado" (saem de "vendido" e de "a receber";
--      a view vw_rentabilidade já ignora parcela cancelada);
--    · parcela com qualquer valor recebido NÃO é mexida (dinheiro que entrou continua contado);
--    · se não sobrar nenhuma parcela válida, o projeto financeiro fica com valor_vendido = 0 (o valor antigo é
--      guardado em valor_vendido_antes_cancelar) e a data fica em cancelado_em. Os custos já lançados continuam
--      aparecendo, então o projeto mostra o prejuízo real em vez de sumir.
-- 2) Um orçamento aprovado, com recebimento ou com custos lançados NÃO pode mais ser excluído (cancele em vez
--    de excluir). A tela de Orçamentos também confere antes, porque ela apaga as parcelas e os custos primeiro.
--
-- SECURITY DEFINER porque Produção não tem permissão de alterar projetos_financeiro (só admin).
-- Seguro rodar mais de uma vez. Não altera nenhum dado existente.

ALTER TABLE public.projetos_financeiro
  ADD COLUMN IF NOT EXISTS valor_vendido_antes_cancelar numeric(12,2),
  ADD COLUMN IF NOT EXISTS cancelado_em timestamptz;

CREATE OR REPLACE FUNCTION public.fn_orcamento_cancelado_reflete_financeiro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'aprovado' AND NEW.status IN ('cancelado', 'reprovado') THEN
    UPDATE receivables SET status = 'cancelado'
    WHERE budget_id = NEW.id AND status <> 'cancelado' AND COALESCE(received_amount, 0) = 0;

    UPDATE projetos_financeiro
    SET valor_vendido_antes_cancelar = COALESCE(valor_vendido_antes_cancelar, valor_vendido),
        valor_vendido = 0,
        cancelado_em = COALESCE(cancelado_em, now()),
        updated_at = now()
    WHERE proposta_id = NEW.id
      AND NOT EXISTS (SELECT 1 FROM receivables r WHERE r.budget_id = NEW.id AND r.status <> 'cancelado');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_orcamento_cancelado_reflete_financeiro ON public.budgets;
CREATE TRIGGER trg_orcamento_cancelado_reflete_financeiro
  AFTER UPDATE OF status ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.fn_orcamento_cancelado_reflete_financeiro();

CREATE OR REPLACE FUNCTION public.fn_orcamento_bloqueia_exclusao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'aprovado'
     OR EXISTS (SELECT 1 FROM receivables WHERE budget_id = OLD.id AND COALESCE(received_amount, 0) > 0)
     OR EXISTS (SELECT 1 FROM project_costs WHERE budget_id = OLD.id) THEN
    RAISE EXCEPTION 'Este orçamento está aprovado, tem recebimento ou custos lançados e não pode ser excluído. Marque como Cancelado.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_orcamento_bloqueia_exclusao ON public.budgets;
CREATE TRIGGER trg_orcamento_bloqueia_exclusao
  BEFORE DELETE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.fn_orcamento_bloqueia_exclusao();

-- Quem roda as funções é o gatilho; ninguém chama direto.
REVOKE ALL ON FUNCTION public.fn_orcamento_cancelado_reflete_financeiro() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_orcamento_bloqueia_exclusao() FROM PUBLIC, anon, authenticated;

-- CONFERÊNCIA: os dois gatilhos existem.
SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_orcamento_cancelado_reflete_financeiro', 'trg_orcamento_bloqueia_exclusao');

-- PLANO DE VOLTA: DROP TRIGGER trg_orcamento_cancelado_reflete_financeiro ON public.budgets;
--                 DROP TRIGGER trg_orcamento_bloqueia_exclusao ON public.budgets;
