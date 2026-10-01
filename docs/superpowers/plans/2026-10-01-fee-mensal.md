# Fee Mensal: Cronograma de Pagamento Mês a Mês — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projetos de fee mensal (contrato com fim definido, valor fixo por mês + adendos pontuais) passam a gerar uma conta a receber por mês automaticamente — na proposta (se já souber os números) ou depois, pelo Financeiro — em vez de uma única conta com o valor total do período.

**Architecture:** `payment_plan` em `budget_versions` ganha um terceiro valor (`'fee_mensal'`), com campos próprios pra guardar início/fim/valor/adendos. Uma função SQL nova (`gerar_parcelas_fee_mensal`) sabe transformar esses parâmetros em contas a receber — uma por mês + uma por adendo — e é chamada tanto por `aprovar_orcamento()` (quando a proposta já veio com isso preenchido) quanto por uma RPC nova do Financeiro (`definir_fee_mensal`, pra quando isso só é decidido depois). Cada mês/adendo nasce como uma conta a receber comum, sem tabela nova — o cronograma É o conjunto de contas do projeto.

**Tech Stack:** React + TypeScript (frontend), Postgres/plpgsql (funções e trigger), `@react-pdf/renderer` (PDF).

**Spec:** [docs/superpowers/specs/2026-10-01-fee-mensal-design.md](../specs/2026-10-01-fee-mensal-design.md)

## Decisões de produto tomadas durante o planejamento (fora da spec)

A spec não fixou alguns detalhes de implementação — as decisões abaixo foram
feitas pra fechar o plano, e vale o Caio conferir se concordam com a
intenção:

1. **Dia do vencimento de cada mês:** todo mês vira uma conta com vencimento
   no dia 1 daquele mês (`date_trunc('month', ...)`). A spec não especificou
   um dia exato.
2. **Valor vendido (`projetos_financeiro.valor_vendido`) pra projeto fee
   mensal:** em vez da fórmula de margem (que não faz sentido pra um
   contrato de valor fixo recorrente), passa a ser a soma do cronograma
   inteiro (valor mensal × quantidade de meses + soma dos adendos). Isso é
   usado nos relatórios financeiros (Custos de Projeto, Dashboard) como "o
   que esse projeto vale".
3. **`handleSaveAsTemplate` (criar um molde reaproveitável de proposta) NÃO
   copia os campos de fee mensal pro template.** Um template é pra várias
   propostas futuras de clientes diferentes — carregar datas e valores de UM
   contrato específico pra dentro dele seria um bug, não uma conveniência.
4. **Formato dos inputs de mês na tela:** `<input type="month">` (nativo do
   navegador, formato `AAAA-MM`), convertido pro primeiro dia do mês
   (`AAAA-MM-01`) antes de gravar — não existe um seletor de mês customizado
   no design system hoje, e o nativo já resolve bem.

## Global Constraints

- Este projeto não tem framework de teste automatizado — a verificação de
  cada tarefa é `npx tsc --noEmit` (frontend) e teste manual (navegador /
  SQL Editor do Supabase), igual ao resto do projeto.
- **SQL é sempre rodado à mão pelo Caio, nunca pela IA** — as Tarefas 1 e 2
  terminam com a migration pronta em arquivo; rodar contra o banco é um
  passo manual dele. **A Tarefa 1 tem que ser aplicada por ele ANTES da
  Tarefa 2** (a migration da Tarefa 2 usa colunas que só existem depois da
  Tarefa 1 rodar) — isso é sobre ORDEM DE APLICAÇÃO no banco, não sobre
  ordem de implementação do código (as duas podem ser implementadas e
  commitadas em sequência normalmente).
- Não alterar nada além do que cada tarefa pede (regra do `CLAUDE.md`: nada
  de refactor de oportunidade).
- Usar sempre os tokens `lumos-*` do Tailwind já usados nos arquivos
  tocados — nunca cor crua.
- Terminar cada tarefa de frontend com `npx tsc --noEmit` limpo (mesma
  baseline de 10 erros pré-existentes e não relacionados — módulos faltando
  de `@tiptap/extension-mention`, `hls.js`, `pdfjs-dist`, e dois
  `implicit any` em `ProjectNotes.tsx`/`useVideoFonte.ts`) antes de seguir.

---

## Task 1: Migration — schema de fee mensal em `budget_versions`

**Files:**
- Create: `supabase/migrations/2026093357_fee_mensal_schema.sql`

**Interfaces:**
- Produces: `budget_versions.payment_plan` aceita também `'fee_mensal'`;
  colunas novas `fee_mensal_inicio date`, `fee_mensal_fim date`,
  `fee_mensal_valor numeric`, `fee_mensal_adendos jsonb` (default `'[]'`),
  `fee_mensal_mostrar_na_proposta boolean` (default `false`).

- [ ] **Step 1: Escrever a migration**

```sql
-- Fee mensal: projetos recorrentes (ex.: contrato semestral com valor fixo
-- por mês e adendos pontuais) ganham reconhecimento próprio na proposta.
-- Hoje não existe NENHUM lugar que registre "este projeto é fee mensal" —
-- nem na proposta, nem depois. payment_plan ganha um terceiro valor; os
-- campos abaixo guardam o que foi proposto (início, fim, valor mensal,
-- adendos) e se isso deve aparecer no PDF. Tudo opcional — não afeta
-- nenhuma proposta existente.
ALTER TABLE public.budget_versions
  ADD COLUMN IF NOT EXISTS fee_mensal_inicio date,
  ADD COLUMN IF NOT EXISTS fee_mensal_fim date,
  ADD COLUMN IF NOT EXISTS fee_mensal_valor numeric,
  ADD COLUMN IF NOT EXISTS fee_mensal_adendos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fee_mensal_mostrar_na_proposta boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.budget_versions.fee_mensal_adendos IS
  'Lista de valores extras pontuais por mês: [{"mes": "2026-09", "valor": 50000}, ...]. Vazio quando o contrato só tem o fixo mensal.';

-- payment_plan passa a aceitar também 'fee_mensal', além de a_vista/entrada_saldo.
ALTER TABLE public.budget_versions DROP CONSTRAINT IF EXISTS chk_payment_plan;
ALTER TABLE public.budget_versions ADD CONSTRAINT chk_payment_plan
  CHECK (payment_plan IS NULL OR payment_plan IN ('a_vista', 'entrada_saldo', 'fee_mensal')) NOT VALID;

-- Conferência: as colunas novas têm que aparecer, e a regra tem que listar os três planos.
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'budget_versions'
  AND column_name IN ('fee_mensal_inicio', 'fee_mensal_fim', 'fee_mensal_valor', 'fee_mensal_adendos', 'fee_mensal_mostrar_na_proposta')
ORDER BY column_name;
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_payment_plan';
```

- [ ] **Step 2: Handoff pro Caio**

