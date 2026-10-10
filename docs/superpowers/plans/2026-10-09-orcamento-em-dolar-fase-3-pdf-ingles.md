# Orçamento em dólar — Fase 3 (PDF da proposta em inglês) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exportar o PDF da proposta em **inglês americano**: textos fixos (cláusulas, rótulos, datas) por dicionário revisável, e textos do orçamento (nomes e descrições de itens, briefing, logística) traduzidos pela API do Claude (Sonnet 5.5), guardados na versão e **revisados/editados pelo usuário antes de exportar**.

**Architecture:** O idioma do PDF (`pdf_language`: `pt`|`en`) é independente da moeda e fica em `budget_versions`, junto com `translations` (jsonb). As traduções são um **glossário chaveado pelo texto original** (`{ "Diária de câmera": "Camera day rate" }`), não por id de item: assim sobrevivem a nova versão (itens ganham uuid novo), a reordenação e a repetição do mesmo texto; texto editado simplesmente fica "sem tradução" e cai no original. O `BudgetPDF` lê tudo de um dicionário (`pdfTextos.ts`); em português a saída tem que ficar **idêntica** à de hoje (teste de regressão por extração de texto do PDF). Uma Edge Function `traduzir-orcamento` (padrão do `extract-receipt`, com erro explícito) chama a API da Anthropic.

**Tech Stack:** React 19 + TypeScript, `@react-pdf/renderer`, `date-fns` (locale `enUS`), Supabase (Postgres + Edge Function em Deno), testes de linha de comando com `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-09-orcamento-em-dolar-design.md` (§8).

## Decisões fechadas com o Caio (2026-10-09)

1. Modelo da tradução: **Sonnet 5.5** (`claude-sonnet-5-5`), não o Haiku do leitor de recibos.
2. Cláusulas em inglês **no estilo dos EUA** (inglês americano, convenções contratuais americanas); a tradução é minha e **precisa de revisão do jurídico antes de ir a um cliente** (dizer isso no PR).
3. **Página pública de aprovação fica em português** nesta fase.

## Desvios do spec (do mapeamento do código; deliberados)

- O spec dizia "traduzir condições de pagamento no PDF": o PDF **não imprime** `payment_terms` nem `validity_days` (só a página pública imprime). Fora do escopo; nada a traduzir.
- O spec previa `translations` chaveado por item: troca por **glossário chaveado pelo texto original** (ver Architecture), por causa do clone de itens com uuid novo.
- `unit_label` (`diaria`, `hora`, `video`, `unidade`, `pacote`) e a categoria (`digital`, `filme`, `live`) são slugs: **mapa fixo** no dicionário, sem IA. Em português o PDF continua imprimindo o slug cru, como hoje.
- A data de emissão continua sendo a data da exportação (`new Date()`), como hoje; é o único trecho que muda entre duas exportações.

## Global Constraints

- **Português idêntico:** com `pdf_language = 'pt'` (ou ausente), o texto extraído do PDF (padrão e detalhado, em R$ e em US$) tem que ser **igual ao de antes** desta fase. Teste de regressão obrigatório na Task 4.
- Idioma e moeda independentes: PDF em inglês + R$ mostra `R$1,234.56`; em inglês + US$ mostra `$10,309.28`; em português + US$ continua `US$ 10.309,28`.
- Textos do orçamento sem tradução saem **no original** (nunca em branco).
- O texto traduzido não pode conter caracteres fora do subset das fontes do PDF (Poppins/Work Sans latin): `→ ← ≥ ≤ ✓ ✔`, emoji e afins são substituídos/removidos (`sanitizarTraducao`).
- A tradução só roda quando o usuário pede (botão); **o PDF nunca chama a IA** e nunca muda sozinho entre exportações (fora a data de emissão).
- A chave da Anthropic fica só no servidor (`ANTHROPIC_API_KEY`, já existente). Erros da função são **explícitos** (não "vazio com 200").
- Duplicar orçamento e "salvar como template" **não** copiam idioma/traduções (voltam a `pt`/nulo pelo padrão do banco); **nova versão** copia.
- Financeiro, `calcFinancials`, página pública, `ServiceOrderPDF` e a Fase 1/2 **não mudam**.
- SQL **só o Caio** roda em produção; testes de SQL só no banco **local**. Deploy da Edge Function só com autorização dele. Sem downloads reais de arquivos nos testes de tela. Tokens `lumos-*`; desktop não regride.
- **Ordem de produção:** migration `2026101100` → deploy da função `traduzir-orcamento` → merge do front. Se o front subir antes da migration, **todo salvamento de orçamento quebra** (coluna inexistente).
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (exatamente este nome de modelo). PR termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/utils/moeda.ts` | modificar | `formatarMoeda`/`formatarValorDaVersao` aceitam `locale` (padrão `pt-BR`). |
| `src/lib/pdfTextos.ts` | criar | Dicionário `pt`/`en` de todos os textos fixos do PDF. Sem imports. |
| `src/lib/traducaoCore.ts` | criar | Glossário de traduções: coletar textos, faltantes, traduzir com fallback, sanitizar, mesclar. Sem imports. |
| `src/utils/idioma.ts` | criar | `camposDeIdioma` (colunas para gravar). Sem imports. |
| `src/utils/financials.ts` | modificar | Campos `pdf_language`/`translations` em `BudgetVersion`. |
| `scripts/testes/pdfTextos.test.mjs` | criar | Testes do dicionário. |
| `scripts/testes/traducaoCore.test.mjs` | criar | Testes do glossário e de `camposDeIdioma`. |
| `scripts/testes/moeda.test.mjs` | modificar | Testes do `locale`. |
| `supabase/migrations/2026101100_pdf_idioma.sql` | criar | Colunas `pdf_language` e `translations`. |
| `scripts/testes/idioma_banco.sql` | criar | Teste do banco local. |
| `supabase/functions/traduzir-orcamento/core.ts` | criar | Validação do pedido, lotes, prompt, leitura da resposta. Sem imports. |
| `supabase/functions/traduzir-orcamento/index.ts` | criar | Edge Function (auth, API da Anthropic). |
| `scripts/testes/traduzirCore.test.mjs` | criar | Testes do `core.ts`. |
| `src/lib/traducao.ts` | criar | Cliente: `traduzirTextos`. |
| `src/components/editor/BudgetPDF.tsx` | modificar | Lê tudo do dicionário e do glossário. |
| `src/components/editor/IdiomaPanel.tsx` | criar | Seletor de idioma + status das traduções + botão "Traduzir e revisar". |
| `src/components/editor/TraducaoModal.tsx` | criar | Tela de revisão: original × tradução editável; botão "Traduzir com IA". |
| `src/pages/BudgetEditorPage.tsx` | modificar | Painel, `camposDeIdioma` nos 3 pontos de gravação, aviso ao exportar. |

**Branch:** já criado a partir do `main`: `feat/dolar-fase-3-pdf-ingles`.

---

### Task 1: Núcleo puro — locale da moeda, dicionário do PDF e glossário de traduções

**Files:**
- Modify: `src/utils/moeda.ts` (assinaturas de `formatarMoeda` e `formatarValorDaVersao`)
- Modify: `scripts/testes/moeda.test.mjs` (acrescentar testes)
- Create: `src/lib/pdfTextos.ts`, `src/lib/traducaoCore.ts`, `src/utils/idioma.ts`
- Modify: `src/utils/financials.ts` (interface `BudgetVersion`)
- Create: `scripts/testes/pdfTextos.test.mjs`, `scripts/testes/traducaoCore.test.mjs`

**Interfaces (usados pelas Tasks 2–5):**
- `formatarMoeda(valor: number, moeda: Moeda = 'BRL', locale: string = 'pt-BR'): string`
- `formatarValorDaVersao(valorBRL: number, v?: VersaoMoeda | null, locale: string = 'pt-BR'): string`
- `pdfTextos.ts`: `type Idioma = 'pt' | 'en'`; `interface ClausulaPdf { titulo: string; itens: string[] }`; `interface TextosPdf {...}` (campos abaixo); `const TEXTOS: Record<Idioma, TextosPdf>`; `getTextos(lang?: string | null): TextosPdf`.
- `traducaoCore.ts`: `interface Traducoes { versao: 1; textos: Record<string, string>; traduzido_em?: string; modelo?: string }`; `interface TextoParaTraduzir { origem: string; tipo: 'texto' | 'html' }`; `chave(s)`, `coletarTextos(version, items)`, `faltantes(coletados, traducoes)`, `traduzir(traducoes, origem)`, `sanitizarTraducao(s)`, `mesclar(traducoes, novas, agoraISO?, modelo?)`.
- `idioma.ts`: `camposDeIdioma(v?)` → `{ pdf_language: 'pt'|'en'; translations: Traducoes | null }`.

- [ ] **Step 1: Testes que falham**

Acrescente ao fim de `scripts/testes/moeda.test.mjs`:

```js
test('locale em inglês: US$ vira $ e a ordem dos separadores muda', () => {
  assert.equal(formatarMoeda(10309.28, 'USD', 'en-US'), '$10,309.28');
  assert.equal(semNbsp(formatarMoeda(10309.28, 'USD')), 'US$ 10.309,28'); // padrão continua pt-BR
  assert.equal(formatarMoeda(1234.5, 'BRL', 'en-US'), 'R$1,234.50');
  assert.equal(formatarValorDaVersao(50000, usd, 'en-US'), '$10,309.28');
  assert.equal(semNbsp(formatarValorDaVersao(50000, usd)), 'US$ 10.309,28');
});
```

Crie `scripts/testes/pdfTextos.test.mjs`:

```js
// Rodar: node --test scripts/testes/pdfTextos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXTOS, getTextos } from '../../src/lib/pdfTextos.ts';

const pt = TEXTOS.pt;
const en = TEXTOS.en;

test('getTextos: padrão é português; en devolve inglês', () => {
  assert.equal(getTextos(undefined), pt);
  assert.equal(getTextos('pt'), pt);
  assert.equal(getTextos('xx'), pt);
  assert.equal(getTextos('en'), en);
});

test('os dois idiomas têm as mesmas chaves e nenhum texto vazio', () => {
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort());
  const vazios = (obj, caminho = '') => Object.entries(obj).flatMap(([k, v]) => {
    if (typeof v === 'string') return v.trim() === '' ? [caminho + k] : [];
    if (Array.isArray(v)) return v.flatMap((x, i) => typeof x === 'string'
      ? (x.trim() === '' ? [`${caminho}${k}[${i}]`] : [])
      : vazios(x, `${caminho}${k}[${i}].`));
    if (v && typeof v === 'object') return vazios(v, `${caminho}${k}.`);
    return [];
  });
  assert.deepEqual(vazios(pt), []);
  assert.deepEqual(vazios(en), []);
});

test('7 cláusulas nos dois idiomas, com o mesmo número de itens', () => {
  assert.equal(pt.clausulas.length, 7);
  assert.equal(en.clausulas.length, 7);
  pt.clausulas.forEach((c, i) => assert.equal(c.itens.length, en.clausulas[i].itens.length, `cláusula ${i + 1}`));
});

test('o marcador da taxa de remarcação aparece exatamente uma vez, na cláusula 4', () => {
  for (const t of [pt, en]) {
    const todos = t.clausulas.flatMap((c) => c.itens).join('\n');
    assert.equal(todos.split('{taxaRemarcacao}').length - 1, 1);
    assert.ok(t.clausulas[3].itens[0].includes('{taxaRemarcacao}'));
  }
});

test('português mantém os textos de hoje (amostra)', () => {
  assert.equal(pt.clausulas[0].titulo, '1. Prazos e alterações');
  assert.ok(pt.clausulas[1].itens[0].startsWith('2.1. Aprovada esta Proposta Comercial'));
  assert.equal(pt.condicoesTitulo, 'CONDIÇÕES GERAIS');
  assert.equal(pt.totalProjeto, 'Investimento Total do Projeto');
  assert.equal(pt.tituloDocumento('2026-001', true), 'PROPOSTA_LUMOS_2026-001_DETALHADA');
  assert.equal(pt.tituloDocumento('2026-001', false), 'PROPOSTA_LUMOS_2026-001');
  assert.equal(pt.taxaRemarcacaoBRL, 'R$2.000,00');
});

