# Orçamento em dólar — Fase 2 (recebimento em reais convertidos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Em Contas a Receber, mostrar a referência em US$ nos títulos de propostas em dólar e permitir registrar o recebimento informando o **valor total recebido em reais, já convertido**, fechando o título mesmo que o valor seja maior ou menor que o previsto.

**Architecture:** Uma RPC `registrar_recebimento_cambial` (SECURITY DEFINER, checa `pode_ver_financeiro()`) faz, num único UPDATE atômico, `total_amount = received_amount = valor real`, `status = 'recebido'`, guarda o previsto numa coluna nova `receivables.valor_previsto` e registra antes/depois em `reconciliacao_recebimento_log`. O front mostra "US$ x" (previsto ÷ cotação travada da versão ligada ao título) e abre um modal novo ao marcar "Recebido" num título em dólar. Todo o resto do financeiro segue em reais.

**Tech Stack:** React 19 + TypeScript, Supabase (Postgres RPC), testes de linha de comando (`node --test` e `psql` local).

**Spec:** `docs/superpowers/specs/2026-10-09-orcamento-em-dolar-design.md` (§7, e decisão 3 fechada em 2026-10-09: "ajustar o `total_amount` do título ao valor real recebido; o previsto fica no log").

## Desvios do spec (resultado do mapeamento do código; deliberados)

1. **Coluna nova `receivables.valor_previsto`** (o spec dizia "sem coluna nova"). Motivo: a referência em US$ é `previsto ÷ cotação`; se o `total_amount` vira o valor real, o US$ contratado se perderia, e o log de auditoria não é legível pelo app. A coluna é preenchida uma única vez, no primeiro ajuste, e nunca muda.
2. **O modal "Registrar Recebimento" que existe hoje é código morto** (`setIsPayModalOpen(true)` nunca é chamado). O recebimento acontece pelo **menu de status** (`applyStatus`) e pelo **lote** (`handleBatchReceive`), que gravam o valor previsto. Por isso o modal novo é aberto a partir de `applyStatus`, e o lote **exclui** títulos em dólar. O modal morto não é tocado.
3. A RPC checa o papel com `pode_ver_financeiro()` (admin ou `financeiro_admin`), igual ao `automacoes_do_banco`. As RPCs financeiras anteriores (`definir_parcelamento`) não checam papel; esta é financeira e altera valores, então checa.

## Global Constraints

- O financeiro é **100% em reais**: `valor_vendido`, `vw_rentabilidade` e Custos de Projeto **não mudam** (o `valor_vendido` continua sendo o valor previsto em reais).
- O ajuste é **um único UPDATE** com `total_amount`, `received_amount`, `status` e `received_at` juntos. Dois UPDATEs fazem o gatilho `trg_receivable_reflete_projeto` reabrir o projeto por um instante. **Não** usar a configuração `lumos.reconciliando` na RPC (ela desliga o espelhamento com Custos de Projeto).
- `received_at` segue a convenção do app: meia-noite UTC do dia informado (`p_data::timestamp AT TIME ZONE 'UTC'`).
- Só títulos em dólar usam este fluxo: `budget_version_id` apontando para uma versão com `currency = 'USD'`. Título manual (sem versão) ou em R$ continua exatamente como hoje.
- Só entra em `recebido` quem não está `cancelado` nem `recebido`. Valor recebido > 0. Valores com 2 casas.
- SQL **só o Caio roda em produção**; testes de SQL só no banco **local**. Sem downloads reais de arquivos nos testes de tela. Tokens `lumos-*`, sem cores cruas (as classes `text-red-500`/`text-green-500`/`text-amber-500` já usadas na tela são aceitas). Desktop não regride.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (exatamente este nome de modelo). PR termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Ordem de produção:** a consulta de Contas a Receber agora embute `budget_versions(currency, fx_rate)` (`budget_version:budget_versions!budget_version_id(...)`), então a migration da Fase 1 `2026100900` PRECISA já estar aplicada em produção (está: aplicada pelo Caio em 2026-10-09). Se faltasse, a lista de Contas a Receber renderizaria VAZIA em silêncio (o erro só vai para `console.error`). Ordem: confirmar que `2026100900` está aplicada → aplicar `2026101000` (coluna `valor_previsto` + RPC) → merge do front. Se o front subir antes da `2026101000`, o botão do modal falharia sem a RPC; portanto: migration primeiro.

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/utils/moeda.ts` | modificar | `usdDoTitulo` (referência US$ do título) e `parseValorBR` (texto "51.200,50" → número). |
| `scripts/testes/moeda.test.mjs` | modificar | Testes das duas funções novas. |
| `supabase/migrations/2026101000_recebimento_cambial.sql` | criar | Coluna `valor_previsto` e RPC `registrar_recebimento_cambial`. |
| `scripts/testes/recebimento_cambial_banco.sql` | criar | Teste do banco local (RPC, permissões, log, espelhamento com o projeto). Termina em ROLLBACK. |
| `src/components/financeiro/RecebimentoUsdModal.tsx` | criar | Modal: valor recebido em reais + data; chama a RPC. |
| `src/pages/ContasReceber.tsx` | modificar | Consulta com a versão, "US$ x" na linha/cartão/Excel, intercepta `applyStatus`, exclui dólar do lote, monta o modal. |

**Branch:** já criado a partir do `main`: `feat/dolar-fase-2-recebimento`.

---

### Task 1: Funções puras (`usdDoTitulo`, `parseValorBR`)

**Files:**
- Modify: `src/utils/moeda.ts` (acrescentar ao final)
- Modify: `scripts/testes/moeda.test.mjs` (acrescentar testes e ampliar o import)

**Interfaces:**
- Consumes: `moedaDaVersao`, `converterValor`, `VersaoMoeda` (já existem em `moeda.ts`).
- Produces (usado pelas Tasks 3 e 4):
  - `usdDoTitulo(titulo: { total_amount?: number | string | null; valor_previsto?: number | string | null }, versao?: VersaoMoeda | null): number | null`
  - `parseValorBR(texto: string): number | null`

- [ ] **Step 1: Escrever os testes que falham**

No topo de `scripts/testes/moeda.test.mjs`, troque o bloco de import por:

```js
import {
  SPREAD_PADRAO, calcCotacaoTravada, converterValor, formatarMoeda,
  formatarValorDaVersao, moedaDaVersao, taxaDaVersao, camposDeMoeda, diasDesde,
  usdDoTitulo, parseValorBR,
} from '../../src/utils/moeda.ts';
```

(Se o import atual já difere em formatação, só acrescente `usdDoTitulo, parseValorBR`.) No fim do arquivo, acrescente:

```js
test('referência em US$ de um título: previsto em reais ÷ cotação travada', () => {
  assert.equal(usdDoTitulo({ total_amount: 5000 }, usd), 1030.93);
  // depois do recebimento, total_amount vira o valor real; o US$ continua o contratado (valor_previsto)
  assert.equal(usdDoTitulo({ total_amount: 5300, valor_previsto: 5000 }, usd), 1030.93);
  assert.equal(usdDoTitulo({ total_amount: '5000', valor_previsto: null }, usd), 1030.93);
});

