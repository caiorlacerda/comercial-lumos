# Orçamento em dólar — Fase 1 (moeda, cotação e PDF em US$) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir cobrar uma proposta em dólar: seletor de moeda e botão "Atualizar cotação" no editor, cotação travada com margem de segurança de 3%, PDF e página pública de aprovação mostrando só US$. O financeiro continua 100% em reais.

**Architecture:** O dólar é só uma conversão final do preço (`valorUSD = valorFinalBRL / fx_rate`); `calcFinancials`, `aprovar_orcamento` e todo o financeiro não mudam. A moeda e a cotação travada ficam em colunas novas de `budget_versions` (com gatilho que as congela quando o orçamento é aprovado). Uma Edge Function `cotacao` busca a PTAX de compra no Banco Central e guarda um registro por dia em `cotacoes_dia`; a cotação manual é sempre possível.

**Tech Stack:** React 19 + TypeScript, `@react-pdf/renderer`, Supabase (Postgres, RPC, Edge Functions em Deno), testes de linha de comando com `node --test` (Node ≥ 23.6 executa TypeScript direto; sem dependências novas).

**Spec:** `docs/superpowers/specs/2026-10-09-orcamento-em-dolar-design.md`

## Global Constraints

- Moeda só `'BRL'` ou `'USD'`. Padrão `'BRL'`. Todas as propostas existentes continuam em R$, sem alteração.
- Margem de segurança padrão **3%** (`fx_spread_pct = 0.03`), editável por orçamento. `fx_rate = round(fx_market_rate × (1 − fx_spread_pct), 4)`.
- `valorUSD = round(valorFinalBRL / fx_rate, 2)`. Custo, margem, imposto e desconto continuam em reais; `calcFinancials` **não é alterado**.
- Cotação: **PTAX de compra** do Banco Central. A cotação só muda quando o usuário aperta "Atualizar cotação" ou digita à mão; abrir o orçamento nunca recalcula.
- O **PDF e a página pública mostram só valores em dólar**: sem cotação e sem equivalente em reais. A cláusula "R$2.000,00" vira a **conversão direta** (`2000 / fx_rate`, duas casas).
- Orçamento **aprovado** ⇒ moeda e cotação travadas (gatilho no banco + campos desabilitados na tela). Para alterar, volta para "Em negociação".
- **Fee mensal fica fora**: com fee mensal marcado, a opção US$ fica desativada (e vice-versa).
- Financeiro 100% em reais; `aprovar_orcamento`, `receivables`, `projetos_financeiro` e `vw_rentabilidade` **não mudam** nesta fase.
- Tokens `lumos-*` do Tailwind; sem cores cruas. Desktop (`lg:`) não regride.
- **SQL é executado só pelo Caio**, no Supabase de produção. A IA nunca roda SQL em produção. O deploy da Edge Function também só com autorização explícita dele.
- **Ordem de produção (crítica):** migration → deploy da função `cotacao` → merge do front. Se o front for ao ar antes da migration, **todo salvamento de orçamento do app quebra** (coluna inexistente), como já aconteceu com o fee mensal. A migration é aditiva e segura de rodar antes.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; PR termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/utils/moeda.ts` | criar | Conversão e formatação de moeda, cotação travada, campos para gravar. Sem imports. |
| `scripts/testes/moeda.test.mjs` | criar | Testes de `moeda.ts` (`node --test`). |
| `supabase/migrations/2026100900_orcamento_em_dolar.sql` | criar | Colunas, constraint, gatilho de trava, `cotacoes_dia`, RPC pública. |
| `scripts/testes/moeda_banco.sql` | criar | Teste do banco local (colunas, constraint, trava, RPC). Termina em ROLLBACK. |
| `supabase/functions/cotacao/ptax.ts` | criar | Leitura da resposta do Banco Central. Sem imports. |
| `supabase/functions/cotacao/index.ts` | criar | Edge Function: autentica, busca PTAX, guarda no dia, devolve a cotação. |
| `scripts/testes/ptax.test.mjs` | criar | Testes de `ptax.ts`. |
| `src/lib/cotacao.ts` | criar | Cliente: chama a função `cotacao`. |
| `src/utils/financials.ts` | modificar | Campos de moeda em `BudgetVersion`. |
| `src/components/editor/MoedaPanel.tsx` | criar | Seletor de moeda, cotação, margem, atualizar, manual. |
| `src/pages/BudgetEditorPage.tsx` | modificar | Integra o painel, grava os campos, exibe o valor na moeda. |
| `src/components/editor/BudgetPDF.tsx` | modificar | Valores em US$ e cláusula convertida. |
| `src/pages/AprovacaoPublica.tsx` | modificar | Valores em US$ e cláusula convertida. |
| `src/pages/Budgets.tsx` | modificar | Colunas nos selects e valor na moeda da lista. |
| `src/context/PrivacyContext.tsx` | modificar | Modo apresentação também borra `US$`. |

Fora da lista de propósito: duplicar orçamento e salvar como template **não** copiam moeda — as colunas novas têm padrão `'BRL'`, então eles voltam para R$ (a cotação envelheceria).

## Desvios do spec (deliberados, para o plano ficar menor e mais seguro)

- O spec dizia que `formatCurrency` ganharia parâmetros de moeda. O plano **não toca** em `formatCurrency` (usado em dezenas de telas): a moeda mora em `src/utils/moeda.ts`, e só o fluxo comercial passa a usá-la. Nenhuma chamada existente muda.
- O spec dizia que os selects de `Budgets`, `Dashboard`, `ClientProfile` e `CustosProjetoDetalhe` ganhariam as colunas novas. Só a **lista de orçamentos** mostra valor na moeda da proposta nesta fase, então só `Budgets.tsx` precisa delas. As outras telas seguem somando reais (decisão do Caio). As exportações de PDF do Dashboard e da lista já buscam a versão com `*`; a Task 7 confere isso na prática.

**Branch:** crie a partir do branch do spec, para spec e plano irem junto no PR:
`git switch -c feat/orcamento-em-dolar docs/spec-orcamento-em-dolar`

---

### Task 1: Funções de moeda (`src/utils/moeda.ts`)

**Files:**
- Create: `src/utils/moeda.ts`
- Create: `scripts/testes/moeda.test.mjs`
- Modify: `src/utils/financials.ts` (interface `BudgetVersion`)

**Interfaces:**
- Produces (usado pelas Tasks 4, 5, 6 e 7):
  - `type Moeda = 'BRL' | 'USD'`; `const SPREAD_PADRAO = 0.03`
  - `interface VersaoMoeda { currency?, fx_market_rate?, fx_spread_pct?, fx_rate?, fx_rate_at?, fx_source? }`
  - `taxaDaVersao(v?): number | null`
  - `moedaDaVersao(v?): Moeda`
  - `calcCotacaoTravada(mercado: number, spread = SPREAD_PADRAO): number`
  - `converterValor(valorBRL: number, v?): number`
  - `formatarMoeda(valor: number, moeda: Moeda = 'BRL'): string`
  - `formatarValorDaVersao(valorBRL: number, v?): string`
  - `camposDeMoeda(v?)`: `{ currency, fx_market_rate, fx_spread_pct, fx_rate, fx_rate_at, fx_source }`
  - `diasDesde(iso?: string | null, agora = new Date()): number | null`

- [ ] **Step 1: Escrever o teste que falha**

Crie `scripts/testes/moeda.test.mjs`:

```js
// Rodar: node --test scripts/testes/moeda.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPREAD_PADRAO, calcCotacaoTravada, converterValor, formatarMoeda,
  formatarValorDaVersao, moedaDaVersao, taxaDaVersao, camposDeMoeda, diasDesde,
} from '../../src/utils/moeda.ts';

const semNbsp = (s) => s.replace(/ /g, ' ');
const usd = { currency: 'USD', fx_rate: 4.85 };

