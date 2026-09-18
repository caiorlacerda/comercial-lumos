-- Imposto reajusta o preço, só em propostas novas.
--
-- Até aqui, o imposto (nf_pct) era só informativo: saía de dentro da margem
-- pra mostrar o lucro líquido, sem nunca mudar o preço que o cliente paga.
-- Time de comercial pediu o oposto pras próximas propostas: subir o imposto
-- deve reajustar o preço pra sobrar a mesma margem de lucro pretendida — e as
-- propostas que já existem hoje têm que continuar exatamente como estão, pra
-- não bagunçar o que já está sendo acompanhado.
--
-- A escolha de conta trava por proposta, no nascimento da versão, e nunca é
-- recalculada depois — a coluna abaixo é essa trava.
ALTER TABLE public.budget_versions
  ADD COLUMN IF NOT EXISTS imposto_reajusta_preco boolean NOT NULL DEFAULT true;

-- Toda versão que já existe antes desta migration fica travada na conta
-- antiga. Só quem nascer DEPOIS daqui pega o default (true) sozinho.
UPDATE public.budget_versions SET imposto_reajusta_preco = false;

COMMENT ON COLUMN public.budget_versions.imposto_reajusta_preco IS
  'true = o imposto (nf_pct) reajusta o preço pra manter a margem de lucro pretendida: custo / (1 - margem - imposto). false = conta antiga, o imposto é só informativo e não muda o preço. Travado no nascimento da versão (ver calcFinancials em src/utils/financials.ts), nunca recalculado depois.';

-- aprovar_orcamento(): mesma fórmula de preço do app (calcFinancials) — só
-- alterado o cálculo do valor de venda, pra também respeitar
-- imposto_reajusta_preco. O resto da função (projeto, parcelas, financeiro)
-- é idêntico ao que já rodava (migration 2026093311_fase2_elo_receita.sql).
CREATE OR REPLACE FUNCTION public.aprovar_orcamento(p_budget_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b RECORD;
  v_versao RECORD;
  v_custo numeric := 0;
  v_total numeric := 0;
  v_denom numeric;
  v_project uuid;
  v_nf numeric;
  v_cat uuid;
  v_plan text;
  v_dias int;
  v_entrada_pct numeric;
  v_entrada numeric;
  v_criadas int := 0;
BEGIN
  SELECT id, project_name, code, client_id, category, active_version_id, status
    INTO b FROM budgets WHERE id = p_budget_id;
  IF b IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'orcamento_nao_encontrado'); END IF;
  IF b.active_version_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'sem_versao_ativa'); END IF;

  SELECT * INTO v_versao FROM budget_versions WHERE id = b.active_version_id;

  -- valor de venda pela mesma fórmula do app:
  -- conta antiga: custo / (1 - margem) - desconto.
  -- conta nova (imposto_reajusta_preco): custo / (1 - margem - imposto) - desconto.
  SELECT COALESCE(sum(unit_cost * quantity), 0) INTO v_custo
  FROM budget_items WHERE version_id = b.active_version_id;
  IF v_custo > 0 THEN
    IF COALESCE(v_versao.imposto_reajusta_preco, false) THEN
      v_denom := GREATEST(1 - COALESCE(v_versao.margin_pct, 0) - COALESCE(v_versao.nf_pct, 0), 0.05);
    ELSE
      v_denom := GREATEST(1 - COALESCE(v_versao.margin_pct, 0), 0.05);
    END IF;
    v_total := GREATEST(v_custo / v_denom - COALESCE(v_versao.discount_value, 0), 0);
  END IF;

  -- projeto (idempotente)
  SELECT id INTO v_project FROM projects WHERE budget_id = p_budget_id;
  IF v_project IS NULL THEN
    INSERT INTO projects (name, code, budget_id, client_id)
    VALUES (b.project_name, b.code, b.id, b.client_id)
    RETURNING id INTO v_project;
  ELSIF b.code IS NOT NULL THEN
    UPDATE projects SET code = b.code
    WHERE id = v_project AND (code IS NULL OR code IN ('', '----'));
  END IF;

  -- parcelas conforme a condição de pagamento da proposta.
  -- Condição pode não estar definida ainda (acontece: fecha o projeto e o
  -- combinado de pagamento vem depois). Nesse caso nasce UMA parcela com o
  -- valor cheio e SEM vencimento, marcada como "a definir": o dinheiro não
  -- some do radar, e o financeiro define o parcelamento quando souber.
  v_plan := v_versao.payment_plan;   -- null = a definir
  v_dias := COALESCE(v_versao.payment_days, 30);
  v_entrada_pct := COALESCE(v_versao.payment_entry_pct, 50);

  IF v_total > 0 AND NOT EXISTS (SELECT 1 FROM receivables WHERE budget_id = p_budget_id) THEN
    IF v_plan IS NULL THEN
      INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                               total_amount, due_date, status, parcela_numero, parcela_total, origem)
      VALUES (b.id, b.active_version_id, v_project, b.project_name, b.client_id,
              v_total, NULL, 'aguardando', 1, 1, 'proposta');
      v_criadas := 1;
    ELSIF v_plan = 'entrada_saldo' THEN
      v_entrada := round(v_total * v_entrada_pct / 100, 2);
      INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                               total_amount, due_date, status, parcela_numero, parcela_total, origem)
      VALUES
        (b.id, b.active_version_id, v_project, b.project_name || ' · entrada', b.client_id,
         v_entrada, CURRENT_DATE, 'aguardando', 1, 2, 'proposta'),
        (b.id, b.active_version_id, v_project, b.project_name || ' · saldo', b.client_id,
         v_total - v_entrada, CURRENT_DATE + v_dias, 'aguardando', 2, 2, 'proposta');
      v_criadas := 2;
    ELSE
      INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                               total_amount, due_date, status, parcela_numero, parcela_total, origem)
      VALUES (b.id, b.active_version_id, v_project, b.project_name, b.client_id,
              v_total, CURRENT_DATE + v_dias, 'aguardando', 1, 1, 'proposta');
      v_criadas := 1;
    END IF;
  END IF;

  -- registro financeiro do projeto
  SELECT nf_percent INTO v_nf FROM config_financeiro WHERE id = 1;
  SELECT id INTO v_cat FROM categorias
  WHERE lower(nome) = lower(COALESCE(b.category, '')) LIMIT 1;

  IF EXISTS (SELECT 1 FROM projetos_financeiro WHERE proposta_id = p_budget_id) THEN
    UPDATE projetos_financeiro
    SET project_id = v_project, valor_vendido = v_total, updated_at = now()
    WHERE proposta_id = p_budget_id;
  ELSE
    INSERT INTO projetos_financeiro (proposta_id, project_id, cliente_id, categoria_id,
                                     valor_vendido, nf_percent, custos_total, status_titulo,
                                     origem, pendente_preenchimento)
    VALUES (p_budget_id, v_project, b.client_id, v_cat, v_total, COALESCE(v_nf, 0.18), 0,
            'emitir_nf', 'auto_aprovacao', true);
  END IF;

  -- o orçamento fica aprovado no mesmo movimento
  UPDATE budgets SET status = 'aprovado' WHERE id = p_budget_id AND status IS DISTINCT FROM 'aprovado';

  RETURN jsonb_build_object('ok', true, 'project_id', v_project,
                            'valor', v_total, 'parcelas_criadas', v_criadas);
END; $$;
