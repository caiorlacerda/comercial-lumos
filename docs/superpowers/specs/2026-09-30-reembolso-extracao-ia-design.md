# Reembolso: extração automática dos dados da nota por IA

**Data:** 30/09/2026 · **Estado:** aprovado em conversa

## O problema

Hoje, pedir reembolso é preencher tudo à mão: descrição, valor, data, projeto.
Em outra ferramenta que o Caio usa (SAP Concur), anexar a foto da nota já
preenche a maior parte sozinho — sobra só dizer o motivo do gasto e em qual
projeto foi. Queremos o mesmo aqui: menos digitação pra quem pede, e mais
contexto (fornecedor, categoria) pra quem aprova.

## O que vai existir

Na hora de anexar a nota (arquivo solto, ou foto tirada na hora pelo celular),
o app manda a imagem pra uma Edge Function que lê o recibo com Claude e devolve
fornecedor, valor, data e uma categoria sugerida. Esses campos aparecem
preenchidos na hora — a pessoa só completa o **motivo do gasto** e escolhe o
**projeto**, exatamente como hoje.

Nenhum campo fica travado: é tudo editável antes de enviar, e se a IA não
conseguir ler a nota (foto ruim, não é bem um recibo, erro de rede), os campos
ficam em branco pra preencher à mão — nunca impede de criar o reembolso.

O upload da nota pro Google Drive continua exatamente como é hoje; a IA só lê
o arquivo pra extrair os dados, não participa do armazenamento.

### Fluxo (quem pede)

1. Anexa a nota (arrasta, escolhe do computador, ou tira foto pelo celular via
   `capture="environment"` no input).
2. A tela chama a Edge Function e mostra "Lendo a nota com IA…" em cima dos campos.
3. Resposta preenche Fornecedor, Categoria, Valor e Data.
4. Pessoa confere/corrige o que quiser, escreve o motivo, escolhe o projeto, envia.

### Quem aprova

A lista e o detalhe passam a mostrar **Fornecedor** e **Categoria**, além do
que já existe. Aprovar/Rejeitar/Pagar continua sem mudança — não existe hoje
edição de reembolso depois de criado, e isso não muda nesta entrega.

## Dados

Duas colunas novas em `reimbursements`:

```
reimbursements
  supplier   text                      -- Fornecedor, preenchido pela IA
  category   expense_category          -- Tipo de despesa (mesmo enum de
                                        -- project_expenses e payables:
                                        -- equipe, equipamento, locacao,
                                        -- transporte, alimentacao,
                                        -- hospedagem, marketing, software,
                                        -- impostos, servicos_terceiros,
                                        -- manutencao, outro)
```

`description` não muda de nome nem de tipo — só o rótulo na tela passa de
"Descrição" para "Motivo do gasto". Reembolsos antigos continuam mostrando o
texto livre que já tinham. `amount` e `expense_date` já existiam; a IA passa a
sugerir os dois, mas o esquema não muda.

## Edge Function `extract-receipt`

- Chamada autenticada (`supabase.functions.invoke`), igual o resto do app — sem
  segredo compartilhado, só o JWT de quem está logado.
- Recebe o arquivo (imagem ou PDF), manda pra Claude (modelo com visão) com um
  prompt que lista as categorias válidas em português, pedindo de volta um
  JSON: `{ supplier, amount, expense_date, category }`.
- `ANTHROPIC_API_KEY` como secret do Supabase, nunca exposta ao navegador.
  Cadastrada pra esta função mas pensada pra ser reaproveitada por outras
  automações de IA que vierem depois — não é escopo desta entrega decidir
  quais.
- Falha (leitura ruim, API fora do ar, resposta não é JSON válido): devolve os
  quatro campos como `null`, sem derrubar a requisição. A tela trata `null`
  como "preenche à mão".
- Sem limite de uso nem contador de custo nesta entrega — ferramenta interna,
  só gente logada da empresa chama.

## Como vamos verificar

Anexar uma nota legível (foto ou print) e conferir que os quatro campos vêm
preenchidos e batem com a nota; anexar uma imagem ilegível ou um arquivo que
não é nota nenhuma e conferir que os campos ficam em branco sem travar o
envio; criar um reembolso do zero e conferir que a lista de aprovação mostra
Fornecedor e Categoria; abrir um reembolso já existente (de antes desta
entrega) e conferir que continua mostrando normalmente, com Fornecedor e
Categoria em branco.

## Fora de escopo, de propósito

- Filtro/relatório por categoria na tela de aprovação. Fica fácil de pedir
  depois que o dado já existir; construir agora sem um pedido concreto é
  adivinhação.
- Editar um reembolso já criado (categoria errada, por exemplo). Não existe
  hoje pra nenhum campo; criar essa capacidade é uma mudança maior que merece
  conversa própria.
- Qualquer controle de custo/limite de chamadas à IA.
- Definir as "outras coisas" em que a Claude vai ser usada depois — só
  garantimos que a chave fica pronta pra isso.