test('margem de segurança padrão é 3%', () => {
  assert.equal(SPREAD_PADRAO, 0.03);
});

test('cotação travada = mercado menos a margem, em 4 casas', () => {
  assert.equal(calcCotacaoTravada(5, 0.03), 4.85);
  assert.equal(calcCotacaoTravada(5.0119, 0.03), 4.8615);
  assert.equal(calcCotacaoTravada(5, 0), 5);
});

test('converte reais em dólar pela cotação travada', () => {
  assert.equal(converterValor(50000, usd), 10309.28);
  assert.equal(converterValor(2000, usd), 412.37);
  assert.equal(converterValor(50000, { currency: 'USD', fx_rate: '4.85' }), 10309.28);
});

test('em R$ o valor passa sem mudança', () => {
  assert.equal(converterValor(1234.5678, { currency: 'BRL', fx_rate: 4.85 }), 1234.5678);
  assert.equal(converterValor(1234.5678, undefined), 1234.5678);
});

test('USD sem cotação válida é tratado como R$', () => {
  assert.equal(moedaDaVersao({ currency: 'USD', fx_rate: null }), 'BRL');
  assert.equal(moedaDaVersao({ currency: 'USD', fx_rate: 0 }), 'BRL');
  assert.equal(taxaDaVersao({ currency: 'USD', fx_rate: -1 }), null);
  assert.equal(converterValor(100, { currency: 'USD', fx_rate: null }), 100);
});

test('formata em R$ e em US$', () => {
  assert.equal(semNbsp(formatarMoeda(1234.5, 'BRL')), 'R$ 1.234,50');
  assert.equal(semNbsp(formatarMoeda(10309.28, 'USD')), 'US$ 10.309,28');
  assert.equal(semNbsp(formatarValorDaVersao(50000, usd)), 'US$ 10.309,28');
  assert.equal(semNbsp(formatarValorDaVersao(50000, { currency: 'BRL' })), 'R$ 50.000,00');
});

test('campos de moeda para gravar', () => {
  assert.deepEqual(camposDeMoeda(undefined), {
    currency: 'BRL', fx_market_rate: null, fx_spread_pct: 0.03,
    fx_rate: null, fx_rate_at: null, fx_source: null,
  });
  assert.deepEqual(
    camposDeMoeda({ currency: 'USD', fx_market_rate: 5, fx_spread_pct: 0.03, fx_rate: 4.85, fx_rate_at: '2026-10-09T12:00:00Z', fx_source: 'ptax' }),
    { currency: 'USD', fx_market_rate: 5, fx_spread_pct: 0.03, fx_rate: 4.85, fx_rate_at: '2026-10-09T12:00:00Z', fx_source: 'ptax' },
  );
});

test('dias desde a cotação', () => {
  assert.equal(diasDesde('2026-10-01T00:00:00Z', new Date('2026-10-09T00:00:00Z')), 8);
  assert.equal(diasDesde(null), null);
  assert.equal(diasDesde('lixo'), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test scripts/testes/moeda.test.mjs`
Expected: FAIL com `Cannot find module '.../src/utils/moeda.ts'`

- [ ] **Step 3: Implementar**

Crie `src/utils/moeda.ts`:

```ts
// Moeda da proposta. O dólar é só uma CONVERSÃO FINAL do preço: custo, margem e
// imposto continuam em reais (calcFinancials não muda). Sem dependências de
// propósito — roda no navegador, no PDF e nos testes de linha de comando.

export type Moeda = 'BRL' | 'USD';

/** Margem de segurança padrão sobre a cotação de mercado (3%). */
export const SPREAD_PADRAO = 0.03;

export interface VersaoMoeda {
  currency?: string | null;
  fx_market_rate?: number | string | null;
  fx_spread_pct?: number | string | null;
  fx_rate?: number | string | null;
  fx_rate_at?: string | null;
  fx_source?: string | null;
}

/** Cotação travada da versão (R$ por US$), ou null se não houver uma válida. */
export function taxaDaVersao(v?: VersaoMoeda | null): number | null {
  const t = Number(v?.fx_rate);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** USD só vale com cotação travada; sem ela a proposta é tratada como R$. */
export function moedaDaVersao(v?: VersaoMoeda | null): Moeda {
  return v?.currency === 'USD' && taxaDaVersao(v) !== null ? 'USD' : 'BRL';
}

/**
 * Cotação travada = cotação de mercado menos a margem de segurança. Quanto
 * menor a cotação, maior o preço em dólar: protege a Lumos se o dólar cair
 * até o pagamento. 4 casas, igual ao banco de dados.
 */
export function calcCotacaoTravada(mercado: number, spread: number = SPREAD_PADRAO): number {
  return Math.round(mercado * (1 - spread) * 10000) / 10000;
}

const arredondar2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Converte um valor em reais para a moeda da versão. Em R$, devolve como veio. */
export function converterValor(valorBRL: number, v?: VersaoMoeda | null): number {
  const taxa = moedaDaVersao(v) === 'USD' ? taxaDaVersao(v) : null;
  return taxa ? arredondar2(valorBRL / taxa) : valorBRL;
}

export function formatarMoeda(valor: number, moeda: Moeda = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: moeda,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor);
}

/** Converte (se for dólar) e formata, num passo só. */
export function formatarValorDaVersao(valorBRL: number, v?: VersaoMoeda | null): string {
  return formatarMoeda(converterValor(valorBRL, v), moedaDaVersao(v));
}

/**
 * Os seis campos de moeda, prontos para entrar nos INSERT/UPDATE de
 * budget_versions. Existe pra essa lista não ser copiada à mão em cada lugar.
 */
export function camposDeMoeda(v?: VersaoMoeda | null) {
  return {
    currency: moedaDaVersao(v),
    fx_market_rate: v?.fx_market_rate != null ? Number(v.fx_market_rate) : null,
    fx_spread_pct: v?.fx_spread_pct != null ? Number(v.fx_spread_pct) : SPREAD_PADRAO,
    fx_rate: taxaDaVersao(v),
    fx_rate_at: v?.fx_rate_at ?? null,
    fx_source: v?.fx_source ?? null,
  };
}

/** Dias inteiros desde uma data ISO; null se não houver data. */
export function diasDesde(iso?: string | null, agora: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((agora.getTime() - t) / 86400000);
}
```

Em `src/utils/financials.ts`, dentro de `interface BudgetVersion`, logo após `imposto_reajusta_preco?: boolean;` (linha ~54), acrescente:

```ts
  /** Moeda da proposta (padrão 'BRL'). Em 'USD' o preço é convertido pela
   *  cotação travada — ver src/utils/moeda.ts. O financeiro segue em reais. */
  currency?: 'BRL' | 'USD';
  fx_market_rate?: number | null;
  fx_spread_pct?: number;
  fx_rate?: number | null;
  fx_rate_at?: string | null;
  fx_source?: 'ptax' | 'manual' | null;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test scripts/testes/moeda.test.mjs`
Expected: `ℹ pass 8` e `ℹ fail 0`

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/utils/moeda.ts scripts/testes/moeda.test.mjs src/utils/financials.ts
git commit -m "feat: funções de moeda e cotação travada para propostas em dólar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — colunas, trava, `cotacoes_dia` e RPC pública

**Files:**
- Create: `supabase/migrations/2026100900_orcamento_em_dolar.sql`
- Create: `scripts/testes/moeda_banco.sql`

**Interfaces:**
- Produces (usado pelas Tasks 3, 4 e 6): colunas `budget_versions.currency | fx_market_rate | fx_spread_pct | fx_rate | fx_rate_at | fx_source`; tabela `cotacoes_dia(data date PK, compra, venda, fonte, buscado_em)`; RPC `get_public_budget_by_token` devolvendo também `currency` e `fx_rate`.

- [ ] **Step 1: Escrever o teste do banco (vai falhar sem a migration)**

Crie `scripts/testes/moeda_banco.sql`:

```sql
-- Teste do banco LOCAL para a migration 2026100900. Não rodar em produção.
-- Tudo termina em ROLLBACK: não deixa nada para trás.
-- Rodar: docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/moeda_banco.sql
BEGIN;

-- Aprovar um orçamento dispara notificação (precisa de usuários); aqui não interessa.
ALTER TABLE public.budgets DISABLE TRIGGER trg_budget_approved_notification;

CREATE FUNCTION pg_temp.deve_falhar(p_sql text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK   %', p_msg;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (esperava erro): %', p_msg;
END $$;

DO $$
DECLARE
  v_b uuid; v_v uuid; v_cur text; v_json json;
BEGIN
  INSERT INTO budgets (code, project_name, category, status)
  VALUES ('TESTE-USD', 'Teste dólar', 'digital', 'rascunho') RETURNING id INTO v_b;
  INSERT INTO budget_versions (budget_id, version_number, public_token)
  VALUES (v_b, 1, gen_random_uuid()) RETURNING id INTO v_v;

  -- 1) padrão é BRL
  SELECT currency INTO v_cur FROM budget_versions WHERE id = v_v;
  IF v_cur <> 'BRL' THEN RAISE EXCEPTION 'FALHOU: padrão deveria ser BRL (veio %)', v_cur; END IF;
  RAISE NOTICE 'OK   padrão é BRL';

  -- 2) USD exige cotação; fonte e margem têm que ser válidas
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET currency = ''USD'' WHERE id = %L', v_v), 'USD sem cotação é recusado');
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET fx_source = ''xyz'' WHERE id = %L', v_v), 'fonte inválida é recusada');
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET fx_spread_pct = 1.5 WHERE id = %L', v_v), 'margem de segurança de 150 por cento é recusada');

  -- 3) USD com cotação é aceito
  UPDATE budget_versions
     SET currency = 'USD', fx_market_rate = 5, fx_spread_pct = 0.03, fx_rate = 4.85, fx_source = 'manual'
   WHERE id = v_v;
  RAISE NOTICE 'OK   USD com cotação é aceito';

  -- 4) RPC pública devolve moeda e cotação
  v_json := get_public_budget_by_token((SELECT public_token FROM budget_versions WHERE id = v_v));
  IF v_json->>'currency' <> 'USD' OR (v_json->>'fx_rate')::numeric <> 4.85 THEN
    RAISE EXCEPTION 'FALHOU: RPC pública sem moeda/cotação: %', v_json;
  END IF;
  RAISE NOTICE 'OK   RPC pública devolve currency e fx_rate';

  -- 5) orçamento aprovado: moeda e cotação travadas
  UPDATE budgets SET status = 'aprovado' WHERE id = v_b;
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET fx_rate = 4.80 WHERE id = %L', v_v), 'cotação travada com orçamento aprovado');
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET currency = ''BRL'' WHERE id = %L', v_v), 'moeda travada com orçamento aprovado');
  UPDATE budget_versions SET fx_rate = 4.85, notes_client = 'ok' WHERE id = v_v;
  RAISE NOTICE 'OK   gravar o mesmo valor e outros campos continua permitido';

  -- 6) volta para negociação: destrava
  UPDATE budgets SET status = 'em_negociacao' WHERE id = v_b;
  UPDATE budget_versions SET fx_market_rate = 5.1, fx_rate = 4.947 WHERE id = v_v;
  RAISE NOTICE 'OK   destrava ao voltar para em negociação';

  -- 7) cotacoes_dia aceita um registro por dia
  INSERT INTO cotacoes_dia (data, compra, venda) VALUES ('2026-10-08', 5.0113, 5.0119)
  ON CONFLICT (data) DO UPDATE SET compra = EXCLUDED.compra, venda = EXCLUDED.venda;
  INSERT INTO cotacoes_dia (data, compra, venda) VALUES ('2026-10-08', 5.0200, 5.0210)
  ON CONFLICT (data) DO UPDATE SET compra = EXCLUDED.compra, venda = EXCLUDED.venda;
  IF (SELECT count(*) FROM cotacoes_dia WHERE data = '2026-10-08') <> 1 THEN
    RAISE EXCEPTION 'FALHOU: cotacoes_dia deveria ter 1 registro por dia';
  END IF;
  RAISE NOTICE 'OK   cotacoes_dia guarda um registro por dia';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Subir o banco local e ver o teste falhar**

