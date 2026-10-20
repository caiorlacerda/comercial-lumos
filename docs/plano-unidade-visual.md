# Plano de unidade visual da plataforma Lumos

Análise feita em 19/10/2026 sobre a branch `feat/home-visual-lumos` (166 arquivos de tela e componente, cerca de 60 mil linhas).
Como li o código, os números abaixo são contagens exatas. **Não medi o visual no celular** e os prints do navegador interno saíram desbotados (a animação de entrada não terminava). Por isso o passo 1 do plano inclui uma página de referência para ver tudo de verdade.

---

## 1. Diagnóstico em uma frase

A plataforma tem **uma boa base de identidade** (cores, ícones, menu, tema claro/escuro), mas **cada tela reinventou por conta própria** os botões, etiquetas, tabelas, abas, janelas e tamanhos de texto. Não existe uma "caixa de peças" única, então toda tela nova nasce um pouco diferente, e o visual novo do deck (vidro, DM Sans) só funciona por cima, com remendos.

### O que já está bom (e vale preservar)

| Ponto | Dado |
|---|---|
| Cores da marca por variável | 6.050 usos das cores `lumos-*` (cerca de 79% das cores) |
| Ícones | 100% da biblioteca Lucide, sem mistura |
| Dropdown padrão | 142 usos do componente `Select` próprio, só 3 `<select>` nativos |
| Janelas | 59 usos do componente `Modal` |
| Lista no celular | `MobileCards` em 17 telas |
| Menu | uma única fonte (`navigation.ts`) para desktop e celular |
| Tema | um único mecanismo claro/escuro |

### Confirmação visual (prévia da branch, desktop, tema claro, 19/10/2026)
Olhei Orçamentos, Contas, Custos de Projeto, Equipe, Board de Produção e Wiki. O que os números mostraram aparece na tela:
- **Títulos**: "Equipe" vem em CAIXA ALTA com ícone; "Contas", "Orçamentos" e "Custos de Projeto" vêm em minúsculas, sem ícone; "Board de Produção" tem ícone e minúsculas.
- **Botão amarelo principal**: em Contas é uma pílula totalmente arredondada; em Orçamentos, Custos e Equipe é um retângulo de canto leve.
- **Indicadores (KPI)**: em Contas têm borda colorida (azul, verde, vermelho); nas outras telas os cartões são neutros.
- **Abas**: Contas usa abas de texto com linha; Custos de Projeto usa abas minúsculas em fonte mono; Board usa colunas pastel com cabeçalhos próprios.
- **Fontes**: confirmei no navegador que as 4 famílias carregam, e que o menu lateral herda Work Sans enquanto o conteúdo usa DM Sans.
- **Leitura**: a Wiki (fundo quase opaco, texto grande) é a tela mais confortável de ler e serve de referência para a densidade das demais.
- **Não verificado**: o celular (a janela do Chrome não reduziu de tamanho) e o tema escuro.

---

## 2. O que encontrei, área por área

### 2.1 Fontes
- Existem **4 famílias** no app: Poppins (títulos) e Work Sans (corpo) carregadas no `index.html`, mais DM Sans e JetBrains Mono do visual novo.
- **Dentro do conteúdo** vale DM Sans. **Fora dele** (menu lateral, páginas públicas, portal do cliente) continua Poppins e Work Sans. Ou seja, menu e tela já usam fontes diferentes.
- 42 pontos escrevem `fontFamily: 'Poppins'` direto no código (PDFs, portal do cliente e aprovação pública). Também aparecem Anton e Inter em outros 6 pontos.
- Pesos: `font-bold` 1.129 vezes e `font-black` 1.044 vezes. O visual novo converte o "black" em 600, mas o "bold" continua 700, então dois pesos pesados convivem de forma irregular.
- Rótulos em caixa alta: 1.139 usos, em 116 arquivos. No escopo novo viram fonte mono, o que é bonito, mas não há regra de quando usar.

