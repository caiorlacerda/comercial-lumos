-- custos_total do projeto deixa de ficar velho quando quem mexe nos custos é da Produção.
--
-- Achados B-05/D-03 (pente fino do financeiro, 07/11/2026).
-- O gatilho trigger_sync_project_costs_to_financeiro (função sync_project_costs_to_financeiro) recalcula
-- projetos_financeiro.custos_total a cada INSERT/UPDATE/DELETE em project_costs. Só que a função roda com a permissão de
-- quem fez a alteração, e em projetos_financeiro só o admin tem UPDATE (a Produção só lê). Resultado: quando um usuário
-- de Produção lança, edita ou apaga um custo, o UPDATE é barrado pela RLS SEM dar erro (0 linhas) e o total fica velho —
-- o lucro e a margem do projeto (Dashboard, Relatórios, Custos) saem errados. Hoje são 2 projetos afetados.
--
-- Correção: a função passa a rodar como dono (SECURITY DEFINER, search_path fixo). O cálculo é o mesmo de antes.
-- Depois, recalcula UMA vez os projetos que já estão desatualizados (idempotente: só toca onde o total gravado difere da soma real).
-- Reversão da função: CREATE OR REPLACE sem "SECURITY DEFINER SET search_path" (texto anterior em 2026080200).

CREATE OR REPLACE FUNCTION public.sync_project_costs_to_financeiro()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
  v_budget_id  UUID;
  v_total      NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_project_id := OLD.project_id;
    v_budget_id  := OLD.budget_id;
  ELSE
    v_project_id := NEW.project_id;
    v_budget_id  := NEW.budget_id;
  END IF;

  IF v_budget_id IS NULL AND v_project_id IS NOT NULL THEN
    SELECT budget_id INTO v_budget_id FROM public.projects WHERE id = v_project_id;
  END IF;

  IF v_budget_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM public.project_costs
    WHERE budget_id = v_budget_id
       OR project_id IN (SELECT id FROM public.projects WHERE budget_id = v_budget_id);

    UPDATE public.projetos_financeiro
    SET custos_total = v_total
    WHERE proposta_id = v_budget_id;

  ELSIF v_project_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM public.project_costs
    WHERE project_id = v_project_id;

    UPDATE public.projetos_financeiro
    SET custos_total = v_total
    WHERE project_id = v_project_id;
  END IF;

  RETURN NULL;
END;
$$;

-- Recalcula só os projetos que já estão com o total velho (mesma regra da função).
WITH real AS (
  SELECT pf.id,
         CASE WHEN pf.proposta_id IS NOT NULL THEN
           COALESCE((SELECT SUM(c.amount) FROM public.project_costs c
                     WHERE c.budget_id = pf.proposta_id
                        OR c.project_id IN (SELECT id FROM public.projects WHERE budget_id = pf.proposta_id)), 0)
         ELSE
           COALESCE((SELECT SUM(c.amount) FROM public.project_costs c WHERE c.project_id = pf.project_id), 0)
         END AS total
  FROM public.projetos_financeiro pf
  WHERE pf.proposta_id IS NOT NULL OR pf.project_id IS NOT NULL
)
UPDATE public.projetos_financeiro pf
SET custos_total = real.total
FROM real
WHERE real.id = pf.id
  AND round(real.total, 2) <> round(pf.custos_total, 2);