test('inglês: títulos, unidades, categorias e valores-chave', () => {
  assert.equal(en.condicoesTitulo, 'GENERAL TERMS AND CONDITIONS');
  assert.equal(en.totalProjeto, 'Total Project Investment');
  assert.equal(en.unidades.diaria, 'day');
  assert.equal(en.unidades.pacote, 'package');
  assert.equal(en.categorias.filme, 'Film');
  assert.equal(en.tituloDocumento('2026-001', true), 'LUMOS_PROPOSAL_2026-001_DETAILED');
  assert.equal(en.taxaRemarcacaoBRL, 'R$2,000.00');
  assert.equal(en.locale, 'en-US');
});

test('inglês preserva os números do contrato (7 dias, 70%, 10%, 1% ao mês, 48 horas, 20%)', () => {
  const todos = en.clausulas.flatMap((c) => c.itens).join('\n');
  for (const trecho of ['seven (7) calendar days', '70%', '10%', '1%', '48 hours', '20%']) {
    assert.ok(todos.includes(trecho), `faltou "${trecho}"`);
  }
});

test('inglês só usa caracteres que as fontes do PDF cobrem', () => {
  const todos = JSON.stringify(en);
  assert.equal(/[→←≥≤✓✔]/u.test(todos), false);
  assert.equal(/[\u{10000}-\u{10FFFF}]/u.test(todos), false);
});
```

Crie `scripts/testes/traducaoCore.test.mjs`:

```js
// Rodar: node --test scripts/testes/traducaoCore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chave, coletarTextos, faltantes, traduzir, sanitizarTraducao, mesclar } from '../../src/lib/traducaoCore.ts';
import { camposDeIdioma } from '../../src/utils/idioma.ts';

const version = {
  notes_client: '<p>Filmagem em <strong>dois dias</strong>.</p>',
  logistics_date: '12 e 13/10',
  logistics_time: '  ',
  logistics_location: 'São Paulo',
};
const items = [
  { name: 'Diária de câmera', description: 'Câmera cinema + operador', sort_order: 1 },
  { name: 'Diária de câmera', description: '', sort_order: 2 },       // nome repetido: não duplica
  { name: 'Edição', description: null, sort_order: 3 },
];

test('coleta os textos únicos a traduzir, na ordem, ignorando vazios', () => {
  const t = coletarTextos(version, items);
  assert.deepEqual(t.map((x) => x.origem), [
    '12 e 13/10', 'São Paulo',
    '<p>Filmagem em <strong>dois dias</strong>.</p>',
    'Diária de câmera', 'Câmera cinema + operador', 'Edição',
  ]);
  assert.equal(t.find((x) => x.origem.startsWith('<p>')).tipo, 'html');
  assert.equal(t.find((x) => x.origem === 'Edição').tipo, 'texto');
});

test('faltantes: o que ainda não tem tradução (inclusive tradução vazia)', () => {
  const coletados = coletarTextos(version, items);
  const traducoes = { versao: 1, textos: { 'Edição': 'Editing', 'São Paulo': '   ' } };
  const f = faltantes(coletados, traducoes).map((x) => x.origem);
  assert.equal(f.includes('Edição'), false);
  assert.equal(f.includes('São Paulo'), true);   // tradução só com espaços = faltando
  assert.equal(f.includes('Diária de câmera'), true);
  assert.equal(faltantes(coletados, null).length, coletados.length);
});

test('traduzir: usa a tradução, senão o original', () => {
  const tr = { versao: 1, textos: { 'Edição': 'Editing' } };
  assert.equal(traduzir(tr, 'Edição'), 'Editing');
  assert.equal(traduzir(tr, ' Edição '), 'Editing');         // chave ignora espaços nas pontas
  assert.equal(traduzir(tr, 'Roteiro'), 'Roteiro');
  assert.equal(traduzir(null, 'Roteiro'), 'Roteiro');
  assert.equal(traduzir(tr, ''), '');
  assert.equal(chave('  a  '), 'a');
});

test('sanitizarTraducao tira o que a fonte do PDF não cobre', () => {
  assert.equal(sanitizarTraducao('A → B ≥ 3 ✓'), 'A -> B >= 3');
  assert.equal(sanitizarTraducao('Great 😀 shot'), 'Great shot');
  assert.equal(sanitizarTraducao('Normal “text” — fine'), 'Normal “text” — fine');
});

test('mesclar junta as novas traduções às existentes, sanitizadas', () => {
  const base = { versao: 1, textos: { 'Edição': 'Editing' } };
  const r = mesclar(base, { 'Roteiro': 'Script →', 'Edição': 'Post' }, '2026-10-09T12:00:00Z', 'claude-sonnet-5-5');
  assert.equal(r.versao, 1);
  assert.equal(r.textos['Roteiro'], 'Script ->');
  assert.equal(r.textos['Edição'], 'Post');
  assert.equal(r.traduzido_em, '2026-10-09T12:00:00Z');
  assert.equal(r.modelo, 'claude-sonnet-5-5');
  assert.deepEqual(base.textos, { 'Edição': 'Editing' }); // não muta a entrada
  assert.equal(mesclar(null, { a: 'b' }).textos.a, 'b');
});

