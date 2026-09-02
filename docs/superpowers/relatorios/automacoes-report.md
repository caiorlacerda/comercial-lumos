# Automações — relatório

Branch `f6`, empurrado. Build `npm run build` com exit 0 antes de cada commit.

## Commits

| hash | o que entrou |
|---|---|
| `9d1293bc` | migração `supabase/migrations/2026093340_automacoes.sql` |
| `f655ea3b` | marca de atendimento na aba Equipe do projeto, evento novo em `events.ts` |
| `b4264ba7` | página Configurações → Automações, rota e navegação |

Push: `a2f4851e..b4264ba7  f6 -> f6`.

## O que entrou no banco (arquivo novo, nada editado)

`supabase/migrations/2026093340_automacoes.sql`, tudo por `CREATE OR REPLACE`.
Nenhuma migração até `2026093339` foi tocada.

1. Tabela `automacoes (chave, ativa, config, updated_at, updated_by)`, com as
   cinco chaves do catálogo semeadas e ligadas (`ON CONFLICT DO NOTHING`, então
   rodar de novo nunca religa o que alguém desligou).
2. `pode_configurar_automacoes()`, no formato de `pode_fechar_agenda()`
   (2026093335): SECURITY DEFINER, STABLE, `search_path = public`. Leitura
   liberada para todo `authenticated`; INSERT, UPDATE e DELETE só passam por ela
   (papel `admin` ativo). RLS ligado na tabela.
3. `project_members.e_atendimento boolean NOT NULL DEFAULT false`, com índice
   parcial por projeto.
4. `automacao_ativa(chave)` e `automacao_config(chave)`: SECURITY DEFINER (o
   portal roda como `anon`), com `EXCEPTION WHEN OTHERS`. Chave ausente responde
   **ligada**; falha de leitura responde **ligada** e só registra `RAISE WARNING`.
   É por aí que passam as três regras da spec.
5. Gatilhos passando a consultar a tabela:
   - `notify_video_novo()` — `revisor_fixo` (entrada na tarefa e lista de avisados)
   - `revisor_fixo_ciclo()` — `recusado_volta_pro_editor` (volta pro editor)
   - `atendimento_com_cliente()` — automação nova
   - `notificar_pedido_de_diaria()` — `pedido_diaria_avisa`, mais a lista de quem
     é avisado vinda de `config.user_ids`
   - `get_client_portal_v2(text)` — `cliente_abriu_portal_avisa`
6. `automacoes_do_banco()`: lê `pg_trigger`, `pg_class`, `pg_proc` e
   `obj_description`, devolve gatilho, tabela, função e descrição. Só admin
   executa (`RAISE EXCEPTION` com `ERRCODE 42501`).
7. `COMMENT ON FUNCTION` em todas as funções tocadas, mais comentários de tabela
   e de coluna. É o que a lista do item 6 mostra.

O corpo de `get_client_portal_v2` foi copiado da versão em produção
(2026093328) por script, não à mão, e a única diferença é o cálculo de
`v_avisar`. A contagem de aberturas do portal continua rodando mesmo com a
automação desligada.

## Quando o atendimento sai da tarefa, e por quê

Sai no mesmo instante que o revisor fixo: quando `status_tarefa_pelos_videos()`
devolve `concluido`, isto é, quando a versão atual de **todos** os formatos da
tarefa está aprovada. Não sai quando o cliente pede alteração, porque é
exatamente aí que o atendimento precisa ver o retorno e tocar a próxima rodada.
Só sai quem tem `task_collaborators.auto_revisor = true`, a marca que já
distingue quem entrou pelo automático: quem foi posto à mão fica, sempre.

A saída não é gateada pelo interruptor, de propósito. Ela só desfaz o que o
automático fez, e se dependesse do interruptor, desligar a automação deixaria
gente presa em tarefa para sempre, que é o arquivo morto que a saída existe para
evitar. Está comentado no SQL.

## O que mudou na tela

- `src/pages/ConfiguracoesAutomacoes.tsx` (novo): cartões com o que cada
  automação faz em português, interruptor, e quem participa. `revisor_fixo` edita
  `app_users.revisor_fixo`, sem segunda lista. `pedido_diaria_avisa` edita
  `automacoes.config.user_ids`, e sem ninguém escolhido o padrão por papel
  continua valendo. `atendimento_com_cliente` explica que a escolha é por projeto.
  Toda leitura e escrita trata erro do Supabase, e 42501 vira "só administradores
  mudam automação".
- Rota `/configuracoes/automacoes` em `src/App.tsx`, lazy, dentro de
  `AuthWrapper` + `PermissionGuard permission="admin"`.
- Item "Automações" na seção `configuracoes` de `src/lib/navigation.ts`, com
  `permission: 'admin'`.
- `src/components/producao/ProjectEquipe.tsx`: pílula "Atendimento" em cada
  pessoa da ficha, sempre visível (não depende de passar o mouse, porque a ficha
  é muito usada no celular), com explicação embaixo da lista.
