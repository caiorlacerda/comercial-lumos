# Orçamento em dólar (proposta em US$, financeiro em R$) — design

Data: 2026-10-09 · Status: decisões fechadas; aguardando aprovação final para o plano

## Objetivo

Poder cobrar uma proposta em **dólar** usando a cotação atual, com um botão no editor
do orçamento e PDF exportado em US$. **Todo o financeiro continua em reais.** O dólar
existe só na proposta (editor, PDF e página pública de aprovação).

## Decisões já tomadas (Caio)

- A cotação fica **travada no orçamento**, sempre com **margem de segurança de 3%**
  (editável por orçamento).
- O financeiro é 100% em reais. A cotação travada no orçamento define o valor em reais.
- No recebimento, o time informa **o valor total em reais, já convertido**.
- O **PDF mostra só o valor em dólar**: sem cotação e sem valor em reais.
- Fee mensal fica **fora** desta primeira entrega.
- PDF em inglês: sim, em etapa própria, com a API do Claude para os textos variáveis.
- O congelamento do valor em reais na aprovação é o que já existe hoje
  (`valor_vendido` e `total_amount` são gravados na aprovação).

## Fora de escopo

Fee mensal em dólar; financeiro, fluxo de caixa e relatórios em dólar; dashboards
separados por moeda (somam reais, como hoje); correção das fórmulas de preço
divergentes já existentes (`Clients.tsx`, `ClientProfile.tsx`, `CustosProjeto.tsx`,
`fn_versao_reajusta_parcelas`).

## Visão geral

O cálculo do preço **não muda** (custo, margem, imposto e desconto continuam em reais,
em `calcFinancials`). O dólar é uma **conversão final**:

```
valorUSD = arredonda( valorFinalBRL / fx_rate , 2 )
fx_rate  = arredonda( cotacao_mercado × (1 − fx_spread_pct) , 4 )
```

Com mercado a R$ 5,00 e margem de 3%: `fx_rate = 4,85`; R$ 50.000 → **US$ 10.309,28**.
A margem sobe o preço em dólar para proteger a Lumos se o dólar cair até o pagamento.

Consequência importante: a aprovação continua gravando **o mesmo valor em reais de
sempre**, então `aprovar_orcamento` e o restante do financeiro **não mudam**.

## 1. Dados (`budget_versions`)

Schema real conferido em produção em 2026-10-09: bate com as migrations do repositório
e **não existe nenhuma coluna de moeda**. Novas colunas (migration versionada):

| coluna | tipo | observação |
|---|---|---|
| `currency` | text, default `'BRL'`, check `in ('BRL','USD')` | |
| `fx_market_rate` | numeric(12,4), null | cotação de mercado usada (R$ por US$) |
| `fx_spread_pct` | numeric(5,4), default `0.03` | mesmo padrão de `margin_pct` (fração) |
| `fx_rate` | numeric(12,4), null | **cotação travada** = mercado × (1 − spread) |
| `fx_rate_at` | timestamptz, null | quando a cotação foi obtida/digitada |
| `fx_source` | text, null | `'ptax'` ou `'manual'` |

Fase 3 acrescenta `pdf_language` (`'pt'`/`'en'`) e `translations` (jsonb).

**Trava na aprovação:** um gatilho `BEFORE UPDATE` em `budget_versions` recusa mudança
em `currency` e `fx_*` enquanto `budgets.status = 'aprovado'`. Para alterar, o orçamento
volta antes para "em negociação". A tela desabilita os campos com uma explicação.

**Fee mensal:** com `payment_plan = 'fee_mensal'`, a opção US$ fica desativada no editor.

## 2. Cotação

- Nova **Edge Function `cotacao`** (exige login) busca a cotação do dólar no **Banco
  Central (PTAX, API Olinda)**, usa o dia útil mais recente e guarda o resultado numa
  tabela `cotacoes_dia` (um registro por dia, com cache). Se a busca falhar, devolve a
  última guardada, com a data.
- Usa a **PTAX de compra**: a Lumos *vende* os dólares ao banco, que *compra*. A
  diferença para a venda é de centésimos e fica dentro da margem de 3%.
- Verificado em 2026-10-09: o serviço responde JSON com `cotacaoCompra`, `cotacaoVenda`
  e `dataHoraCotacao`, em dias úteis.
- **Cotação manual** sempre possível (campo editável); `fx_source` passa a `'manual'`.
- A cotação **só muda quando o usuário aperta "Atualizar cotação"**: abrir o orçamento
  nunca recalcula sozinho.
- Aviso interno (nunca no PDF): "cotação de N dias; a proposta vale por X dias —
  atualizar?" quando `fx_rate_at` for mais antigo que `validity_days`.

## 3. Editor (`BudgetEditorPage.tsx`)

- Perto de "Valor de Venda Final": seletor **Moeda (R$ | US$)**; em US$ aparecem
  cotação do mercado, margem de segurança (3%), **cotação travada**, data, botão
  **Atualizar cotação** e campo para digitar à mão.
- O resumo mostra o valor final em US$ (e continua mostrando o interno em R$, só para a
  equipe).
- As colunas novas precisam entrar nos **5 pontos onde a lista de colunas de
  `budget_versions` está escrita à mão** (INSERT do rascunho, UPDATE do salvar, nova
  versão, salvar como template, duplicar em `Budgets.tsx`/`Templates.tsx`), senão se
  perdem na clonagem. **Nova versão** copia moeda e cotação; **duplicar orçamento e
  template** voltam para R$ (a cotação envelheceria).
- Os selects explícitos de `Budgets.tsx`, `Dashboard.tsx`, `ClientProfile.tsx` e
  `CustosProjetoDetalhe.tsx` ganham as colunas novas.

