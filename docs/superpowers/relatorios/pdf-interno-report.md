# A call sheet da equipe, inteira

Arquivos mexidos: `src/components/editor/OrdemDoDiaPDF.tsx` (reescrito) e o payload do botão
"Exportar PDF" em `src/pages/OrdemDoDiaDetalhe.tsx` (linhas 796 a 816). Nada mais.
O `OrdemDoDiaClientePDF.tsx` não foi tocado.

---

## O que estava faltando de verdade

Conferido lendo os dois arquivos, não confiando na revisão. A lista do achado 4 estava **certa**:
tudo o que ela apontou como ausente estava mesmo ausente.

Faltava, e agora sai:

1. **Locações extras.** O payload mandava só a primeira locação incluída (`l0`). As outras não
   existiam no papel. Agora saem todas as incluídas, numeradas (1ª, 2ª…), com endereço e observação.
2. **Call times.** O campo `call_times` nunca era enviado. Agora é uma tabela Grupo / Chegada.
3. **Regras do set.** `regras.vestimenta`, `regras.redes`, `regras.setup_camera`, `regras.outras`,
   as quatro fora. Agora saem como subtítulos dentro de "Regras do set", só as preenchidas.
4. **Objetos de cena.**
5. **Figurino** (com a coluna Personagem, que é o que a tela guarda em `personagem`).
6. **Equipamentos.**
7. **Roteiros**, com nome e o link escrito por extenso, que é o que serve no papel.
8. **`nota_cliente`**, o recado ao cliente, com a linha dizendo que esse é o único texto da OD
   que o cliente também lê no portal.

Faltava também, e a revisão não citou:

9. **O horário da diária.** O PDF mostrava a data e nada de hora. Agora o bloco de identificação
   traz "06:30 às 18:00, 11h 30min no total", calculado do próprio cronograma, igual à tela.
10. **Tipo, local e "em paralelo" de cada momento do cronograma.** A tela mostra isso em chips
    embaixo da descrição; o PDF imprimia só hora, descrição e responsável. Agora há coluna Local
    e uma segunda linha com o tipo ("Gravação", "Deslocamento"…) e o "em paralelo".
11. **Numeração de página e cabeçalho de continuação.** O cabeçalho fixo repetia logo e CNPJ, sem
    o nome da diária nem a data, e não havia número de página. Agora toda página repete
    "nome da diária / Ordem do dia, {data}" e o rodapé traz "Página X de Y".

Onde a revisão escorregou, de leve: ao descrever o que o payload **mandava**, ela esqueceu o
`ponto_encontro`, que já ia e já saía impresso. Não muda a lista de faltantes.

Um detalhe achado no teste, fora da lista da revisão: a descrição gerada pela tela para
deslocamento usa "→", e as fontes latinas registradas em `pdfFonts.ts` não têm essa seta, então ela
imprimia como caractere trocado (o extrator lia "’"). O PDF agora troca a seta por " para " na hora
de desenhar, sem mexer no dado.

## `secoes_ativas`

**A tela não usa.** `grep` no `src/`: o campo só aparece no tipo, no PDF e no literal fixo que o
botão mandava com tudo `true`. Nenhuma aba liga ou desliga seção. Então:

- o botão parou de mandar o literal (era código morto disfarçado de configuração);
- o PDF passou a tratar a chave ausente como **visível**, e respeita um `false` explícito se um dia
  vier do banco. Quem manda no papel é ter conteúdo.

Testado: com `secoes_ativas: { equipe: false }` a seção Equipe some e o resto fica.

## Ordem no papel

Ordem de uso no set, não a das nove abas:

1. Identificação (diária, data por extenso com dia da semana, horário, emissão)
2. Clima · Ponto de encontro · Call times
3. Cronograma · Locações
4. Elenco · Equipe · Contatos · Objetos de cena · Figurino · Equipamentos · Roteiros
5. Regras do set · Recado para o cliente

## Legibilidade

Vai ser impresso em preto e branco e aberto no celular embaixo de sol:

- fundo **branco** (era `#F5F5F3`), texto `#1A1A1A`;
- corpo de 8 para **9,5pt**, rótulos de tabela de 7 para 8pt;
- os cinzas claros sobre branco sumiram: rótulo era `#666`/`#888`, rodapé era `#999`, agora
  `#2B2B2B` a `#3A3A3A`;
- bordas de `#DDD` para `#B4B4B4`, que sobrevivem à impressora;
- o "marco do dia" era tarja `rgba(0,0,0,0.13)`; virou barra preta na lateral esquerda mais
  negrito, com fundo bem leve;
- cabeçalho de seção: amarelo com texto preto e um filete preto embaixo, que em preto e branco
  continua sendo uma faixa clara com texto escuro.

## Quebra de página