### 2.2 Tamanhos de texto
- **1.560 tamanhos "soltos"** em pixels (`text-[10px]` etc.), com 17 valores diferentes (10px, 10.5px, 11px, 11.5px, 12px, 12.5px, 13px, 13.5px...). A escala padrão (`text-xs`, `text-sm`) aparece 1.233 vezes. Ou seja, a maioria não segue escala.
- **Mais de 320 textos com 8 ou 9 px** (275 de 9px, 49 de 8px, mais 28 de 9.5px). É pequeno demais para leitura confortável e é a causa de boa parte do "está difícil de ler".
- **Títulos de página**: 49 telas, 13 combinações diferentes. Cerca de metade usa 24px e metade usa 30px; metade em negrito e metade em preto pesado; 6 telas em CAIXA ALTA. Dentro do próprio Financeiro, Dashboard, Relatórios e Configuração usam o título grande, e Contas, Movimentações e Notas usam o pequeno.

### 2.3 Cores
- **1.611 usos de cores cruas** do Tailwind (vermelho 628, verde 370, âmbar 211, azul 113, amarelo 72, roxo 53...), mais 218 códigos hexadecimais no código (55 tons distintos).
- Maiores concentrações: Projetos (125), Custos de Projeto (100), Custos de Projeto Detalhe (84), Contas a Receber (61), Dashboard de Produção (57).
- **O mesmo significado com cores diferentes.** Só o "verde de sucesso/pago/aprovado" aparece em cerca de 70 lugares, com 3 fundos (10%, 15%, 20%) e 3 tons de texto (400, 500, 600).
- **Amarelo da marca em 4 variantes** (`lumos-yellow`, `yellow-500`, `yellow-400` e hexadecimais `#EFC700`, `#F5D87A`, `#ffd91e`, `#facc15`).
- Sintoma: para o tema claro ficar legível, precisei gerar **76 regras de remendo** no CSS que trocam o tom de todas essas cores cruas. Se houvesse cores de significado (sucesso, perigo, aviso), isso não existiria.
- Branco e preto crus: `text-white` 67 vezes, `text-black` 56, `bg-black/xx` 50.
- `tailwind.config.js` guarda uma paleta escura antiga e **é ignorado** pelo Tailwind 4 (não há `@config`). O `CLAUDE.md` ainda diz que os tokens ficam lá. O `index.html` fixa `bg-[#222222]` e `theme-color #0a0a0a`, o que pode dar um clarão escuro ao abrir no tema claro.

### 2.4 Cantos, sombras e espaçamento
- Cantos: `rounded-full` 540, `rounded-lumos` 529, `rounded` 329 (4px), e outros. No visual novo `rounded-lumos` virou 20px, mas `rounded` continua 4px, então **dentro do mesmo cartão há canto de 20px ao lado de canto de 4px**.
- Sombras: 12 variações, sendo `shadow-2xl` 87 vezes (pesada demais para uso geral) e 7 sombras escritas à mão.
- Espaço interno dos cartões: `p-1`, `p-3`, `p-3.5`, `p-4`, `p-5`, `p-6`, `p-8`, sem regra. A largura máxima do conteúdo muda de tela para tela (Configurações estreita, outras sem limite).

### 2.5 Botões
- **994 botões** no código e **nenhum componente `Button`**. Existem duas classes (`btn-primary` 133 usos, `btn-secondary` 96), mas **42 botões amarelos são montados à mão** e há pelo menos 12 variações de botão "perigoso" (vermelho).
- Alturas e cantos variam (`py-1`, `py-1.5`, `py-2`, `py-2.5`, `py-3`; canto lumos, cheio, 4px).
- `btn-primary` usa `hover:bg-yellow-400` (cor crua) em vez da cor da marca.