test('título sem versão em dólar não tem referência em US$', () => {
  assert.equal(usdDoTitulo({ total_amount: 5000 }, { currency: 'BRL', fx_rate: 4.85 }), null);
  assert.equal(usdDoTitulo({ total_amount: 5000 }, null), null);
  assert.equal(usdDoTitulo({ total_amount: 5000 }, { currency: 'USD', fx_rate: null }), null);
  assert.equal(usdDoTitulo({ total_amount: null, valor_previsto: null }, usd), null);
});

test('lê valores em reais digitados à brasileira', () => {
  assert.equal(parseValorBR('51.200,50'), 51200.5);
  assert.equal(parseValorBR('51200,5'), 51200.5);
  assert.equal(parseValorBR('R$ 51.200,00'), 51200);
  assert.equal(parseValorBR('51.200'), 51200);     // ponto de milhar
  assert.equal(parseValorBR('51200.5'), 51200.5);  // ponto decimal
  assert.equal(parseValorBR('1.5'), 1.5);
  assert.equal(parseValorBR('1.234.567'), 1234567);
});

test('valor digitado inválido vira null', () => {
  assert.equal(parseValorBR(''), null);
  assert.equal(parseValorBR('   '), null);
  assert.equal(parseValorBR('abc'), null);
  assert.equal(parseValorBR('0'), null);
  assert.equal(parseValorBR('-5'), null);
});
```

(`usd` já está definido no topo do arquivo: `{ currency: 'USD', fx_rate: 4.85 }`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test scripts/testes/moeda.test.mjs`
Expected: FAIL (`usdDoTitulo` / `parseValorBR` não exportados — erro de import).

- [ ] **Step 3: Implementar**

Acrescente ao final de `src/utils/moeda.ts`:

```ts
/**
 * Referência em US$ de um título (parcela) de proposta em dólar: o valor PREVISTO
 * em reais ÷ cotação travada da versão. Depois do recebimento o `total_amount`
 * passa a ser o valor real; o previsto fica em `valor_previsto`, então o US$
 * contratado continua o mesmo. null se a versão não for em dólar.
 */
export function usdDoTitulo(
  titulo: { total_amount?: number | string | null; valor_previsto?: number | string | null },
  versao?: VersaoMoeda | null,
): number | null {
  if (moedaDaVersao(versao) !== 'USD') return null;
  const bruto = titulo.valor_previsto ?? titulo.total_amount;
  if (bruto == null) return null;
  const base = Number(bruto);
  return Number.isFinite(base) ? converterValor(base, versao) : null;
}

/**
 * Lê um valor em reais digitado à brasileira ("51.200,50", "51200,5", "R$ 51.200").
 * Com vírgula, os pontos são milhar e a vírgula é o decimal. Sem vírgula, pontos
 * seguidos de exatamente 3 dígitos são milhar ("51.200" = 51200); caso contrário o
 * ponto é decimal ("51200.5"). Devolve null se não houver valor positivo.
 */
export function parseValorBR(texto: string): number | null {
  const t = String(texto ?? '').replace(/R\$|\s/g, '');
  if (!t) return null;
  let normal: string;
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '');
  else normal = t;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test scripts/testes/moeda.test.mjs`
Expected: `ℹ fail 0` (os 8 testes antigos + 4 novos = 12 passando).

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/utils/moeda.ts scripts/testes/moeda.test.mjs
git commit -m "feat: referência em US$ do título e leitura de valores em reais" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — `valor_previsto` e RPC `registrar_recebimento_cambial`

**Files:**
- Create: `supabase/migrations/2026101000_recebimento_cambial.sql`
- Create: `scripts/testes/recebimento_cambial_banco.sql`

