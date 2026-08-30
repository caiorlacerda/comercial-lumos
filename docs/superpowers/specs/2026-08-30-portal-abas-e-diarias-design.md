# Portal do cliente: abas no projeto e pedido de diária

**Data:** 30/08/2026 · **Estado:** aprovado em conversa, pronto para virar plano

## O problema

A página de um projeto no portal é uma rolagem só: pacote do mês, onde o projeto
está, entregas, arquivos. Serve para acompanhar, não para fazer. Tudo que o
cliente precisa **fazer** continua saindo por WhatsApp, e a pergunta mais cara é
sempre a mesma: "vocês têm dia tal livre pra gravar?". Essa conversa nasce fora
do app, é decidida fora do app, e só volta pra cá quando alguém redigita a
diária na mão.

Do outro lado, a produção descobre o pedido no meio de uma conversa e responde
sem ver o calendário. Não existe fila, não existe registro de quem pediu o quê,
e o consumo do pacote do mês só é conferido quando já estourou.

## O que vai existir

O projeto no portal ganha abas, e uma delas fecha o ciclo do pedido de diária:
o cliente vê o que tem contratado, vê que dias estão livres, pede, e a equipe
aceita ou recusa dentro do fluxo que já usa. Aceitar cria a diária de verdade.

### Abas do projeto (portal)

| Aba | O que mostra | Origem |
|---|---|---|
| Visão geral | pacote do mês + onde o projeto está | já existe, só muda de lugar |
| Entregas | os vídeos, agrupados por estado | já existe, só muda de lugar |
| Diárias | pacote, agendadas, calendário, pedido | **novo** |
| Arquivos | documentos marcados como entrega | já existe, só muda de lugar |

Roteiros fica para a fase 2: exige decidir o que de um roteiro o cliente pode
ler e criar o aprovar/pedir ajuste dele, que é outro desenho.

No celular as abas usam a mesma fita horizontal rolável do menu de projetos, que
já está no portal e já foi testada em tela pequena.

### A aba Diárias, do lado do cliente

Três blocos, na ordem da cabeça de quem chega:

1. **Seu pacote** — "3 de 4 diárias usadas em agosto". Vem de `escopo_do_mes`,
   sem contador novo. Sem contrato por volume, o bloco não aparece.
2. **Agendadas** — as diárias já marcadas do projeto: data, horário, local.
3. **Pedir uma data** — calendário de 90 dias à frente.

Estados de um dia no calendário, e nada além disso:

- **livre** — dá pra pedir;
- **ocupado** — já existe diária marcada naquele dia, em qualquer projeto de
  qualquer cliente. O cliente nunca sabe de quem é;
- **bloqueado** — a Lumos fechou a data na mão (feriado, viagem, equipe fora);
- **cedo demais** — dentro da antecedência mínima.

Fim de semana é dia livre: gravação em sábado existe.

Escolhida a data, o formulário pede: o que precisa gravar, onde, e a duração
estimada. Se o mês já passou do pacote, o formulário avisa **antes de enviar**:
"esta seria a 5ª de 4 diárias; ela entra como extra e vai ser orçada". O cliente
decide seguir ou desistir; nada é bloqueado.

Regras: antecedência mínima de 7 dias, guardada no portal do cliente e
ajustável no modal do portal; um pedido pendente por dia; dia ocupado ou
bloqueado não aceita pedido.

**Quem pediu:** com login por pessoa ligado, o pedido sai com o nome e o e-mail
de quem está logado. Sem login, o formulário pede nome e e-mail, do mesmo jeito
que a porta de nome da revisão pública faz hoje.

### O lado de dentro

O pedido aparece **no topo da aba Diárias do projeto**, em destaque, com
**Aceitar** e **Recusar**. Recusar pede um motivo curto, que o cliente lê no
portal.

Aceitar **cria a diária** ali mesmo, já com data, local, duração e descrição
vindas do pedido, e tira o pedido da fila. Ninguém redigita nada, e a diária
nasce dentro do fluxo que já existe: escala, previsão do tempo, cobrança
automática de nota fiscal do freela escalado.

Notificação `diaria_solicitada` para admin e produção, disparada por **trigger
no banco**. O portal roda como `anon`, e chamada de `notify()` do lado do
cliente esbarra na RLS — o mesmo motivo pelo qual as outras notificações de
rota pública já são trigger.

## Dados