Cole o SQL acima na mensagem pro Caio rodar no SQL Editor do Supabase (nunca
execute você mesmo). O resultado da primeira conferência tem que trazer as
5 colunas; o da segunda tem que mostrar `IN ('a_vista', 'entrada_saldo',
'fee_mensal')` na regra.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026093357_fee_mensal_schema.sql
git commit -m "feat: adiciona schema de fee mensal em budget_versions"
```

---

## Task 2: SQL — gerador de parcelas, RPCs do Financeiro, aprovação e trigger

**Files:**
- Create: `supabase/migrations/2026093358_fee_mensal_funcoes.sql`

**Interfaces:**
- Consumes: colunas da Tarefa 1 (precisam já estar aplicadas no banco antes
  de rodar esta migration — ver Global Constraints).
- Produces:
  - `public.gerar_parcelas_fee_mensal(p_budget_id uuid, p_versao_id uuid, p_project_id uuid, p_client_id uuid, p_nome text, p_inicio date, p_fim date, p_valor numeric, p_adendos jsonb) RETURNS int` — gera as contas a receber; retorna quantas criou.
  - `public.definir_fee_mensal(p_budget_id uuid, p_inicio date, p_fim date, p_valor numeric, p_adendos jsonb DEFAULT '[]'::jsonb) RETURNS jsonb` — chamado pelo Financeiro pra configurar do zero. Retorna `{ok: true, parcelas_criadas: int}` ou `{ok: false, error: 'periodo_invalido'|'valor_invalido'|'orcamento_nao_encontrado'|'nada_gerado'}`.
  - `public.adicionar_parcela_fee_mensal(p_budget_id uuid, p_mes date, p_valor numeric, p_eh_adendo boolean DEFAULT false) RETURNS jsonb` — adiciona UMA conta nova (adendo num mês existente, ou mês novo no fim). Retorna `{ok: true}` ou `{ok: false, error: 'valor_invalido'|'orcamento_nao_encontrado'}`.
  - `aprovar_orcamento()` com um terceiro caminho pra `payment_plan = 'fee_mensal'`.
  - `fn_versao_reajusta_parcelas()` ignora projetos com `payment_plan = 'fee_mensal'`.

- [ ] **Step 1: Escrever a migration completa**

```sql
-- Fee mensal: gera uma conta a receber por mês (+ uma por adendo) em vez de
-- uma conta só com o valor total do período. A geração mora numa função só
-- (gerar_parcelas_fee_mensal), reaproveitada pela aprovação do orçamento E
-- pela tela do Financeiro — nunca duas lógicas que podem divergir.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) O gerador — uma conta por mês + uma por adendo
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gerar_parcelas_fee_mensal(
  p_budget_id   uuid,
  p_versao_id   uuid,
  p_project_id  uuid,
  p_client_id   uuid,
  p_nome        text,
  p_inicio      date,
  p_fim         date,
  p_valor       numeric,
  p_adendos     jsonb
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mes        date;
  v_criadas    int := 0;
  v_prox       int;
  v_adendo     jsonb;
  v_mes_adendo date;
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR COALESCE(p_valor, 0) <= 0 THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(max(parcela_numero), 0) INTO v_prox
  FROM receivables WHERE budget_id = p_budget_id;

  -- uma conta por mês, vencimento no dia 1
  v_mes := date_trunc('month', p_inicio)::date;
  WHILE v_mes <= p_fim LOOP
    v_prox := v_prox + 1;
    INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                             total_amount, due_date, status, parcela_numero, parcela_total, origem)
    VALUES (p_budget_id, p_versao_id, p_project_id,
            p_nome || ' · ' || to_char(v_mes, 'MM/YYYY'), p_client_id,
            p_valor, v_mes, 'aguardando', v_prox, v_prox, 'fee_mensal');
    v_criadas := v_criadas + 1;
    v_mes := (v_mes + interval '1 month')::date;
  END LOOP;

  -- uma conta extra por adendo, no mês certo
  FOR v_adendo IN SELECT * FROM jsonb_array_elements(COALESCE(p_adendos, '[]'::jsonb))
  LOOP
    v_mes_adendo := to_date(v_adendo->>'mes', 'YYYY-MM');
    v_prox := v_prox + 1;
    INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                             total_amount, due_date, status, parcela_numero, parcela_total, origem)
    VALUES (p_budget_id, p_versao_id, p_project_id,
            p_nome || ' · ' || to_char(v_mes_adendo, 'MM/YYYY') || ' · Adendo', p_client_id,
            (v_adendo->>'valor')::numeric, v_mes_adendo, 'aguardando', v_prox, v_prox, 'fee_mensal');
    v_criadas := v_criadas + 1;
  END LOOP;

  -- parcela_total final: só nas linhas desta geração, pro total real
  UPDATE receivables SET parcela_total = v_prox
  WHERE budget_id = p_budget_id AND origem = 'fee_mensal';

  RETURN v_criadas;
END; $$;

GRANT EXECUTE ON FUNCTION public.gerar_parcelas_fee_mensal(uuid, uuid, uuid, uuid, text, date, date, numeric, jsonb) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Financeiro configura do zero (quando não veio pronto da proposta)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.definir_fee_mensal(
  p_budget_id uuid,
  p_inicio    date,
  p_fim       date,
  p_valor     numeric,
  p_adendos   jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b RECORD;
  v_criadas int;
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RETURN jsonb_build_object('ok', false, 'error', 'periodo_invalido');
  END IF;
  IF COALESCE(p_valor, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'valor_invalido');
  END IF;

  SELECT id, project_name, client_id, active_version_id INTO b FROM budgets WHERE id = p_budget_id;
  IF b IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'orcamento_nao_encontrado'); END IF;

  -- some com as parcelas ainda intocadas; o que teve recebimento permanece
  -- (mesma regra de ouro do definir_parcelamento)
  DELETE FROM receivables
  WHERE budget_id = p_budget_id AND COALESCE(received_amount, 0) = 0 AND status <> 'cancelado';

  v_criadas := public.gerar_parcelas_fee_mensal(
    b.id, b.active_version_id, (SELECT id FROM projects WHERE budget_id = b.id), b.client_id,
    b.project_name, p_inicio, p_fim, p_valor, p_adendos
  );

  IF v_criadas = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nada_gerado');
  END IF;

  UPDATE budget_versions
  SET payment_plan = 'fee_mensal',
      fee_mensal_inicio = p_inicio, fee_mensal_fim = p_fim,
      fee_mensal_valor = p_valor, fee_mensal_adendos = COALESCE(p_adendos, '[]'::jsonb)
  WHERE id = b.active_version_id;

  RETURN jsonb_build_object('ok', true, 'parcelas_criadas', v_criadas);
END; $$;