**Interfaces:**
- Consumes: `public.pode_ver_financeiro()` (existe, migration `2026093307`), tabelas `receivables`, `budget_versions`, `reconciliacao_recebimento_log` (colunas `receivable_id`, `projeto_financeiro_id`, `antes`, `depois`).
- Produces (usado pelas Tasks 3 e 4):
  - coluna `receivables.valor_previsto numeric` (nulável);
  - `registrar_recebimento_cambial(p_receivable_id uuid, p_valor_brl numeric, p_data date) RETURNS jsonb`: `{ok:true, previsto, recebido, diferenca}` ou `{ok:false, error}` com `error` em `valor_invalido | data_invalida | nao_encontrado | status_invalido | nao_e_dolar`; sem permissão levanta exceção `42501`.

- [ ] **Step 1: Escrever o teste do banco (vai falhar sem a migration)**

Crie `scripts/testes/recebimento_cambial_banco.sql`:

```sql
-- Teste do banco LOCAL para a migration 2026101000. Não rodar em produção.
-- Tudo termina em ROLLBACK.
-- Rodar: docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/recebimento_cambial_banco.sql
BEGIN;

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
  v_admin uuid; v_cli uuid;
  v_b uuid; v_v uuid; v_b2 uuid; v_v2 uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid;
  v_res jsonb; v_tot numeric; v_rec numeric; v_st text; v_prev numeric; v_dt date; v_n int; v_proj text;
BEGIN
  SELECT auth_user_id INTO v_admin FROM app_users
   WHERE role = 'admin' AND status = 'ativo' AND auth_user_id IS NOT NULL LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'FALHOU: não há admin ativo no banco local'; END IF;

  INSERT INTO clients (name) VALUES ('Cliente teste dólar') RETURNING id INTO v_cli;

  -- Proposta em US$ com duas parcelas de R$ 2.500 (cotação travada 4,85) e projeto financeiro.
  INSERT INTO budgets (code, project_name, category, status, client_id)
  VALUES ('TESTE-RCB', 'Teste recebimento', 'digital', 'em_negociacao', v_cli) RETURNING id INTO v_b;
  INSERT INTO budget_versions (budget_id, version_number, currency, fx_market_rate, fx_rate, fx_source)
  VALUES (v_b, 1, 'USD', 5, 4.85, 'manual') RETURNING id INTO v_v;
  INSERT INTO projetos_financeiro (proposta_id, cliente_id, valor_vendido, nf_percent, status_titulo)
  VALUES (v_b, v_cli, 5000, 0.18, 'esperando_pagamento');
  INSERT INTO receivables (budget_id, budget_version_id, description, client_id, total_amount, status, origem, parcela_numero, parcela_total)
  VALUES (v_b, v_v, 'Parcela 1', v_cli, 2500, 'aguardando', 'proposta', 1, 2) RETURNING id INTO v_r1;
  INSERT INTO receivables (budget_id, budget_version_id, description, client_id, total_amount, status, origem, parcela_numero, parcela_total)
  VALUES (v_b, v_v, 'Parcela 2', v_cli, 2500, 'aguardando', 'proposta', 2, 2) RETURNING id INTO v_r2;

  -- Proposta em R$ (não pode usar este fluxo).
  INSERT INTO budgets (code, project_name, category, status, client_id)
  VALUES ('TESTE-RCB2', 'Teste em reais', 'digital', 'em_negociacao', v_cli) RETURNING id INTO v_b2;
  INSERT INTO budget_versions (budget_id, version_number) VALUES (v_b2, 1) RETURNING id INTO v_v2;
  INSERT INTO receivables (budget_id, budget_version_id, description, client_id, total_amount, status, origem)
  VALUES (v_b2, v_v2, 'Em reais', v_cli, 1000, 'aguardando', 'proposta') RETURNING id INTO v_r3;

  -- 1) Grants: anon NÃO executa; authenticated executa.
  IF has_function_privilege('anon', 'public.registrar_recebimento_cambial(uuid,numeric,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU: anon não pode executar a RPC';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.registrar_recebimento_cambial(uuid,numeric,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU: authenticated deveria executar a RPC';
  END IF;
  RAISE NOTICE 'OK   grants: anon fechado, authenticated aberto';

  -- 2) Quem não é do financeiro é recusado.
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  PERFORM pg_temp.deve_falhar(format('SELECT registrar_recebimento_cambial(%L, 2600, ''2026-10-09'')', v_r1), 'usuário sem permissão é recusado');

  -- A partir daqui, como admin.
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- 3) Entradas inválidas.
  v_res := registrar_recebimento_cambial(v_r1, 0, '2026-10-09');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'valor_invalido' THEN RAISE EXCEPTION 'FALHOU: valor 0: %', v_res; END IF;
  v_res := registrar_recebimento_cambial(v_r1, 2600, NULL);
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'data_invalida' THEN RAISE EXCEPTION 'FALHOU: data nula: %', v_res; END IF;
  v_res := registrar_recebimento_cambial(gen_random_uuid(), 2600, '2026-10-09');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'nao_encontrado' THEN RAISE EXCEPTION 'FALHOU: id inexistente: %', v_res; END IF;
  v_res := registrar_recebimento_cambial(v_r3, 1000, '2026-10-09');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'nao_e_dolar' THEN RAISE EXCEPTION 'FALHOU: título em reais: %', v_res; END IF;
  RAISE NOTICE 'OK   entradas inválidas e título em reais são recusados';

  -- 4) Recebimento ACIMA do previsto (2600 > 2500): ajusta total e recebido, guarda o previsto.
  v_res := registrar_recebimento_cambial(v_r1, 2600, '2026-10-09');
  IF NOT (v_res->>'ok')::boolean OR (v_res->>'previsto')::numeric <> 2500 OR (v_res->>'recebido')::numeric <> 2600 OR (v_res->>'diferenca')::numeric <> 100 THEN
    RAISE EXCEPTION 'FALHOU: retorno do recebimento acima do previsto: %', v_res;
  END IF;
  SELECT total_amount, received_amount, status::text, valor_previsto, (received_at AT TIME ZONE 'UTC')::date
    INTO v_tot, v_rec, v_st, v_prev, v_dt FROM receivables WHERE id = v_r1;
  IF v_tot <> 2600 OR v_rec <> 2600 OR v_st <> 'recebido' OR v_prev <> 2500 OR v_dt <> '2026-10-09' THEN
    RAISE EXCEPTION 'FALHOU: linha após o recebimento: total %, recebido %, status %, previsto %, data %', v_tot, v_rec, v_st, v_prev, v_dt;
  END IF;
  RAISE NOTICE 'OK   recebimento acima do previsto ajusta total/recebido e guarda o previsto';

  -- 5) Auditoria: uma linha de log com antes/depois.
  SELECT count(*) INTO v_n FROM reconciliacao_recebimento_log
   WHERE receivable_id = v_r1 AND (antes->>'total_amount')::numeric = 2500 AND (depois->>'total_amount')::numeric = 2600
     AND (depois->>'valor_previsto')::numeric = 2500;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: esperava 1 linha de log, veio %', v_n; END IF;
  RAISE NOTICE 'OK   auditoria registrada em reconciliacao_recebimento_log';

  -- 6) Com a parcela 2 ainda aberta, o projeto NÃO fica recebido.
  SELECT status_titulo::text INTO v_proj FROM projetos_financeiro WHERE proposta_id = v_b;
  IF v_proj = 'pagamento_recebido' THEN RAISE EXCEPTION 'FALHOU: projeto não pode ficar recebido com parcela aberta'; END IF;
  RAISE NOTICE 'OK   projeto segue aberto enquanto há parcela aberta';

  -- 7) Já recebido: recusa. (não deixa ajustar de novo nem trocar o previsto)
  v_res := registrar_recebimento_cambial(v_r1, 9999, '2026-10-10');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'status_invalido' THEN RAISE EXCEPTION 'FALHOU: título já recebido: %', v_res; END IF;
  SELECT valor_previsto INTO v_prev FROM receivables WHERE id = v_r1;
  IF v_prev <> 2500 THEN RAISE EXCEPTION 'FALHOU: o previsto não pode mudar (veio %)', v_prev; END IF;
  RAISE NOTICE 'OK   título já recebido é recusado e o previsto não muda';

  -- 8) Recebimento ABAIXO do previsto (2300 < 2500) na última parcela: o projeto fecha.
  v_res := registrar_recebimento_cambial(v_r2, 2300, '2026-10-12');
  IF NOT (v_res->>'ok')::boolean OR (v_res->>'diferenca')::numeric <> -200 THEN RAISE EXCEPTION 'FALHOU: recebimento abaixo do previsto: %', v_res; END IF;
  SELECT status::text, total_amount, received_amount INTO v_st, v_tot, v_rec FROM receivables WHERE id = v_r2;
  IF v_st <> 'recebido' OR v_tot <> 2300 OR v_rec <> 2300 THEN RAISE EXCEPTION 'FALHOU: parcela 2: % % %', v_st, v_tot, v_rec; END IF;
  SELECT status_titulo::text INTO v_proj FROM projetos_financeiro WHERE proposta_id = v_b;
  IF v_proj <> 'pagamento_recebido' THEN RAISE EXCEPTION 'FALHOU: com todas as parcelas recebidas o projeto deveria fechar (veio %)', v_proj; END IF;
  RAISE NOTICE 'OK   recebimento abaixo do previsto fecha a parcela e o projeto';

  -- 9) Título cancelado: recusa (a checagem de status vem antes da de moeda).
  UPDATE receivables SET status = 'cancelado' WHERE id = v_r3;
  v_res := registrar_recebimento_cambial(v_r3, 100, '2026-10-12');
  IF (v_res->>'ok')::boolean OR v_res->>'error' <> 'status_invalido' THEN RAISE EXCEPTION 'FALHOU: título cancelado: %', v_res; END IF;
  RAISE NOTICE 'OK   título cancelado é recusado';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Subir o banco local e ver o teste falhar**

O Docker é o OrbStack (abra-o se necessário): `orbctl start`.

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/recebimento_cambial_banco.sql`
Expected: FAIL (`function public.registrar_recebimento_cambial(uuid, numeric, date) does not exist` ou coluna `valor_previsto` inexistente).