O Docker é o OrbStack: abra o OrbStack (ou `orbctl start`) antes.

Run: `supabase start`
Run: `supabase db reset`
Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/moeda_banco.sql`
Expected: FAIL com `column "currency" does not exist` (ou `relation "cotacoes_dia" does not exist`).

- [ ] **Step 3: Escrever a migration**

Crie `supabase/migrations/2026100900_orcamento_em_dolar.sql`:

```sql
-- ORÇAMENTO EM DÓLAR (Fase 1)
--
-- A proposta pode ser cobrada em US$. O dólar é só uma conversão FINAL do preço:
-- custo, margem e imposto seguem em reais, e o financeiro (aprovar_orcamento,
-- receivables, projetos_financeiro, vw_rentabilidade) NÃO muda — continua
-- recebendo o valor em reais de sempre.
--
-- Esta migration é ADITIVA e segura de rodar antes do deploy do front: todas as
-- propostas existentes ficam em R$ (padrão 'BRL'); o front antigo ignora as
-- colunas novas. Já o front NOVO grava essas colunas, então esta migration tem
-- que rodar ANTES dele.
--
--   fx_market_rate  cotação de mercado usada (R$ por US$, PTAX de compra)
--   fx_spread_pct   margem de segurança (fração; 0.03 = 3%)
--   fx_rate         cotação TRAVADA = mercado × (1 − margem)
--   fx_rate_at      quando a cotação foi obtida/digitada
--   fx_source       'ptax' (Banco Central) ou 'manual'

ALTER TABLE public.budget_versions
  ADD COLUMN IF NOT EXISTS currency       text         NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS fx_market_rate numeric(12,4),
  ADD COLUMN IF NOT EXISTS fx_spread_pct  numeric(5,4) NOT NULL DEFAULT 0.03,
  ADD COLUMN IF NOT EXISTS fx_rate        numeric(12,4),
  ADD COLUMN IF NOT EXISTS fx_rate_at     timestamptz,
  ADD COLUMN IF NOT EXISTS fx_source      text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_versions_moeda_valida') THEN
    ALTER TABLE public.budget_versions
      ADD CONSTRAINT budget_versions_moeda_valida CHECK (
        currency IN ('BRL', 'USD')
        AND (currency = 'BRL' OR (fx_rate IS NOT NULL AND fx_rate > 0))
        AND (fx_source IS NULL OR fx_source IN ('ptax', 'manual'))
        AND fx_spread_pct >= 0 AND fx_spread_pct < 1
      );
  END IF;
END $$;

-- TRAVA NA APROVAÇÃO: com o orçamento aprovado, moeda e cotação não mudam.
-- Gravar o MESMO valor (o editor reenvia a versão inteira a cada salvamento) e
-- mexer em qualquer outro campo continua permitido. Para alterar, o orçamento
-- volta antes para "Em negociação".
CREATE OR REPLACE FUNCTION public.fn_trava_cotacao_aprovado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.currency       IS DISTINCT FROM OLD.currency
   OR NEW.fx_market_rate IS DISTINCT FROM OLD.fx_market_rate
   OR NEW.fx_spread_pct  IS DISTINCT FROM OLD.fx_spread_pct
   OR NEW.fx_rate        IS DISTINCT FROM OLD.fx_rate
   OR NEW.fx_source      IS DISTINCT FROM OLD.fx_source)
  AND EXISTS (SELECT 1 FROM budgets b WHERE b.id = NEW.budget_id AND b.status = 'aprovado')
  THEN
    RAISE EXCEPTION 'Moeda e cotação não podem mudar com o orçamento aprovado. Volte o orçamento para "Em negociação" antes de alterar.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trava_cotacao_aprovado ON public.budget_versions;