test('camposDeIdioma: padrão pt e sem traduções', () => {
  assert.deepEqual(camposDeIdioma(undefined), { pdf_language: 'pt', translations: null });
  assert.deepEqual(camposDeIdioma({ pdf_language: 'en', translations: { versao: 1, textos: {} } }),
    { pdf_language: 'en', translations: { versao: 1, textos: {} } });
  assert.equal(camposDeIdioma({ pdf_language: 'xx' }).pdf_language, 'pt');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test scripts/testes/moeda.test.mjs scripts/testes/pdfTextos.test.mjs scripts/testes/traducaoCore.test.mjs`
Expected: FAIL (módulos `pdfTextos.ts`, `traducaoCore.ts`, `idioma.ts` inexistentes; `formatarMoeda` ignora o 3º argumento).

- [ ] **Step 3: Implementar `moeda.ts`**

Em `src/utils/moeda.ts`, troque

```ts
export function formatarMoeda(valor: number, moeda: Moeda = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
```

por

```ts
export function formatarMoeda(valor: number, moeda: Moeda = 'BRL', locale: string = 'pt-BR'): string {
  return new Intl.NumberFormat(locale, {
```

e troque

```ts
export function formatarValorDaVersao(valorBRL: number, v?: VersaoMoeda | null): string {
  return formatarMoeda(converterValor(valorBRL, v), moedaDaVersao(v));
}
```

por

```ts
export function formatarValorDaVersao(valorBRL: number, v?: VersaoMoeda | null, locale: string = 'pt-BR'): string {
  return formatarMoeda(converterValor(valorBRL, v), moedaDaVersao(v), locale);
}
```

- [ ] **Step 4: Criar `src/lib/pdfTextos.ts`**

```ts
// Textos fixos do PDF da proposta, em português e em inglês americano.
// Sem imports: roda no navegador, no PDF e nos testes de linha de comando.
//
// Português: IDÊNTICO ao que o BudgetPDF imprimia antes (regressão testada).
// Inglês: tradução em inglês americano, em estilo contratual dos EUA. As
// cláusulas são texto CONTRATUAL: precisam de revisão do jurídico antes de ir
// a um cliente. Os números do contrato (7 dias, 70%, 10%, 1% ao mês, 48 horas,
// 20%) são os mesmos nos dois idiomas.

export type Idioma = 'pt' | 'en';

export interface ClausulaPdf {
  titulo: string;
  /** Parágrafos numerados à mão ("1.1. ..."). A cláusula 4 contém `{taxaRemarcacao}`. */
  itens: string[];
}

export interface TextosPdf {
  /** Locale de números e valores (Intl). */
  locale: 'pt-BR' | 'en-US';
  /** Formato (date-fns) da data de emissão e do mês do cronograma de fee mensal. */
  formatoData: string;
  formatoMes: string;
  tituloDocumento: (codigo: string, detalhado: boolean) => string;

  emissao: string;
  projeto: string;
  cliente: string;
  categoria: string;
  contato: string;
  clienteFallback: string;

  escopo: string;
  datas: string;
  horario: string;
  local: string;

  tituloFinanceiro: string;
  colItem: string;
  colDescricao: string;
  colQtd: string;
  colUnid: string;
  colValorUnit: string;
  colTotal: string;
  subtotal: string;
  totalProjeto: string;
  grupos: { equipe: string; equipamentos: string; producao: string; edicao: string };
  /** Categoria do orçamento (slug → rótulo). Em português vazio: capitaliza o slug, como hoje. */
  categorias: Record<string, string>;
  /** Unidade do item (slug → rótulo). Em português vazio: imprime o slug cru, como hoje. */
  unidades: Record<string, string>;

  condicoesTitulo: string;
  clausulas: ClausulaPdf[];
  /** Valor mínimo da taxa de remarcação quando a proposta está em R$ (em US$ é convertido). */
  taxaRemarcacaoBRL: string;

  feeTitulo: string;
  feeMes: string;
  feeValorMensal: string;
  feeAdendo: string;

  termoTitulo: string;
  aprovadoPor: string;
  contatoFallback: string;
  dataLinha: string;
  produtoraLumos: string;
  equipeFallback: string;
}

const pt: TextosPdf = {
  locale: 'pt-BR',
  formatoData: "dd 'de' MMMM 'de' yyyy",
  formatoMes: 'MMM/yyyy',
  tituloDocumento: (codigo, detalhado) => `PROPOSTA_LUMOS_${codigo}${detalhado ? '_DETALHADA' : ''}`,

  emissao: 'Emissão',
  projeto: 'Projeto',
  cliente: 'Cliente',
  categoria: 'Categoria',
  contato: 'Contato',
  clienteFallback: 'Cliente',

  escopo: 'Escopo e Briefing',
  datas: 'Data(s)',
  horario: 'Horário',
  local: 'Local / Endereço',

  tituloFinanceiro: 'Proposta Financeira Detalhada',
  colItem: 'Item / Serviço',
  colDescricao: 'Descrição',
  colQtd: 'Qtd',
  colUnid: 'Unid.',
  colValorUnit: 'Valor unit.',
  colTotal: 'Total',
  subtotal: 'Subtotal',
  totalProjeto: 'Investimento Total do Projeto',
  grupos: { equipe: 'Equipe', equipamentos: 'Equipamentos', producao: 'Produção', edicao: 'Pós-produção' },
  categorias: {},
  unidades: {},

  condicoesTitulo: 'CONDIÇÕES GERAIS',
  clausulas: [
    {
      titulo: '1. Prazos e alterações',
      itens: [
        '1.1. Esta Proposta Comercial terá validade por 7 dias corridos, a partir da celebração do contrato entre as partes. Após este período, os investimentos estarão sujeitos a alterações.',
        '1.2. Eventuais alterações nas especificações dos trabalhos a serem realizados podem alterar o valor desta Proposta Comercial.',
      ],
    },
    {
      titulo: '2. Cancelamento e rescisão',
      itens: [
        '2.1. Aprovada esta Proposta Comercial, em qualquer hipótese de cancelamento da prestação dos serviços, por parte do CLIENTE, será devida multa, em favor da LUMOS, em valor correspondente a 70% (setenta por cento) do valor total devido pelo CLIENTE, sem prejuízo do pagamento de todas as despesas já realizadas pela LUMOS, na execução dos serviços objeto da presente Proposta Comercial.',
        '2.2. Para quaisquer finalidades que se façam necessárias, a presente Proposta Comercial, considerar-se-á aprovada pelo CLIENTE, em qualquer hipótese de manifestação deste, concordando com seus termos e condições, seja por concordância manifestada por e-mail ou outros meios, tais como mas não limitados a aplicativos de troca de mensagens, mensagens de texto, etc., seja por manifestação tácita da vontade do CLIENTE, no sentido deste ter ciência do início do cumprimento das obrigações constantes da Proposta Comercial, pela LUMOS, sem que se manifeste em contrário.',
      ],
    },
    {
      titulo: '3. Pagamento',
      itens: [
        '3.1. O pagamento deverá ocorrer de acordo com prazo de pagamento combinado entre o CLIENTE e a LUMOS no ato do aceite da presente Proposta Comercial, dentro das opções disponíveis nesta.',
        '3.2. O atraso no pagamento sujeitará o CLIENTE à multa de 10% (dez por cento) e juros de 1% a.m. sobre o valor do débito.',
      ],
    },
    {
      titulo: '4. Taxa de Remarcação',
      itens: [
        '4.1. Caso o CLIENTE altere a data prevista para a execução do serviço, sem respeitar o prazo máximo de 48 horas de antecedência, será cobrada uma taxa de remarcação no valor mínimo de {taxaRemarcacao} ou 20% do valor total do projeto.',
      ],
    },
    {
      titulo: '5. Direitos autorais e uso',
      itens: [
        '5.1. Todo o material produzido pela LUMOS permanece de propriedade desta até a quitação integral do valor contratado.',
        '5.2. A cessão de direitos de uso do material produzido está limitada ao território e período de veiculação descritos nesta Proposta.',
      ],
    },
    {
      titulo: '6. Créditos',
      itens: [
        '6.1. A LUMOS reserva-se o direito de utilizar o material produzido em seu portfólio e materiais de divulgação, salvo expressa proibição do CLIENTE formalizada por escrito.',
      ],
    },
    {
      titulo: '7. Responsabilidades',
      itens: [
        '7.1. A LUMOS não se responsabiliza por atrasos ou impedimentos causados por fatores externos ao seu controle, como condições climáticas, restrições de locação ou atrasos por parte do CLIENTE na entrega de materiais necessários à produção.',
      ],
    },
  ],
  taxaRemarcacaoBRL: 'R$2.000,00',

  feeTitulo: 'Cronograma de pagamento (fee mensal)',
  feeMes: 'Mês',
  feeValorMensal: 'Valor mensal',
  feeAdendo: 'Adendo',

  termoTitulo: 'Termo de Aceite e Aprovação',
  aprovadoPor: 'Aprovado por:',
  contatoFallback: 'NOME DO RESPONSÁVEL',
  dataLinha: 'DATA: ____/____/____',
  produtoraLumos: 'Produtora Lumos',
  equipeFallback: 'Equipe de Produção',
};

const en: TextosPdf = {
  locale: 'en-US',
  formatoData: 'MMMM d, yyyy',
  formatoMes: 'MMM yyyy',
  tituloDocumento: (codigo, detalhado) => `LUMOS_PROPOSAL_${codigo}${detalhado ? '_DETAILED' : ''}`,

  emissao: 'Issued',
  projeto: 'Project',
  cliente: 'Client',
  categoria: 'Category',
  contato: 'Contact',
  clienteFallback: 'Client',

  escopo: 'Scope & Brief',
  datas: 'Date(s)',
  horario: 'Time',
  local: 'Location / Address',

  tituloFinanceiro: 'Detailed Financial Proposal',
  colItem: 'Item / Service',
  colDescricao: 'Description',
  colQtd: 'Qty',
  colUnid: 'Unit',
  colValorUnit: 'Unit price',
  colTotal: 'Total',
  subtotal: 'Subtotal',
  totalProjeto: 'Total Project Investment',
  grupos: { equipe: 'Crew', equipamentos: 'Equipment', producao: 'Production', edicao: 'Post-production' },
  categorias: { digital: 'Digital', filme: 'Film', live: 'Live' },
  unidades: { diaria: 'day', hora: 'hour', video: 'video', unidade: 'unit', pacote: 'package' },

  condicoesTitulo: 'GENERAL TERMS AND CONDITIONS',
  clausulas: [
    {
      titulo: '1. Term and Changes',
      itens: [
        '1.1. This Commercial Proposal will remain valid for seven (7) calendar days from the date the agreement between the parties is executed. After that period, the fees stated herein are subject to change.',
        '1.2. Any change to the scope of work to be performed may result in a change to the price set forth in this Commercial Proposal.',
      ],
    },
    {
      titulo: '2. Cancellation and Termination',
      itens: [
        '2.1. Once this Commercial Proposal has been approved, if CLIENT cancels the services for any reason, CLIENT shall pay LUMOS a cancellation fee equal to seventy percent (70%) of the total amount owed by CLIENT, without prejudice to reimbursement of all expenses already incurred by LUMOS in performing the services covered by this Commercial Proposal.',
        '2.2. For all purposes, this Commercial Proposal shall be deemed accepted by CLIENT upon any expression of acceptance of its terms and conditions, whether by email or by other means (including, without limitation, messaging apps and text messages), or by implied acceptance, where CLIENT is aware that LUMOS has begun performing its obligations under this Commercial Proposal and does not object.',
      ],
    },
    {
      titulo: '3. Payment',
      itens: [
        '3.1. Payment shall be made in accordance with the payment terms agreed between CLIENT and LUMOS upon acceptance of this Commercial Proposal, from among the options available herein.',
        '3.2. Late payments shall be subject to a late fee of ten percent (10%) plus interest at one percent (1%) per month on the outstanding balance.',
      ],
    },
    {
      titulo: '4. Rescheduling Fee',
      itens: [
        '4.1. If CLIENT changes the scheduled date of service without giving at least 48 hours prior notice, a rescheduling fee will be charged in a minimum amount of {taxaRemarcacao} or 20% of the total project price.',
      ],
    },
    {
      titulo: '5. Copyright and Use',
      itens: [
        '5.1. All material produced by LUMOS remains the property of LUMOS until the contract price has been paid in full.',
        '5.2. The license to use the material produced is limited to the territory and term of distribution described in this Proposal.',
      ],
    },
    {
      titulo: '6. Credits',
      itens: [
        '6.1. LUMOS reserves the right to use the material produced in its portfolio and promotional materials, unless CLIENT expressly prohibits such use in writing.',
      ],
    },
    {
      titulo: '7. Responsibilities',
      itens: [
        '7.1. LUMOS shall not be liable for delays or impediments caused by factors beyond its reasonable control, such as weather conditions, location restrictions, or delays by CLIENT in delivering materials necessary for production.',
      ],
    },
  ],
  taxaRemarcacaoBRL: 'R$2,000.00',

  feeTitulo: 'Payment schedule (monthly retainer)',
  feeMes: 'Month',
  feeValorMensal: 'Monthly fee',
  feeAdendo: 'Add-on',

  termoTitulo: 'Acceptance and Approval',
  aprovadoPor: 'Approved by:',
  contatoFallback: 'CONTACT NAME',
  dataLinha: 'DATE: ____/____/____',
  produtoraLumos: 'Produtora Lumos',
  equipeFallback: 'Production Team',
};

export const TEXTOS: Record<Idioma, TextosPdf> = { pt, en };

/** Textos do idioma pedido; qualquer coisa que não seja 'en' é português. */
export function getTextos(lang?: string | null): TextosPdf {
  return lang === 'en' ? TEXTOS.en : TEXTOS.pt;
}
```

- [ ] **Step 5: Criar `src/lib/traducaoCore.ts`**

```ts
// Glossário de traduções do orçamento. Chaveado pelo TEXTO ORIGINAL (não por id
// de item): sobrevive a nova versão (itens ganham uuid novo), a reordenação e a
// repetição do mesmo texto; um texto editado simplesmente fica "sem tradução".
// Sem imports: roda no navegador, no PDF e nos testes de linha de comando.

export interface Traducoes {
  versao: 1;
  /** texto original (sem espaços nas pontas) → tradução em inglês */
  textos: Record<string, string>;
  traduzido_em?: string;
  modelo?: string;
}

export interface TextoParaTraduzir {
  origem: string;
  tipo: 'texto' | 'html';
}

interface VersaoTextos {
  notes_client?: string | null;
  logistics_date?: string | null;
  logistics_time?: string | null;
  logistics_location?: string | null;
}
interface ItemTextos {
  name?: string | null;
  description?: string | null;
  sort_order?: number | null;
}

/** Chave do glossário: o texto sem espaços nas pontas. */
export const chave = (s?: string | null): string => String(s ?? '').trim();

const ehHtml = (s: string) => /<\/?[a-z][^>]*>/i.test(s);

/**
 * Todos os textos do orçamento que o PDF em inglês precisa traduzir, sem repetição,
 * na ordem em que aparecem: logística, briefing (HTML) e itens (nome, descrição).
 * Unidade e categoria saem de um mapa fixo (pdfTextos), não daqui.
 */
export function coletarTextos(version: VersaoTextos | null | undefined, items: ItemTextos[] | null | undefined): TextoParaTraduzir[] {
  const vistos = new Set<string>();
  const out: TextoParaTraduzir[] = [];
  const add = (texto: string | null | undefined, forcarHtml = false) => {
    const o = chave(texto);
    if (!o || vistos.has(o)) return;
    vistos.add(o);
    out.push({ origem: o, tipo: forcarHtml || ehHtml(o) ? 'html' : 'texto' });
  };
  add(version?.logistics_date);
  add(version?.logistics_time);
  add(version?.logistics_location);
  add(version?.notes_client, true);
  const ordenados = [...(items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const it of ordenados) {
    add(it.name);
    add(it.description);
  }
  return out;
}

/** O que ainda não tem tradução (ausente ou só espaços). */
export function faltantes(coletados: TextoParaTraduzir[], traducoes: Traducoes | null | undefined): TextoParaTraduzir[] {
  return coletados.filter((c) => chave(traducoes?.textos?.[c.origem]) === '');
}

/** Tradução do texto, ou o próprio texto se não houver. */
export function traduzir(traducoes: Traducoes | null | undefined, origem?: string | null): string {
  const o = String(origem ?? '');
  const t = traducoes?.textos?.[chave(o)];
  return t && chave(t) !== '' ? t : o;
}

/**
 * Tira o que as fontes do PDF (Poppins/Work Sans, subset latin) não cobrem:
 * setas e símbolos matemáticos viram ASCII; emoji e seletores de variação somem.
 */
export function sanitizarTraducao(s: string): string {
  return String(s ?? '')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[✓✔]/g, '')
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/️/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Junta traduções novas às existentes (sanitizadas), sem mutar a entrada. */
export function mesclar(
  base: Traducoes | null | undefined,
  novas: Record<string, string>,
  agoraISO?: string,
  modelo?: string,
): Traducoes {
  const textos: Record<string, string> = { ...(base?.textos ?? {}) };
  for (const [origem, en] of Object.entries(novas)) textos[chave(origem)] = sanitizarTraducao(en);
  return {
    versao: 1,
    textos,
    traduzido_em: agoraISO ?? base?.traduzido_em,
    modelo: modelo ?? base?.modelo,
  };
}
```

- [ ] **Step 6: Criar `src/utils/idioma.ts` e estender `BudgetVersion`**

`src/utils/idioma.ts`:

```ts
// Idioma do PDF da proposta e glossário de traduções, prontos para os INSERT/UPDATE
// de budget_versions (mesmo papel de camposDeMoeda). Sem imports.

export function camposDeIdioma(v?: { pdf_language?: string | null; translations?: unknown } | null) {
  return {
    pdf_language: v?.pdf_language === 'en' ? ('en' as const) : ('pt' as const),
    translations: (v?.translations ?? null) as { versao: 1; textos: Record<string, string>; traduzido_em?: string; modelo?: string } | null,
  };
}
```

Em `src/utils/financials.ts`, dentro de `interface BudgetVersion`, depois do campo `fx_source` (último campo de moeda), acrescente:

```ts
  /** Idioma do PDF da proposta (padrão 'pt'). Independente da moeda. */
  pdf_language?: 'pt' | 'en';
  /** Glossário texto original → inglês (ver src/lib/traducaoCore.ts). */
  translations?: { versao: 1; textos: Record<string, string>; traduzido_em?: string; modelo?: string } | null;
```

- [ ] **Step 7: Rodar e ver passar**

Run: `node --test scripts/testes/moeda.test.mjs scripts/testes/pdfTextos.test.mjs scripts/testes/traducaoCore.test.mjs scripts/testes/ptax.test.mjs`
Expected: `ℹ fail 0`.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/utils/moeda.ts scripts/testes/moeda.test.mjs src/lib/pdfTextos.ts src/lib/traducaoCore.ts src/utils/idioma.ts src/utils/financials.ts scripts/testes/pdfTextos.test.mjs scripts/testes/traducaoCore.test.mjs
git commit -m "feat: dicionário do PDF em inglês, glossário de traduções e locale da moeda" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — `pdf_language` e `translations`

**Files:**
- Create: `supabase/migrations/2026101100_pdf_idioma.sql`
- Create: `scripts/testes/idioma_banco.sql`

**Interfaces:**
- Produces (usado pelas Tasks 4 e 5): `budget_versions.pdf_language text NOT NULL DEFAULT 'pt' CHECK in ('pt','en')`; `budget_versions.translations jsonb` (nulável).

- [ ] **Step 1: Teste do banco (vai falhar sem a migration)**

Crie `scripts/testes/idioma_banco.sql`:

```sql
-- Teste do banco LOCAL para a migration 2026101100. Não rodar em produção.
-- Rodar: docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/idioma_banco.sql
BEGIN;

CREATE FUNCTION pg_temp.deve_falhar(p_sql text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK   %', p_msg;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (esperava check_violation): %', p_msg;
END $$;

DO $$
DECLARE
  v_cli uuid; v_b uuid; v_v uuid; v_lang text; v_tr jsonb;
BEGIN
  INSERT INTO clients (name) VALUES ('Cliente teste idioma') RETURNING id INTO v_cli;
  INSERT INTO budgets (code, project_name, category, status, client_id)
  VALUES ('TESTE-IDI', 'Teste idioma', 'digital', 'em_negociacao', v_cli) RETURNING id INTO v_b;
  INSERT INTO budget_versions (budget_id, version_number) VALUES (v_b, 1) RETURNING id INTO v_v;

  -- 1) padrão: português, sem traduções
  SELECT pdf_language, translations INTO v_lang, v_tr FROM budget_versions WHERE id = v_v;
  IF v_lang <> 'pt' OR v_tr IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: padrão deveria ser pt/null (veio %, %)', v_lang, v_tr;
  END IF;
  RAISE NOTICE 'OK   padrão é pt e sem traduções';

  -- 2) idioma inválido é recusado
  PERFORM pg_temp.deve_falhar(format('UPDATE budget_versions SET pdf_language = ''fr'' WHERE id = %L', v_v), 'idioma fora de pt/en é recusado');

  -- 3) en + glossário jsonb é aceito e volta igual
  UPDATE budget_versions
     SET pdf_language = 'en',
         translations = '{"versao":1,"textos":{"Diária de câmera":"Camera day rate"}}'::jsonb
   WHERE id = v_v;
  SELECT pdf_language, translations INTO v_lang, v_tr FROM budget_versions WHERE id = v_v;
  IF v_lang <> 'en' OR v_tr->'textos'->>'Diária de câmera' <> 'Camera day rate' THEN
    RAISE EXCEPTION 'FALHOU: en/translations não voltaram (%, %)', v_lang, v_tr;
  END IF;
  RAISE NOTICE 'OK   en e glossário são gravados e lidos de volta';

  -- 4) o gatilho da trava de moeda NÃO bloqueia mudança de idioma com orçamento aprovado
  UPDATE budgets SET status = 'aprovado' WHERE id = v_b;
  UPDATE budget_versions SET pdf_language = 'pt', translations = NULL WHERE id = v_v;
  RAISE NOTICE 'OK   idioma e traduções continuam editáveis com o orçamento aprovado';
END $$;

ROLLBACK;
```

(Se o `UPDATE budgets SET status = 'aprovado'` esbarrar no gatilho de notificação de aprovação por falta de usuários no banco local, desabilite-o dentro da transação como no teste da Fase 1: `ALTER TABLE public.budgets DISABLE TRIGGER trg_budget_approved_notification;` antes do `DO`.)

- [ ] **Step 2: Ver o teste falhar**

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/idioma_banco.sql`
Expected: FAIL (`column "pdf_language" does not exist`). (Docker é o OrbStack: `orbctl start` se preciso.)

- [ ] **Step 3: Migration**

Crie `supabase/migrations/2026101100_pdf_idioma.sql`:

```sql
-- PDF DA PROPOSTA EM INGLÊS (orçamento em dólar, Fase 3)
--
--   pdf_language  idioma do PDF: 'pt' (padrão) ou 'en'. Independente da moeda.
--   translations  glossário de traduções: {"versao":1,"textos":{"<texto original>":"<English>"}}.
--                 Chaveado pelo TEXTO ORIGINAL (não por id de item) para sobreviver a
--                 nova versão (itens ganham uuid novo). Gravado só depois que a pessoa
--                 revisa na tela; o PDF nunca chama a IA.
--
-- Aditiva e segura de rodar antes do deploy do front: todos os orçamentos existentes
-- ficam em 'pt' e sem traduções. O front NOVO grava essas colunas, então esta
-- migration tem que rodar ANTES dele. Idioma e traduções NÃO são travados na
-- aprovação (o gatilho de moeda só olha currency/fx_*).

ALTER TABLE public.budget_versions
  ADD COLUMN IF NOT EXISTS pdf_language text  NOT NULL DEFAULT 'pt',
  ADD COLUMN IF NOT EXISTS translations jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_versions_pdf_language_valido') THEN
    ALTER TABLE public.budget_versions
      ADD CONSTRAINT budget_versions_pdf_language_valido CHECK (pdf_language IN ('pt', 'en'));
  END IF;
END $$;
```

- [ ] **Step 4: Aplicar localmente e rodar o teste**

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/2026101100_pdf_idioma.sql`
Expected: `ALTER TABLE` e `DO`, sem erro.

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/idioma_banco.sql`
Expected: 4 linhas `NOTICE:  OK   ...`, nenhuma `FALHOU`, termina em `ROLLBACK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026101100_pdf_idioma.sql scripts/testes/idioma_banco.sql
git commit -m "feat: banco do PDF em inglês (idioma e glossário de traduções)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Edge Function `traduzir-orcamento` e cliente

**Files:**
- Create: `supabase/functions/traduzir-orcamento/core.ts`
- Create: `supabase/functions/traduzir-orcamento/index.ts`
- Create: `scripts/testes/traduzirCore.test.mjs`
- Create: `src/lib/traducao.ts`

**Interfaces:**
- Consumes: `TextoParaTraduzir` (Task 1, `src/lib/traducaoCore.ts`).
- Produces (usado pela Task 5): `traduzirTextos(itens: TextoParaTraduzir[]): Promise<{ traducoes: Record<string, string>; modelo: string }>` (chaves = `origem`). Função HTTP: corpo `{ itens: [{ id, tipo, origem }] }` → `{ traducoes: Record<id, string>, modelo }` ou `{ error }` com status 400 (pedido inválido), 401/403 (auth), 502 (falha da IA ou resposta incompleta), 500.

- [ ] **Step 1: Testes que falham**

Crie `scripts/testes/traduzirCore.test.mjs`:

```js
// Rodar: node --test scripts/testes/traduzirCore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITES, validarPedido, dividirEmLotes, lerResposta, MODELO } from '../../supabase/functions/traduzir-orcamento/core.ts';

const item = (id, origem, tipo = 'texto') => ({ id, tipo, origem });

test('modelo é o Sonnet 5.5', () => {
  assert.equal(MODELO, 'claude-sonnet-5-5');
});

test('validarPedido aceita um pedido bom', () => {
  const r = validarPedido({ itens: [item('t0', 'Diária de câmera'), item('t1', '<p>Oi</p>', 'html')] });
  assert.equal(r.ok, true);
  assert.equal(r.itens.length, 2);
});

test('validarPedido recusa pedidos ruins com mensagem', () => {
  assert.equal(validarPedido(null).ok, false);
  assert.equal(validarPedido({}).ok, false);
  assert.equal(validarPedido({ itens: [] }).ok, false);
  assert.equal(validarPedido({ itens: [item('a', '')] }).ok, false);                    // origem vazia
  assert.equal(validarPedido({ itens: [{ id: 'a', tipo: 'x', origem: 'oi' }] }).ok, false); // tipo inválido
  assert.equal(validarPedido({ itens: [item('a', 'oi'), item('a', 'tchau')] }).ok, false);  // id repetido
  assert.equal(validarPedido({ itens: Array.from({ length: LIMITES.itens + 1 }, (_, i) => item('i' + i, 'x')) }).ok, false);
  assert.equal(validarPedido({ itens: [item('a', 'x'.repeat(LIMITES.caracteresPorItem + 1))] }).ok, false);
  const r = validarPedido({ itens: [item('a', 'x')], lixo: 1 });
  assert.equal(r.ok, true); // campos extras são ignorados
});

test('validarPedido recusa o total de caracteres acima do limite', () => {
  const grande = 'x'.repeat(LIMITES.caracteresPorItem);
  const itens = Array.from({ length: 7 }, (_, i) => item('i' + i, grande));
  const r = validarPedido({ itens });
  assert.equal(r.ok, false);
  assert.match(r.erro, /grande demais/i);
});

test('dividirEmLotes respeita itens e caracteres por lote e mantém a ordem', () => {
  const itens = Array.from({ length: LIMITES.itensPorLote * 2 + 3 }, (_, i) => item('i' + i, 'curto'));
  const lotes = dividirEmLotes(itens);
  assert.equal(lotes.length, 3);
  assert.deepEqual(lotes.flat().map((x) => x.id), itens.map((x) => x.id));
  const pesados = [item('a', 'x'.repeat(20000)), item('b', 'y'.repeat(20000)), item('c', 'z')];
  const l2 = dividirEmLotes(pesados);
  assert.equal(l2.length, 2);                     // 20000 + 20000 > 30000
  assert.deepEqual(l2.flat().map((x) => x.id), ['a', 'b', 'c']);
});

test('lerResposta: lê o tool_use e confere que todos os ids voltaram', () => {
  const json = { content: [
    { type: 'text', text: 'ok' },
    { type: 'tool_use', name: 'registrar_traducoes', input: { traducoes: [{ id: 't0', en: 'Camera day rate' }, { id: 't1', en: '<p>Hi</p>' }] } },
  ] };
  const r = lerResposta(json, ['t0', 't1']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.traducoes, { t0: 'Camera day rate', t1: '<p>Hi</p>' });
});

test('lerResposta: erro explícito quando falta id, vem vazio ou não há tool_use', () => {
  const falta = { content: [{ type: 'tool_use', input: { traducoes: [{ id: 't0', en: 'A' }] } }] };
  const r1 = lerResposta(falta, ['t0', 't1']);
  assert.equal(r1.ok, false);
  assert.match(r1.erro, /incompleta/i);
  const vazio = { content: [{ type: 'tool_use', input: { traducoes: [{ id: 't0', en: '   ' }] } }] };
  assert.equal(lerResposta(vazio, ['t0']).ok, false);
  assert.equal(lerResposta({ content: [{ type: 'text', text: 'oi' }] }, ['t0']).ok, false);
  assert.equal(lerResposta(null, ['t0']).ok, false);
  const extra = { content: [{ type: 'tool_use', input: { traducoes: [{ id: 't0', en: 'A' }, { id: 'zzz', en: 'B' }] } }] };
  assert.deepEqual(lerResposta(extra, ['t0']).traducoes, { t0: 'A' }); // id desconhecido é ignorado
});
```

- [ ] **Step 2: Ver falhar**

Run: `node --test scripts/testes/traduzirCore.test.mjs`
Expected: FAIL (`Cannot find module '.../traduzir-orcamento/core.ts'`).

- [ ] **Step 3: Implementar `core.ts`**

Crie `supabase/functions/traduzir-orcamento/core.ts`:

```ts
// Núcleo puro da função traduzir-orcamento (sem imports: roda no Deno e nos testes de linha de comando).

export const MODELO = 'claude-sonnet-5-5';

export const LIMITES = {
  itens: 150,
  caracteresPorItem: 20000,
  caracteresTotal: 120000,
  itensPorLote: 40,
  caracteresPorLote: 30000,
};

export interface PedidoItem {
  id: string;
  tipo: 'texto' | 'html';
  origem: string;
}

export const NOME_FERRAMENTA = 'registrar_traducoes';

export const FERRAMENTA = {
  name: NOME_FERRAMENTA,
  description: 'Registra a tradução em inglês americano de cada texto recebido, sem omitir nenhum.',
  input_schema: {
    type: 'object',
    properties: {
      traducoes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'O mesmo id recebido.' },
            en: { type: 'string', description: 'A tradução em inglês americano.' },
          },
          required: ['id', 'en'],
        },
      },
    },
    required: ['traducoes'],
  },
};

