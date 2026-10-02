-- Contas a Receber zeradas: projeto aprovado com valor, mas a única conta a
-- receber dele está com total R$ 0,00 (visto em #2026-263, #2026-265 e
-- #2026-268). Uma conta de R$ 0 não faz sentido pra um projeto vendido, então
-- ela passa a ter o valor do projeto (projetos_financeiro.valor_vendido).
--
-- Só mexe quando TODAS as condições valem — nenhum caso ambíguo:
--   * o projeto tem exatamente UMA conta a receber (não cancelada);
--   * ela está zerada e nada foi recebido (não é "Recebido");
--   * o projeto tem valor vendido maior que zero.
-- Valores que apenas DIVERGEM entre as duas telas (e não estão zerados) NÃO são
-- tocados: ficam listados em reconciliar_recebimento(false) pra revisão.
--
-- O que mudou fica registrado em reconciliacao_recebimento_log (antes/depois).
-- Rodar de novo não faz nada (depois de corrigido, a conta já não está zerada).
WITH alvo AS (
  SELECT rc.id AS rid, pf.id AS pid, rc.total_amount AS antes, round(pf.valor_vendido, 2) AS depois
  FROM receivables rc
  JOIN projetos_financeiro pf ON pf.proposta_id = rc.budget_id
  WHERE rc.status NOT IN ('cancelado', 'recebido')
    AND COALESCE(rc.total_amount, 0) = 0
    AND COALESCE(rc.received_amount, 0) = 0
    AND COALESCE(pf.valor_vendido, 0) > 0
    AND (SELECT count(*) FROM receivables x
         WHERE x.budget_id = rc.budget_id AND x.status <> 'cancelado') = 1
), registro AS (
  INSERT INTO reconciliacao_recebimento_log (projeto_financeiro_id, receivable_id, antes, depois)
  SELECT pid, rid, jsonb_build_object('total_amount', antes), jsonb_build_object('total_amount', depois)
  FROM alvo
)
UPDATE receivables rc
SET total_amount = a.depois, updated_at = now()
FROM alvo a
WHERE rc.id = a.rid
RETURNING rc.description AS conta_corrigida, a.antes AS valor_antes, rc.total_amount AS valor_depois;
