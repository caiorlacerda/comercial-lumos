-- APROVAÇÃO PÚBLICA DE ORÇAMENTO, ETAPA 2 DE 2: FECHA A LEITURA ABERTA DO VISITANTE
--
-- Problema confirmado em produção: um visitante com a chave pública do app (ela vai dentro do
-- site) lia TODOS os orçamentos, versões, itens (com preço) e clientes, porque as regras
-- "anon_read_*" liberam a linha quando a versão "tem token", e não quando o token é o do
-- visitante. Todas as versões têm token, então nada era barrado.
--
-- A página /aprovar/:token não precisa dessas regras: ela carrega a proposta pela função
-- get_public_budget_by_token e registra a resposta pela função insert_budget_approval.
-- Desde a etapa 1 (2026103102) ela também não lê mais budget_approvals direto.
--
-- O que esta migration faz: derruba as 6 regras abertas do visitante (nada mais).
--
-- NÃO mexe nas tabelas de jogos (game_state, memoria_state, roleta_state): sem decisão ainda.
-- NÃO mexe em aprovar_orcamento (continua aberta ao visitante; trava vem em passo à parte).
-- ORDEM: rodar SOMENTE depois do deploy do front da etapa 1 (#417) e com a migration
-- 2026103102 já aplicada. Seguro rodar mais de uma vez. Não mexe em dados nem em fórmulas.

-- 0) A equipe continua lendo as respostas de aprovação ------------------------------------
-- O editor de orçamento (BudgetEditorPage) lê budget_approvals logado para mostrar quem
-- aprovou. Não dá para afirmar daqui se existe outra regra de leitura para a equipe nessa
-- tabela ou se a regra aberta do visitante era a única; por isso esta regra explícita nasce
-- ANTES de as abertas caírem. Se já houver outra equivalente, as duas coexistem sem problema.
DO $$
BEGIN
  IF to_regclass('public.budget_approvals') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS equipe_le_aprovacoes ON public.budget_approvals';
    EXECUTE 'CREATE POLICY equipe_le_aprovacoes ON public.budget_approvals FOR SELECT TO authenticated USING (public.is_team())';
  END IF;
END $$;

-- 1) Regras abertas do visitante ---------------------------------------------------------
DO $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('budget_approvals', 'anon_insert_approval'),
      ('budget_approvals', 'anon_read_approval_by_token'),
      ('budget_items',     'anon_read_items_by_public_version'),
      ('budget_versions',  'anon_read_version_by_token'),
      ('budgets',          'anon_read_budget_by_public_version'),
      ('clients',          'anon_read_client_by_public_budget')
    ) AS t(tabela, politica)
  LOOP
    IF to_regclass('public.' || r.tabela) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.politica, r.tabela);
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '% regras abertas do visitante removidas (ou ja ausentes)', n;
END $$;