export const SISTEMA = [
  'You translate text from Brazilian Portuguese into American English for commercial proposals (budgets) of an audiovisual production company.',
  'Each input has an id, a type ("texto" = plain text, "html" = rich text with HTML tags) and the Portuguese source text.',
  'Rules:',
  '- Use American English spelling and US industry terminology (crew, call time, shoot day, camera operator, post-production, deliverables, etc.).',
  '- Keep proper nouns, brand names, people, places, product names, numbers, times and units exactly as they are. Translate only the words around them.',
  '- For type "html": keep every HTML tag and the structure exactly as given and translate only the text between tags. Do not add or remove tags.',
  '- Do not add, omit, summarize or explain anything. One translation per input id.',
  '- Do not use arrows, check marks, emoji or other symbols outside plain Latin text and common punctuation.',
  `Always answer by calling the tool ${NOME_FERRAMENTA}, returning every id you received.`,
].join('\n');

export function validarPedido(corpo: unknown): { ok: true; itens: PedidoItem[] } | { ok: false; erro: string } {
  const itens = (corpo as { itens?: unknown } | null)?.itens;
  if (!Array.isArray(itens) || itens.length === 0) return { ok: false, erro: 'Envie ao menos um texto para traduzir.' };
  if (itens.length > LIMITES.itens) return { ok: false, erro: `Textos demais (máximo ${LIMITES.itens}).` };
  const ids = new Set<string>();
  const out: PedidoItem[] = [];
  let total = 0;
  for (const it of itens as Record<string, unknown>[]) {
    const id = typeof it?.id === 'string' ? it.id : '';
    const origem = typeof it?.origem === 'string' ? it.origem : '';
    const tipo = it?.tipo;
    if (!id || ids.has(id)) return { ok: false, erro: 'Cada texto precisa de um id único.' };
    if (tipo !== 'texto' && tipo !== 'html') return { ok: false, erro: 'Tipo de texto inválido.' };
    if (!origem.trim()) return { ok: false, erro: 'Há texto vazio no pedido.' };
    if (origem.length > LIMITES.caracteresPorItem) return { ok: false, erro: 'Há um texto grande demais.' };
    ids.add(id);
    total += origem.length;
    out.push({ id, tipo, origem });
  }
  if (total > LIMITES.caracteresTotal) return { ok: false, erro: 'O pedido é grande demais.' };
  return { ok: true, itens: out };
}