CREATE TRIGGER trg_trava_cotacao_aprovado
  BEFORE UPDATE ON public.budget_versions
  FOR EACH ROW EXECUTE FUNCTION public.fn_trava_cotacao_aprovado();

-- Um registro por dia útil, guardado pela Edge Function `cotacao` (cache e
-- plano B quando o Banco Central estiver fora do ar). Só a função (service
-- role) lê e escreve: RLS ligado e nenhuma policy.
CREATE TABLE IF NOT EXISTS public.cotacoes_dia (
  data       date PRIMARY KEY,
  compra     numeric(12,4) NOT NULL,
  venda      numeric(12,4) NOT NULL,
  fonte      text          NOT NULL DEFAULT 'ptax',
  buscado_em timestamptz   NOT NULL DEFAULT now()
);
ALTER TABLE public.cotacoes_dia ENABLE ROW LEVEL SECURITY;

-- A página pública de aprovação precisa saber a moeda e a cotação para mostrar
-- o mesmo valor em US$ que o editor. Resto da função idêntico ao de
-- 2026093350 (CREATE OR REPLACE preserva as permissões atuais).
CREATE OR REPLACE FUNCTION public.get_public_budget_by_token(p_token uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'id', bv.id,
    'budget_id', bv.budget_id,
    'version_number', bv.version_number,
    'margin_pct', bv.margin_pct,
    'nf_pct', bv.nf_pct,
    'imposto_reajusta_preco', bv.imposto_reajusta_preco,
    'discount_value', bv.discount_value,
    'currency', bv.currency,
    'fx_rate', bv.fx_rate,
    'notes_client', bv.notes_client,
    'payment_terms', bv.payment_terms,
    'validity_days', bv.validity_days,
    'public_token', bv.public_token,
    'created_at', bv.created_at,
    'budgets', json_build_object(
      'project_name', b.project_name,
      'code', b.code,
      'category', b.category,
      'status', b.status,
      'clients', json_build_object(
        'name', c.name,
        'agency_name', c.agency_name
      )
    ),
    'contact', CASE WHEN cc.id IS NOT NULL THEN json_build_object(
      'name', cc.name,
      'email', cc.email
    ) ELSE NULL END,
    'items', (
      SELECT json_agg(
        json_build_object(
          'id', bi.id,
          'item_group', bi.item_group,
          'name', bi.name,
          'description', bi.description,
          'unit_cost', bi.unit_cost,
          'quantity', bi.quantity,
          'unit_label', bi.unit_label,
          'sort_order', bi.sort_order
        ) ORDER BY bi.sort_order
      )
      FROM budget_items bi
      WHERE bi.version_id = bv.id
    )
  )
  INTO result
  FROM budget_versions bv
  JOIN budgets b ON b.id = bv.budget_id
  LEFT JOIN clients c ON c.id = b.client_id
  LEFT JOIN client_contacts cc ON cc.id = bv.contact_id
  WHERE bv.public_token = p_token;

  RETURN result;
END;
$function$;
```

- [ ] **Step 4: Aplicar no banco local e rodar o teste**

Run: `supabase db reset`
Expected: todas as migrations aplicam sem erro (a nova é a última).

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/moeda_banco.sql`
Expected: 9 linhas `NOTICE:  OK   ...` e nenhuma `FALHOU`; termina em `ROLLBACK`.

Se o `ALTER TABLE budgets DISABLE TRIGGER trg_budget_approved_notification` reclamar que o gatilho não existe, rode `\d budgets` no psql, use o nome real do gatilho de notificação de aprovação e ajuste só essa linha do teste.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026100900_orcamento_em_dolar.sql scripts/testes/moeda_banco.sql
git commit -m "feat: banco do orçamento em dólar (colunas, trava na aprovação, cotações do dia)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Edge Function `cotacao` e cliente

**Files:**
- Create: `supabase/functions/cotacao/ptax.ts`
- Create: `supabase/functions/cotacao/index.ts`
- Create: `scripts/testes/ptax.test.mjs`
- Create: `src/lib/cotacao.ts`

**Interfaces:**
- Consumes: tabela `cotacoes_dia` (Task 2).
- Produces (usado pela Task 4): `buscarCotacao(): Promise<CotacaoDia>` com `interface CotacaoDia { data: string; compra: number; venda: number; fonte: string; do_cache: boolean }`.

**Atenção (testado em 2026-10-09):** o firewall do Banco Central responde **403** se a URL tiver `$select`. A URL abaixo não o usa, de propósito.

- [ ] **Step 1: Escrever o teste que falha**

Crie `scripts/testes/ptax.test.mjs`:

```js
// Rodar: node --test scripts/testes/ptax.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escolherCotacao, urlPtax } from '../../supabase/functions/cotacao/ptax.ts';

// Trecho da resposta real do Banco Central consultada em 2026-10-09.
const resposta = {
  value: [
    { cotacaoCompra: 4.9692, cotacaoVenda: 4.9698, dataHoraCotacao: '2026-10-06 13:03:21.267287' },
    { cotacaoCompra: 5.0113, cotacaoVenda: 5.0119, dataHoraCotacao: '2026-10-08 13:08:16.814037' },
    { cotacaoCompra: 4.9929, cotacaoVenda: 4.9935, dataHoraCotacao: '2026-10-07 13:05:23.249063' },
  ],
};

test('escolhe a cotação mais recente, mesmo fora de ordem', () => {
  assert.deepEqual(escolherCotacao(resposta), { data: '2026-10-08', compra: 5.0113, venda: 5.0119 });
});

test('ignora registros inválidos', () => {
  const r = { value: [
    { cotacaoCompra: 0, cotacaoVenda: 5, dataHoraCotacao: '2026-10-09 13:00:00' },
    { cotacaoCompra: 5, cotacaoVenda: 5.1, dataHoraCotacao: '2026-10-07 13:00:00' },
  ] };
  assert.deepEqual(escolherCotacao(r), { data: '2026-10-07', compra: 5, venda: 5.1 });
});

test('devolve null quando não há cotação', () => {
  assert.equal(escolherCotacao({ value: [] }), null);
  assert.equal(escolherCotacao({}), null);
  assert.equal(escolherCotacao(null), null);
});

test('monta o endereço com a janela de datas no formato do BC (MM-DD-AAAA)', () => {
  const url = urlPtax(new Date('2026-10-09T12:00:00Z'));
  assert.ok(url.includes("@dataInicial='09-29-2026'"));
  assert.ok(url.includes("@dataFinalCotacao='10-09-2026'"));
  assert.ok(url.startsWith('https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo'));
});

test('não usa $select (o firewall do Banco Central responde 403)', () => {
  assert.ok(!urlPtax(new Date()).includes('$select'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test scripts/testes/ptax.test.mjs`
Expected: FAIL com `Cannot find module '.../supabase/functions/cotacao/ptax.ts'`

- [ ] **Step 3: Implementar o leitor**

Crie `supabase/functions/cotacao/ptax.ts`:

```ts
// Leitura da cotação do dólar no Banco Central (PTAX, serviço Olinda).
// Puro, sem imports: o index.ts usa dentro do Deno e os testes rodam no Node.

export interface CotacaoPtax {
  /** Dia da cotação (AAAA-MM-DD). */
  data: string;
  compra: number;
  venda: number;
}

const mdy = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;

/**
 * Endereço que lista as cotações dos últimos `diasAtras` dias (o BC só publica
 * em dia útil). NÃO acrescentar `$select`: o firewall do Banco Central responde
 * 403 a esse parâmetro (testado em 2026-10-09); a resposta já vem enxuta.
 */
export function urlPtax(hoje: Date, diasAtras = 10): string {
  const ini = new Date(hoje.getTime() - diasAtras * 86400000);
  return (
    'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
    'CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)' +
    `?@dataInicial='${mdy(ini)}'&@dataFinalCotacao='${mdy(hoje)}'` +
    '&$top=100&$orderby=dataHoraCotacao%20desc&$format=json'
  );
}

/** Pega a cotação mais recente da resposta do BC; null se não houver nenhuma válida. */
export function escolherCotacao(json: unknown): CotacaoPtax | null {
  const lista = (json as { value?: unknown })?.value;
  if (!Array.isArray(lista)) return null;
  let melhor: { quando: string; compra: number; venda: number } | null = null;
  for (const r of lista as Record<string, unknown>[]) {
    const compra = Number(r?.cotacaoCompra);
    const venda = Number(r?.cotacaoVenda);
    const quando = String(r?.dataHoraCotacao ?? '');
    if (!(compra > 0) || !(venda > 0) || !quando) continue;
    if (!melhor || quando > melhor.quando) melhor = { quando, compra, venda };
  }
  return melhor ? { data: melhor.quando.slice(0, 10), compra: melhor.compra, venda: melhor.venda } : null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test scripts/testes/ptax.test.mjs`
Expected: `ℹ pass 5` e `ℹ fail 0`

- [ ] **Step 5: Escrever a Edge Function**

Crie `supabase/functions/cotacao/index.ts`:

```ts
// supabase/functions/cotacao/index.ts
//
// Cotação do dólar para as propostas em US$: PTAX de COMPRA do Banco Central
// (a Lumos vende os dólares ao banco). Guarda um registro por dia em
// cotacoes_dia; se o Banco Central estiver fora do ar, devolve a última guardada
// (do_cache: true). Chamada autenticada pelo app (JWT); qualquer funcionário
// ATIVO pode chamar.
//
// Deploy: supabase functions deploy cotacao   (com verificação de JWT, o padrão)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { escolherCotacao, urlPtax } from "./ptax.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // 1. Autoriza: qualquer funcionário ativo.
    try {
      const authHeader = req.headers.get('Authorization') ?? ''
      if (!authHeader) return json({ error: 'Não autenticado.' }, 401)
      const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
      const { data: { user: caller } } = await callerClient.auth.getUser()
      if (!caller) return json({ error: 'Sessão inválida.' }, 401)
      const { data: callerProfile } = await callerClient
        .from('app_users').select('id, status').eq('auth_user_id', caller.id).single()
      if (!callerProfile || callerProfile.status !== 'ativo') {
        return json({ error: 'Usuário inativo.' }, 403)
      }
    } catch (authErr) {
      console.error('cotacao: erro de autenticação', authErr)
      return json({ error: 'Sessão inválida.' }, 401)
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // 2. Banco Central (com limite de tempo).
    let cot = null
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const r = await fetch(urlPtax(new Date()), { signal: ctrl.signal })
      clearTimeout(timer)
      if (r.ok) cot = escolherCotacao(await r.json())
    } catch (e) {
      console.error('cotacao: falha ao consultar o Banco Central', e)
    }

    if (cot) {
      await db.from('cotacoes_dia').upsert(
        { data: cot.data, compra: cot.compra, venda: cot.venda, fonte: 'ptax', buscado_em: new Date().toISOString() },
        { onConflict: 'data' },
      )
      return json({ data: cot.data, compra: cot.compra, venda: cot.venda, fonte: 'ptax', do_cache: false })
    }

    // 3. Plano B: a última cotação guardada.
    const { data: ultima } = await db.from('cotacoes_dia')
      .select('data, compra, venda, fonte').order('data', { ascending: false }).limit(1).maybeSingle()
    if (ultima) {
      return json({ data: ultima.data, compra: Number(ultima.compra), venda: Number(ultima.venda), fonte: ultima.fonte, do_cache: true })
    }
    return json({ error: 'Não foi possível obter a cotação agora.' }, 502)
  } catch (err) {
    console.error('cotacao: erro inesperado', err)
    return json({ error: 'Erro interno.' }, 500)
  }
})
```

- [ ] **Step 6: Escrever o cliente**

Crie `src/lib/cotacao.ts`:

```ts
import { supabase } from '@/lib/supabase';

export interface CotacaoDia {
  /** Dia da cotação (AAAA-MM-DD). */
  data: string;
  /** PTAX de compra: a que a proposta usa. */
  compra: number;
  venda: number;
  fonte: string;
  /** true quando o Banco Central estava fora do ar e veio a última guardada. */
  do_cache: boolean;
}

/** Busca a cotação do dólar (PTAX de compra). Lança erro se não houver nenhuma. */
export async function buscarCotacao(): Promise<CotacaoDia> {
  const { data, error } = await supabase.functions.invoke('cotacao', { body: {} });
  if (error) throw error;
  const c = data as any;
  if (!c || c.error || !(Number(c.compra) > 0)) throw new Error(c?.error || 'Cotação indisponível');
  return c as CotacaoDia;
}
```

- [ ] **Step 7: Conferir tipos e commitar**

Run: `npx tsc --noEmit`
Expected: sem erros (as funções em `supabase/functions` não entram no `tsc`; o `ptax.ts` é testado no Node).

```bash
git add supabase/functions/cotacao scripts/testes/ptax.test.mjs src/lib/cotacao.ts
git commit -m "feat: função cotacao (PTAX de compra do Banco Central) e cliente

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Editor — painel de moeda

**Files:**
- Create: `src/components/editor/MoedaPanel.tsx`
- Modify: `src/pages/BudgetEditorPage.tsx`

**Interfaces:**
- Consumes: `buscarCotacao` (Task 3); `SPREAD_PADRAO, calcCotacaoTravada, diasDesde, formatarMoeda, moedaDaVersao, camposDeMoeda, formatarValorDaVersao, converterValor` (Task 1); `BudgetVersion` com campos de moeda (Task 1).
- Produces: `<MoedaPanel version disabled aprovado feeMensal onChange />`.

- [ ] **Step 1: Criar o painel**

Crie `src/components/editor/MoedaPanel.tsx`:

```tsx
import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import Select from '@/components/ui/Select';
import { useToast } from '@/context/ToastContext';
import type { BudgetVersion } from '@/utils/financials';
import { buscarCotacao } from '@/lib/cotacao';
import { SPREAD_PADRAO, calcCotacaoTravada, diasDesde, formatarMoeda, moedaDaVersao } from '@/utils/moeda';

interface Props {
  version: BudgetVersion;
  /** Versão antiga / só leitura. */
  disabled: boolean;
  /** Orçamento aprovado: moeda e cotação ficam congeladas. */
  aprovado: boolean;
  /** Fee mensal não aceita dólar nesta primeira entrega. */
  feeMensal: boolean;
  onChange: (updates: Partial<BudgetVersion>) => void;
}

const dataBR = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};

