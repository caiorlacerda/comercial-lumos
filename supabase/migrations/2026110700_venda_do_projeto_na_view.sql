-- A "VENDA" DO PROJETO PASSA A SER O QUE FOI CONTRATADO (soma das parcelas) — e a view deixa de vazar o financeiro.
--
-- Problema (relato do Vini, 07/11/2026): dentro do projeto o "Faturamento Bruto (Venda)" não bate com o que foi vendido.
-- Ex.: Alice Blitz & Corretores (orçamento 225) foi vendida por R$ 6.000,00 e a tela mostra R$ 6.053,27.
-- Causa: em 14/08 a fórmula do preço mudou ("custo × (1+margem) × (1+imposto)" → "custo ÷ (1 − margem)") e passou a valer
-- para TODOS os orçamentos, inclusive os já aprovados e faturados; e o `valor_vendido` gravado foi sendo reescrito com o preço
-- ao vivo a cada salvamento. A parcela a receber ficou com o valor da época: é o único número que o cliente recebeu em NF,
-- que não muda quando a fórmula muda e que bate com o caixa.
--
-- Regra nova (uma fonte só): venda = soma das parcelas não canceladas do orçamento (`valor_previsto` quando houver, senão
-- `total_amount`). Se ainda não existe parcela (ou ela está zerada), vale o `valor_vendido` gravado em projetos_financeiro.
-- Como Dashboard, Relatórios, Contas a Receber (coluna Lucro) e as telas de Custos já leem a view, todas passam a mostrar
-- o mesmo número SEM mexer em nenhum dado.
--
-- Mudanças na view vw_rentabilidade:
--   1. `valor_vendido` (e tudo que deriva dele: valor_nf, receita_liquida, lucro_*, margem) passa a ser a venda acima.
--   2. Colunas novas, no fim: `valor_vendido_gravado` (o que está em projetos_financeiro) e `venda_origem` ('parcelas'|'gravado').
--   3. SEGURANÇA (achado B-01): a view era do `postgres`, sem filtro, com SELECT/INSERT/UPDATE/DELETE para `authenticated`:
--      qualquer usuário logado lia o financeiro inteiro (40 linhas pela view, 0 pela tabela). Agora ela só devolve linhas
--      para admin e produção (as mesmas regras da tabela projetos_financeiro) e para o servidor (service_role / conexão direta),
--      e não aceita mais escrita. Não usei `security_invoker` porque `receivables` só é legível por admin: a Produção
--      passaria a ver outro número que o admin. Filtrar o papel dentro da view dá o mesmo número para quem tem acesso.
--
-- Seguro rodar mais de uma vez. Reversão: ver o fim do arquivo.

CREATE OR REPLACE VIEW public.vw_rentabilidade
WITH (security_barrier = true) AS
SELECT
  p.id,
  p.proposta_id,
  p.project_id,
  p.cliente_id,
  p.categoria_id,
  p.tipo_servico_id,
  p.icp,
  v.venda AS valor_vendido,
  p.nf_percent,
  p.custos_total,
  p.data_recebimento_negociada,
  p.status_titulo,
  p.data_recebido,
  p.origem,
  p.pendente_preenchimento,
  p.created_at,
  p.encerrado_em,
  p.encerrado_por,
  p.updated_at,
  round(v.venda * p.nf_percent, 2) AS valor_nf,
  round(v.venda * (1::numeric - p.nf_percent), 2) AS receita_liquida,
  round(v.venda - p.custos_total, 2) AS lucro_operacional,
  round(v.venda * (1::numeric - p.nf_percent) - p.custos_total, 2) AS lucro_liquido,
  CASE
    WHEN v.venda > 0::numeric THEN round((v.venda * (1::numeric - p.nf_percent) - p.custos_total) / v.venda, 4)
    ELSE 0::numeric
  END AS margem,
  (p.status_titulo <> 'pagamento_recebido'::status_titulo AND p.data_recebimento_negociada < CURRENT_DATE) AS vencido,
  p.valor_vendido AS valor_vendido_gravado,
  v.origem AS venda_origem
FROM public.projetos_financeiro p
LEFT JOIN LATERAL (
  SELECT sum(COALESCE(r.valor_previsto, r.total_amount)) AS soma
  FROM public.receivables r
  WHERE r.budget_id = p.proposta_id AND r.status <> 'cancelado'
) pa ON true
CROSS JOIN LATERAL (
  SELECT round(COALESCE(NULLIF(pa.soma, 0), p.valor_vendido, 0), 2)::numeric(12,2) AS venda,
         CASE WHEN COALESCE(pa.soma, 0) > 0 THEN 'parcelas' ELSE 'gravado' END AS origem
) v
WHERE public.get_user_role()::text = ANY (ARRAY['admin', 'producao'])
   OR COALESCE(auth.role(), '') IN ('', 'service_role');

-- Só leitura, só para quem está logado e para o servidor. Fim da escrita pela view.
REVOKE ALL ON public.vw_rentabilidade FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_rentabilidade TO authenticated, service_role;

COMMENT ON VIEW public.vw_rentabilidade IS
  'Rentabilidade por projeto. valor_vendido = soma das parcelas não canceladas (o contratado); sem parcela, o valor gravado em projetos_financeiro. Só admin/produção e servidor leem.';

-- Conferência (somente leitura): quantos projetos usam parcelas e quantos caem no valor gravado.
-- SELECT venda_origem, count(*), sum(valor_vendido) FROM public.vw_rentabilidade GROUP BY 1;

-- ───────────────────────── REVERSÃO (se precisar voltar ao comportamento anterior) ─────────────────────────
-- DROP VIEW public.vw_rentabilidade;
-- CREATE VIEW public.vw_rentabilidade AS
--  SELECT id, proposta_id, project_id, cliente_id, categoria_id, tipo_servico_id, icp, valor_vendido, nf_percent, custos_total,
--         data_recebimento_negociada, status_titulo, data_recebido, origem, pendente_preenchimento, created_at, encerrado_em,
--         encerrado_por, updated_at,
--         round(valor_vendido * nf_percent, 2) AS valor_nf,
--         round(valor_vendido * (1::numeric - nf_percent), 2) AS receita_liquida,
--         round(valor_vendido - custos_total, 2) AS lucro_operacional,
--         round(valor_vendido * (1::numeric - nf_percent) - custos_total, 2) AS lucro_liquido,
--         CASE WHEN valor_vendido > 0::numeric THEN round((valor_vendido * (1::numeric - nf_percent) - custos_total) / valor_vendido, 4) ELSE 0::numeric END AS margem,
--         status_titulo <> 'pagamento_recebido'::status_titulo AND data_recebimento_negociada < CURRENT_DATE AS vencido
--    FROM projetos_financeiro p;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.vw_rentabilidade TO authenticated;  -- (como estava; o ideal é manter só o SELECT)
-- (As colunas novas valor_vendido_gravado e venda_origem somem junto; o front novo cai no valor calculado quando elas não existem.)