GRANT EXECUTE ON FUNCTION public.definir_fee_mensal(uuid, date, date, numeric, jsonb) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Acrescentar UMA conta a um cronograma que já existe (adendo novo, ou
--    estender o contrato com mais um mês) — nunca mexe no que já estava lá.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adicionar_parcela_fee_mensal(
  p_budget_id uuid,
  p_mes       date,
  p_valor     numeric,
  p_eh_adendo boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b      RECORD;
  v_prox int;
  v_mes  date := date_trunc('month', p_mes)::date;
  v_desc text;
BEGIN
  IF COALESCE(p_valor, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'valor_invalido');
  END IF;

  SELECT id, project_name, client_id, active_version_id INTO b FROM budgets WHERE id = p_budget_id;
  IF b IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'orcamento_nao_encontrado'); END IF;

  SELECT COALESCE(max(parcela_numero), 0) + 1 INTO v_prox FROM receivables WHERE budget_id = p_budget_id;
  v_desc := b.project_name || ' · ' || to_char(v_mes, 'MM/YYYY') || CASE WHEN p_eh_adendo THEN ' · Adendo' ELSE '' END;

  INSERT INTO receivables (budget_id, budget_version_id, project_id, description, client_id,
                           total_amount, due_date, status, parcela_numero, parcela_total, origem)
  VALUES (b.id, b.active_version_id, (SELECT id FROM projects WHERE budget_id = b.id), v_desc, b.client_id,
          p_valor, v_mes, 'aguardando', v_prox, v_prox, 'fee_mensal');

  UPDATE receivables SET parcela_total = v_prox WHERE budget_id = p_budget_id AND origem = 'fee_mensal';

  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.adicionar_parcela_fee_mensal(uuid, date, numeric, boolean) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) aprovar_orcamento() ganha o terceiro caminho
-- ───────────────────────────────────────────────────────────────────────────
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
  v_adendo jsonb;
BEGIN
  SELECT id, project_name, code, client_id, category, active_version_id, status
    INTO b FROM budgets WHERE id = p_budget_id;
  IF b IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'orcamento_nao_encontrado'); END IF;
  IF b.active_version_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'sem_versao_ativa'); END IF;

  SELECT * INTO v_versao FROM budget_versions WHERE id = b.active_version_id;
  v_plan := v_versao.payment_plan;

  IF v_plan = 'fee_mensal' THEN
    -- fee mensal: o valor vendido é a soma do cronograma (fixo × meses +
    -- adendos) — é o que foi contratado de verdade, não a fórmula de
    -- margem (que não se aplica a um valor fixo recorrente).
    v_total := COALESCE(v_versao.fee_mensal_valor, 0) * GREATEST(
      (extract(year from v_versao.fee_mensal_fim)::int - extract(year from v_versao.fee_mensal_inicio)::int) * 12
      + (extract(month from v_versao.fee_mensal_fim)::int - extract(month from v_versao.fee_mensal_inicio)::int) + 1,
      0);
    FOR v_adendo IN SELECT * FROM jsonb_array_elements(COALESCE(v_versao.fee_mensal_adendos, '[]'::jsonb))
    LOOP
      v_total := v_total + COALESCE((v_adendo->>'valor')::numeric, 0);
    END LOOP;
  ELSE
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
  v_dias := COALESCE(v_versao.payment_days, 30);
  v_entrada_pct := COALESCE(v_versao.payment_entry_pct, 50);

  IF v_total > 0 AND NOT EXISTS (SELECT 1 FROM receivables WHERE budget_id = p_budget_id) THEN
    IF v_plan = 'fee_mensal' THEN
      v_criadas := public.gerar_parcelas_fee_mensal(
        b.id, b.active_version_id, v_project, b.client_id, b.project_name,
        v_versao.fee_mensal_inicio, v_versao.fee_mensal_fim,
        v_versao.fee_mensal_valor, v_versao.fee_mensal_adendos
      );
    ELSIF v_plan IS NULL THEN
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
  WHERE lower(nome) = lower(b.category::text) LIMIT 1;

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

-- ───────────────────────────────────────────────────────────────────────────
-- 5) O gatilho que redistribui em partes iguais passa a ignorar fee mensal
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_versao_reajusta_parcelas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_budget uuid;
  v_custo numeric := 0;
  v_total numeric := 0;
  v_abertas int;
  v_recebido numeric;
BEGIN
  -- Fee mensal nunca é redistribuído sozinho: se o preço mudar de verdade,
  -- quem ajusta o cronograma é o Financeiro, na mão.
  IF NEW.payment_plan = 'fee_mensal' THEN RETURN NEW; END IF;

  SELECT id INTO v_budget FROM budgets WHERE active_version_id = NEW.id AND status = 'aprovado';
  IF v_budget IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(sum(unit_cost * quantity), 0) INTO v_custo FROM budget_items WHERE version_id = NEW.id;
  IF v_custo > 0 AND COALESCE(NEW.margin_pct, 0) < 1 THEN
    v_total := GREATEST(v_custo / (1 - COALESCE(NEW.margin_pct, 0)) - COALESCE(NEW.discount_value, 0), 0);
  END IF;
  IF v_total <= 0 THEN RETURN NEW; END IF;

  SELECT count(*), COALESCE(sum(received_amount), 0) INTO v_abertas, v_recebido
  FROM receivables WHERE budget_id = v_budget AND received_amount < total_amount AND status <> 'cancelado';

  IF v_abertas > 0 AND v_total > v_recebido THEN
    UPDATE receivables
    SET total_amount = round((v_total - v_recebido) / v_abertas, 2),
        budget_version_id = NEW.id,
        notes = COALESCE(notes || E'\n', '') || 'Valor ajustado em ' || to_char(now(), 'DD/MM/YYYY') || ' (proposta editada).',
        updated_at = now()
    WHERE budget_id = v_budget AND received_amount < total_amount AND status <> 'cancelado';
  END IF;

  RETURN NEW;
END; $$;

-- Conferência: as três funções novas têm que existir, e aprovar_orcamento/
-- fn_versao_reajusta_parcelas têm que estar com a definição atualizada
-- (procure 'fee_mensal' no corpo — tem que aparecer nas duas).
SELECT proname FROM pg_proc
WHERE proname IN ('gerar_parcelas_fee_mensal', 'definir_fee_mensal', 'adicionar_parcela_fee_mensal')
ORDER BY proname;
SELECT pg_get_functiondef('public.aprovar_orcamento(uuid)'::regprocedure) ILIKE '%fee_mensal%' AS aprovar_orcamento_atualizada;
SELECT pg_get_functiondef('public.fn_versao_reajusta_parcelas()'::regprocedure) ILIKE '%fee_mensal%' AS trigger_atualizado;
```

- [ ] **Step 2: Handoff pro Caio**

Cole o SQL acima na mensagem pro Caio rodar no SQL Editor do Supabase —
**só depois de ele já ter rodado a migration da Tarefa 1**. As três
conferências no final têm que voltar: as três funções listadas, e
`aprovar_orcamento_atualizada = true` / `trigger_atualizado = true`.

Depois disso, peça pra ele rodar estas duas verificações extras (ainda sem
UI nenhuma pronta — testam só o banco):

```sql
-- 1) Simula uma proposta de fee mensal e aprova, sem passar pela tela
-- (troque <BUDGET_ID> por uma proposta de teste qualquer, ainda não aprovada).
UPDATE budget_versions
SET payment_plan = 'fee_mensal',
    fee_mensal_inicio = '2026-08-01', fee_mensal_fim = '2026-12-01',
    fee_mensal_valor = 40000,
    fee_mensal_adendos = '[{"mes":"2026-09","valor":50000},{"mes":"2026-11","valor":48864.07}]'::jsonb