/** Divide em lotes (itens e caracteres) mantendo a ordem. */
export function dividirEmLotes(itens: PedidoItem[]): PedidoItem[][] {
  const lotes: PedidoItem[][] = [];
  let atual: PedidoItem[] = [];
  let chars = 0;
  for (const it of itens) {
    const cheio = atual.length >= LIMITES.itensPorLote
      || (atual.length > 0 && chars + it.origem.length > LIMITES.caracteresPorLote);
    if (cheio) { lotes.push(atual); atual = []; chars = 0; }
    atual.push(it);
    chars += it.origem.length;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

/** Lê a resposta da API (tool_use) e confere que TODOS os ids pedidos voltaram com texto. */
export function lerResposta(json: unknown, idsPedidos: string[]): { ok: true; traducoes: Record<string, string> } | { ok: false; erro: string } {
  const content = (json as { content?: unknown } | null)?.content;
  const uso = Array.isArray(content)
    ? (content as Record<string, unknown>[]).find((b) => b?.type === 'tool_use')
    : undefined;
  const lista = (uso?.input as { traducoes?: unknown } | undefined)?.traducoes;
  if (!Array.isArray(lista)) return { ok: false, erro: 'A IA não devolveu as traduções.' };
  const pedidos = new Set(idsPedidos);
  const traducoes: Record<string, string> = {};
  for (const t of lista as Record<string, unknown>[]) {
    const id = typeof t?.id === 'string' ? t.id : '';
    const en = typeof t?.en === 'string' ? t.en : '';
    if (pedidos.has(id) && en.trim() !== '') traducoes[id] = en;
  }
  const faltam = idsPedidos.filter((id) => !(id in traducoes));
  if (faltam.length > 0) return { ok: false, erro: 'Resposta da IA incompleta. Tente de novo.' };
  return { ok: true, traducoes };
}
```

- [ ] **Step 4: Ver passar**

Run: `node --test scripts/testes/traduzirCore.test.mjs`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Escrever a Edge Function**

Crie `supabase/functions/traduzir-orcamento/index.ts`:

```ts
// supabase/functions/traduzir-orcamento/index.ts
//
// Traduz os textos de um orçamento (português do Brasil → inglês americano) com Claude,
// para o PDF da proposta em inglês. O app guarda o resultado depois que a pessoa REVISA;
// o PDF nunca chama esta função. Chamada autenticada (JWT); qualquer funcionário ATIVO
// pode chamar. Usa a mesma ANTHROPIC_API_KEY do extract-receipt.
//
// Diferente do extract-receipt, falha de verdade: erro da IA, resposta incompleta ou
// pedido inválido voltam como { error } com status 4xx/5xx — o app mostra a mensagem,
// em vez de "vazio com 200" (que mascararia uma tradução que não aconteceu).
//
// Deploy: supabase functions deploy traduzir-orcamento   (com verificação de JWT, o padrão)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { FERRAMENTA, MODELO, NOME_FERRAMENTA, SISTEMA, dividirEmLotes, lerResposta, validarPedido } from "./core.ts"

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
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

    // 1. Autoriza: qualquer funcionário ativo.
    try {
      const authHeader = req.headers.get('Authorization') ?? ''
      if (!authHeader) return json({ error: 'Não autenticado.' }, 401)
      const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
      const { data: { user: caller } } = await callerClient.auth.getUser()
      if (!caller) return json({ error: 'Sessão inválida.' }, 401)
      const { data: callerProfile } = await callerClient
        .from('app_users').select('id, status').eq('auth_user_id', caller.id).single()
      if (!callerProfile || callerProfile.status !== 'ativo') return json({ error: 'Usuário inativo.' }, 403)
    } catch (authErr) {
      console.error('traduzir-orcamento: erro de autenticação', authErr)
      return json({ error: 'Sessão inválida.' }, 401)
    }

    if (!ANTHROPIC_API_KEY) {
      console.error('traduzir-orcamento: ANTHROPIC_API_KEY ausente')
      return json({ error: 'Tradução indisponível no momento.' }, 502)
    }

    // 2. Valida o pedido.
    const corpo = await req.json().catch(() => null)
    const pedido = validarPedido(corpo)
    if (!pedido.ok) return json({ error: pedido.erro }, 400)

    // 3. Traduz em lotes, um de cada vez.
    const traducoes: Record<string, string> = {}
    for (const lote of dividirEmLotes(pedido.itens)) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 55000)
      let resp: Response
      try {
        resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: MODELO,
            max_tokens: 8192,
            system: SISTEMA,
            tools: [FERRAMENTA],
            tool_choice: { type: 'tool', name: NOME_FERRAMENTA },
            messages: [{ role: 'user', content: JSON.stringify({ itens: lote }) }],
          }),
        })
      } catch (e) {
        console.error('traduzir-orcamento: falha de rede com a Anthropic', e)
        return json({ error: 'Não consegui falar com o serviço de tradução. Tente de novo.' }, 502)
      } finally {
        clearTimeout(timer)
      }
      if (!resp.ok) {
        console.error('traduzir-orcamento: Anthropic respondeu', resp.status, (await resp.text().catch(() => '')).slice(0, 300))
        return json({ error: 'O serviço de tradução recusou o pedido. Tente de novo.' }, 502)
      }
      const lido = lerResposta(await resp.json().catch(() => null), lote.map((i) => i.id))
      if (!lido.ok) return json({ error: lido.erro }, 502)
      Object.assign(traducoes, lido.traducoes)
    }

    return json({ traducoes, modelo: MODELO })
  } catch (err) {
    console.error('traduzir-orcamento: erro inesperado', err)
    return json({ error: 'Erro interno.' }, 500)
  }
})
```

- [ ] **Step 6: Cliente**

Crie `src/lib/traducao.ts`:

```ts
import { supabase } from '@/lib/supabase';
import type { TextoParaTraduzir } from '@/lib/traducaoCore';

/**
 * Pede à função `traduzir-orcamento` a tradução (inglês americano) dos textos.
 * Devolve um mapa texto original → tradução. Lança Error com a mensagem do servidor
 * (ou uma mensagem amigável) se algo falhar; nunca devolve resultado parcial.
 */
export async function traduzirTextos(itens: TextoParaTraduzir[]): Promise<{ traducoes: Record<string, string>; modelo: string }> {
  const pedido = itens.map((it, i) => ({ id: `t${i}`, tipo: it.tipo, origem: it.origem }));
  const { data, error } = await supabase.functions.invoke('traduzir-orcamento', { body: { itens: pedido } });
  if (error) {
    let msg = 'Não foi possível traduzir agora. Tente de novo.';
    try {
      const corpo = await (error as any).context?.json?.();
      if (corpo?.error) msg = String(corpo.error);
    } catch { /* corpo ilegível: fica a mensagem amigável */ }
    throw new Error(msg);
  }
  const d = data as any;
  if (!d || d.error || !d.traducoes) throw new Error(d?.error || 'Não foi possível traduzir agora. Tente de novo.');
  const porId: Record<string, string> = d.traducoes;
  const traducoes: Record<string, string> = {};
  pedido.forEach((p) => { if (porId[p.id]) traducoes[p.origem] = porId[p.id]; });
  return { traducoes, modelo: String(d.modelo || '') };
}
```

- [ ] **Step 7: Tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros (a função em Deno fica fora do `tsc`; o `core.ts` é testado no Node).

```bash
git add supabase/functions/traduzir-orcamento scripts/testes/traduzirCore.test.mjs src/lib/traducao.ts
git commit -m "feat: função traduzir-orcamento (Sonnet 5.5) e cliente" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `BudgetPDF` lê o dicionário (português idêntico) e o inglês funciona

**Files:**
- Modify: `src/components/editor/BudgetPDF.tsx` (imports; o componente inteiro, da linha `// 3. COMPONENTE` ao fim do arquivo)

**Interfaces:**
- Consumes: `getTextos`, `Idioma` (`pdfTextos.ts`); `traduzir` (`traducaoCore.ts`); `formatarValorDaVersao(valor, v, locale)` e `formatarMoeda(valor, moeda, locale)` (`moeda.ts`); `version.pdf_language`, `version.translations`.
- Produces: `BudgetPDF` com as mesmas props; o idioma vem de `version.pdf_language`. Nenhum chamador muda.

**Esta tarefa é uma refatoração com teste de regressão. A ordem importa.**

- [ ] **Step 1: Capturar a linha de base em português ANTES de mexer no arquivo**