- [ ] **Step 3: Escrever a migration**

Crie `supabase/migrations/2026101000_recebimento_cambial.sql`:

```sql
-- RECEBIMENTO EM REAIS CONVERTIDOS (orçamento em dólar, Fase 2)
--
-- O cliente paga em US$, o banco converte, e o que entra na conta em reais depende
-- da cotação do dia. Esta RPC fecha o título de uma proposta em dólar com o valor
-- REALMENTE recebido em reais (maior ou menor que o previsto).
--
-- Tudo num único UPDATE (total_amount, received_amount, status, received_at juntos):
-- o gatilho trg_receivable_reflete_projeto compara apenas somas e, vendo a linha já
-- final, fecha o projeto quando todas as parcelas estão recebidas. Dois UPDATEs
-- fariam o projeto reabrir por um instante. NÃO se usa a configuração
-- lumos.reconciliando: ela desligaria o espelhamento com Custos de Projeto.
--
-- valor_previsto guarda o total em reais ANTES do ajuste (preenchido uma única vez);
-- é dele que sai a referência em US$ na tela (previsto ÷ cotação travada da versão).
-- O valor_vendido do projeto continua sendo o previsto em reais (não muda aqui).
--
-- Aditiva e segura de rodar antes do deploy do front.

ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS valor_previsto numeric;

COMMENT ON COLUMN public.receivables.valor_previsto IS
  'Total em reais antes do ajuste pelo valor realmente recebido (propostas em dólar). Preenchido uma única vez.';

CREATE OR REPLACE FUNCTION public.registrar_recebimento_cambial(
  p_receivable_id uuid,
  p_valor_brl     numeric,
  p_data          date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          receivables%ROWTYPE;
  v_moeda    text;
  v_previsto numeric;
  v_valor    numeric;
BEGIN
  IF NOT public.pode_ver_financeiro() THEN
    RAISE EXCEPTION 'Sem permissão para registrar recebimentos.' USING ERRCODE = '42501';
  END IF;

  IF p_valor_brl IS NULL OR p_valor_brl <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'valor_invalido');
  END IF;
  IF p_data IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'data_invalida');
  END IF;
  v_valor := round(p_valor_brl, 2);

  SELECT * INTO r FROM receivables WHERE id = p_receivable_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nao_encontrado');
  END IF;
  IF r.status IN ('cancelado', 'recebido') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'status_invalido');
  END IF;

  SELECT bv.currency INTO v_moeda FROM budget_versions bv WHERE bv.id = r.budget_version_id;
  IF v_moeda IS DISTINCT FROM 'USD' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nao_e_dolar');
  END IF;

  v_previsto := COALESCE(r.valor_previsto, r.total_amount);

  UPDATE receivables
     SET valor_previsto  = v_previsto,
         total_amount    = v_valor,
         received_amount = v_valor,
         status          = 'recebido',
         received_at     = p_data::timestamp AT TIME ZONE 'UTC',
         updated_at      = now()
   WHERE id = r.id;

  INSERT INTO reconciliacao_recebimento_log (receivable_id, antes, depois)
  VALUES (
    r.id,
    jsonb_build_object('total_amount', r.total_amount, 'received_amount', r.received_amount, 'status', r.status),
    jsonb_build_object('total_amount', v_valor, 'received_amount', v_valor, 'status', 'recebido',
                       'valor_previsto', v_previsto, 'moeda_origem', 'USD', 'por', auth.uid())
  );

  RETURN jsonb_build_object('ok', true, 'previsto', v_previsto, 'recebido', v_valor, 'diferenca', v_valor - v_previsto);
END;
$$;

-- No Supabase o REVOKE FROM PUBLIC sozinho não fecha o acesso de anon.
REVOKE ALL ON FUNCTION public.registrar_recebimento_cambial(uuid, numeric, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_recebimento_cambial(uuid, numeric, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_recebimento_cambial(uuid, numeric, date) TO authenticated;
```

