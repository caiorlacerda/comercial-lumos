# A ordem do dia no portal do cliente

Branch `f6`, commit `1a4f1e7b`, empurrado para `origin/f6`.

## O que mudou

### 1. `supabase/migrations/2026093337_ordem_no_portal.sql` (novo, não rodado)

- `ALTER TABLE ordens_do_dia ADD COLUMN IF NOT EXISTS nota_cliente text` + `COMMENT`.
- `CREATE OR REPLACE FUNCTION portal_agenda(text, uuid)`: cópia fiel da versão
  de `2026093336`, com uma chave nova dentro de cada item de `agendadas`.
  Nenhuma migração de `2026093329` a `2026093336` foi tocada.

A chave nova, `ordem`, é montada campo a campo (nada de linha inteira, nada de
`ponto_encontro` cru):

```
ordem: {
  ponto_encontro: { nome, endereco } | null,
  cronograma: [ { hora, descricao } ],   // de plano_acao, na ordem escrita
  nota_cliente: text | null
} | null
```

`hora` é o `inicio` do momento; `descricao` é o que acontece. Linha sem hora e
sem descrição não vira linha.

Condição: `ordens_do_dia.diaria_id = project_diarias.id`
**e** `aprovacao = 'aprovada'`. Rascunho não sai do banco. Sem interruptor novo.

Ficou de fora do retorno, ou seja, nem sai do Postgres: `call_times`,
`equipamentos`, `figurino`, `objetos`, `regras`, `contatos`, `talentos`,
`locacoes`/`locacao`, `clima`, `equipe` da OD, e do cronograma `responsavel`,
`tipo`, `locacao`, `chegada`, `paralelo`, `destaque`, `fim`.

O resto do retorno (`dias` sem motivo, `pacote`, `pacotes`, `pedidos`, e a
`equipe` da diária atrás de `client_portals.mostrar_equipe`) continua idêntico.

### 2. `src/pages/OrdemDoDiaDetalhe.tsx`

- `OD.nota_cliente: string`, lido com `o.nota_cliente || ''` (sem a coluna, a
  página abre igual, com o campo vazio).
- `CardRegra` ganhou dois adereços opcionais: `ajuda` (linha embaixo do título)
  e `vazio` (texto do estado vazio). Nenhum uso existente mudou.
- Card novo "Recado para o cliente", ícone `Eye`, ajuda dizendo que o cliente lê
  esse texto no portal quando a ordem for aprovada. Aparece na aba Cronograma,
  logo abaixo das regras do set, e na aba Outras Observações, do mesmo jeito que
  as regras já apareciam nas duas.
- `nota_cliente` entrou na regex que detecta "falta rodar a migração" no toast
  de erro do `patch`.

### 3. `src/pages/PortalCliente.tsx` e `portalCliente.css.ts`

- Tipo `Agenda['agendadas'][number].ordem`, opcional.
- Helper `noDia(g)`: limpa e devolve `null` quando não há nada. Sem a migração a
  chave nem chega, e é o mesmo caminho: a seção "No dia" some inteira.
- Na janela da gravação, depois de "Onde" (e da descrição), a seção **No dia**:
  ponto de encontro, "Como vai ser o dia" (lista hora + o que acontece) e
  "O que você precisa providenciar".
- CSS novo (`.grav-dia`, `.grav-ponto`, `.grav-crono`, `.grav-recado`) no mesmo
  arquivo de string do portal, sem Tailwind. Hora em coluna fixa de 44px, texto
  com `min-width: 0` e `overflow-wrap: anywhere`: em 375px quebra na linha, não
  empurra a página pro lado.

## Verificação

- `npm run build` exit 0 antes do commit.
- `curl` na `portal_agenda` de hoje (token `_kXsb3iRhJAa`, projeto Uniasselvi):
  três gravações, chaves `id, nome, data, hora_inicio, hora_fim, local,
  duracao_horas, descricao, equipe`. Sem `ordem`, como esperado antes da
  migração, e é o caso degradado que a tela trata.
- Balanço de parênteses da migração conferido por script; o resto do corpo é
  idêntico ao de `2026093336`, que está em produção.
- Navegador: o portal carrega normalmente. A aba do painel travou no meio da
  navegação (a pane estava escondida) e não valia insistir, porque sem a
  migração não existe seção "No dia" pra ver. Nenhum erro de console vindo do
  portal; os erros presentes são do `LayoutContext` do app interno, do HMR, e
  são anteriores a esta mudança.
- Nada foi escrito no banco, em nenhum projeto.

## Depende da migração

Enquanto `2026093337` não rodar: a coluna `nota_cliente` não existe (salvar o
recado mostra o toast de migração pendente) e a RPC não devolve `ordem`, então
o portal segue exatamente como está hoje.
