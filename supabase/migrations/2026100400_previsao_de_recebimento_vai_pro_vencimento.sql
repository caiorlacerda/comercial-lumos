-- O modal "Editar recebível" de Contas a Receber gravava a "Data de recebimento"
-- sempre em receivables.received_at — inclusive em títulos AINDA EM ABERTO,
-- onde a pessoa queria dizer "quando vai entrar". Mas received_at é a data em
-- que o dinheiro ENTROU; a previsão é o vencimento (due_date), que é o mesmo
-- campo que Custos de Projeto chama de "Vencimento negociado". Resultado: a
-- data digitada ficava invisível na tabela e nunca chegava em Custos de Projeto.
--
-- O front passa a gravar a previsão em due_date. Esta migration move o que já
-- ficou em received_at pra due_date, SÓ quando não há ambiguidade:
--   * título não recebido, sem nenhum valor recebido (parcial fica de fora,
--     porque lá received_at é a data do pagamento parcial);
--   * due_date vazio, ou igual à data digitada.
-- Se due_date já tem OUTRA data, não decidimos por ninguém: o título aparece na
-- segunda consulta pra revisão manual.
--
-- Ao mexer no vencimento, o gatilho espelha a data em Custos de Projeto
-- (quando o projeto tem uma conta só). O que mudou fica em
-- reconciliacao_recebimento_log (antes/depois). Rodar de novo não faz nada.
WITH alvo AS (
  SELECT id, due_date, (received_at AT TIME ZONE 'UTC')::date AS prevista
  FROM receivables
  WHERE status NOT IN ('recebido', 'parcial', 'cancelado')
    AND COALESCE(received_amount, 0) = 0
    AND received_at IS NOT NULL
    AND (due_date IS NULL OR due_date = (received_at AT TIME ZONE 'UTC')::date)
), registro AS (
  INSERT INTO reconciliacao_recebimento_log (receivable_id, antes, depois)
  SELECT id,
         jsonb_build_object('due_date', due_date, 'received_at', prevista),
         jsonb_build_object('due_date', prevista, 'received_at', NULL)
  FROM alvo
)
UPDATE receivables rc
SET due_date = a.prevista, received_at = NULL, updated_at = now()
FROM alvo a
WHERE rc.id = a.id
RETURNING rc.description AS titulo_corrigido, a.prevista AS vencimento_agora;

-- Revisão manual: título em aberto com uma data em received_at DIFERENTE do vencimento.
SELECT b.code AS codigo, rc.description AS titulo, rc.status,
       rc.due_date AS vencimento, (rc.received_at AT TIME ZONE 'UTC')::date AS data_digitada_no_modal
FROM receivables rc
LEFT JOIN budgets b ON b.id = rc.budget_id
WHERE rc.status NOT IN ('recebido', 'parcial', 'cancelado')
  AND COALESCE(rc.received_amount, 0) = 0
  AND rc.received_at IS NOT NULL
ORDER BY b.code;