WHERE id = (SELECT active_version_id FROM budgets WHERE id = '<BUDGET_ID>');

SELECT public.aprovar_orcamento('<BUDGET_ID>');

-- Tem que aparecer 7 linhas: 5 meses (ago-dez, R$40.000 cada) + 2 adendos
-- (set R$50.000, nov R$48.864,07), todo mundo com due_date no dia 1 do mês certo.
SELECT description, due_date, total_amount FROM receivables
WHERE budget_id = '<BUDGET_ID>' ORDER BY due_date, description;

-- 2) Prova que editar margem/desconto NÃO redistribui fee mensal (o ponto
-- mais perigoso deste plano). Anota os total_amount de cima, roda:
UPDATE budget_versions SET discount_value = 100
WHERE id = (SELECT active_version_id FROM budgets WHERE id = '<BUDGET_ID>');

-- Os total_amount têm que estar EXATAMENTE iguais aos de antes — nada mudou.
SELECT description, due_date, total_amount FROM receivables
WHERE budget_id = '<BUDGET_ID>' ORDER BY due_date, description;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026093358_fee_mensal_funcoes.sql
git commit -m "feat: gera cronograma de fee mensal na aprovacao e no financeiro"
```

---

## Task 3: Frontend — proposta (`BudgetEditorPage.tsx` + `financials.ts`)

**Files:**
- Modify: `src/utils/financials.ts`
- Modify: `src/pages/BudgetEditorPage.tsx`

**Interfaces:**
- Produces: `BudgetVersion.payment_plan` passa a aceitar `'fee_mensal'`;
  novos campos `fee_mensal_inicio?: string | null`, `fee_mensal_fim?: string
  | null`, `fee_mensal_valor?: number | null`, `fee_mensal_adendos?: {
  mes: string; valor: number }[]`, `fee_mensal_mostrar_na_proposta?:
  boolean`. Task 5 (PDF) consome esses mesmos nomes de campo.

- [ ] **Step 1: Estender a interface `BudgetVersion`**

Em `src/utils/financials.ts`, modificar o trecho (linhas 36-39 hoje):

```typescript
  /** Como o cliente paga (Fase 2): gera as parcelas na aprovação. */
  payment_plan?: 'a_vista' | 'entrada_saldo' | null;
  payment_days?: number | null;
  payment_entry_pct?: number | null;
```

para:

```typescript
  /** Como o cliente paga (Fase 2): gera as parcelas na aprovação. */
  payment_plan?: 'a_vista' | 'entrada_saldo' | 'fee_mensal' | null;
  payment_days?: number | null;
  payment_entry_pct?: number | null;
  /** Fee mensal: contrato recorrente com fim definido, valor fixo por mês
   *  e adendos pontuais. Preenchido só quando payment_plan = 'fee_mensal'. */
  fee_mensal_inicio?: string | null;
  fee_mensal_fim?: string | null;
  fee_mensal_valor?: number | null;
  fee_mensal_adendos?: { mes: string; valor: number }[];
  fee_mensal_mostrar_na_proposta?: boolean;
```

- [ ] **Step 2: Rodar tsc pra conferir que o tipo novo compila**

Run: `npx tsc --noEmit`
Expected: sem erro novo (mesma baseline de 10 erros pré-existentes).

- [ ] **Step 3: Persistir os campos novos nos 3 lugares que salvam a proposta de verdade**

Em `src/pages/BudgetEditorPage.tsx`, há 4 lugares que fazem insert/update de
`budget_versions` com uma lista explícita de campos (procure por
`notes_client: version`). Adicionar os 5 campos novos em **3 deles**
(dentro de `handleSave` e `handleNewVersion`) — e **propositalmente NÃO**
no quarto (`handleSaveAsTemplate`, ver decisão de produto no topo deste
plano).

**3a. Dentro de `handleSave`, no insert de versão nova** (por volta da
linha 500-516 hoje):

```typescript
        const { data: vData, error: vError } = await supabase
          .from('budget_versions')
          .insert({
            budget_id: currentBudgetId,
            contact_id: version.contact_id || null,
            version_number: 1,
            margin_pct: version.margin_pct,
            nf_pct: version.nf_pct,
            discount_value: version.discount_value,
            notes_internal: version.notes_internal,
            notes_client: version.notes_client,
            payment_terms: version.payment_terms,
            validity_days: version.validity_days,
            logistics_date: version.logistics_date || null,
            logistics_time: version.logistics_time || null,
            logistics_location: version.logistics_location || null,
            payment_plan: version.payment_plan || null,
            fee_mensal_inicio: version.fee_mensal_inicio || null,
            fee_mensal_fim: version.fee_mensal_fim || null,
            fee_mensal_valor: version.fee_mensal_valor || null,
            fee_mensal_adendos: version.fee_mensal_adendos || [],
            fee_mensal_mostrar_na_proposta: version.fee_mensal_mostrar_na_proposta || false
          })
          .select()
          .single();
```

**3b. Dentro de `handleSave`, no update de versão existente** (por volta da
linha 541-553 hoje):

```typescript
          supabase.from('budget_versions').update({
            contact_id: version.contact_id || null,
            margin_pct: version.margin_pct,
            nf_pct: version.nf_pct,
            discount_value: version.discount_value,
            notes_internal: version.notes_internal,
            notes_client: version.notes_client,
            payment_terms: version.payment_terms,
            validity_days: version.validity_days,
            logistics_date: version.logistics_date || null,
            logistics_time: version.logistics_time || null,
            logistics_location: version.logistics_location || null,
            payment_plan: version.payment_plan || null,
            fee_mensal_inicio: version.fee_mensal_inicio || null,
            fee_mensal_fim: version.fee_mensal_fim || null,
            fee_mensal_valor: version.fee_mensal_valor || null,
            fee_mensal_adendos: version.fee_mensal_adendos || [],
            fee_mensal_mostrar_na_proposta: version.fee_mensal_mostrar_na_proposta || false
          }).eq('id', version.id),