export default function MoedaPanel({ version, disabled, aprovado, feeMensal, onChange }: Props) {
  const toast = useToast();
  const [buscando, setBuscando] = useState(false);
  const [manualAberto, setManualAberto] = useState(false);
  const [manualTexto, setManualTexto] = useState('');

  const moeda = moedaDaVersao(version);
  const bloqueado = disabled || aprovado || feeMensal;
  const spread = Number(version.fx_spread_pct ?? SPREAD_PADRAO);
  const idade = diasDesde(version.fx_rate_at);
  const velha = idade !== null && idade > (version.validity_days ?? 7);

  // Uma única chamada com os seis campos: o banco só aceita USD junto de uma cotação.
  const aplicar = (mercado: number, fonte: 'ptax' | 'manual') => {
    onChange({
      currency: 'USD',
      fx_market_rate: mercado,
      fx_spread_pct: spread,
      fx_rate: calcCotacaoTravada(mercado, spread),
      fx_rate_at: new Date().toISOString(),
      fx_source: fonte,
    });
  };

  const atualizar = async () => {
    setBuscando(true);
    try {
      const c = await buscarCotacao();
      aplicar(c.compra, 'ptax');
      setManualAberto(false);
      if (c.do_cache) toast.warning(`Banco Central indisponível agora. Usei a última cotação guardada (${dataBR(c.data)}).`);
    } catch {
      toast.error('Não consegui buscar a cotação. Digite a cotação à mão.');
      setManualAberto(true);
    } finally {
      setBuscando(false);
    }
  };

  const escolher = (v: string) => {
    if (v === 'BRL') { onChange({ currency: 'BRL' }); return; }
    void atualizar();
  };

  const usarManual = () => {
    const n = Number(manualTexto.replace(',', '.'));
    if (!(n > 0 && n < 100)) { toast.error('Cotação inválida. Exemplo: 5,07'); return; }
    aplicar(n, 'manual');
    setManualAberto(false);
    setManualTexto('');
  };

  const mudarMargem = (texto: string) => {
    const s = Math.min(Math.max(Number(texto) || 0, 0), 20) / 100;
    const mercado = Number(version.fx_market_rate);
    if (!(mercado > 0)) return;
    onChange({ fx_spread_pct: s, fx_rate: calcCotacaoTravada(mercado, s) });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-1 block">Moeda da proposta</label>
        <Select
          disabled={bloqueado || buscando}
          className="input-lumos w-full font-black uppercase text-[10px] disabled:opacity-70"
          value={moeda}
          onChange={escolher}
          options={[{ value: 'BRL', label: 'R$ — Real' }, { value: 'USD', label: 'US$ — Dólar' }]}
        />
        {feeMensal && (
          <p className="text-[10px] text-lumos-text-secondary mt-1">Fee mensal não aceita dólar nesta versão.</p>
        )}
        {aprovado && moeda === 'USD' && (
          <p className="text-[10px] text-lumos-text-secondary mt-1">
            Moeda e cotação travadas: o orçamento está aprovado. Volte para "Em Negociação" para alterar.
          </p>
        )}
      </div>

      {moeda === 'USD' && (
        <div className="rounded-lumos border border-lumos-border p-3 space-y-3 text-[10px] font-semibold">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-lumos-text-secondary uppercase font-black block mb-1">Cotação de mercado</span>
              <span className="text-lumos-text-primary text-xs">{formatarMoeda(Number(version.fx_market_rate) || 0)}</span>
            </div>
            <div>
              <label className="text-lumos-text-secondary uppercase font-black block mb-1">Margem de segurança</label>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={0} max={20} step={0.5}
                  disabled={bloqueado}
                  className="input-lumos w-full text-center font-bold text-lumos-text-primary disabled:opacity-70"
                  value={Math.round(spread * 10000) / 100}
                  onChange={(e) => mudarMargem(e.target.value)}
                />
                <span className="text-lumos-text-secondary">%</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-lumos-text-secondary uppercase font-black">Cotação travada</span>
            <span className="text-lumos-text-primary text-sm font-black">{formatarMoeda(Number(version.fx_rate) || 0)}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-lumos-text-secondary">
              {version.fx_source === 'manual' ? 'Digitada' : 'Banco Central (PTAX)'}
              {version.fx_rate_at ? ` · ${dataBR(version.fx_rate_at)}` : ''}
            </span>
            <button
              type="button" disabled={bloqueado || buscando} onClick={atualizar}
              className="h-8 px-3 rounded-lumos border border-lumos-border text-lumos-text-primary font-bold flex items-center gap-1.5 hover:border-lumos-yellow/50 disabled:opacity-50"
            >
              {buscando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Atualizar cotação
            </button>
          </div>

          {velha && !aprovado && (
            <p className="text-amber-500">
              Cotação de {idade} dia(s) e a proposta vale por {version.validity_days ?? 7}. Atualize a cotação se for reenviar.
            </p>
          )}
        </div>
      )}

      {!bloqueado && (moeda === 'USD' || manualAberto) && (
        <div>
          <button
            type="button" onClick={() => setManualAberto(v => !v)}
            className="text-[10px] text-lumos-text-secondary underline hover:text-lumos-text-primary"
          >
            {manualAberto ? 'Esconder cotação manual' : 'Digitar a cotação à mão'}
          </button>
          {manualAberto && (
            <div className={clsx('flex items-center gap-2 mt-2')}>
              <input
                type="text" inputMode="decimal" placeholder="Cotação de mercado (ex.: 5,07)"
                className="input-lumos w-full text-[11px]"
                value={manualTexto}
                onChange={(e) => setManualTexto(e.target.value)}
              />
              <button
                type="button" onClick={usarManual}
                className="h-9 px-3 rounded-lumos bg-lumos-yellow text-black text-[10px] font-black uppercase whitespace-nowrap"
              >
                Usar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Imports no editor**

Em `src/pages/BudgetEditorPage.tsx`, depois de `import Select from '@/components/ui/Select';` (linha 73), acrescente:

```tsx
import MoedaPanel from '@/components/editor/MoedaPanel';
import { camposDeMoeda, converterValor, formatarMoeda, formatarValorDaVersao, moedaDaVersao } from '@/utils/moeda';
```

- [ ] **Step 3: Gravar os campos de moeda nos três pontos de gravação**

Use `Edit` com estes trechos (cada um é único pelo contexto que o cerca).

(a) Rascunho — INSERT de `budget_versions` (indentação de 12 espaços). Troque

```tsx
            fee_mensal_mostrar_na_proposta: version.fee_mensal_mostrar_na_proposta || false
          })
          .select()
          .single();

        if (vError) throw vError;
        currentVersionId = vData.id;
```

por

```tsx
            fee_mensal_mostrar_na_proposta: version.fee_mensal_mostrar_na_proposta || false,
            ...camposDeMoeda(version)
          })
          .select()
          .single();

        if (vError) throw vError;
        currentVersionId = vData.id;
```

(b) Salvar de orçamento existente — UPDATE. Troque

```tsx
            fee_mensal_mostrar_na_proposta: version.fee_mensal_mostrar_na_proposta || false
          }).eq('id', version.id),
```

por

```tsx
            fee_mensal_mostrar_na_proposta: version.fee_mensal_mostrar_na_proposta || false,
            ...camposDeMoeda(version)
          }).eq('id', version.id),
```

(c) Nova versão — INSERT (indentação de 10 espaços). Troque

```tsx
          fee_mensal_mostrar_na_proposta: version.fee_mensal_mostrar_na_proposta || false
        })
        .select()
        .single();

      if (vError) throw vError;

      const itemsToClone
```

por

```tsx
          fee_mensal_mostrar_na_proposta: version.fee_mensal_mostrar_na_proposta || false,
          ...camposDeMoeda(version)
        })
        .select()
        .single();

      if (vError) throw vError;

      const itemsToClone
```

`handleSaveAsTemplate` e a duplicação em `Budgets.tsx`/`Templates.tsx` **não** são alterados: as colunas novas têm padrão `'BRL'`.

- [ ] **Step 4: Valor de Venda Final na moeda da proposta**

Troque a linha do valor grande (a que tem `text-4xl`):

```tsx
                  <span className="text-4xl font-black text-lumos-yellow leading-none tracking-tighter drop-shadow-sm">{formatCurrency(financials?.valorFinal || 0)}</span>
```

por

```tsx
                  <span className="text-4xl font-black text-lumos-yellow leading-none tracking-tighter drop-shadow-sm">{formatarValorDaVersao(financials?.valorFinal || 0, version)}</span>
                  {moedaDaVersao(version) === 'USD' && (
                    <span className="text-[10px] text-lumos-text-secondary font-bold uppercase mt-1">
                      Interno (só a equipe vê): {formatCurrency(financials?.valorFinal || 0)}
                    </span>
                  )}
```

(`converterValor` e `formatarMoeda` entram no import para uso do painel e de ajustes futuros; se o `tsc` acusar import não usado em modo estrito de lint, remova os dois do import.)

- [ ] **Step 5: Inserir o painel e travar fee mensal**

Insira `<MoedaPanel>` imediatamente antes do bloco "Status Proposta". Troque

```tsx
                <div>
                  <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-2 block">Status Proposta</label>
```

por

```tsx
                {version && (
                  <MoedaPanel
                    version={version}
                    disabled={isReadOnly}
                    aprovado={budget?.status === 'aprovado'}
                    feeMensal={version.payment_plan === 'fee_mensal'}
                    onChange={updateVersion}
                  />
                )}

                <div>
                  <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-2 block">Status Proposta</label>
```

Desative o fee mensal quando a proposta estiver em dólar. Troque

```tsx
                id="fee-mensal-toggle"
                disabled={isReadOnly}
```

por

```tsx
                id="fee-mensal-toggle"
                disabled={isReadOnly || moedaDaVersao(version) === 'USD'}
                title={moedaDaVersao(version) === 'USD' ? 'Fee mensal não aceita dólar nesta versão.' : undefined}
```

- [ ] **Step 6: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Testar na tela (banco local)**

Run: `npm run dev` (ou `preview_start`) com o Supabase local no ar (`supabase start`, `supabase db reset`). Entre com a conta de teste do seed (`caio.lacerda@produtoralumos.com.br` / `password123`, **só no banco local**). Abra ou crie um orçamento com itens e confira:
1. Em R$, nada mudou: Valor de Venda Final igual ao de antes.
2. Moeda → "US$ — Dólar": como a função `cotacao` não está no ar localmente, aparece o aviso "Não consegui buscar a cotação" e abre o campo manual (isso testa o caminho de falha).
3. Digite `5` em "Digitar a cotação à mão" → **Usar**: aparecem mercado R$ 5,00, margem 3%, cotação travada R$ 4,85, e o Valor de Venda Final em `US$`, com a linha "Interno" em R$. Confira a conta: Valor R$ ÷ 4,85.
4. Mude a margem para 5%: a cotação travada vira R$ 4,75 e o valor em US$ sobe.
5. Espere 5 s (autosave) e recarregue a página: moeda e cotação continuam.
6. Marque "Este projeto é fee mensal?": deve estar **desabilitado** em dólar. Volte para R$, marque fee mensal: a opção US$ fica desabilitada com a explicação.
7. Mude o Status para "Aprovado": o seletor de moeda fica desabilitado, com o texto de travado. Volte para "Em Negociação": destrava.
8. "Nova versão": a nova versão herda dólar e cotação.

- [ ] **Step 8: Commit**

```bash
git add src/components/editor/MoedaPanel.tsx src/pages/BudgetEditorPage.tsx
git commit -m "feat: seletor de moeda e cotação travada no editor de orçamento

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: PDF em US$

**Files:**
- Modify: `src/components/editor/BudgetPDF.tsx`

**Interfaces:**
- Consumes: `formatarValorDaVersao`, `moedaDaVersao` (Task 1). A `version` que chega ao PDF já traz `currency` e `fx_rate` (o editor usa o estado; as exportações de `Budgets.tsx` e `Dashboard.tsx` buscam a versão com `*`).

- [ ] **Step 1: Import**

Perto dos outros imports de `@/utils/...` no topo do arquivo, acrescente:

```tsx
import { formatarValorDaVersao, moedaDaVersao } from '@/utils/moeda';
```

(`formatCurrency` continua importado: o bloco de fee mensal, que não existe em US$, ainda o usa.)

- [ ] **Step 2: Valores em dólar**

Dentro do componente, logo depois de `const markupMultiplier = ...` (linha ~380), acrescente:

```tsx
  // Em proposta em dólar o PDF mostra SÓ US$ (sem cotação e sem reais). Cada valor
  // é convertido e arredondado sozinho; o total é convertido uma única vez.
  const fmt = (valorBRL: number) => formatarValorDaVersao(valorBRL, version);
  const taxaRemarcacao = moedaDaVersao(version) === 'USD' ? fmt(2000) : 'R$2.000,00';
```

Troque os quatro usos de `formatCurrency` da tabela:

```tsx
                    <Text style={[styles.tableCell, styles.colValorD]}>{formatCurrency(valorUnitario)}</Text>
```
→
```tsx
                    <Text style={[styles.tableCell, styles.colValorD]}>{fmt(valorUnitario)}</Text>
```

```tsx
                      {formatCurrency(valorUnitario * item.quantity)}
```
→
```tsx
                      {fmt(valorUnitario * item.quantity)}
```

```tsx
                  <Text style={styles.groupSubtotalValue}>{formatCurrency(groupSum)}</Text>
```
→
```tsx
                  <Text style={styles.groupSubtotalValue}>{fmt(groupSum)}</Text>
```

```tsx
                    <Text style={styles.totalValue}>{formatCurrency(financials.valorFinal)}</Text>
```
→
```tsx
                    <Text style={styles.totalValue}>{fmt(financials.valorFinal)}</Text>
```

- [ ] **Step 3: Cláusula de remarcação**

Troque

```tsx
será cobrada uma taxa de remarcação no valor mínimo de R$2.000,00 ou 20% do valor total do projeto.</Text>
```

por

```tsx
será cobrada uma taxa de remarcação no valor mínimo de {taxaRemarcacao} ou 20% do valor total do projeto.</Text>
```

(A frase começa em `4.1. Caso o CLIENTE altere...`; mantenha o resto do texto como está.)

- [ ] **Step 4: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Testar o PDF**

Com o `npm run dev` e o banco local: no orçamento em dólar da Task 4, gere o **PDF padrão** e o **PDF detalhado** (botões do editor). Abra os arquivos e confira:
- só `US$`, nenhuma menção a "R$" nem à cotação (exceto o que o texto fixo já tinha, sem valor em reais);
- "Investimento Total do Projeto" = Valor em R$ ÷ cotação travada (ex.: R$ 50.000 ÷ 4,85 = US$ 10.309,28);
- cláusula 4.1 com `US$ 412,37` (para cotação 4,85), e não `R$2.000,00`;
- num orçamento em R$, o PDF é idêntico ao de antes (regressão), inclusive `R$2.000,00`.
Se houver `pdftotext` instalado: `pdftotext arquivo.pdf - | grep -n 'R\$'` num PDF em dólar não deve achar valores.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/BudgetPDF.tsx
git commit -m "feat: PDF da proposta em US$ (valores e cláusula de remarcação convertidos)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Página pública de aprovação em US$

**Files:**
- Modify: `src/pages/AprovacaoPublica.tsx`

**Interfaces:**
- Consumes: `formatarValorDaVersao`, `moedaDaVersao` (Task 1); RPC com `currency` e `fx_rate` (Task 2). O estado `version` da página vem do JSON da RPC e já tem esses campos.

- [ ] **Step 1: Import**

Na linha 4, abaixo de `import { calcFinancials, formatCurrency } from '@/utils/financials';`, acrescente:

```tsx
import { formatarValorDaVersao, moedaDaVersao } from '@/utils/moeda';
```

Se `formatCurrency` ficar sem uso no arquivo depois dos passos abaixo, remova-o do import da linha 4.

- [ ] **Step 2: Valores e cláusula**

Perto de `const financials = calcFinancials(items, version);` (linha ~221), acrescente:

```tsx
  // Proposta em dólar: o cliente vê SÓ US$ (sem cotação e sem reais), no mesmo valor do editor.
  const fmt = (valorBRL: number) => formatarValorDaVersao(valorBRL, version);
  const taxaRemarcacao = moedaDaVersao(version) === 'USD' ? fmt(2000) : 'R$2.000,00';
```

Troque o subtotal do grupo:

```tsx
                              {formatCurrency(groupTotal)}
```
→
```tsx
                              {fmt(groupTotal)}
```

Troque o total:

```tsx
            {formatCurrency(financials.valorFinal)}
```
→
```tsx
            {fmt(financials.valorFinal)}
```

Troque a cláusula (a string da linha ~435, que hoje é uma string simples entre aspas simples) por um template:

```tsx
                `Caso o CLIENTE altere a data prevista para a execução do serviço, sem respeitar o prazo máximo de 48 horas de antecedência, será cobrada uma taxa de remarcação no valor mínimo de ${taxaRemarcacao} ou 20% do valor total do projeto.`,
```

- [ ] **Step 3: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Testar**

Com o banco local, no orçamento em dólar: clique em "Gerar link" (ou o botão equivalente do editor) para criar o `public_token` e abra `/aprovar/<token>` numa aba anônima:
- total e subtotais em `US$`, igual ao editor; nenhuma menção a reais nem à cotação na tela;
- cláusula 4 com o valor em US$;
- orçamento em R$: página igual à de antes.
Não clique em Aprovar/Recusar num orçamento real; no banco local, aprovar um orçamento de teste é aceitável e deve gerar o mesmo `valor_vendido` (em reais) que em R$.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AprovacaoPublica.tsx
git commit -m "feat: página pública de aprovação mostra a proposta em US$

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Lista de orçamentos e modo apresentação

**Files:**
- Modify: `src/pages/Budgets.tsx`
- Modify: `src/context/PrivacyContext.tsx`

**Interfaces:**
- Consumes: `formatarValorDaVersao` (Task 1).

- [ ] **Step 1: Colunas nos selects da lista**

Em `src/pages/Budgets.tsx`, os dois blocos `active_version:...` e `versions:...` do `fetchBudgets` repetem as linhas abaixo. Use `Edit` com `replace_all: true` para trocar

```
            imposto_reajusta_preco,
            items:budget_items!version_id (id, unit_cost, quantity, item_group)
```

por

```
            imposto_reajusta_preco,
            currency,
            fx_rate,
            items:budget_items!version_id (id, unit_cost, quantity, item_group)
```

- [ ] **Step 2: Valor na moeda do orçamento**

Acrescente o import junto dos outros de `@/utils/...`:

```tsx
import { formatarValorDaVersao } from '@/utils/moeda';
```

As duas exibições de valor (tabela e cartão) são idênticas. Use `Edit` com `replace_all: true` para trocar

```tsx
{formatCurrency((budget as any).valorFinal || 0)}
```

por

```tsx
{formatarValorDaVersao((budget as any).valorFinal || 0, (budget as any).active_version)}
```

A ordenação "Valor Final" continua por `valorFinal` em reais (consistente entre moedas). Depois, rode:

Run: `grep -n "formatCurrency" src/pages/Budgets.tsx`
Se só restar o `import`, remova `formatCurrency` do import da linha 36 (`import { calcFinancials, formatCurrency } from '@/utils/financials';` → `import { calcFinancials } from '@/utils/financials';`).

- [ ] **Step 3: Modo apresentação borra US$**

Em `src/context/PrivacyContext.tsx`, troque

```tsx
// "R$ 1.234,56", "-R$ 90,00", "R$ 0"
const MOEDA = /R\$\s*-?[\d.,]+/;
```

por

```tsx
// "R$ 1.234,56", "-R$ 90,00", "R$ 0", "US$ 10.309,28"
const MOEDA = /(?:R|US)\$\s*-?[\d.,]+/;
```

Verifique a expressão:

Run: `node -e "const M=/(?:R|US)\\$\\s*-?[\\d.,]+/; for (const t of ['R\$ 1.234,56','-R\$ 90,00','R\$ 0','US\$ 10.309,28','sem valor']) console.log(JSON.stringify(t), M.test(t))"`
Expected: `true`, `true`, `true`, `true`, `false` (nessa ordem).

- [ ] **Step 4: Conferir tipos e testar**

Run: `npx tsc --noEmit`
Expected: sem erros.

Na tela (banco local): na lista de orçamentos, o orçamento em dólar mostra `US$ ...` e os em R$ continuam em R$. Exporte o PDF **pela lista** e **pelo Dashboard** para um orçamento em dólar: ambos devem sair em US$ (as duas exportações buscam a versão com `*`). Ligue o modo apresentação (olho): os valores em `US$` ficam borrados como os em `R$`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Budgets.tsx src/context/PrivacyContext.tsx
git commit -m "feat: lista de orçamentos na moeda da proposta; modo apresentação borra US\$

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verificação final, PR e roteiro de produção

**Files:** nenhum arquivo de código novo.

- [ ] **Step 1: Rodar todas as verificações automáticas**

Run: `node --test scripts/testes/moeda.test.mjs scripts/testes/ptax.test.mjs`
Expected: `ℹ pass 13` e `ℹ fail 0` (8 + 5).

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/moeda_banco.sql`
Expected: 9 linhas `OK`, sem `FALHOU`.

Run: `npm run build`
Expected: build conclui sem erros.

- [ ] **Step 2: Regressão em R$**

No banco local, com um orçamento em R$: editor, PDF padrão e detalhado, página pública e lista idênticos ao comportamento anterior. Aprove um orçamento de teste em R$ e outro em US$: o `valor_vendido` e as parcelas (em reais) devem seguir a mesma regra de sempre; o de US$ gera o **mesmo valor em reais** que o equivalente em R$.

- [ ] **Step 3: Limpar o ambiente local**

Reverta artefatos versionados do banco local, se aparecerem no `git status`:
`git checkout -- node_modules supabase/.temp` (esses caminhos são rastreados no repositório). Confirme com `git status` que só os arquivos desta fase estão alterados.

- [ ] **Step 4: Abrir o PR**

```bash
git push -u origin feat/orcamento-em-dolar
```

Crie `pr_orcamento_dolar.md` na pasta temporária da sessão com: o que muda (a seção "Visão geral" do spec em linguagem simples), o **roteiro de produção** abaixo, o que NÃO muda (financeiro em reais) e os testes feitos. O corpo termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Depois:

```bash
gh pr create --base main --head feat/orcamento-em-dolar --title "feat: orçamento em dólar (Fase 1)" --body-file <caminho do pr_orcamento_dolar.md>
```

- [ ] **Step 5: Roteiro de produção (só com a autorização do Caio, nesta ordem)**

1. **Conferir a RPC antes de substituir.** No SQL Editor de produção, o Caio roda
   `select pg_get_functiondef('public.get_public_budget_by_token(uuid)'::regprocedure);`
   e compara com a função de `supabase/migrations/2026093350_public_budget_imposto_reajusta.sql`. Só pode diferir pelas duas linhas novas (`currency`, `fx_rate`) que a migration acrescenta. Se a de produção tiver algo a mais, parar e ajustar a migration antes.
2. **Rodar a migration `2026100900_orcamento_em_dolar.sql`** no SQL Editor de produção (SQL completo colado no chat para o Caio copiar). Conferir depois:
   `select column_name from information_schema.columns where table_name='budget_versions' and column_name like 'fx_%' or column_name='currency';` (esperado: 6 linhas) e `select tgname from pg_trigger where tgname='trg_trava_cotacao_aprovado';` (esperado: 1 linha).
3. **Deploy da função:** `supabase functions deploy cotacao` (com JWT, o padrão). Smoke test: abrir um orçamento, trocar para US$ e conferir que a cotação vem do Banco Central (e que `cotacoes_dia` ganhou uma linha).
4. **Merge do PR** (`gh pr merge --merge --delete-branch`, a pedido do Caio) e esperar o deploy da Vercel.
5. **Teste em produção com um orçamento de teste:** US$, PDF, link público. Não aprovar um orçamento real só para testar.

**Se algo der errado depois do merge:** o front antigo continua funcionando com as colunas novas no banco (são aditivas), então o rollback é só reverter o merge; a migration não precisa ser desfeita.