### 2.6 Hover, clique e foco
- **49 hovers de fundo diferentes**. Só o "hover neutro" tem 5 versões (`text-secondary/10` 80, `/5` 40, `text-primary/5` 38, `lumos-bg` 32, valores soltos).
- Hover de texto: vermelho em 500 (35) e em 400 (27), azul em 500 e 400.
- Durações de transição: 100, 150, 200, 300, 500, 700 e 1000 ms. Efeitos de escala (`hover:scale-105/110/150`, `active:scale-95`) só em alguns lugares.
- **Foco de teclado quase inexistente**: 1 regra de `focus-visible` em todo o app. Quem navega por teclado não vê onde está.

### 2.7 Campos, dropdowns e datas
- Campos de texto: 278 `<input>`, 354 usos da classe `input-lumos`. É a parte mais consistente.
- Dropdown: o `Select` é bom, mas o `Combobox` (busca) é usado em 1 lugar só.
- **Datas: 45 campos de data nativos do navegador contra 9 `DatePicker` próprios.** O nativo muda de cara conforme o navegador e o sistema.
- O menu do `Select` usa a classe `custom-scrollbar`, que **não está definida** no CSS (não tem efeito).
- Menus de "três pontinhos" e dropdowns de ação são escritos à mão em pelo menos 7 telas (posição absoluta com sombra), cada um com um visual.

### 2.8 Janelas (modais)
- 59 usos de `Modal`, mas cerca de **100 janelas/camadas montadas à mão** (`fixed inset-0`). Campeões: Projetos (12), Revisão Pública (10), árvore de projetos do menu (8), Ordem do Dia (8).
- Fundo escuro atrás: 7 intensidades (`black/40`, 50, 60, 70, 75, 80, 90).
- Tamanhos: 14 em `max-w-md`, o resto espalhado; uma em tela cheia, criada neste mês.
- Camadas (z-index): 79 valores soltos (`z-[300]`, `z-[200]`...) sem escala. Bug conhecido: janelas sem portal aparecem parcialmente **por baixo do menu lateral**.
- No celular, só 3 lugares usam `BottomSheet`. Os demais modais só encolhem.

### 2.9 Abas e alternadores
- Abas com linha embaixo em cerca de 14 telas, abas em pílula/segmentadas em cerca de 5, `ViewToggle` (lista/cards) em 3 telas, abas por `?tab=` em Financeiro > Contas. **Não existe componente `Tabs`.** Cada uma tem altura, cor ativa e espaçamento próprios.

### 2.10 Tabelas e listas
- 27 tabelas em 23 telas, com **44 estilos de cabeçalho** diferentes (`px-4 py-3`, `px-6 py-4`, `py-2.5`; texto em 10px preto caixa alta em umas, normal em outras).
- O componente `Pagination` só existe em 3 telas.
- Estados vazios: 41 mensagens escritas à mão em 26 arquivos, sem componente.

### 2.11 Etiquetas de status (chips)
- **226 etiquetas feitas à mão em 62 arquivos.** Há mapas centrais de status (revisão de vídeo, roteiro, tarefa), mas cada um define suas cores (`bg-green-500/10` aqui, `/15` ali; `border /20` aqui, `/40` ali). O mesmo "Aprovado" não tem a mesma cara em Projetos, Custos e Revisão.

### 2.12 Avisos (toast), carregando e vazio
- Toast: 509 chamadas. É a única peça **sólida e saturada** (`green-600` com branco, `red-600`, `yellow-500` com preto) em um app translúcido.
- Carregando: 143 spinners e 90 `Loader2`, só 21 esqueletos (`animate-pulse`). A maior parte das telas fica "girando" em vez de mostrar a forma do conteúdo.

### 2.13 Ícones
- Só Lucide (ótimo), mas em 12 tamanhos: `w-4` 428, `w-3.5` 360, `w-3` 121, `w-5` 111, `w-6` 53, e outros (2.5, 7, 8, 10, 12...), mais 10 tamanhos passados em `size={N}`.

