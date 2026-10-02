# Projetos com fee mensal: cronograma de pagamento mês a mês

**Data:** 01/10/2026 · **Estado:** aprovado em conversa

## O problema

Hoje, um projeto de fee mensal (ex.: Shopee, contrato de um semestre com valor
fixo por mês e eventuais adendos pontuais) vira **uma única conta a receber**,
com o valor total do período inteiro. Não tem como ver a divisão mês a mês, e
cada vencimento real não fica registrado em lugar nenhum — fica só numa
planilha à parte.

Além disso, não existe NENHUM lugar na plataforma, nem na proposta nem depois,
que reconheça "este projeto é fee mensal". Isso trava relatórios futuros (ex.:
quanto de receita recorrente mensal já está fechada) e faz com que a
informação do tipo de contrato dependa só da memória de quem vendeu.

## O que vai existir

### Na proposta (opcional)

Uma seção nova, "Este projeto é fee mensal?". Se marcada, a pessoa preenche:
mês de início, mês de fim, valor fixo mensal, e uma lista de adendos pontuais
(mês + valor) — pode ficar vazia, pra contratos só com o fixo. Um checkbox
("Mostrar essa divisão no PDF da proposta") decide se isso aparece pro
cliente ou fica só interno — às vezes isso já está negociado na hora de
montar a proposta, às vezes só se decide depois de fechado.

Preencher essa seção não cria nada ainda — é só a intenção registrada na
proposta. Ela nasce vazia e nunca obriga ninguém a preencher.

### Na aprovação

`aprovar_orcamento()` ganha um terceiro caminho (hoje só tem "à vista" e
"entrada + saldo"): se a proposta tem `payment_plan = 'fee_mensal'` com os
dados preenchidos, a aprovação já cria **uma conta a receber por mês**, do
início ao fim, mais **uma conta extra por adendo**. Cada uma nasce como uma
conta a receber comum — vencimento, status, tudo igual a qualquer outro
projeto. Não existe tabela nova pra "cronograma"; o cronograma É o conjunto
de contas a receber daquele projeto.

### No Financeiro

O mesmo ícone de calendário que já abre o parcelamento hoje
(`ParcelamentoModal`, em Contas a Receber) ganha uma terceira opção: **Fee
mensal**, ao lado de "Valor cheio" e "Entrada + saldo".

- Se o projeto ainda não tem fee mensal configurado (porque não veio
  preenchido da proposta, ou porque é um contrato puramente interno):
  mostra os mesmos campos de início/fim/valor/adendos, pra configurar do
  zero.
- Se já tem (veio da proposta, ou já foi configurado antes): mostra a
  divisão mês a mês (igual à imagem que o Caio mandou: mês, valor fixo,
  adendo), com um jeito de **adicionar um adendo novo** num mês que já
  existe, ou **estender o contrato** com mais um mês no fim.

A geração do cronograma (criar as contas a receber a partir de
início/fim/valor/adendos) é uma função só, reaproveitada pela aprovação E por
essa tela — nunca duas lógicas separadas que podem divergir.

### No PDF da proposta

Quando o checkbox "Mostrar no PDF" está marcado, a página de condições de
pagamento passa a incluir a tabela mês a mês (mês · valor mensal · adendo).
Desmarcado, o PDF fica exatamente como é hoje.

## Dados

Em `budget_versions`:

```
payment_plan                      -- ganha o valor 'fee_mensal' na regra
                                   -- que já existe (hoje só aceita
                                   -- a_vista / entrada_saldo)
fee_mensal_inicio          date
fee_mensal_fim             date
fee_mensal_valor           numeric
fee_mensal_adendos         jsonb   -- [{ "mes": "2026-09", "valor": 50000 }, …]
fee_mensal_mostrar_na_proposta  boolean default false
```

Nada de tabela nova pra "cronograma" ou "parcela de fee mensal": cada mês e
cada adendo nasce como uma linha comum em `receivables` (a mesma tabela que
já guarda à vista, entrada+saldo, e reembolso-gerados). A diferenciação entre
"valor fixo do mês" e "adendo daquele mês" fica só na descrição da conta
(ex.: "Shopee · Setembro" vs. "Shopee · Setembro · Adendo") — não precisa de
coluna nova pra isso, e os dois tipos de linha se comportam exatamente igual
dali em diante (status, NF, recebimento, inclusive o "Em atraso" manual que
acabou de ser lançado).

## Regras

- O gatilho `fn_versao_reajusta_parcelas` (que hoje redistribui o valor em
  partes iguais entre as parcelas em aberto sempre que margem ou desconto de
  uma proposta aprovada muda) passa a **ignorar projetos com
  `payment_plan = 'fee_mensal'`**. Editar margem/desconto nunca mais mexe
  sozinho num cronograma mensal — se o preço mudar de verdade, quem ajusta é
  o Financeiro, na mão, pela tela de fee mensal.
- Preencher a seção de fee mensal na proposta é sempre opcional, e nunca
  bloqueia aprovar um orçamento sem isso preenchido.
- "Mostrar no PDF" é independente de ter ou não os dados preenchidos — só
  controla se a tabela aparece pro cliente.
- A regra de ouro do parcelamento de hoje continua valendo: conta que já
  teve recebimento nunca é tocada ao reconfigurar ou estender o cronograma.
- Os campos `fee_mensal_*` em `budget_versions` registram o que foi
  **proposto**, e não mudam sozinhos depois que o projeto é aprovado —
  edições feitas depois pelo Financeiro (novo adendo, contrato estendido)
  mexem só nas contas a receber reais, nunca reescrevem o que a proposta
  originalmente dizia. Quem quiser saber o cronograma atual de verdade olha
  as contas a receber do projeto, não a proposta.

## Como vamos verificar

Criar uma proposta de teste com fee mensal preenchido e o checkbox do PDF
ligado, aprovar, e conferir que nascem as contas a receber certas (uma por
mês + adendos, vencimentos e valores corretos) e que o PDF mostra a tabela.
Repetir com o checkbox desligado: contas nascem normalmente, PDF fica sem a
tabela. Editar margem ou desconto da proposta já aprovada e conferir que as
contas a receber não mudam de valor sozinhas. Pelo Financeiro, configurar fee
mensal do zero numa proposta que não veio com isso definido, e conferir que
gera certo. Adicionar um adendo novo num mês que já existe e conferir que
vira uma conta nova, sem mexer nas que já estavam lá. Marcar uma dessas
contas manualmente como "Em atraso" e conferir que funciona igual a
qualquer outra.

## Fora de escopo, de propósito

- Geração automática e recorrente sem fim definido — todo contrato de fee
  mensal tem fim decidido de antemão (confirmado com o Caio).
- Qualquer mudança em como contratos avulsos (não fee mensal) funcionam
  hoje — fica tudo exatamente igual.
- Relatório consolidado de receita recorrente mensal (MRR). É um ótimo
  próximo passo depois que o dado existir, mas é um pedido separado, com seu
  próprio desenho.