- [ ] **Step 4: Aplicar no banco local e rodar o teste**

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/2026101000_recebimento_cambial.sql`
Expected: `ALTER TABLE`, `COMMENT`, `CREATE FUNCTION`, `REVOKE`, `REVOKE`, `GRANT`, sem erro. (Se o banco local estiver estranho, `supabase db reset` reconstrói tudo e aplica esta migration junto.)

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/recebimento_cambial_banco.sql`
Expected: 9 linhas `NOTICE:  OK   ...` (casos 1 a 9: grants, sem permissão, entradas inválidas, acima do previsto, auditoria, projeto aberto, já recebido, abaixo do previsto fechando o projeto, cancelado), nenhuma `FALHOU`, termina em `ROLLBACK`.

Se um teste falhar por coluna `NOT NULL` do fixture (por exemplo em `budgets`, `clients` ou `projetos_financeiro`), ajuste **somente os INSERTs do fixture** do teste; se falhar por comportamento da RPC, é defeito da migration.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026101000_recebimento_cambial.sql scripts/testes/recebimento_cambial_banco.sql
git commit -m "feat: RPC de recebimento em reais convertidos para propostas em dólar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Modal `RecebimentoUsdModal`

**Files:**
- Create: `src/components/financeiro/RecebimentoUsdModal.tsx`

**Interfaces:**
- Consumes: `supabase.rpc('registrar_recebimento_cambial', { p_receivable_id, p_valor_brl, p_data })` → `{ok, error?, previsto?, recebido?, diferenca?}` (Task 2); `formatarMoeda`, `parseValorBR`, `usdDoTitulo` (Task 1); `Modal` (`isOpen`, `onClose`, `title`, `children`, `maxWidth`); `DatePicker` (`value`, `onChange(value|null)`); `useToast()` com `.error`.
- Produces (usado pela Task 4): default export `RecebimentoUsdModal` com props `{ titulo: any; onClose: () => void; onDone: (r: { previsto: number; recebido: number }) => void }`. `titulo` é um `receivable` com `budget_version` embutida (`currency`, `fx_rate`) e `valor_previsto` opcional.

