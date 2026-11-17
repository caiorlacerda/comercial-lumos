-- CORREÇÃO DE DADOS (Onda 3). Mostrado antes de aplicar; cada bloco tem a conferência no fim.
-- Só mexe nas linhas citadas pelo id. Seguro rodar mais de uma vez.

-- 1) #279 (SPX Express): a parcela está marcada "recebido" em 10/11 mas com valor R$ 0. Põe o valor real.
UPDATE receivables SET total_amount = 10616.67, received_amount = 10616.67
WHERE id = 'bdc11ca6-f1aa-4b43-ae40-4e4cc4301e44' AND total_amount = 0;

-- 2) #286 e #287: troca a parcela de R$ 0 pelo valor real, mantendo o vencimento que já estava combinado.
UPDATE receivables SET total_amount = 10000.00
WHERE id = '90b710ce-e824-4bca-bdb9-52979b2a0c68' AND total_amount = 0;           -- #286, vence 01/01/2027
UPDATE receivables SET total_amount = 17935.31
WHERE id = 'a0994908-7339-47d9-bd15-e6aa423d7bdf' AND total_amount = 0;           -- #287, vence 15/12/2026

-- 3) #226 (Popeyes): a parcela já está certa (R$ 15.020,18, recebida); só o "valor vendido" gravado do projeto
--    ficou velho (9.284,24). Alinha com o que foi cobrado.
UPDATE projetos_financeiro SET valor_vendido = 15020.18
WHERE id = '40ded017-de5c-4673-98d9-b3534b8fd320';

-- 4) #259 (MIMO | Allianz Arena): aprovado e depois caiu -> cancelado. O vendido (R$ 5.000) sai das somas; os
--    R$ 1.200 de custo continuam. (O orçamento hoje está "reprovado", então o gatilho não dispara: faz aqui.)
UPDATE projetos_financeiro
SET valor_vendido_antes_cancelar = COALESCE(valor_vendido_antes_cancelar, valor_vendido),
    valor_vendido = 0, cancelado_em = COALESCE(cancelado_em, now())
WHERE id = 'e162fe04-b975-43c9-bbcd-e0b1e306cf17';
UPDATE budgets SET status = 'cancelado' WHERE id = 'b523b5a9-075d-4e7e-bad3-99df36189faf';

-- 5) Centavos: parcelas guardam casas longas (ex.: 6000,004528). Arredonda para 2 casas. Exceto o #244, que não se mexe.
UPDATE receivables
SET total_amount = round(total_amount, 2),
    received_amount = round(received_amount, 2),
    valor_previsto = round(valor_previsto, 2)
WHERE (total_amount <> round(total_amount, 2) OR received_amount <> round(received_amount, 2) OR valor_previsto <> round(valor_previsto, 2))
  AND budget_id IS DISTINCT FROM (SELECT id FROM budgets WHERE code = '#2026-244');   -- #244 fica exatamente como está

-- 6) Parcelas antigas sem project_id/origem (menos a do #244): liga ao projeto do mesmo orçamento e marca a origem "proposta".
UPDATE receivables r SET project_id = p.id
FROM projects p WHERE r.project_id IS NULL AND r.budget_id IS NOT NULL AND p.budget_id = r.budget_id
  AND r.budget_id <> (SELECT id FROM budgets WHERE code = '#2026-244');
UPDATE receivables SET origem = 'proposta' WHERE origem IS NULL AND budget_id IS NOT NULL
  AND budget_id <> (SELECT id FROM budgets WHERE code = '#2026-244');

-- CONFERÊNCIA
SELECT b.code, b.status, (SELECT sum(total_amount) FROM receivables r WHERE r.budget_id = b.id AND r.status <> 'cancelado') parcelas,
       (SELECT valor_vendido FROM projetos_financeiro pf WHERE pf.proposta_id = b.id) vendido_gravado
FROM budgets b WHERE right(b.code, 3) IN ('226', '259', '279', '286', '287') ORDER BY 1;
SELECT count(*) FILTER (WHERE project_id IS NULL) sem_projeto, count(*) FILTER (WHERE origem IS NULL) sem_origem,
       count(*) FILTER (WHERE total_amount <> round(total_amount, 2)) decimais_longos FROM receivables;