Com o código ainda sem alteração em `BudgetPDF.tsx`, gere e guarde o **texto extraído** de 4 PDFs (padrão e detalhado, em R$ e em US$) de um orçamento de teste do banco **local** (o orçamento `TST-001` existe; versão em US$ com cotação travada 4,85; troque a moeda da versão entre BRL e USD por SQL local para gerar os 4 casos — o gatilho só trava se o orçamento estiver `aprovado`; garanta `em_negociacao`). Método (o mesmo da Fase 1; **nenhum download real**):
1. Suba o Vite local: `npm run dev` em segundo plano (Supabase local já em `http://127.0.0.1:54321`, `.env.local` aponta para ele; login local de teste `caio.lacerda@produtoralumos.com.br` / `password123`, que existe só no banco local).
2. No navegador (pode estar oculto: use `javascript_tool`), antes de clicar nos botões de PDF, instale: um `URL.createObjectURL` que guarda o Blob e um `HTMLAnchorElement.prototype.click` que ignora âncoras com `download`; clique em "PDF" (padrão e detalhado) no editor do orçamento; envie o Blob por POST a um receptor local descartável (CORS `*`) que você sobe num diretório de rascunho da sessão (`/private/tmp/claude-501/-Users-caiorizzuttl-Documents-LUMOS-proposta-lumos/cc52598d-9a40-42b2-be7d-614ea56628e6/scratchpad/`).
3. Extraia o texto com `pdfjs-dist` instalado nesse diretório de rascunho (`npm install pdfjs-dist --prefix <diretório>`; NÃO no projeto), com um script node que concatena o texto de todas as páginas.
4. Guarde os 4 textos como `baseline_BRL_padrao.txt`, `baseline_BRL_detalhado.txt`, `baseline_USD_padrao.txt`, `baseline_USD_detalhado.txt` no diretório de rascunho. (Se o orçamento de teste não tiver briefing/logística, preencha por SQL local `notes_client`, `logistics_date`, `logistics_time`, `logistics_location` para cobrir esses blocos; depois da refatoração use o MESMO estado.)

- [ ] **Step 2: Atualizar os imports**

No topo de `src/components/editor/BudgetPDF.tsx`, troque

```tsx
import { Document, Page, Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer';
import { BudgetItem, BudgetVersion, VersionFinancials, formatCurrency } from '@/utils/financials';
import { formatBudgetCode } from '@/utils/formatters';
import { formatarValorDaVersao, moedaDaVersao } from '@/utils/moeda';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
```

por

```tsx
import { Fragment } from 'react';
import { Document, Page, Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer';
import { BudgetItem, BudgetVersion, VersionFinancials } from '@/utils/financials';
import { formatBudgetCode } from '@/utils/formatters';
import { formatarMoeda, formatarValorDaVersao, moedaDaVersao } from '@/utils/moeda';
import { getTextos } from '@/lib/pdfTextos';
import { traduzir } from '@/lib/traducaoCore';
import { format, parseISO } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
```

(`formatCurrency` sai: o bloco de fee mensal passa a usar `formatarMoeda(..., 'BRL', t.locale)`, que em português produz exatamente a mesma string.)

- [ ] **Step 3: Substituir o componente**

Apague tudo da linha `// 3. COMPONENTE` até o fim do arquivo (a interface `BudgetPDFProps` e o componente `BudgetPDF`) e coloque no lugar:

```tsx
// 3. COMPONENTE
interface BudgetPDFProps {
  budget: any;
  version: BudgetVersion;
  contact?: any;
  items: BudgetItem[];
  financials: VersionFinancials;
  userName?: string;
  /** Proposta detalhada: mostra valor unitário e total de cada item. */
  detalhado?: boolean;
}

export const BudgetPDF = ({ budget, version, contact, items, financials, userName, detalhado = false }: BudgetPDFProps) => {
  if (!budget || !version || !financials) return null;

  // Idioma do PDF (independente da moeda). Em português a saída é idêntica à de sempre.
  const lang = version.pdf_language === 'en' ? 'en' : 'pt';
  const t = getTextos(lang);
  const dateLocale = lang === 'en' ? enUS : ptBR;
  // Textos do orçamento: em inglês vêm do glossário revisado guardado na versão;
  // sem tradução saem no original. Em português passam direto.
  const tr = (s?: string | null): string => (lang === 'en' ? traduzir(version.translations, s) : String(s ?? ''));

  const dateStr = format(new Date(), t.formatoData, { locale: dateLocale });
  const markupMultiplier = financials.valorFinal / (financials.totalCusto || 1);

  // Em proposta em dólar o PDF mostra SÓ US$ (sem cotação e sem reais). Cada valor
  // é convertido e arredondado sozinho; o total é convertido uma única vez.
  const fmt = (valorBRL: number) => formatarValorDaVersao(valorBRL, version, t.locale);
  const taxaRemarcacao = moedaDaVersao(version) === 'USD' ? fmt(2000) : t.taxaRemarcacaoBRL;

  // Categoria: mapa do idioma, ou o slug capitalizado (como sempre foi em português).
  const categoryFormatted = budget.category
    ? (t.categorias[budget.category] ?? budget.category.charAt(0).toUpperCase() + budget.category.slice(1).toLowerCase())
    : '—';

  const groups = ['equipe', 'equipamentos', 'producao', 'edicao'] as const;

  // Novo padrão de nomenclatura: [CODE] | Lumos + [AGÊNCIA] [CLIENTE] | [NOME DO PROJETO]
  const clientDisplayName = budget.clients?.agency_name
    ? `${budget.clients.agency_name} + ${budget.clients.name}`
    : (budget.clients?.name || t.clienteFallback);

  const formattedCode = formatBudgetCode(budget.code);
  const nomenclatureHeader = `${formattedCode} | Lumos + ${clientDisplayName} | ${budget.project_name}`;
  const proposalTag = nomenclatureHeader;

  const cabecalho = (
    <>
      <View style={styles.header}>
        <Image src={logo} style={{ width: 144 }} />
        <View style={styles.companyInfo}>
          <Text style={{ fontWeight: 700 }}>Produtora Lumos Audiovisual Ltda.</Text>
          <Text>CNPJ: 51.253.010/0001-70</Text>
          <Text>R. Jaceru, 384 - Cj. 1604 - Vila Gertrudes</Text>
          <Text>São Paulo - SP, 04705-000</Text>
          <Text>comercial@produtoralumos.com.br</Text>
          <Text>+55 (11) 98667-6747</Text>
          <Text>www.produtoralumos.com.br</Text>
        </View>
      </View>
      <View style={styles.headerLine} />
    </>
  );

  // Cronograma do fee mensal (fee mensal nunca existe em US$): valores sempre em R$.
  // `null` explícito quando não se aplica: um '' solto dentro de uma <View> quebraria o react-pdf.
  const mostrarFee = version.payment_plan === 'fee_mensal' && !!version.fee_mensal_mostrar_na_proposta
    && !!version.fee_mensal_inicio && !!version.fee_mensal_fim;
  const feeMensal = !mostrarFee ? null : (
    <View style={{ marginTop: 2, marginBottom: 10 }} wrap={false}>
      <Text style={[styles.conditionText, { fontWeight: 700, marginBottom: 4 }]}>{t.feeTitulo}</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { width: '40%' }]}>{t.feeMes}</Text>
        <Text style={[styles.tableHeaderCell, { width: '30%', textAlign: 'right' }]}>{t.feeValorMensal}</Text>
        <Text style={[styles.tableHeaderCell, { width: '30%', textAlign: 'right' }]}>{t.feeAdendo}</Text>
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
            <Text style={[styles.tableCell, { width: '40%' }]}>{format(parseISO(`${l.mes}-01`), t.formatoMes, { locale: dateLocale })}</Text>
            <Text style={[styles.tableCell, { width: '30%', textAlign: 'right' }]}>{formatarMoeda(version.fee_mensal_valor || 0, 'BRL', t.locale)}</Text>
            <Text style={[styles.tableCell, { width: '30%', textAlign: 'right' }]}>{l.adendo > 0 ? formatarMoeda(l.adendo, 'BRL', t.locale) : '—'}</Text>
          </View>
        ));
      })()}
    </View>
  );

  return (
    <Document title={t.tituloDocumento(formattedCode.replace('#', ''), detalhado)}>
      {/* PÁGINA 1: PROPOSTA FINANCEIRA */}
      <Page size="A4" style={styles.page}>
        {/* Cabeçalho */}
        {cabecalho}

        {/* Nomenclatura acima do bloco */}
        <Text style={styles.nomenclatureTag}>{proposalTag}</Text>

        {/* Bloco de Identificação */}
        <View style={styles.idBlock}>
          <View style={styles.idRow}>
            <View style={styles.idLabelCol}><Text>{t.projeto}</Text></View>
            <View style={styles.idValueCol}><Text style={{ fontWeight: 700 }}>{budget.project_name}</Text></View>
            <View style={[styles.idMetaCol, { borderLeftWidth: 0.5, borderLeftColor: '#dcdcdc' }]}>
               <Text style={styles.idDate}>{t.emissao}: {dateStr}</Text>
            </View>
          </View>
          <View style={styles.idRow}>
            <View style={styles.idLabelCol}><Text>{t.cliente}</Text></View>
            <View style={styles.idValueCol}><Text>{clientDisplayName}</Text></View>
            <View style={[styles.idLabelCol, { borderLeftWidth: 0.5, borderLeftColor: '#dcdcdc' }]}><Text>{t.categoria}</Text></View>
            <View style={styles.idValueCol}><Text>{categoryFormatted}</Text></View>
          </View>
          <View style={[styles.idRow, { borderBottomWidth: 0 }]}>
            <View style={styles.idLabelCol}><Text>{t.contato}</Text></View>
            <View style={{ width: '85%', padding: 4 }}>
              <Text>{contact?.name || '—'}  ·  {contact?.email || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Escopo e Briefing */}
        {(version.notes_client || version.logistics_date || version.logistics_time || version.logistics_location) && (
          <View>
            <Text style={styles.sectionTitle}>{t.escopo}</Text>

            {/* Bloco de Logística se preenchido */}
            {(version.logistics_date || version.logistics_time || version.logistics_location) && (
              <View style={styles.logisticsBlock}>
                {version.logistics_date && (
                  <View style={styles.logisticsItem}>
                    <Text style={styles.logisticsLabel}>{t.datas}</Text>
                    <Text style={styles.logisticsValue}>{tr(version.logistics_date)}</Text>
                  </View>
                )}
                {version.logistics_time && (
                  <View style={styles.logisticsItem}>
                    <Text style={styles.logisticsLabel}>{t.horario}</Text>
                    <Text style={styles.logisticsValue}>{tr(version.logistics_time)}</Text>
                  </View>
                )}
                {version.logistics_location && (
                  <View style={[styles.logisticsItem, { flex: 2 }]}>
                    <Text style={styles.logisticsLabel}>{t.local}</Text>
                    <Text style={styles.logisticsValue}>{tr(version.logistics_location)}</Text>
                  </View>
                )}
              </View>
            )}

            {version.notes_client && (
              <View style={{ marginBottom: 12 }}>{renderRichNotes(tr(version.notes_client))}</View>
            )}
          </View>
        )}

        {/* Proposta Financeira — sempre começa numa nova página */}
        <View break>
          <View wrap={false}>
            <Text style={styles.sectionTitle}>{t.tituloFinanceiro}</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, detalhado ? styles.colNameD : styles.colName]}>{t.colItem}</Text>
              <Text style={[styles.tableHeaderCell, detalhado ? styles.colDescD : styles.colDesc]}>{t.colDescricao}</Text>
              <Text style={[styles.tableHeaderCell, detalhado ? styles.colQtyD : styles.colQty]}>{t.colQtd}</Text>
              <Text style={[styles.tableHeaderCell, detalhado ? styles.colUnitD : styles.colUnit]}>{t.colUnid}</Text>
              {detalhado && <Text style={[styles.tableHeaderCell, styles.colValorD]}>{t.colValorUnit}</Text>}
              {detalhado && <Text style={[styles.tableHeaderCell, styles.colTotalD]}>{t.colTotal}</Text>}
            </View>
          </View>

        <View style={{ marginBottom: 12 }}>
          {groups.filter(g => (items || []).some(i => i.item_group === g)).map((group, groupIdx, activeGroups) => {
            const groupItems = (items || []).filter(i => i.item_group === group);
            const isLastGroup = groupIdx === activeGroups.length - 1;
            const groupSum = groupItems.reduce((sum, item) =>
              sum + item.unit_cost * markupMultiplier * item.quantity, 0);

            const renderItemRow = (item: BudgetItem, index: number) => {
              const valorUnitario = item.unit_cost * markupMultiplier;
              return (
                <View key={item.id} style={[styles.tableRow, index % 2 === 1 ? styles.tableRowEven : {}]} wrap={false}>
                  <Text style={[styles.tableCell, detalhado ? styles.colNameD : styles.colName]}>{tr(item.name)}</Text>
                  <Text style={[styles.tableCell, detalhado ? styles.colDescD : styles.colDesc, { color: '#888', fontSize: 7, lineHeight: 1.4 }]}>
                    {tr(item.description)}
                  </Text>
                  <Text style={[styles.tableCell, detalhado ? styles.colQtyD : styles.colQty]}>{item.quantity}</Text>
                  <Text style={[styles.tableCell, detalhado ? styles.colUnitD : styles.colUnit]}>{t.unidades[item.unit_label] ?? item.unit_label}</Text>
                  {detalhado && (
                    <Text style={[styles.tableCell, styles.colValorD]}>{fmt(valorUnitario)}</Text>
                  )}
                  {detalhado && (
                    <Text style={[styles.tableCell, styles.colTotalD, { fontWeight: 700 }]}>
                      {fmt(valorUnitario * item.quantity)}
                    </Text>
                  )}
                </View>
              );
            };

            return (
              /* wrap={false} mantém o grupo inteiro numa só página, evitando divisões no meio da categoria */
              <View key={group} wrap={false}>
                <View style={styles.groupHeader}>
                  <Text>{t.grupos[group]}</Text>
                </View>

                {groupItems.map((item, index) => renderItemRow(item, index))}

                <View style={styles.groupSubtotalRow}>
                  <Text style={styles.groupSubtotalText}>{t.subtotal} {t.grupos[group]}</Text>
                  <Text style={styles.groupSubtotalValue}>{fmt(groupSum)}</Text>
                </View>

                {isLastGroup && (
                  <View style={styles.totalContainer} wrap={false} minPresenceAhead={80}>
                    <Text style={styles.totalLabel}>{t.totalProjeto}</Text>
                    <Text style={styles.totalValue}>{fmt(financials.valorFinal)}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
        </View>{/* fim: Proposta Financeira */}

      </Page>

      {/* PÁGINA DE CONDIÇÕES E ASSINATURAS */}
      <Page size="A4" style={styles.page}>
        {/* Cabeçalho Página 2 */}
        {cabecalho}

        <Text style={styles.sectionTitle}>{t.condicoesTitulo}</Text>
        <View style={styles.conditionsList}>
          {t.clausulas.map((c, ci) => (
            <Fragment key={ci}>
              <View style={styles.conditionSection}>
                <Text style={styles.conditionTitle}>{c.titulo}</Text>
                {c.itens.map((txt, ii) => (
                  <Text key={ii} style={styles.conditionText}>{txt.replace('{taxaRemarcacao}', () => taxaRemarcacao)}</Text>
                ))}
              </View>
              {/* O cronograma do fee mensal fica logo depois da cláusula 3 (Pagamento). */}
              {ci === 2 && feeMensal}
            </Fragment>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 10 }]}>{t.termoTitulo}</Text>
        <View style={styles.signatureContainer}>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureTitle}>{t.aprovadoPor}</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>{clientDisplayName}</Text>
            <Text style={styles.signatureLabel}>{contact?.name || t.contatoFallback}</Text>
            <Text style={styles.signatureLabel}>{t.dataLinha}</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureTitle}>{t.produtoraLumos}</Text>
            <View style={styles.signatureLine} />
            <Text style={[styles.signatureLabel, styles.signatureName]}>{userName || t.equipeFallback}</Text>
            <Text style={styles.signatureLabel}>{t.dataLinha}</Text>
          </View>
        </View>

        {/* Rodapé (Não fixed, apenas absoluto na base da página 2) */}
        <View style={styles.pageFooter}>
          <Text style={styles.footerText}>{nomenclatureHeader} · WWW.PRODUTORALUMOS.COM.BR</Text>
        </View>
      </Page>
    </Document>
  );
};
```