- [ ] **Step 1: Criar o componente**

Crie `src/components/financeiro/RecebimentoUsdModal.tsx`:

```tsx
import { useState } from 'react';
import { clsx } from 'clsx';
import Modal from '@/components/common/Modal';
import DatePicker from '@/components/ui/DatePicker';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { formatarMoeda, parseValorBR, usdDoTitulo } from '@/utils/moeda';

export interface RecebimentoUsdResultado {
  previsto: number;
  recebido: number;
}

interface Props {
  /** Título (receivable) com `budget_version` embutida (currency, fx_rate) e `valor_previsto` opcional. */
  titulo: any;
  onClose: () => void;
  onDone: (r: RecebimentoUsdResultado) => void;
}

const ERROS: Record<string, string> = {
  valor_invalido: 'Informe um valor em reais maior que zero.',
  data_invalida: 'Informe a data em que o dinheiro entrou.',
  nao_encontrado: 'Este título não existe mais.',
  status_invalido: 'Este título já está recebido ou foi cancelado.',
  nao_e_dolar: 'Este título não é de uma proposta em dólar.',
};

// Data local de hoje (AAAA-MM-DD), sem o desvio de fuso do toISOString.
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function RecebimentoUsdModal({ titulo, onClose, onDone }: Props) {
  const toast = useToast();
  const [texto, setTexto] = useState('');
  const [data, setData] = useState<string | null>(hoje());
  const [salvando, setSalvando] = useState(false);

  const previsto = Number(titulo.valor_previsto ?? titulo.total_amount ?? 0);
  const usd = usdDoTitulo(titulo, titulo.budget_version);
  const valor = parseValorBR(texto);
  const diferenca = valor != null ? Math.round((valor - previsto) * 100) / 100 : null;
  const muitoDiferente = diferenca != null && previsto > 0 && Math.abs(diferenca) / previsto > 0.15;

  const confirmar = async () => {
    if (valor == null) { toast.error(ERROS.valor_invalido); return; }
    if (!data) { toast.error(ERROS.data_invalida); return; }
    setSalvando(true);
    try {
      const { data: r, error } = await supabase.rpc('registrar_recebimento_cambial', {
        p_receivable_id: titulo.id,
        p_valor_brl: valor,
        p_data: data,
      });
      if (error) throw error;
      if (!r?.ok) { toast.error(ERROS[r?.error] || 'Não foi possível registrar o recebimento.'); return; }
      onDone({ previsto: Number(r.previsto), recebido: Number(r.recebido) });
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível registrar o recebimento.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Registrar recebimento em dólar" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="text-xs text-lumos-text-secondary space-y-1">
          <p className="font-bold text-lumos-text-primary text-sm">{titulo.description}</p>
          <p>
            Previsto: <span className="font-bold text-lumos-text-primary">{formatarMoeda(previsto, 'BRL')}</span>
            {usd != null && <span> · {formatarMoeda(usd, 'USD')} contratados</span>}
          </p>
        </div>

        <div>
          <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-1 block">
            Valor recebido em R$ (já convertido)
          </label>
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            placeholder="Ex.: 51.200,00"
            className="input-lumos w-full"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {diferenca != null && (
            <p className={clsx('text-[11px] font-bold mt-1', diferenca >= 0 ? 'text-green-500' : 'text-red-500')}>
              Diferença para o previsto: {diferenca >= 0 ? '+' : '−'}{formatarMoeda(Math.abs(diferenca), 'BRL')} (variação cambial)
            </p>
          )}
          {muitoDiferente && (
            <p className="text-[11px] text-amber-500 mt-1">
              Confira o valor: ele difere mais de 15% do previsto.
            </p>
          )}
        </div>

        <div>
          <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-1 block">
            Data em que o dinheiro entrou
          </label>
          <DatePicker value={data} onChange={setData} />
        </div>

        <p className="text-[11px] text-lumos-text-secondary">
          O total deste título passa a ser o valor recebido; o previsto fica guardado para a referência em dólar.
        </p>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 h-10 text-sm">Cancelar</button>
          <button
            type="button"
            onClick={confirmar}
            disabled={salvando || valor == null || !data}
            className="btn-primary flex-1 h-10 text-sm font-bold disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Registrar recebimento'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. (O componente ainda não é usado; a Task 4 o conecta.)

- [ ] **Step 3: Commit**

```bash
git add src/components/financeiro/RecebimentoUsdModal.tsx
git commit -m "feat: modal para registrar o recebimento em reais de proposta em dólar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Contas a Receber — referência em US$, modal e lote

**Files:**
- Modify: `src/pages/ContasReceber.tsx`

**Interfaces:**
- Consumes: `RecebimentoUsdModal` (Task 3); `usdDoTitulo`, `formatarMoeda`, `moedaDaVersao` (Task 1 / `moeda.ts`); coluna `valor_previsto` e a RPC (Task 2).

- [ ] **Step 1: Imports e estado**

Depois de `import { RECEBIVEL_LABEL, dataRecebimentoExibida } from '@/lib/statusRecebimento';` (linha 33), acrescente:

```tsx
import RecebimentoUsdModal from '@/components/financeiro/RecebimentoUsdModal';
import { formatarMoeda, moedaDaVersao, usdDoTitulo } from '@/utils/moeda';
```

Depois de `const [parcelando, setParcelando] = useState<{ budgetId: string; nome?: string } | null>(null);` (linha 60), acrescente:

```tsx
  // Título de proposta em dólar que está sendo recebido (abre o modal do valor em reais).
  const [usdReceber, setUsdReceber] = useState<any | null>(null);
```

- [ ] **Step 2: Consulta com a versão do orçamento**

Troque

```tsx
        supabase.from('receivables').select('*, client:clients(name), budget:budgets(id, project_name, code)').order('due_date', { ascending: true }),
```

por

```tsx
        supabase.from('receivables').select('*, client:clients(name), budget:budgets(id, project_name, code), budget_version:budget_versions!budget_version_id(id, currency, fx_rate)').order('due_date', { ascending: true }),
```

- [ ] **Step 3: Helper de referência em US$**

Logo depois da linha do `lucroOf` (`const lucroOf = (r: any): number | null => ...`, ~linha 373), acrescente:

```tsx
  // Referência em US$ (só propostas em dólar): previsto em reais ÷ cotação travada da versão.
  const usdOf = (r: any): number | null => usdDoTitulo(r, r.budget_version);
  const emDolar = (r: any): boolean => moedaDaVersao(r.budget_version) === 'USD';
```

- [ ] **Step 4: Interceptar "Recebido" no menu de status**

Troque

```tsx
  const applyStatus = async (r: any, newStatus: string) => {
    setStatusMenuOpen(null);
    try {
```

por

```tsx
  const applyStatus = async (r: any, newStatus: string) => {
    setStatusMenuOpen(null);
    // Proposta em dólar: o que entra é o valor em reais JÁ CONVERTIDO, que só quem
    // recebeu sabe. Abre o modal em vez de gravar o previsto.
    if (newStatus === 'recebido' && r.status !== 'recebido' && emDolar(r)) {
      setUsdReceber(r);
      return;
    }
    try {
```

(`emDolar` é declarada mais abaixo como `const` dentro do componente; como `applyStatus` só é chamada depois da renderização, o acesso é seguro.)

- [ ] **Step 5: Lote não inclui títulos em dólar**

Troque

```tsx
    const toReceive = filtered.filter(r => selectedIds.has(r.id) && r.status !== 'recebido');
    if (toReceive.length === 0) return;
```

por

```tsx
    const selecionados = filtered.filter(r => selectedIds.has(r.id) && r.status !== 'recebido');
    // Título em dólar precisa do valor recebido em reais: não entra no lote.
    const emDolarSel = selecionados.filter(emDolar);
    if (emDolarSel.length > 0) {
      toast.warning(`${emDolarSel.length} título(s) em dólar ficaram de fora: registre o valor recebido em reais de cada um pelo menu de status.`);
    }
    const toReceive = selecionados.filter(r => !emDolar(r));
    if (toReceive.length === 0) return;
```

- [ ] **Step 6: "US$ x" na linha da tabela, no cartão e no Excel**

Linha da tabela — troque

```tsx
      <td className="px-6 py-4 text-right text-sm font-bold text-lumos-text-primary whitespace-nowrap">{brl(Number(r.total_amount || 0))}</td>
```

por

```tsx
      <td className="px-6 py-4 text-right text-sm font-bold text-lumos-text-primary whitespace-nowrap">
        {brl(Number(r.total_amount || 0))}
        {usdOf(r) != null && (
          <div className="text-[10px] font-semibold text-lumos-text-secondary">{formatarMoeda(usdOf(r) as number, 'USD')}</div>
        )}
      </td>
```

Cartão do celular — troque

```tsx
          <span className="font-black font-mono text-sm text-lumos-text-primary whitespace-nowrap">{brl(Number(r.total_amount || 0))}</span>
```

por

```tsx
          <span className="font-black font-mono text-sm text-lumos-text-primary whitespace-nowrap">{brl(Number(r.total_amount || 0))}</span>
          {usdOf(r) != null && (
            <span className="text-[10px] font-semibold text-lumos-text-secondary whitespace-nowrap">{formatarMoeda(usdOf(r) as number, 'USD')}</span>
          )}
```

Excel — troque

```tsx
                'Valor (R$)': r.total_amount,
```

por

```tsx
                'Valor (R$)': r.total_amount,
                'Valor (US$)': usdOf(r) ?? '',
```

- [ ] **Step 7: Montar o modal e avisar os admins**

Depois do bloco `{parcelando && ( ... )}` (termina em `)}` logo antes de `<Modal isOpen={isDeleteModalOpen}`), acrescente:

```tsx
      {usdReceber && (
        <RecebimentoUsdModal
          titulo={usdReceber}
          onClose={() => setUsdReceber(null)}
          onDone={async ({ recebido }) => {
            const r = usdReceber;
            setUsdReceber(null);
            toast.success('Recebimento registrado ✓');
            try {
              // Financeiro é sensível: só quem acessa a página (admins) é avisado.
              const admins = await getAdminUserIds();
              await notify({
                userIds: admins,
                event: NOTIFICATION_EVENTS.PAGAMENTO_RECEBIDO,
                title: 'Pagamento recebido',
                body: `${brl(recebido)} recebido de "${r?.client?.name || 'Cliente'}" para: ${r?.description}.`,
                link: '/financeiro/contas-receber',
              });
            } catch { /* o aviso não pode desfazer o recebimento já gravado */ }
            fetchReceivables(true);
          }}
        />
      )}
```

- [ ] **Step 8: Conferir tipos e testar na tela (banco local)**

Run: `npx tsc --noEmit`
Expected: sem erros.