- Nenhum item curto quebra no meio: `wrap={false}` em toda linha de tabela, item de locação,
  membro da equipe e bloco de regra.
- **Título órfão:** o `minPresenceAhead` do @react-pdf 4.4 não resolveu, medido: com 56, 78 e 120
  o PDF saiu byte a byte igual, com "LOCAÇÕES (2)" sozinho no pé da página 1. Troquei por uma
  cola explícita: o `Secao` usa `Children.toArray` e coloca o título junto dos primeiros filhos
  dentro de um `View wrap={false}` (2 nas tabelas, pra levar o cabeçalho das colunas e a primeira
  linha; 1 nos blocos de texto). Depois disso a página 1 termina na última linha do cronograma.

---

## Como foi provado

Entrei em `http://localhost:5173/login` pelo botão "🤖 Entrar como robô de testes".

**Dado de teste:** criei a ordem do dia **"Ordem do Dia - Produção Teste - Diária 1"**
(`dc01891a-5174-4b30-a0a7-4821a770ea24`, código `#2026-231-D1`) pela aba Ordem do dia do projeto
**Produção Teste** (Vitru), a partir da diária que já existia no projeto (não criei diária nova).
Preenchi os nove blocos, inclusive os que faltavam. Os campos vieram pelo cliente Supabase do
próprio app, no console (mesmas colunas e mesmos formatos que os formulários da tela gravam, nada
de SQL), e **recarreguei a tela pra conferir que ela renderiza tudo o que foi gravado** (call time,
locações, regras, recado, cronograma com tipo e paralelo, elenco, equipe, objetos, figurino,
equipamentos). O roteiro foi ligado pelo **interruptor real da aba Roteiros**.

**Geração:** o download em disco é bloqueado na automação, então troquei `URL.createObjectURL` por
um espião e **cliquei no próprio botão "Exportar PDF"**. O blob capturado:

```
{ tipo: "application/pdf", bytes: 49757, cabeçalho: "%PDF-1.3", páginas: 3 }
```

**Texto extraído** do mesmo blob, com o `pdfjs-dist` que já existe no `node_modules`, servido pelo
Vite e rodando na página. Saiu, em ordem:

- P1: cabeçalho com o nome da diária e a data, DIÁRIA / DATA / HORÁRIO ("06:30 às 18:00, 11h 30min
  no total") / EMISSÃO, CLIMA, PONTO DE ENCONTRO, CALL TIMES (3 grupos), CRONOGRAMA (6 momentos,
  com "Gravação, em paralelo" e "Deslocamento: Campus Uniasselvi para Praia da Reserva"),
  rodapé "Página 1 de 3".
- P2: LOCAÇÕES (2), as duas com endereço e observação; ELENCO (2); EQUIPE (5); CONTATOS (2);
  OBJETOS DE CENA (2); FIGURINO. Rodapé "Página 2 de 3".
- P3: EQUIPAMENTOS (3); ROTEIROS com o link; REGRAS DO SET com as quatro fichas; RECADO PARA O
  CLIENTE com o aviso. Rodapé "Página 3 de 3".

O cabeçalho com nome da diária e data aparece nas três páginas.

**Olho no papel:** rendereizei as páginas em canvas com o pdfjs e olhei. Página 1 em 3,4x pra
conferir corpo de texto e a barra do marco do dia.

**Bloco vazio não vira título:** gerei o PDF de uma ordem só com título e data, pelo mesmo
componente. Saiu **1 página** com cabeçalho e bloco de identificação, e nenhum título de seção.

**Limpeza:** a ordem do dia de teste e o roteiro de teste do projeto foram apagados. Confirmado
depois: `ordens_do_dia` e `project_roteiros` do projeto Produção Teste voltaram a zero. A diária que
já existia continua lá. A OD real "Uniasselvi, Diária 03 | Social Vídeos" segue intacta e
`aprovada`, só foi lida.

**Build:** `npm run build` com exit 0. O `@react-pdf/renderer` continua em chunk próprio
(`react-pdf.browser-BIVqe7sb.js`, 1.515 kB), o componente em
`OrdemDoDiaPDF-596YtVTy.js` (14,3 kB), e o `index` ficou em 365,11 kB, o mesmo tamanho de antes da
mudança: nada do PDF entrou no pedaço principal.

## Fora de escopo, anotado

- `contatos` continua sem formulário na tela (item 5 da revisão). O PDF imprime o que estiver no
  banco; pra testar, precisei gravar pelo console.
- `clima` (texto) e `ponto_encontro` também não têm editor na tela, só leitura. Mesma situação.
- A tabela que cruza a quebra de página não repete o cabeçalho das colunas na página seguinte.
  O @react-pdf só repete com `fixed`, que repetiria em **todas** as páginas, inclusive onde a
  tabela nem está. Ficou como está.