(O componente acima mantém `styles` e os registros de fonte do início do arquivo. `Fragment` e o fragmento curto `<>…</>` são suficientes: `cabecalho` e `feeMensal` são elementos reaproveitados em pontos fixos, não em listas.)

- [ ] **Step 4: Tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Regressão em português (o teste que importa)**

Repita a captura do Step 1 com o código novo, **com o mesmo estado do banco local** (mesma versão, mesmos textos, moedas BRL e USD, padrão e detalhado, `pdf_language` ausente/`pt`; se a migration da Task 2 ainda não estiver no banco local, aplique-a: `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/2026101100_pdf_idioma.sql`). Salve como `depois_*.txt` e compare com os `baseline_*.txt`: **tem que ser igual, byte a byte, exceto a data de emissão** (`Emissão: …`), que muda com o dia. Reporte os 4 resultados (iguais ou o diff exato). Se algum diferir por outro motivo que a data, é defeito da refatoração: corrija.

- [ ] **Step 6: Inglês funciona**

No mesmo orçamento de teste (local), grave por SQL local `pdf_language = 'en'` e um glossário de teste, por exemplo:
`UPDATE budget_versions SET pdf_language='en', translations='{"versao":1,"textos":{"<nome do 1º item>":"Camera day rate"}}'::jsonb WHERE id = '<versão>';`
(use o nome real de um item do orçamento de teste e, se houver, a nota/logística). Capture e extraia o texto do PDF **padrão e detalhado**, em **US$** e em **R$**, e confirme: título `GENERAL TERMS AND CONDITIONS`; as 7 cláusulas em inglês com `seven (7) calendar days`, `70%`, `48 hours`; cláusula 4.1 com `$412.37` (US$, cotação 4,85) ou `R$2,000.00` (R$); `Total Project Investment` com `$1,718.21` (US$) ou `R$8,333.33` (R$) conforme o orçamento de teste; rótulos `Project`, `Client`, `Category`, `Contact`, `Issued: <Month d, yyyy>`; grupos `Crew`/`Equipment`; unidade `day`/`unit`...; item traduzido aparece em inglês e os **não** traduzidos aparecem no original; `Acceptance and Approval`, `Approved by:`, `DATE: ____/____/____`; **nenhum** `R$` num PDF em inglês + US$. Depois restaure `pdf_language = 'pt'` e `translations = NULL`.

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/BudgetPDF.tsx
git commit -m "feat: PDF da proposta lê o dicionário e sai em inglês americano quando pedido" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Editor — painel de idioma, tela de revisão e gravação

**Files:**
- Create: `src/components/editor/IdiomaPanel.tsx`
- Create: `src/components/editor/TraducaoModal.tsx`
- Modify: `src/pages/BudgetEditorPage.tsx`

**Interfaces:**
- Consumes: `coletarTextos`, `faltantes`, `mesclar`, `traduzir`, `chave`, `Traducoes`, `TextoParaTraduzir` (`traducaoCore.ts`); `traduzirTextos` (`traducao.ts`); `camposDeIdioma` (`idioma.ts`); `Modal` (`isOpen`, `onClose`, `title`, `children`, `maxWidth`); `Select` (`value`, `onChange`, `options`, `disabled`, `className`); `RichTextEditor` (`value`, `onChange(html)`, `editable`, `className`, `minHeight`); `useToast()`.
- Produces: `<IdiomaPanel version items disabled onChange />` e `<TraducaoModal version items onClose onSave />`.

- [ ] **Step 1: Criar `TraducaoModal.tsx`**

Crie `src/components/editor/TraducaoModal.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import Modal from '@/components/common/Modal';
import RichTextEditor from '@/components/common/RichTextEditor';
import { useToast } from '@/context/ToastContext';
import type { BudgetItem, BudgetVersion } from '@/utils/financials';
import { chave, coletarTextos, faltantes, mesclar, type Traducoes } from '@/lib/traducaoCore';
import { traduzirTextos } from '@/lib/traducao';

interface Props {
  version: BudgetVersion;
  items: BudgetItem[];
  onClose: () => void;
  /** Recebe o glossário revisado; quem chama grava na versão. */
  onSave: (t: Traducoes) => void;
}

// Texto simples de um trecho HTML, só para mostrar o ORIGINAL ao lado da tradução.
const textoSimples = (html: string) => {
  try {
    return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() || html;
  } catch { return html; }
};

export default function TraducaoModal({ version, items, onClose, onSave }: Props) {
  const toast = useToast();
  const coletados = useMemo(() => coletarTextos(version, items), [version, items]);
  const [rascunho, setRascunho] = useState<Record<string, string>>(() => ({ ...(version.translations?.textos ?? {}) }));
  const [modelo, setModelo] = useState<string | undefined>(version.translations?.modelo);
  const [traduzindo, setTraduzindo] = useState(false);

  const comoTraducoes = (): Traducoes => ({ versao: 1, textos: rascunho, traduzido_em: version.translations?.traduzido_em, modelo });
  const faltam = faltantes(coletados, comoTraducoes());

  const traduzirComIA = async (somenteFaltantes: boolean) => {
    const alvo = somenteFaltantes ? faltam : coletados;
    if (alvo.length === 0) { toast.warning('Não há textos para traduzir.'); return; }
    setTraduzindo(true);
    try {
      const r = await traduzirTextos(alvo);
      const mesclado = mesclar(comoTraducoes(), r.traducoes, new Date().toISOString(), r.modelo);
      setRascunho(mesclado.textos);
      setModelo(mesclado.modelo);
      toast.success(`${Object.keys(r.traducoes).length} texto(s) traduzido(s). Revise antes de salvar.`);
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível traduzir agora.');
    } finally {
      setTraduzindo(false);
    }
  };

  const mudar = (origem: string, en: string) => setRascunho((p) => ({ ...p, [chave(origem)]: en }));

  const salvar = () => {
    // Só guarda o que ainda é texto do orçamento (limpa traduções de textos que já não existem).
    const vivos = new Set(coletados.map((c) => c.origem));
    const textos: Record<string, string> = {};
    for (const [o, en] of Object.entries(rascunho)) if (vivos.has(o) && chave(en) !== '') textos[o] = en;
    onSave({ versao: 1, textos, traduzido_em: version.translations?.traduzido_em ?? new Date().toISOString(), modelo });
  };

  return (
    <Modal isOpen onClose={onClose} title="Traduzir e revisar (inglês)" maxWidth="max-w-4xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-lumos-text-secondary">
            Traduza com a IA e <span className="font-bold text-lumos-text-primary">revise cada texto</span> antes de salvar.
            O PDF em inglês usa o que estiver salvo aqui; texto sem tradução sai em português.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={traduzindo || faltam.length === 0} onClick={() => traduzirComIA(true)}
              className="btn-primary h-9 px-3 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
              {traduzindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Traduzir {faltam.length > 0 ? `${faltam.length} faltante(s)` : 'com IA'}
            </button>
            <button type="button" disabled={traduzindo || coletados.length === 0}
              onClick={() => { if (confirm('Traduzir TUDO de novo? As traduções que você já editou serão substituídas.')) void traduzirComIA(false); }}
              className="btn-secondary h-9 px-3 text-xs font-bold disabled:opacity-50">
              Retraduzir tudo
            </button>
          </div>
        </div>

        {coletados.length === 0 && (
          <p className="text-sm text-lumos-text-secondary">Este orçamento ainda não tem textos para traduzir.</p>
        )}

        <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3">
          {coletados.map((c) => {
            const falta = chave(rascunho[c.origem]) === '';
            return (
              <div key={c.origem} className={clsx('grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lumos border p-3',
                falta ? 'border-amber-500/40' : 'border-lumos-border')}>
                <div>
                  <span className="text-[10px] text-lumos-text-secondary font-black uppercase block mb-1">Original (português)</span>
                  <p className="text-sm text-lumos-text-primary whitespace-pre-wrap">{c.tipo === 'html' ? textoSimples(c.origem) : c.origem}</p>
                </div>
                <div>
                  <span className="text-[10px] text-lumos-text-secondary font-black uppercase block mb-1">
                    English {falta && <span className="text-amber-500 normal-case">· sem tradução</span>}
                  </span>
                  {c.tipo === 'html' ? (
                    <RichTextEditor value={rascunho[c.origem] ?? ''} onChange={(html: string) => mudar(c.origem, html)} editable minHeight="120px" />
                  ) : (
                    <textarea rows={c.origem.length > 60 ? 3 : 1} className="input-lumos w-full text-sm"
                      value={rascunho[c.origem] ?? ''} onChange={(e) => mudar(c.origem, e.target.value)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 h-10 text-sm">Cancelar</button>
          <button type="button" onClick={salvar} className="btn-primary flex-1 h-10 text-sm font-bold">Salvar traduções</button>
        </div>
      </div>
    </Modal>
  );
}
```