Teste na tela, **só contra o banco local** (Supabase local em `http://127.0.0.1:54321`, `.env.local` já aponta para ele; login de teste local `caio.lacerda@produtoralumos.com.br` / `password123`, que existe só no banco local). Aplique antes a migration da Task 2 no banco local. Prepare, por SQL local, um orçamento de teste em dólar com uma parcela: o orçamento `TST-001` (versão em USD, cotação travada 4,85) já existe; crie dois títulos para ele (`origem 'proposta'`, `budget_version_id` = a versão USD, `total_amount` 2500 cada, `parcela_numero` 1 e 2) e um título de outro orçamento em R$. Rode `npm run dev` em segundo plano e abra Financeiro → Contas → A Receber. **Sem downloads reais** (não clique em Excel/PDF). Confira:
1. O título em dólar mostra `R$ 2.500,00` e, abaixo, `US$ 515,46` (2500 ÷ 4,85). O título em R$ não mostra US$. No celular (viewport estreito) o cartão mostra o `US$` ao lado.
2. Menu de status do título em dólar → **Recebido**: abre o modal "Registrar recebimento em dólar", mostrando o previsto, o `US$ 515,46 contratados`, o campo de valor e a data de hoje. Digite `2.600,00`: aparece `Diferença para o previsto: +R$ 100,00`. Digite `5.000`: aparece o aviso de mais de 15%. Clique em **Registrar recebimento**: o título fica **Recebido** com `R$ 2.600,00`, e o `US$ 515,46` continua (previsto preservado). No banco: `total_amount = received_amount = 2600`, `valor_previsto = 2500`.
3. Segunda parcela: **Recebido** com `2.300,00` (abaixo do previsto): `−R$ 200,00`; ao confirmar, o projeto no Custos de Projeto passa a "Recebido" (todas as parcelas recebidas).
4. Menu de status de um título em R$ → **Recebido**: comportamento igual ao de antes (sem modal).
5. Selecione um título em dólar em aberto e um em R$ e use o recebimento em lote: aparece o aviso "1 título(s) em dólar ficaram de fora…" e só o título em R$ é recebido.
6. Cancelar o modal não altera nada.
7. Console do navegador sem erros novos.
Ao final, restaure o banco local se quiser (os dados são de teste).

- [ ] **Step 9: Commit**

```bash
git add src/pages/ContasReceber.tsx
git commit -m "feat: contas a receber mostra a referência em US\$ e registra recebimento em reais convertidos" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verificação final, PR e roteiro de produção

**Files:** nenhum arquivo de código novo.

- [ ] **Step 1: Verificações automáticas**

Run: `node --test scripts/testes/moeda.test.mjs scripts/testes/ptax.test.mjs`
Expected: `ℹ fail 0` (12 + 5 = 17 passando).

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/recebimento_cambial_banco.sql`
Expected: todos `OK`, termina em `ROLLBACK`.

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/moeda_banco.sql`
Expected: continua tudo `OK` (a Fase 1 não regrediu).

Run: `npm run build`
Expected: build conclui sem erros.

- [ ] **Step 2: Limpar o ambiente**

`git status` deve mostrar só os arquivos desta fase. Se `node_modules/.vite` ou `supabase/.temp` aparecerem modificados, `git checkout -- node_modules supabase/.temp`.

- [ ] **Step 3: Abrir o PR**

```bash
git push -u origin feat/dolar-fase-2-recebimento
```

Corpo do PR (arquivo temporário, `--body-file`): o que muda; o **roteiro de produção** abaixo; as **limitações conhecidas** abaixo; os testes feitos; termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

```bash
gh pr create --base main --head feat/dolar-fase-2-recebimento --title "feat: orçamento em dólar, Fase 2 (recebimento em reais convertidos)" --body-file <caminho do corpo>
```

**Roteiro de produção (só com a autorização do Caio, nesta ordem):**
1. Caio roda a migration `2026101000_recebimento_cambial.sql` no SQL Editor de produção (SQL completo colado no chat). Conferir: `select column_name from information_schema.columns where table_name='receivables' and column_name='valor_previsto';` (1 linha) e `select proname from pg_proc where proname='registrar_recebimento_cambial';` (1 linha).
2. Mesclar o PR.
3. Teste em produção com um título de teste de proposta em dólar (não usar um real só para testar).

**Limitações conhecidas (para o PR e para o Caio):**
- Marcar "Pagamento recebido" em **Custos de Projeto**, usar o **lote** em títulos em reais, ou a reconciliação por SQL quitam o título pelo valor **previsto**, sem pedir o valor em reais. Para propostas em dólar, o caminho certo é o menu de status de Contas a Receber.
- O `valor_vendido` do projeto (e portanto Rentabilidade, relatórios e dashboard) continua o valor **previsto**; a variação cambial real aparece no título. Re-aprovar o orçamento reescreve o `valor_vendido` com o previsto.
- Reabrir um título já recebido em dólar pelo menu de status devolve o status e restaura o `total_amount` para o previsto (`valor_previsto`, que segue guardado); o `valor_vendido` do projeto nunca é alterado pelo recebimento.
- `definir_parcelamento` calcula o saldo como `valor_vendido` − soma de `received_amount`; refazer o parcelamento de um projeto em dólar depois de um recebimento parcial carrega a variação cambial para a nova parcela (precisa de acompanhamento).
- Se o embed da versão do título vier nulo (versão apagada), o título é tratado como R$ e segue o caminho direto antigo.
