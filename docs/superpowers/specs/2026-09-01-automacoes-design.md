# Automações: uma página para o que o app faz sozinho

**Data:** 01/09/2026 · **Estado:** aprovado em conversa

## O problema

O app tem 42 gatilhos rodando sozinhos: notificação, sincronia de status,
cobrança de nota fiscal, pasta no Drive, transcode. Ninguém vê essa lista em
lugar nenhum, e quem participa de cada uma está escrito no código. Quando o
time muda, muda deploy.

Dois pedidos concretos vieram disso: marcar o atendimento do projeto quando o
vídeo vai para o cliente, e poder acrescentar um terceiro revisor sem mexer em
código.

## O que vai existir

Configurações → Automações. Cada automação é um cartão que diz em português o
que ela faz, se está ligada, e quem ela envolve. Trocar quem é um clique.
Criar um tipo novo continua sendo código, porque cada tipo mexe no banco.

### O catálogo configurável

| chave | o que faz | o que dá pra mudar |
|---|---|---|
| `revisor_fixo` | vídeo entra em revisão, os revisores fixos entram na tarefa e saem quando não sobra formato pra revisar | ligada, e quem são |
| `atendimento_com_cliente` | vídeo vai pra revisão do cliente, o atendimento daquele projeto entra na tarefa e é avisado | ligada |
| `recusado_volta_pro_editor` | vídeo recusado devolve a tarefa pra quem subiu a versão | ligada |
| `pedido_diaria_avisa` | cliente pede diária pelo portal | ligada, e quem é avisado |
| `cliente_abriu_portal_avisa` | cliente abre o portal | ligada |

### O que a página mostra sem deixar mexer

As outras automações do banco, lidas do catálogo do Postgres, não de uma lista
escrita à mão: nome do gatilho, tabela e a descrição que estiver no comentário
da função. Lista escrita à mão apodrece; lida do banco, não.

## Dados

```
automacoes
  chave       text PRIMARY KEY
  ativa       boolean NOT NULL DEFAULT true
  config      jsonb   NOT NULL DEFAULT '{}'
  updated_at  timestamptz
  updated_by  uuid → app_users
```

Mais `project_members.e_atendimento boolean NOT NULL DEFAULT false`: a função
continua texto livre pra escrever o que quiser, e a marca é o que a automação
lê. Procurar a palavra "atendimento" no texto quebraria no primeiro "Atend.".

Quem são os revisores fixos continua em `app_users.revisor_fixo`, o dado que já
existe. A página é só onde se mexe nele. Duas fontes pra mesma verdade é como
nasce divergência.

## Regras

- Automação desligada não roda, e nada quebra: o gatilho lê a tabela e sai.
- Automação que não existe na tabela é tratada como **ligada**, para um deploy
  novo nunca chegar com comportamento desligado por descuido.
- Falha ao ler a configuração nunca derruba a operação principal. Subir vídeo
  não pode falhar porque a tabela de automações está fora do ar.
- Só admin abre a página e muda qualquer coisa, cobrado pelo banco e não só
  pela tela.

## Como vamos verificar

Logado como robô, no projeto Produção Teste: desligar uma automação e provar
que ela não roda; religar e provar que voltou; marcar alguém como atendimento
do projeto e conferir que ele entra na tarefa quando o vídeo vai pro cliente;
e conferir que a lista lida do banco mostra os gatilhos que existem de verdade.

## Fora de escopo, de propósito

- Motor de regras livre, onde qualquer evento liga em qualquer ação. Parece
  poderoso e vira tela que ninguém entende e que quebra em silêncio.
- Histórico de execução de cada automação. Vale, mas é outra entrega.
