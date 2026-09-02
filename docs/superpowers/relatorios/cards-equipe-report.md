# Cartões de gravação e dia travado sem motivo

Branch `f6`, worktree `determined-tereshkova-0af84d`.

## Commits

- `1967b395` feat(portal): a gravação marcada vira cartão, e a equipe só aparece se a Lumos deixar
- `b91be3ed` feat(portal): dia travado não conta mais o porquê pro cliente

`npm run build` com exit 0 antes de cada um dos dois commits (tsc + vite build).

## Arquivos

- `supabase/migrations/2026093336_equipe_da_gravacao.sql` (novo)
- `src/components/producao/PortalModal.tsx`
- `src/pages/PortalCliente.tsx`
- `src/pages/portalCliente.css.ts`

Nenhuma migração de 2026093329 a 2026093335 foi tocada. Nenhum SQL foi executado.

## Mudança 1: cartões, com a equipe atrás de autorização

Banco (`2026093336`):
- `client_portals.mostrar_equipe boolean NOT NULL DEFAULT false`, com `ADD COLUMN IF NOT EXISTS`.
- `portal_agenda` reescrita a partir da versão de `2026093334`. Cada item de `agendadas`
  ganha `id`, `duracao_horas`, `descricao` e `equipe`.
- `equipe` sai de `diaria_members`, com `app_users.full_name` para gente do time e
  `fornecedores.nome` para freela. Vai só `nome` e `funcao`, mais nada.
- Com `mostrar_equipe = false` a lista volta `[]` do próprio banco, dentro de um
  `CASE`: não é filtro de tela, o dado não chega ao navegador do cliente.

Interno (`PortalModal.tsx`):
- `mostrar_equipe` entrou na interface `Portal` e ganhou interruptor na lista
  "O que o cliente vê", com a copy dizendo o alcance: "Nome e função de quem grava,
  em todos os projetos deste cliente."

Portal (`PortalCliente.tsx` + CSS):
- "Gravações marcadas" virou grade de cartões (`.gravs` / `.grav-card`): data, nome,
  horário e local. Cartão é botão, e abre a janela da gravação.
- A janela usa a mesma moldura da janela de pedido (`.pedido-modal-fora` /
  `.pedido-modal`), sem componente novo e sem Tailwind. O comportamento de janela
  (Esc, X, clique fora, foco preso, foco devolvido ao cartão) virou o hook `useJanela`,
  escrito a partir do efeito que já existia; a janela de pedido passou a usar o mesmo
  hook, com o comportamento idêntico.
- Sem autorização o cartão continua clicando e a janela continua abrindo: aparece tudo
  menos a equipe, e a tela não diz que existe algo escondido.

## Mudança 2: dia travado não conta o motivo

- `motivo` saiu do retorno de `portal_agenda` (o `CASE` inteiro, e a variável
  `v_dias_prep` que só servia pra ele).
- Saiu da interface `Agenda`, do componente `Calendario`, do `title` do dia e da
  legenda de motivos embaixo do calendário, junto com `DIA_SEMANA_PLURAL` e o CSS
  `.legenda-dias`. Dia indisponível diz só "Indisponível".
- A legenda de cores ficou (livre para pedir, sua gravação, indisponível).
- `dia_semana_fechado` continua sendo devolvido e tratado por `portal_pedir_diaria`;
  o texto que o cliente lê passou a ser "Este dia não está disponível. Escolha outro."

## Verificação

Sem navegador: `npm run build` (exit 0) antes de cada commit, e leitura das migrações
`2026093334` e `2026093305` para copiar a versão em produção e a origem da equipe.

Com navegador (uma passada, portal `_kXsb3iRhJAa`, projeto Uniasselvi
`0944d1cf-49e5-48b8-8e3a-1cdc21d9669e`, aba Diárias, migração ainda NÃO rodada):

- Três cartões renderizados: 01/09 "Diária 03 | Social Vídeos" (11:00 às 19:00, Prédio
  da Vitru), 21/10 e 22/10 "Evento | Diária 01" e "02" (08:00 às 20:00).
- Cartão clicado: janela abre com nome, "Terça-feira, 1 de setembro de 2026", horário e
  onde. Sem duração e sem equipe, porque a função antiga não manda esses campos: é a
  degradação esperada. Esc fechou, `body.style.overflow` voltou ao normal e o foco
  voltou ao `.grav-card` que abriu.
- Janela de pedido (que passou a usar o hook) testada por regressão: dia 7 livre abre
  "Segunda-feira, 7 de setembro de 2026", trava a rolagem, e o Esc devolve o foco ao
  dia 7. Nenhum pedido foi enviado.
- 21/09/2026 (bloqueio do dono do produto, intacto): `title` = "Indisponível", sem
  motivo. `document.querySelectorAll('.legenda-dias').length === 0`, e a legenda de
  cores segue com as três entradas.
- Altura constante ao trocar de mês, medida em três meses:

  | mês | `.mes` | `.secao` ("Pedir uma data") |
  |---|---|---|
  | setembro de 2026 | 511,5625 px | 578,8359375 px |
  | outubro de 2026  | 511,5625 px | 578,8359375 px |
  | novembro de 2026 | 511,5625 px | 578,8359375 px |

- 375 px: `document.documentElement.scrollWidth === 375` (sem rolagem lateral), cartões
  em coluna única de 323 px.
- Nada foi escrito no banco durante a verificação.

## O que depende da migração rodar

`supabase/migrations/2026093336_equipe_da_gravacao.sql` precisa ser executado à mão
no Supabase. Até lá:

- o interruptor "Equipe da gravação" no `PortalModal` aparece desligado e, se alguém
  clicar, o `UPDATE` falha (coluna inexistente): o modal reverte sozinho e mostra
  "Não foi possível salvar.";
- a janela da gravação abre sem duração e sem equipe;
- `motivo` ainda desce do banco, mas a tela não lê mais: o cliente já vê só
  "Indisponível". A promessa de que o motivo não chega ao navegador só vale depois
  da migração.