```

**3c. Dentro de `handleNewVersion`** (por volta da linha 645-664 hoje) —
herda da versão anterior, igual já acontece com `imposto_reajusta_preco`:

```typescript
      const { data: newV, error: vError } = await supabase
        .from('budget_versions')
        .insert({
          budget_id: budget.id,
          version_number: nextNumber,
          margin_pct: version.margin_pct,
          nf_pct: version.nf_pct,
          discount_value: version.discount_value,
          notes_internal: version.notes_internal,
          notes_client: version.notes_client,
          payment_terms: version.payment_terms,
          validity_days: version.validity_days,
          logistics_date: version.logistics_date || null,
          logistics_time: version.logistics_time || null,
          logistics_location: version.logistics_location || null,
          // Nova versão da MESMA proposta herda a conta da versão anterior —
          // só proposta nova de verdade (nasce sem isso, cai no default do
          // banco) ganha a conta nova sozinha.
          imposto_reajusta_preco: version.imposto_reajusta_preco === true,
          payment_plan: version.payment_plan || null,
          fee_mensal_inicio: version.fee_mensal_inicio || null,
          fee_mensal_fim: version.fee_mensal_fim || null,
          fee_mensal_valor: version.fee_mensal_valor || null,
          fee_mensal_adendos: version.fee_mensal_adendos || [],
          fee_mensal_mostrar_na_proposta: version.fee_mensal_mostrar_na_proposta || false
        })
        .select()
        .single();