## 4. Formatação (`src/utils/financials.ts`)

`formatCurrency(value)` ganha parâmetros opcionais `(currency = 'BRL', locale = 'pt-BR')`
e um helper `converterParaMoeda(valorBRL, version)`. Chamadas existentes não mudam
(retrocompatível). US$ em português: `US$ 10.309,28`; em inglês (Fase 3): `$10,309.28`.
Modo apresentação (`PrivacyContext.tsx`) passa a borrar também `US$ …` e `$ …`.

## 5. PDF (`BudgetPDF.tsx`)

- Em US$: **só valores em dólar**. Sem cotação, sem equivalente em reais.
- Total, subtotais por grupo e (no modo detalhado) preço por item convertidos a partir
  dos reais. **Cada valor é arredondado sozinho, então a soma dos itens pode diferir
  alguns centavos do total**; o total é sempre o convertido uma vez.
- Cláusula "taxa de remarcação no valor mínimo de **R$ 2.000,00**" (também em
  `AprovacaoPublica.tsx`): em US$ vira a **conversão direta** pela cotação travada
  (`2000 / fx_rate`, duas casas), sem expor reais. Exemplo: cotação 4,85 → US$ 412,37.
- O restante do PDF (textos, CNPJ, data) fica em português na Fase 1.

## 6. Página pública (`AprovacaoPublica.tsx` + RPC)

`get_public_budget_by_token` passa a devolver também `currency` e `fx_rate`; a página
converte o total do mesmo jeito que o editor e mostra **apenas US$**. A aprovação segue
igual (`insert_budget_approval`, `syncBudgetApprovalFlow` com `valorFinal` em reais).

## 7. Contas a Receber (Fase 2)

- **Referência em US$:** títulos cujo `budget_version_id` aponta para uma versão em US$
  mostram "US$ x" ao lado do valor em reais, calculado na hora
  (`total_amount / fx_rate`). Não há coluna nova em `receivables`. *A verificar no plano:
  se `aprovar_orcamento` preenche `budget_version_id` em todas as parcelas.*
- **Registrar recebimento de título em US$:** hoje o sistema soma o valor recebido,
  **bloqueia se passar do total** e marca "parcial" se faltar. Para US$, o modal pede
  **"Valor recebido em R$ (já convertido)"**, fecha o título como `recebido` e ajusta o
  `total_amount` desse título ao valor realmente recebido, com o valor previsto
  registrado em `reconciliacao_recebimento_log` (antes/depois). Os gatilhos de
  espelhamento com Custos de Projeto são conferidos no plano.
- `projetos_financeiro.valor_vendido` **continua o valor previsto**; a variação cambial
  real aparece no título, não em Rentabilidade (limitação conhecida; evolução futura).

## 8. PDF em inglês (Fase 3)

- Idioma do PDF (`pdf_language`) **independente** da moeda.
- **Textos fixos** (cláusulas, termo de aceite, rótulos, data): dicionário pt/en no
  código (`src/lib/pdfTextos.ts`), traduzido **uma vez e revisado por vocês**. Não usa
  API, pois as cláusulas são contratuais.
- **Textos do orçamento** (nomes e descrições dos itens, observações ao cliente,
  condições de pagamento): nova Edge Function `traduzir-orcamento`, que chama a API da
  Anthropic (mesmo padrão de `extract-receipt`; chave só no servidor). O resultado fica
  em `translations` na versão e abre numa tela **para revisão e edição antes de
  exportar**. O PDF nunca muda sozinho entre duas exportações.

## Entrega em fases (um PR por fase)

1. **Moeda e PDF em US$:** migration (colunas, gatilho de trava, RPC pública), Edge
   Function `cotacao` + `cotacoes_dia`, editor, formatação, PDF em US$, página pública.
2. **Recebimento:** referência em US$ e recebimento em reais convertidos.
3. **PDF em inglês:** dicionário, tradução assistida, revisão.

## Verificação (não há runner de testes no projeto)

- **Regressão:** orçamento em R$ com os mesmos dados dá o mesmo total, PDF e aprovação.
- **Cálculo:** `valorFinal / fx_rate` com e sem desconto e com imposto reajustando preço.
- **Banco local (`supabase db reset`):** colunas, gatilho de trava, RPC pública e
  aprovação com orçamento em US$ gerando o mesmo `valor_vendido` que em R$.
- **Tela:** troca de moeda, atualizar cotação, cotação manual, falha da API, orçamento
  aprovado travado, nova versão, duplicar e template, PDF padrão e detalhado, página
  pública.

## Decisões fechadas em 2026-10-09 (Caio)

1. Cláusula de remarcação em US$: **conversão direta**, sem arredondar para múltiplos.
2. Cotação: **PTAX de compra** (a Lumos vende os dólares ao banco).
3. Recebimento de título em US$: **ajusta o `total_amount` do título** ao valor real
   recebido em reais; o previsto fica no log.

## Observações fora de escopo (para conhecimento)

- A RPC pública `get_public_budget_by_token` já devolve a **qualquer pessoa com o link**
  `unit_cost` (custo), `margin_pct`, `nf_pct` e `discount_value`. O cliente consegue ver
  custo e margem da Lumos inspecionando a rede. **O Caio avaliou que a página é pouco
  usada e aceitou o risco por ora**; nada será feito aqui.
- `ClientProfile.tsx` usa `versions[0]` em vez da versão ativa; "salvar como template",
  duplicar e `Templates.tsx` não copiam `payment_plan`, fee mensal nem
  `imposto_reajusta_preco`.