### 2.14 Menu lateral, topo e celular
- O menu lateral usa o degradê "ônix âmbar" com grão, **em outra linguagem visual** que o conteúdo em vidro (e em fonte diferente).
- Cabeçalho, sub-menu e barra inferior do celular ainda **não receberam o visual novo**.
- `Topbar.tsx` (263 linhas) **não é usado em lugar nenhum** (só aparece num comentário).

### 2.15 Páginas que o cliente vê
- Login já está no visual novo. **Aprovação, Portal do Cliente, Revisão, Nota Fiscal, Cadastro de fornecedor e Definir senha continuam no visual antigo**, e são justamente as telas que o cliente final vê. As fontes aqui são escritas direto no código.
- **PDFs** (orçamento, ordem do dia) têm estilo próprio com Poppins, Work Sans, Anton e Inter. Fora do escopo do app, mas fazem parte da marca.

### 2.16 Tamanho dos arquivos (dificulta manter)
- Projetos.tsx tem 4.143 linhas, BudgetEditorPage 2.419, CustosProjetoDetalhe 2.008, OrdemDoDiaDetalhe 1.742, PortalCliente 1.677. Quanto maior o arquivo, mais difícil arrumar sem quebrar.

---

## 3. Por que isso aconteceu

Cada funcionalidade foi construída rápido, em momentos diferentes, e **não havia peças compartilhadas** para botão, etiqueta, aba, tabela e cabeçalho. Quando não existe a peça, copia-se e ajusta-se à mão. O resultado são centenas de pequenas variações que, somadas, parecem apps diferentes. O visual novo foi aplicado por cima como "escopo" (`.lumos-deck`), o que funciona, mas esconde o problema em vez de resolvê-lo.

---

## 4. O plano

### Fase 0, Decisões (1 conversa, sem código)
Definimos juntos as regras do jogo. Ver a seção 5 (decisões que preciso de você).

### Fase 1, Fundações (cerca de 1 dia)
Tudo em um lugar só (`src/index.css`):
1. **Cores de significado** claras e escuras: sucesso, perigo, aviso, informação, neutro, destaque de revisão (roxo) e marca. Com isso, as 76 regras de remendo do tema claro somem.
2. **Fonte única**: DM Sans (e JetBrains Mono para rótulos) carregada em todo o app, inclusive menu e páginas públicas. Sai Poppins/Work Sans.
3. **Escala de textos nomeada** (por exemplo: rótulo 11, apoio 12, corpo 14, subtítulo 16, título de seção 20, título de página 28). **Fim do texto abaixo de 11px.**
4. **Cantos e sombras**: 3 cantos (campo/botão, cartão, pílula) e 3 sombras (nenhuma, cartão, janela).
5. **Tempos de transição** e **camadas (z-index)** em escala fixa.
6. Limpar `tailwind.config.js`, `index.html` e atualizar o `CLAUDE.md`.

### Fase 2, Caixa de peças (cerca de 3 a 4 dias)
Criar uma vez, bem feitas, as peças que hoje são copiadas:

| Peça | Substitui |
|---|---|
| `Button` (principal, secundário, discreto, perigo, ícone; 3 tamanhos) | 994 botões, 42 amarelos à mão, 12 vermelhos |
| `StatusChip` + mapa central de status | 226 etiquetas |
| `Field` (rótulo, campo, ajuda, erro) | variações de campo |
| `DatePicker` em todo lugar | 45 datas nativas |
| `Modal` padrão (sempre portal, 4 tamanhos, um único fundo escuro) | ~100 janelas à mão |
| `Drawer`/`BottomSheet` no celular | modais que só encolhem |
| `Tabs` (linha) e `SegmentedControl` (pílula) | ~19 abas feitas à mão |
| `PageHeader` (título, subtítulo, ações, abas) | 49 cabeçalhos diferentes |
| `DataTable` (cabeçalho, linha, hover, paginação, vazio, carregando, cartão no celular) | 27 tabelas |
| `Menu` de ações ("três pontinhos") | dropdowns à mão |
| `EmptyState`, `Skeleton`, `StatCard` (KPI), `Panel` | vazios, carregamentos, cartões |
| `Toast` no mesmo vidro do app | toasts sólidos |