(`useToast()` expõe `success`, `error` e `warning`; confira em `src/context/ToastContext.tsx`. Se o `RichTextEditor` tipar `minHeight` como número ou não aceitar `editable`, ajuste só essas props, sem mexer no componente.)

- [ ] **Step 2: Criar `IdiomaPanel.tsx`**

Crie `src/components/editor/IdiomaPanel.tsx`:

```tsx
import { useMemo, useState } from 'react';
import Select from '@/components/ui/Select';
import type { BudgetItem, BudgetVersion } from '@/utils/financials';
import { coletarTextos, faltantes, type Traducoes } from '@/lib/traducaoCore';
import TraducaoModal from '@/components/editor/TraducaoModal';

interface Props {
  version: BudgetVersion;
  items: BudgetItem[];
  /** Versão antiga / só leitura. */
  disabled: boolean;
  onChange: (updates: Partial<BudgetVersion>) => void;
}

export default function IdiomaPanel({ version, items, disabled, onChange }: Props) {
  const [aberto, setAberto] = useState(false);
  const idioma = version.pdf_language === 'en' ? 'en' : 'pt';
  const coletados = useMemo(() => coletarTextos(version, items), [version, items]);
  const faltam = faltantes(coletados, version.translations).length;

  const salvar = (t: Traducoes) => {
    onChange({ translations: t });
    setAberto(false);
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-1 block">Idioma do PDF</label>
        <Select
          disabled={disabled}
          className="input-lumos w-full font-black uppercase text-[10px] disabled:opacity-70"
          value={idioma}
          onChange={(v) => onChange({ pdf_language: v === 'en' ? 'en' : 'pt' })}
          options={[{ value: 'pt', label: 'Português' }, { value: 'en', label: 'English (US)' }]}
        />
      </div>

      {idioma === 'en' && (
        <div className="rounded-lumos border border-lumos-border p-3 space-y-2 text-[10px] font-semibold">
          <div className="flex items-center justify-between gap-2">
            <span className="text-lumos-text-secondary">
              {coletados.length === 0
                ? 'Sem textos para traduzir.'
                : `${coletados.length - faltam} de ${coletados.length} textos traduzidos`}
            </span>
            <button
              type="button" disabled={disabled} onClick={() => setAberto(true)}
              className="h-8 px-3 rounded-lumos border border-lumos-border text-lumos-text-primary font-bold hover:border-lumos-yellow/50 disabled:opacity-50"
            >
              Traduzir e revisar
            </button>
          </div>
          {faltam > 0 && (
            <p className="text-amber-500">
              {faltam} texto(s) sem tradução saem em português no PDF em inglês.
            </p>
          )}
        </div>
      )}

      {aberto && <TraducaoModal version={version} items={items} onClose={() => setAberto(false)} onSave={salvar} />}
    </div>
  );
}
```

- [ ] **Step 3: Integrar no editor (`BudgetEditorPage.tsx`)**

(a) Imports: depois de `import MoedaPanel from '@/components/editor/MoedaPanel';` acrescente

```tsx
import IdiomaPanel from '@/components/editor/IdiomaPanel';
import { camposDeIdioma } from '@/utils/idioma';
import { coletarTextos, faltantes } from '@/lib/traducaoCore';
```

(b) Gravar idioma e traduções nos três pontos que já gravam `camposDeMoeda` (rascunho INSERT, UPDATE do salvar, nova versão INSERT). Em cada um, a linha `...camposDeMoeda(version)` ganha uma vírgula e a linha seguinte `...camposDeIdioma(version)`. Use `Edit` com estes contextos (cada um é único):

Rascunho (indentação de 12 espaços) — troque
```tsx
            ...camposDeMoeda(version)
          })
          .select()
          .single();

        if (vError) throw vError;
        currentVersionId = vData.id;
```
por
```tsx
            ...camposDeMoeda(version),
            ...camposDeIdioma(version)
          })
          .select()
          .single();

        if (vError) throw vError;
        currentVersionId = vData.id;
```

Salvar de orçamento existente — troque
```tsx
            ...camposDeMoeda(version)
          }).eq('id', version.id),
```
por
```tsx
            ...camposDeMoeda(version),
            ...camposDeIdioma(version)
          }).eq('id', version.id),
```

Nova versão (indentação de 10 espaços) — troque
```tsx
          ...camposDeMoeda(version)
        })
        .select()
        .single();

      if (vError) throw vError;

      const itemsToClone
```
por
```tsx
          ...camposDeMoeda(version),
          ...camposDeIdioma(version)
        })
        .select()
        .single();

      if (vError) throw vError;

      const itemsToClone
```

`handleSaveAsTemplate`, duplicar e `Templates.tsx` **não** mudam (voltam a `pt`/nulo pelo padrão do banco).

(c) Painel: logo depois do bloco do `MoedaPanel` (o `{version && ( <MoedaPanel ... /> )}`), antes do bloco "Status Proposta", acrescente:

```tsx
                {version && (
                  <IdiomaPanel
                    version={version}
                    items={items}
                    disabled={isReadOnly}
                    onChange={updateVersion}
                  />
                )}
```

(d) Aviso ao exportar: no começo de `handleGenerateAndBackup`, logo depois de `if (!financials || !budget || !version) return;`, acrescente:

```tsx
    if (version.pdf_language === 'en') {
      const faltam = faltantes(coletarTextos(version, items), version.translations).length;
      if (faltam > 0) toast.warning(`${faltam} texto(s) sem tradução saem em português neste PDF em inglês.`);
    }
```

(O `updateVersion` salva `pdf_language` e `translations` com o debounce de 5 s, como os demais campos; `savePartialVersion` faz `update(updates)` genérico.)

- [ ] **Step 4: Tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Testar na tela (banco local)**

Banco local com as migrations das Tasks 1–2 aplicadas; Vite local; login de teste local `caio.lacerda@produtoralumos.com.br` / `password123` (existe só no banco local); **sem downloads reais** (use a captura de Blob da Task 4 se for conferir PDF). A função `traduzir-orcamento` **não** está no ar localmente: o botão de IA vai falhar com mensagem (isso testa o caminho de erro); o restante se testa digitando as traduções à mão. Confira no orçamento de teste (`TST-001`):
1. Aparece **"Idioma do PDF"** (Português / English (US)) abaixo da moeda. Em Português nada mais aparece.
2. Troque para **English (US)**: aparece "0 de N textos traduzidos" e o aviso âmbar "N texto(s) sem tradução saem em português…". Aguarde ~5 s (autosave) e recarregue a página: continua em English.
3. **Traduzir e revisar** abre o modal: um bloco por texto (logística, briefing, nome e descrição de cada item), com o original à esquerda e um campo em inglês à direita; blocos sem tradução com borda âmbar e "sem tradução".
4. Clique **Traduzir N faltante(s)**: sem a função no ar, aparece um toast de erro com mensagem amigável e nada é alterado (o modal continua utilizável).
5. Digite à mão a tradução de dois textos (um deles o briefing no editor rico) e clique **Salvar traduções**: o modal fecha; o painel mostra "2 de N textos traduzidos"; o aviso mostra N−2.
6. Gere o PDF em inglês (captura de Blob, sem download real): os dois textos traduzidos aparecem em inglês, os demais no original; ao clicar em PDF aparece o toast de aviso sobre textos sem tradução.
7. **Nova versão** herda English e as traduções (o painel da nova versão mostra o mesmo "2 de N"). **Duplicar** o orçamento (pela lista) cria um orçamento em Português e sem traduções.
8. Troque de volta para Português: o PDF sai idêntico ao de antes.
9. Console do navegador sem erros novos. Restaure o banco local se quiser.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/IdiomaPanel.tsx src/components/editor/TraducaoModal.tsx src/pages/BudgetEditorPage.tsx
git commit -m "feat: painel de idioma e tela de revisão da tradução no editor do orçamento" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verificação final, PR e roteiro de produção

**Files:** nenhum arquivo de código novo.

- [ ] **Step 1: Verificações automáticas**

Run: `node --test scripts/testes/moeda.test.mjs scripts/testes/ptax.test.mjs scripts/testes/pdfTextos.test.mjs scripts/testes/traducaoCore.test.mjs scripts/testes/traduzirCore.test.mjs`
Expected: `ℹ fail 0`.

Run (banco local, 3 scripts): `idioma_banco.sql`, `moeda_banco.sql`, `recebimento_cambial_banco.sql` com `docker exec -i supabase_db_proposta-lumos psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/testes/<arquivo>`
Expected: todos `OK`, sem `FALHOU`, terminando em `ROLLBACK`.

Run: `npm run build`
Expected: build conclui sem erros.

- [ ] **Step 2: Limpar o ambiente**

`git status` só com os arquivos desta fase; se `node_modules/.vite` ou `supabase/.temp` aparecerem modificados, `git checkout -- node_modules supabase/.temp`.

- [ ] **Step 3: Abrir o PR**

```bash
git push -u origin feat/dolar-fase-3-pdf-ingles
```

Corpo do PR (arquivo temporário, `--body-file`): o que muda; o **roteiro de produção** abaixo; o aviso de **revisão do jurídico** das cláusulas em inglês; os testes feitos (inclusive a regressão do PDF em português); termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

```bash
gh pr create --base main --head feat/dolar-fase-3-pdf-ingles --title "feat: orçamento em dólar, Fase 3 (PDF em inglês)" --body-file <caminho do corpo>
```

**Roteiro de produção (só com a autorização do Caio, nesta ordem):**
1. O Caio roda a migration `2026101100_pdf_idioma.sql` no SQL Editor de produção (SQL completo colado no chat). Conferir: `select column_name from information_schema.columns where table_name='budget_versions' and column_name in ('pdf_language','translations');` (2 linhas).
2. **Deploy da função** `traduzir-orcamento` (o Caio, no terminal, dentro do worktree: `supabase functions deploy traduzir-orcamento --project-ref byntpekyfhzwfihjhzuo`). Confirmar que o segredo `ANTHROPIC_API_KEY` existe nas Edge Functions (já é usado pelo leitor de recibos).
3. Teste na pré-visualização do PR (ela usa o banco de produção): num orçamento de **teste**, idioma English → "Traduzir e revisar" → "Traduzir faltantes" → revisar → salvar → gerar o PDF em inglês e conferir.
4. Só então mesclar.

**Para o PR e para o Caio:**
- As cláusulas em inglês são tradução minha, em estilo contratual americano, e **precisam de revisão do jurídico** antes de um cliente receber.
- A página pública de aprovação continua em português (decisão do Caio); o PDF em inglês é só o PDF.
- Custo: cada "Traduzir" usa a API da Anthropic (Sonnet 5.5) e só roda quando alguém aperta o botão.