```
diaria_pedidos
  id              uuid pk
  project_id      uuid → projects (cascade)
  client_id       uuid → clients          -- redundante de propósito: o
                                          -- calendário e as regras do portal
                                          -- consultam por cliente
  client_user_id  uuid → client_users     -- null quando o portal não exige login
  nome            text not null           -- quem pediu, como se identificou
  email           text not null
  data_desejada   date not null
  duracao_horas   numeric(4,1) default 10
  local           text
  descricao       text not null
  fora_do_pacote  boolean default false   -- congela a leitura do dia do pedido
  estado          text default 'pendente' -- pendente|aceito|recusado|cancelado
  motivo_recusa   text
  diaria_id       uuid → project_diarias  -- preenchido ao aceitar
  respondido_por  uuid → app_users
  respondido_em   timestamptz
  created_at      timestamptz default now()

agenda_bloqueios
  data      date pk
  motivo    text
  criado_por uuid → app_users
  created_at timestamptz default now()
```

`client_portals` ganha `antecedencia_dias int default 7`.

RLS: `diaria_pedidos` e `agenda_bloqueios` liberados só para `authenticated`. O
portal não fala com as tabelas — fala com RPCs `SECURITY DEFINER`, como o resto
dele.

## Funções (a superfície pública do portal)

- `portal_agenda(p_token text, p_project_id uuid)` → dias dos próximos 90 dias
  com estado (`livre`/`ocupado`/`bloqueado`/`cedo`), as diárias já agendadas do
  projeto, o consumo do pacote no mês corrente e os pedidos que este portal já
  fez. Devolve **estado do dia, nunca o dono do dia**.
- `portal_pedir_diaria(p_token, p_project_id, p_data, p_duracao, p_local, p_descricao, p_nome, p_email)`
  → cria o pedido. Recusa dia ocupado, bloqueado, dentro da antecedência, ou com
  pedido pendente. Marca `fora_do_pacote` conforme o consumo do mês na hora.
- `portal_cancelar_pedido(p_token, p_pedido_id)` → só pedido pendente, e só do
  próprio portal.

Do lado de dentro, tabela direto (o time é `authenticated`), mais uma função
`aceitar_pedido_diaria(p_pedido_id)` que cria a diária e fecha o pedido numa
transação só — duas escritas que não podem ficar pela metade.

## Erros e casos de borda

- **Dois clientes pedem o mesmo dia:** o dia só fica ocupado quando existe
  diária marcada. Dois pedidos pendentes no mesmo dia são possíveis e corretos;
  quem aceitar primeiro ocupa o dia, e o segundo pedido passa a mostrar, na
  fila interna, que a data ficou ocupada.
- **Aceitar um pedido de data que ficou ocupada:** a função avisa e pede
  confirmação em vez de recusar sozinha — pode haver duas equipes no mesmo dia.
- **Projeto sem contrato por volume:** o bloco do pacote some, o pedido segue
  funcionando, e `fora_do_pacote` fica falso.
- **Portal sem login:** o e-mail do formulário não é verificado. É o mesmo nível
  de confiança da aprovação de vídeo hoje, e vale registrar isso: pedido não é
  compromisso, é pedido. Quem quiser identidade verificada liga o login.
- **Pedido de projeto que saiu do portal:** as RPCs conferem `portal_visivel` e
  a lista de projetos da pessoa, igual ao resto do portal.

## Como vamos verificar

Sem framework de teste no repo, então: script de verificação por RPC (como já
foi feito no portal e na revisão) rodando anônimo contra os dados reais do
projeto **Produção Teste**, cobrindo dia livre, dia ocupado, dia bloqueado, dia
dentro da antecedência, pedido repetido, e pedido em projeto invisível. Depois,
o ciclo completo no navegador: pedir pelo portal, ver chegar na aba Diárias,
aceitar, e conferir que a diária existe com os dados certos.

Nada de teste em projeto de cliente real.

## Fases

**Fase 1 (esta spec):** abas no portal; aba Diárias completa; fila e aprovação
na aba Diárias interna; notificação.

**Fase 2:** aba Roteiros com aprovação do cliente; ordem do dia da diária
confirmada visível pro cliente; e-mail avisando que o pedido foi aceito ou
recusado.

**Fase 3:** pedidos que não são diária (peça extra, corte novo); histórico do
pacote mês a mês; relatório mensal em PDF.

## Fora de escopo, de propósito

- **Recusar sugerindo outra data.** Vira negociação, e negociação é conversa.
- **Mostrar a agenda cheia da Lumos.** Expõe quantos clientes temos e quando
  estamos parados.
- **Chat por projeto.** Vira canal paralelo ao atendimento e ninguém lê.