### Fase 3, Aplicar em ondas (2 a 3 semanas, em paralelo com o uso normal)
Cada onda é uma branch com preview para você aprovar:

1. **Onda A, casca**: menu lateral, cabeçalho, sub-menu e barra inferior do celular.
2. **Onda B, Financeiro**: Contas, Movimentações, Notas, Custos, Fluxo, Relatórios (mais cor crua e dinheiro).
3. **Onda C, Comercial**: Orçamentos, editor, Clientes, Catálogo, Templates.
4. **Onda D, Produção**: Projetos (quebrar em partes menores), Board, Cronograma, Equipamentos, Fornecedores, Ordem do Dia.
5. **Onda E, Configurações e equipe**: Equipe, Comunicados, Mural, Wiki, Auditoria, Notificações.
6. **Onda F, páginas públicas**: aprovação, portal, revisão, nota, cadastro, definir senha (o que o cliente vê).
7. **Onda G, PDFs** (opcional): alinhar fontes e cores dos PDFs à marca.

Boa parte do trabalho de cores e tamanhos pode ser feita **em massa por script** (trocar `text-green-500` pelo token de sucesso em todo o app de uma vez), com revisão visual depois.

### Fase 4, Travas para não voltar a bagunçar (cerca de 1 dia)
- Uma **página de referência** (`/design`, só para admin) mostrando todas as peças e estados, claro e escuro, desktop e celular. É também como você aprova o visual de uma vez só.
- Uma **verificação automática** no build que avisa quando alguém usa cor crua, texto abaixo de 11px ou janela montada à mão.
- Seção "como construir uma tela" no `CLAUDE.md`.

### Estimativa
Cerca de **3 a 4 semanas de calendário** no total, mas já dá para ver ganho grande depois das fases 1 e 2 (cerca de 1 semana). São estimativas, não promessas: a Onda D (Projetos) é a mais incerta.

---

## 5. Decisões tomadas (19/10/2026)

1. **Menu lateral**: mantém o ônix âmbar (contraste com o conteúdo em vidro).
2. **Cantos**: 12px em tudo (cartões, botões, campos). Pílulas continuam totalmente arredondadas. Login e Home já foram ajustados.
3. **Texto mínimo**: 12px.
4. **Títulos de página**: padrão do login e da Home (28px, peso médio, sem caixa alta).
5. **Páginas públicas e PDFs**: ficam para depois.
6. **Integração por ondas, sem o time ver**: o visual novo entra atrás de um interruptor (ver abaixo).

### Interruptor do visual novo
- Já implementado em `src/lib/visualNovo.ts`. Desligado (padrão), o app é exatamente o de hoje: Home e Login clássicos, sem DM Sans, sem fundo de luz.
- Liga só no aparelho de quem pedir: link com `?visual=novo` (desliga com `?visual=antigo`) ou o botão em Configurações > Aparência, que só admin enxerga.
- Não usa banco de dados, então não exige SQL.
- Cada onda nova (componentes, telas) é escrita para valer só com o interruptor ligado.
- **Para liberar a todos**: trocar `PADRAO_LIGADO` para `true` em `visualNovo.ts` (um deploy). Quem desligou de propósito continua no antigo. Depois de um tempo, removemos o visual antigo.
- Limite do método: telas que ganharem componentes novos (por exemplo `Button`, `Tabs`) continuam com a aparência antiga com o interruptor desligado, porque os componentes só trocam de visual sob o escopo do visual novo.

---

## 6. Decisões originais (histórico)