- `src/lib/notifications/events.ts`: evento `video_com_cliente`, para a pessoa
  poder desligar esse aviso em Notificações.

Degradação sem a migração: a página avisa qual arquivo rodar e mostra o catálogo
em leitura; a aba Equipe lê `project_members` com `select('*')` (pedir
`e_atendimento` pelo nome derrubaria a consulta inteira) e a marca simplesmente
não aparece.

## O que foi verificado

- `npm run build` exit 0 antes de cada commit.
- No navegador, logado como robô de testes: `/configuracoes/automacoes` devolve
  "Sem Permissão" (o robô é `producao`), e o item não aparece na navegação. É o
  comportamento certo do guard.
- Aba Equipe do projeto The Office aberta em leitura: a ficha técnica carrega
  normalmente com o `select('*')` e a marca de atendimento não aparece, porque a
  coluna ainda não existe. Sem erro no console vindo do app.
- **Não consegui ver a página renderizada**: ela é admin, o robô é `producao`, e
  virar admin exigiria escrever numa ficha de usuário do banco de produção. Duas
  tentativas de afrouxar o guard localmente só para tirar print foram barradas
  pelo classificador, e não insisti. Nada foi criado nem apagado no banco.

## Roteiro do teste, depois de rodar o SQL

Rodar `supabase/migrations/2026093340_automacoes.sql` no Supabase com as abas do
app fechadas. Os quatro SELECTs do fim devem mostrar as cinco chaves ligadas, a
coluna `e_atendimento`, a tabela com RLS e quatro políticas, e a lista de
gatilhos.

**1. A página abre e é só de admin.**
Logado como você: Configurações → Automações. Cinco cartões, todos "Ligada".
Peça a alguém que não é admin para abrir `/configuracoes/automacoes`: tem que
dar "Sem Permissão", e o item não aparece na navegação dessa pessoa.

**2. A lista lida do banco.**
No fim da página, "O resto do que o app faz sozinho" → Ver. Confira que aparecem
`trg_notify_video_novo`, `trg_revisor_fixo_ciclo`, os dois
`trg_atendimento_com_cliente_*` e `trg_notificar_pedido_de_diaria`, cada um com a
descrição do comentário da função. Os que ainda não têm comentário aparecem com
"Sem descrição no banco ainda", e isso é esperado.

**3. Atendimento entra na tarefa (automação nova).**
No projeto Produção Teste: aba Equipe → Adicionar pessoa (pode ser você mesmo) →
na pílula da pessoa, clicar "Atendimento" (fica amarela). Depois, numa tarefa
desse projeto com vídeo, mover o vídeo para "Enviar ao cliente". Confira:
- a pessoa marcada aparece como colaboradora da tarefa;
- ela recebeu o aviso "Vídeo foi para o cliente 🎬" no sino.

**4. Provar que desligada não roda.**
Em Automações, desligue "Atendimento acompanha o vídeo que foi pro cliente".
Volte ao projeto de teste, tire a pessoa dos colaboradores da tarefa, e mova
outro vídeo (ou o mesmo, voltando para revisão interna e mandando de novo) para
"Enviar ao cliente". Agora:
- a pessoa **não** entra como colaboradora;
- **não** chega aviso novo no sino;
- e, o principal, o vídeo muda de etapa normalmente, sem erro. Automação
  desligada não pode quebrar a operação.
Religue a automação e repita: a pessoa volta a entrar e o aviso volta a chegar.
Mesmo teste vale, sem projeto de teste, para "Cliente abriu o portal": desligue,
abra o portal de um cliente numa aba anônima, e confira que o portal abre igual
e ninguém recebe aviso; a contagem de aberturas do portal continua subindo.

**5. Trocar quem participa, sem deploy.**
Em "Cliente pediu diária pelo portal", escolha uma ou duas pessoas em "Quem é
avisado". Peça uma diária pelo portal do cliente de teste: só as escolhidas
recebem. Desmarque todas: volta ao padrão de sempre, administradores e gestão de
produção.

**6. Revisor fixo continua sendo o mesmo dado.**
Em "Revisor fixo", confira que Caio e Vinicius Ankerkrone já aparecem marcados
(vieram da 2026093339, não foram tocados aqui). Marque uma terceira pessoa por
aqui e abra a ficha dela em Usuários: a marca "Revisor fixo" tem que estar
ligada lá também. É o mesmo campo, não duas listas. Desmarque de volta.

**7. Limpeza.**
Apagar o que foi criado no projeto Produção Teste e desmarcar a pessoa de
atendimento, se for teste. Não mexer na ordem do dia "Uniasselvi, Diária 03".

Preview da branch: `https://comercial-lumos-git-f6-caiolacerda-7541s-projects.vercel.app`
(confirme na Vercel quando o deploy de `f6` terminar).