```

- [ ] **Step 4: Adicionar a seção "Fee mensal" na tela**

Em `src/pages/BudgetEditorPage.tsx`, logo depois do bloco que fecha a seção
de "Briefing & Condições" e antes do mapeamento dos grupos de item — ancore
pelo texto exato (linhas 1619-1625 hoje):

```typescript
                  </div>
                </div>
              </div>
            </div>
          </div>

          {(['equipe', 'equipamentos', 'producao', 'edicao'] as const).map(group => {
```

Inserir um novo bloco entre a penúltima e a última linha acima (ou seja,
logo antes do `{(['equipe', ...`):

```typescript
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <input
                type="checkbox"
                id="fee-mensal-toggle"
                disabled={isReadOnly}
                checked={version?.payment_plan === 'fee_mensal'}
                onChange={(e) => {
                  if (e.target.checked) {
                    setVersion(vv => vv ? { ...vv, payment_plan: 'fee_mensal' } : null);
                  } else {
                    setVersion(vv => vv ? { ...vv, payment_plan: null, fee_mensal_inicio: null, fee_mensal_fim: null, fee_mensal_valor: null, fee_mensal_adendos: [] } : null);
                  }
                  isDirty.current = true;
                }}
                className="w-4 h-4"
              />
              <label htmlFor="fee-mensal-toggle" className="font-bold text-sm text-lumos-text-primary cursor-pointer">
                Este projeto é fee mensal?
              </label>
            </div>
            {version?.payment_plan === 'fee_mensal' && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block">Início</label>
                    <input
                      type="month" disabled={isReadOnly}
                      className="input-lumos w-full text-xs disabled:opacity-70"
                      value={version?.fee_mensal_inicio ? version.fee_mensal_inicio.slice(0, 7) : ''}
                      onChange={(e) => {
                        setVersion(vv => vv ? { ...vv, fee_mensal_inicio: e.target.value ? `${e.target.value}-01` : null } : null);
                        isDirty.current = true;
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block">Fim</label>
                    <input
                      type="month" disabled={isReadOnly}
                      className="input-lumos w-full text-xs disabled:opacity-70"
                      value={version?.fee_mensal_fim ? version.fee_mensal_fim.slice(0, 7) : ''}
                      onChange={(e) => {
                        setVersion(vv => vv ? { ...vv, fee_mensal_fim: e.target.value ? `${e.target.value}-01` : null } : null);
                        isDirty.current = true;
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-2 block">Valor mensal fixo</label>
                    <input
                      type="number" min={0} disabled={isReadOnly}
                      className="input-lumos w-full text-xs disabled:opacity-70"
                      value={version?.fee_mensal_valor || ''}
                      onChange={(e) => {
                        setVersion(vv => vv ? { ...vv, fee_mensal_valor: Number(e.target.value) || 0 } : null);
                        isDirty.current = true;
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase block">Adendos pontuais (opcional)</label>
                  {(version?.fee_mensal_adendos || []).map((ad, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="month" disabled={isReadOnly}
                        className="input-lumos text-xs disabled:opacity-70"
                        value={ad.mes}
                        onChange={(e) => {
                          const next = [...(version?.fee_mensal_adendos || [])];
                          next[idx] = { ...next[idx], mes: e.target.value };
                          setVersion(vv => vv ? { ...vv, fee_mensal_adendos: next } : null);
                          isDirty.current = true;
                        }}
                      />
                      <input
                        type="number" min={0} disabled={isReadOnly} placeholder="Valor"
                        className="input-lumos w-32 text-xs disabled:opacity-70"
                        value={ad.valor || ''}
                        onChange={(e) => {
                          const next = [...(version?.fee_mensal_adendos || [])];
                          next[idx] = { ...next[idx], valor: Number(e.target.value) || 0 };
                          setVersion(vv => vv ? { ...vv, fee_mensal_adendos: next } : null);
                          isDirty.current = true;
                        }}
                      />
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = (version?.fee_mensal_adendos || []).filter((_, i) => i !== idx);
                            setVersion(vv => vv ? { ...vv, fee_mensal_adendos: next } : null);
                            isDirty.current = true;
                          }}
                          className="text-red-500 text-xs font-bold"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  ))}
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...(version?.fee_mensal_adendos || []), { mes: '', valor: 0 }];
                        setVersion(vv => vv ? { ...vv, fee_mensal_adendos: next } : null);
                        isDirty.current = true;
                      }}
                      className="text-[11px] font-bold text-lumos-yellow"
                    >
                      + Adicionar adendo
                    </button>
                  )}
                </div>

                <label className="flex items-center gap-2 text-xs text-lumos-text-secondary">
                  <input
                    type="checkbox" disabled={isReadOnly}
                    checked={!!version?.fee_mensal_mostrar_na_proposta}
                    onChange={(e) => {
                      setVersion(vv => vv ? { ...vv, fee_mensal_mostrar_na_proposta: e.target.checked } : null);
                      isDirty.current = true;
                    }}
                  />
                  Mostrar essa divisão no PDF da proposta
                </label>
              </div>
            )}
          </div>

```

- [ ] **Step 5: Rodar tsc de novo**

Run: `npx tsc --noEmit`
Expected: mesma baseline de 10 erros, nenhum novo em `BudgetEditorPage.tsx`
nem em `financials.ts`.

- [ ] **Step 6: Teste manual**

Abrir uma proposta, marcar "Este projeto é fee mensal?", preencher início,
fim e valor, adicionar um adendo, salvar, recarregar a página e conferir
que tudo continua preenchido. Desmarcar o checkbox e conferir que os campos
somem e salvam como vazios.

- [ ] **Step 7: Commit**

```bash
git add src/utils/financials.ts src/pages/BudgetEditorPage.tsx
git commit -m "feat: secao de fee mensal na proposta, com dados persistidos"
```

---

## Task 4: Frontend — Financeiro (`ParcelamentoModal.tsx`)

**Files:**
- Modify: `src/components/financeiro/ParcelamentoModal.tsx` (reescrita completa do arquivo — ele tem ~185 linhas e quase todo o conteúdo muda)

**Interfaces:**
- Consumes: RPCs `definir_fee_mensal` e `adicionar_parcela_fee_mensal` da Tarefa 2 (exatos nomes de parâmetro usados acima).
- Produces: nenhuma interface nova consumida por outra tarefa — é a ponta final da cadeia.

- [ ] **Step 1: Reescrever o arquivo inteiro**

```typescript
import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';

/**
 * PARCELAMENTO — mora no Financeiro de propósito: o comercial fecha a venda,
 * e o combinado de pagamento costuma vir depois. Enquanto não vem, a proposta
 * aprovada fica com uma parcela única "a definir" (valor cheio, sem
 * vencimento), então o dinheiro nunca some do radar.
 *
 * Regra de ouro: parcela que JÁ teve recebimento não é tocada. O plano novo
 * distribui apenas o saldo em aberto.
 *
 * Fee mensal é o terceiro plano: em vez de 1 ou 2 parcelas, gera uma conta
 * por mês (do início ao fim) mais uma por adendo pontual. Se o projeto já
 * tem fee mensal configurado (veio da proposta, ou já foi definido aqui
 * antes), a janela mostra a divisão mês a mês em vez do formulário de
 * configurar do zero, com um jeito de adicionar um adendo novo ou estender
 * o contrato — nunca mexendo no que já existe.
 */

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const brData = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const somaDias = (base: string, dias: number) => {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const mesLabel = (isoAnoMes: string) => {
  const [y, m] = isoAnoMes.split('-');
  return `${MESES[Number(m) - 1]}/${y}`;
};

interface Props {
  budgetId: string;
  nomeProjeto?: string;
  onClose: () => void;
  onDone?: () => void;
}

interface MesFeeMensal { due_date: string; fixo: number; adendo: number }

export default function ParcelamentoModal({ budgetId, nomeProjeto, onClose, onDone }: Props) {
  const toast = useToast();
  const [plano, setPlano] = useState<'a_vista' | 'entrada_saldo' | 'fee_mensal'>('a_vista');
  const [dias, setDias] = useState(30);
  const [entradaPct, setEntradaPct] = useState(50);
  const [base, setBase] = useState(() => new Date().toISOString().slice(0, 10));
  const [salvando, setSalvando] = useState(false);
  const [resumo, setResumo] = useState<{ total: number; recebido: number; saldo: number } | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);

  // Fee mensal — configurar do zero
  const [fmInicio, setFmInicio] = useState('');
  const [fmFim, setFmFim] = useState('');
  const [fmValor, setFmValor] = useState(0);
  const [fmAdendos, setFmAdendos] = useState<{ mes: string; valor: number }[]>([]);

  // Fee mensal — já configurado: a divisão real, vinda das contas a receber
  const [fmMeses, setFmMeses] = useState<MesFeeMensal[] | null>(null);
  const [fmNovoAdendoMes, setFmNovoAdendoMes] = useState('');
  const [fmNovoAdendoValor, setFmNovoAdendoValor] = useState(0);
  const [fmNovoMesExtra, setFmNovoMesExtra] = useState('');

  useEffect(() => {
    (async () => {
      const [{ data }, { data: feeRows }] = await Promise.all([
        supabase.from('receivables').select('total_amount, received_amount, status')
          .eq('budget_id', budgetId).neq('status', 'cancelado'),
        supabase.from('receivables').select('due_date, total_amount, description')
          .eq('budget_id', budgetId).eq('origem', 'fee_mensal').order('due_date'),
      ]);
      const total = (data || []).reduce((s, r) => s + Number(r.total_amount || 0), 0);
      const recebido = (data || []).reduce((s, r) => s + Number(r.received_amount || 0), 0);
      setResumo({ total, recebido, saldo: Math.max(total - recebido, 0) });

      if (feeRows && feeRows.length > 0) {
        const porMes = new Map<string, MesFeeMensal>();
        feeRows.forEach((r: any) => {
          const mes = String(r.due_date).slice(0, 7);
          const atual = porMes.get(mes) || { due_date: mes, fixo: 0, adendo: 0 };
          if (String(r.description).includes('Adendo')) atual.adendo += Number(r.total_amount || 0);
          else atual.fixo += Number(r.total_amount || 0);
          porMes.set(mes, atual);
        });
        setFmMeses([...porMes.values()].sort((a, b) => a.due_date.localeCompare(b.due_date)));
        setPlano('fee_mensal');
      }
    })();
  }, [budgetId]);

  const salvar = async () => {
    setSalvando(true);
    const rpc = plano === 'fee_mensal'
      ? supabase.rpc('definir_fee_mensal', {
          p_budget_id: budgetId, p_inicio: `${fmInicio}-01`, p_fim: `${fmFim}-01`,
          p_valor: fmValor, p_adendos: fmAdendos,
        })
      : supabase.rpc('definir_parcelamento', {
          p_budget_id: budgetId, p_plan: plano, p_days: dias, p_entry_pct: entradaPct, p_base: base,
        });
    const { data, error } = await rpc;
    setSalvando(false);
    if (error) {
      if (/definir_parcelamento|definir_fee_mensal|function|schema/i.test(error.message)) {
        setIndisponivel(true);
        return;
      }
      toast.error(`Não deu pra definir: ${error.message}`);
      return;
    }
    const r = data as { ok?: boolean; error?: string; parcelas_criadas?: number } | null;
    if (!r?.ok) {
      toast.error(
        r?.error === 'nada_em_aberto' ? 'Não há saldo em aberto pra parcelar neste projeto.'
        : r?.error === 'periodo_invalido' ? 'Confira as datas de início e fim.'
        : r?.error === 'valor_invalido' ? 'Informe um valor mensal maior que zero.'
        : 'Não foi possível definir o parcelamento.'
      );
      return;
    }
    toast.success(`Parcelamento definido ✓ ${r.parcelas_criadas} parcela${r.parcelas_criadas === 1 ? '' : 's'}.`);
    onDone?.();
    onClose();
  };

  const adicionarAdendoExistente = async () => {
    if (!fmNovoAdendoMes || fmNovoAdendoValor <= 0) return;
    setSalvando(true);
    const { error } = await supabase.rpc('adicionar_parcela_fee_mensal', {
      p_budget_id: budgetId, p_mes: `${fmNovoAdendoMes}-01`, p_valor: fmNovoAdendoValor, p_eh_adendo: true,
    });
    setSalvando(false);
    if (error) { toast.error(`Não deu pra adicionar: ${error.message}`); return; }
    toast.success('Adendo adicionado ✓');
    onDone?.();
    onClose();
  };

  const estenderContrato = async () => {
    if (!fmNovoMesExtra) return;
    const valorBase = fmMeses && fmMeses.length > 0 ? fmMeses[fmMeses.length - 1].fixo : 0;
    setSalvando(true);
    const { error } = await supabase.rpc('adicionar_parcela_fee_mensal', {
      p_budget_id: budgetId, p_mes: `${fmNovoMesExtra}-01`, p_valor: valorBase, p_eh_adendo: false,
    });
    setSalvando(false);
    if (error) { toast.error(`Não deu pra estender: ${error.message}`); return; }
    toast.success('Contrato estendido ✓');
    onDone?.();
    onClose();
  };

  const saldo = resumo?.saldo ?? 0;
  const entrada = plano === 'entrada_saldo' ? Math.round(saldo * entradaPct) / 100 : 0;
  const jaConfigurado = fmMeses !== null && fmMeses.length > 0;

  return (
    <Modal isOpen onClose={onClose} title="Definir parcelamento" maxWidth={jaConfigurado || plano === 'fee_mensal' ? 'max-w-lg' : 'max-w-md'}>
      <div className="space-y-4">
        {nomeProjeto && <p className="text-sm font-bold text-lumos-text-primary">{nomeProjeto}</p>}

        {indisponivel ? (
          <div className="rounded-lumos border border-lumos-border p-4 text-center space-y-2">
            <CalendarClock className="w-7 h-7 text-lumos-text-secondary mx-auto" />
            <p className="text-sm font-bold text-lumos-text-primary">Parcelamento ainda não ativado</p>
            <p className="text-xs text-lumos-text-secondary">Falta rodar a migration da Fase 2 no Supabase.</p>
          </div>
        ) : jaConfigurado ? (
          <>
            <div className="rounded-lumos border border-lumos-border overflow-hidden">
              <div className="grid grid-cols-3 bg-lumos-text-secondary/5 text-[10px] font-black uppercase text-lumos-text-secondary px-3 py-2">
                <span>Mês</span><span className="text-right">Fixo</span><span className="text-right">Adendo</span>
              </div>
              {fmMeses!.map(m => (
                <div key={m.due_date} className="grid grid-cols-3 px-3 py-2 text-[12.5px] border-t border-lumos-border">
                  <span className="text-lumos-text-primary font-bold">{mesLabel(m.due_date)}</span>
                  <span className="text-right text-lumos-text-primary">{brl(m.fixo)}</span>
                  <span className="text-right text-lumos-text-secondary">{m.adendo > 0 ? brl(m.adendo) : '—'}</span>
                </div>
              ))}
            </div>

            <div className="rounded-lumos bg-lumos-text-secondary/5 border border-lumos-border p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary">Adicionar adendo num mês existente</p>
              <div className="flex items-center gap-2">
                <select className="input-lumos h-9 text-xs flex-1" value={fmNovoAdendoMes} onChange={e => setFmNovoAdendoMes(e.target.value)}>
                  <option value="">Selecione o mês</option>
                  {fmMeses!.map(m => <option key={m.due_date} value={m.due_date}>{mesLabel(m.due_date)}</option>)}
                </select>
                <input type="number" min={0} placeholder="Valor" className="input-lumos h-9 w-28 text-xs"
                  value={fmNovoAdendoValor || ''} onChange={e => setFmNovoAdendoValor(Number(e.target.value) || 0)} />
                <button onClick={adicionarAdendoExistente} disabled={salvando} className="btn-primary h-9 px-3 text-xs">Adicionar</button>
              </div>
            </div>

            <div className="rounded-lumos bg-lumos-text-secondary/5 border border-lumos-border p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary">Estender o contrato com mais um mês</p>
              <div className="flex items-center gap-2">
                <input type="month" className="input-lumos h-9 text-xs flex-1" value={fmNovoMesExtra} onChange={e => setFmNovoMesExtra(e.target.value)} />
                <button onClick={estenderContrato} disabled={salvando} className="btn-primary h-9 px-3 text-xs">Estender</button>
              </div>
            </div>
          </>
        ) : (
          <>
            {resumo && (
              <div className="rounded-lumos border border-lumos-border p-3 text-[12.5px] space-y-1">
                <div className="flex justify-between"><span className="text-lumos-text-secondary">Valor do projeto</span><span className="font-bold text-lumos-text-primary">{brl(resumo.total)}</span></div>
                {resumo.recebido > 0 && (
                  <div className="flex justify-between"><span className="text-lumos-text-secondary">Já recebido (fica intacto)</span><span className="font-bold text-green-500">{brl(resumo.recebido)}</span></div>
                )}
                <div className="flex justify-between border-t border-lumos-border pt-1">
                  <span className="text-lumos-text-secondary">A parcelar</span>
                  <span className="font-black text-lumos-text-primary">{brl(saldo)}</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'a_vista' as const, titulo: 'Valor cheio', desc: 'Uma parcela só' },
                { id: 'entrada_saldo' as const, titulo: 'Entrada + saldo', desc: 'Metade agora, resto depois' },
                { id: 'fee_mensal' as const, titulo: 'Fee mensal', desc: 'Valor fixo por mês' },
              ]).map(op => (
                <button key={op.id} onClick={() => setPlano(op.id)}
                  className={clsx('rounded-lumos border p-3 text-left transition-colors',
                    plano === op.id
                      ? 'border-lumos-yellow bg-lumos-yellow/10'
                      : 'border-lumos-border hover:border-lumos-text-secondary/40')}>
                  <p className="text-[13px] font-bold text-lumos-text-primary">{op.titulo}</p>
                  <p className="text-[11px] text-lumos-text-secondary">{op.desc}</p>
                </button>
              ))}
            </div>

            {plano === 'fee_mensal' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Início</label>
                    <input type="month" value={fmInicio} onChange={e => setFmInicio(e.target.value)} className="input-lumos w-full h-10 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Fim</label>
                    <input type="month" value={fmFim} onChange={e => setFmFim(e.target.value)} className="input-lumos w-full h-10 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Valor mensal</label>
                    <input type="number" min={0} value={fmValor || ''} onChange={e => setFmValor(Number(e.target.value) || 0)} className="input-lumos w-full h-10 text-sm" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Adendos pontuais (opcional)</label>
                  {fmAdendos.map((ad, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input type="month" value={ad.mes} onChange={e => {
                        const next = [...fmAdendos]; next[idx] = { ...next[idx], mes: e.target.value }; setFmAdendos(next);
                      }} className="input-lumos h-9 text-xs flex-1" />
                      <input type="number" min={0} placeholder="Valor" value={ad.valor || ''} onChange={e => {
                        const next = [...fmAdendos]; next[idx] = { ...next[idx], valor: Number(e.target.value) || 0 }; setFmAdendos(next);
                      }} className="input-lumos h-9 w-28 text-xs" />
                      <button onClick={() => setFmAdendos(fmAdendos.filter((_, i) => i !== idx))} className="p-2 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => setFmAdendos([...fmAdendos, { mes: '', valor: 0 }])} className="text-[11px] font-bold text-lumos-yellow flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Adicionar adendo
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {plano === 'entrada_saldo' && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Entrada (%)</label>
                    <input type="number" min={1} max={99} value={entradaPct}
                      onChange={e => setEntradaPct(Number(e.target.value) || 50)}
                      className="input-lumos w-full h-10 text-sm" />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                    {plano === 'entrada_saldo' ? 'Saldo em (dias)' : 'Prazo (dias)'}
                  </label>
                  <input type="number" min={0} value={dias}
                    onChange={e => setDias(Number(e.target.value) || 0)}
                    className="input-lumos w-full h-10 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">A partir de</label>
                  <input type="date" value={base} onChange={e => setBase(e.target.value)}
                    className="input-lumos w-full h-10 text-sm" />
                </div>
              </div>
            )}

            {plano !== 'fee_mensal' && saldo > 0 && (
              <div className="rounded-lumos bg-lumos-text-secondary/5 border border-lumos-border p-3 space-y-1 text-[12.5px]">
                <p className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary">Vai ficar assim</p>
                {plano === 'entrada_saldo' ? (
                  <>
                    <div className="flex justify-between text-lumos-text-primary"><span>Entrada</span><span className="font-bold">{brl(entrada)} · {brData(base)}</span></div>
                    <div className="flex justify-between text-lumos-text-primary"><span>Saldo</span><span className="font-bold">{brl(saldo - entrada)} · {brData(somaDias(base, dias))}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between text-lumos-text-primary"><span>Parcela única</span><span className="font-bold">{brl(saldo)} · {brData(somaDias(base, dias))}</span></div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1">{jaConfigurado ? 'Fechar' : 'Cancelar'}</button>
          {!indisponivel && !jaConfigurado && (
            <button onClick={salvar} disabled={salvando || (plano === 'fee_mensal' ? (!fmInicio || !fmFim || fmValor <= 0) : saldo <= 0)}
              className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Definir parcelamento
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Rodar tsc**

Run: `npx tsc --noEmit`
Expected: mesma baseline de 10 erros, nenhum novo em `ParcelamentoModal.tsx`.
Se o `Modal` component reclamar do tipo de `maxWidth`, confira a prop em
`src/components/common/Modal.tsx` — ela já aceita string livre (`max-w-md`
já era usado antes); `max-w-lg` deve compilar sem ajuste.

- [ ] **Step 3: Teste manual**

Num projeto aprovado SEM fee mensal: abrir o parcelamento (ícone de
calendário em Contas a Receber), escolher "Fee mensal", preencher
início/fim/valor + um adendo, salvar, e conferir que aparecem as contas
certas em Contas a Receber. Reabrir o mesmo parcelamento depois: tem que
mostrar a tabela mês a mês, não o formulário de novo. Adicionar um adendo
num mês existente e conferir que vira uma conta nova. Estender o contrato
com mais um mês e conferir o mesmo.

- [ ] **Step 4: Commit**

```bash
git add src/components/financeiro/ParcelamentoModal.tsx
git commit -m "feat: fee mensal como terceira opcao no parcelamento do financeiro"
```

---

## Task 5: Frontend — PDF (`BudgetPDF.tsx`)

**Files:**
- Modify: `src/components/editor/BudgetPDF.tsx`

**Interfaces:**
- Consumes: campos `fee_mensal_*` da Tarefa 3 (já tipados em `BudgetVersion`, importado neste arquivo).

- [ ] **Step 1: Importar `parseISO`**

Modificar a linha 4 (hoje `import { format } from 'date-fns';`):

```typescript
import { format, parseISO } from 'date-fns';
```

- [ ] **Step 2: Adicionar a tabela de cronograma na seção de Pagamento**

Ancorar pelo texto exato do Item 3 (linhas 589-594 hoje):

```typescript
          {/* Item 3 */}
          <View style={styles.conditionSection}>
            <Text style={styles.conditionTitle}>3. Pagamento</Text>
            <Text style={styles.conditionText}>3.1. O pagamento deverá ocorrer de acordo com prazo de pagamento combinado entre o CLIENTE e a LUMOS no ato do aceite da presente Proposta Comercial, dentro das opções disponíveis nesta.</Text>
            <Text style={styles.conditionText}>3.2. O atraso no pagamento sujeitará o CLIENTE à multa de 10% (dez por cento) e juros de 1% a.m. sobre o valor do débito.</Text>
          </View>
```

Inserir logo depois (antes do comentário `{/* Item 4 */}`):

```typescript

          {version.payment_plan === 'fee_mensal' && version.fee_mensal_mostrar_na_proposta
            && version.fee_mensal_inicio && version.fee_mensal_fim && (
            <View style={{ marginTop: 2, marginBottom: 10 }} wrap={false}>
              <Text style={[styles.conditionText, { fontWeight: 700, marginBottom: 4 }]}>Cronograma de pagamento (fee mensal)</Text>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { width: '40%' }]}>Mês</Text>
                <Text style={[styles.tableHeaderCell, { width: '30%', textAlign: 'right' }]}>Valor mensal</Text>
                <Text style={[styles.tableHeaderCell, { width: '30%', textAlign: 'right' }]}>Adendo</Text>
              </View>
              {(() => {
                const linhas: { mes: string; adendo: number }[] = [];
                let cursor = parseISO(version.fee_mensal_inicio as string);
                const fim = parseISO(version.fee_mensal_fim as string);
                let guard = 0;
                while (cursor <= fim && guard < 60) {
                  const mesKey = format(cursor, 'yyyy-MM');
                  const adendo = (version.fee_mensal_adendos || [])
                    .filter(a => a.mes === mesKey)
                    .reduce((s, a) => s + Number(a.valor || 0), 0);
                  linhas.push({ mes: mesKey, adendo });
                  cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
                  guard++;
                }
                return linhas.map((l, idx) => (
                  <View key={l.mes} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowEven : {}]}>
                    <Text style={[styles.tableCell, { width: '40%' }]}>{format(parseISO(`${l.mes}-01`), 'MMM/yyyy', { locale: ptBR })}</Text>
                    <Text style={[styles.tableCell, { width: '30%', textAlign: 'right' }]}>{formatCurrency(version.fee_mensal_valor || 0)}</Text>
                    <Text style={[styles.tableCell, { width: '30%', textAlign: 'right' }]}>{l.adendo > 0 ? formatCurrency(l.adendo) : '—'}</Text>
                  </View>
                ));
              })()}
            </View>
          )}
```

- [ ] **Step 3: Rodar tsc**

Run: `npx tsc --noEmit`
Expected: mesma baseline de 10 erros, nenhum novo em `BudgetPDF.tsx`.

- [ ] **Step 4: Teste manual**

Numa proposta com fee mensal preenchido e "Mostrar no PDF" marcado, gerar o
PDF (botão de gerar/baixar proposta) e conferir que a tabela aparece com os
meses e adendos certos. Desmarcar o checkbox, gerar de novo, e conferir que
a tabela não aparece.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/BudgetPDF.tsx
git commit -m "feat: PDF da proposta mostra cronograma de fee mensal quando marcado"
```