1. **Menu lateral**: passa para o visual de vidro do conteúdo, ou mantém o ônix âmbar e adaptamos o conteúdo a ele?
2. **Cantos**: cartões em 20px como hoje, mas **botões e campos em 12px**? (Hoje tudo que é `rounded-lumos` vira 20px, inclusive botões pequenos.)
3. **Texto mínimo de 11px** (acaba com os 8 e 9px)? Isso pode deixar telas densas (tabelas, Projetos) um pouco maiores. Compensamos com menos texto por linha.
4. **Títulos de página** no padrão do login e da Home (28px, peso médio, sem caixa alta), com CAIXA ALTA mono só em rótulos pequenos?
5. **Páginas públicas e PDFs** entram nesta rodada ou ficam para depois?
6. **Como integrar**: aprovar tudo e mesclar no fim (como você pediu) ou mesclar por onda? Mesclar por onda é mais seguro: se algo der errado, o estrago é pequeno e é fácil reverter. Se preferir tudo no fim, mantemos uma branch longa que precisa ser atualizada com o `main` toda semana.

---

## 6. Riscos e cuidados

- **Regressão no desktop**: cada onda será testada em claro e escuro, desktop e celular, antes de você ver.
- **Telas grandes** (Projetos, Editor de orçamento) concentram o risco; vamos mexer nelas por último, depois de a caixa de peças estar madura.
- **Nada de SQL** nesta frente: é só visual. A migration `2026101300_home_layout.sql` da Home continua pendente de você rodar.
- Nada será mesclado sem sua aprovação.

---

## 7. Andamento

- **Fase 1 (base):** concluída em 20/10/2026. Cores de significado, fonte única, texto mínimo de 12px, cantos, sombras.
- **Fonte dos títulos:** Instrument Serif (escolha B).
- **Fase 2 (caixa de peças):** concluída em 20/10/2026, atrás do interruptor. Peças em `src/components/ui/`: `Button` e `IconButton`, `StatusChip`, `Field`/`Input`/`Textarea`, `Tabs` e `SegmentedControl`, `PageHeader`, `Panel` e `StatCard`, `DataTable`, `ActionMenu`, `EmptyState` e `Skeleton`. A janela (`Modal`, com `size` e portal automático), o `Select` e o aviso (toast) ganharam o visual novo. Todas aparecem na página `/design` (só admin).
- **Fase 3 (ondas nas telas):** próxima. Ordem: casca (menu e celular), Financeiro, Comercial, Produção, Configurações e equipe.

## 8. Padrão de abas, alternadores, chips e filtros (21/10/2026)

Quatro peças, cada uma com um único visual (CSS no `src/index.css`, seção "Padrão único de abas, alternadores, chips e filtros"):

| Peça | Para que serve | Como aparece | Como marcar no código |
|---|---|---|---|
| **Abas** | Trocar de seção dentro da página (A Receber / A Pagar; Em andamento / Encerrados) | Sublinhado dourado, DM Sans 14px | Qualquer `<button>` com `border-b-2` (o ativo é o que não tem `border-transparent`), ou a classe `aba-lumos` com `aria-selected` |
| **Alternador** | Mudar a forma de ver os mesmos dados (Lista/Cards, Semana/Mês/Trimestre, Calendário/Lista/Kanban) | Cápsula única, itens de 32px, ativo em amarelo | Caixa `.segmentado-lumos`, itens `.segmento-lumos` com `aria-pressed` |
| **Chips de filtro** | Filtrar a mesma lista (Todas / Entradas / Saídas; Todos / Emitir NF / Recebido) | Pílula de 32px, ativa com véu dourado (vermelho para "atrasado") | `.chip-lumos` com `aria-pressed` (e `data-tom="danger"` quando for alerta) |
| **Campos de seleção** | Filtros em lista suspensa | Texto normal em DM Sans, sem caixa alta | Automático (`button.input-lumos`) |

Em telas novas, use os componentes `Tabs` e `SegmentedControl` (em `src/components/ui/Tabs.tsx`), que seguem a mesma aparência.
