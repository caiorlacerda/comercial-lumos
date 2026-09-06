# Bem-vindo à Lumos: onboarding do cliente novo no portal

**Data:** 06/09/2026 · **Estado:** aprovado em conversa (primeiro de 5 sub-projetos do portal do cliente: Bem-vindo à Lumos, Contrato, Meetings, Report, Feedback)

## O problema

Hoje, quando um cliente novo começa a trabalhar com a Lumos, o que a Lumos
precisa dele (logo, brand book, guidelines, acessos a redes sociais) é pedido
por fora, e-mail ou WhatsApp, sem lugar nenhum que mostre o que já chegou e o
que falta. O time descobre o que falta perguntando, ou só quando sente falta
num briefing.

## O que vai existir

Uma aba nova no portal do cliente, "Bem-vindo à Lumos", no mesmo nível de
Início/Projetos/Atendimento (não dentro de um projeto — é do cliente, que pode
ter vários projetos). Duas partes:

1. Um texto curto explicando o que esperar de trabalhar com a Lumos.
2. Um checklist de 4 itens fixos, igual pra todo cliente:

| item | tipo | o que o cliente faz |
|---|---|---|
| Logo | arquivo | envia o arquivo (vetorial ou PNG grande) |
| Brand book / manual da marca | arquivo | envia o arquivo, se tiver |
| Guidelines de conteúdo/tom de voz | arquivo | envia o arquivo, se tiver |
| Acessos (redes sociais, Drive etc.) | manual | convida contato@produtoralumos.com.br como editor, e marca "feito" — não dá pra "enviar" uma credencial, então esse item não tem upload |

Enviar o arquivo (ou marcar "feito" no caso de Acessos) já conta como
concluído. Sem etapa de aprovação: se o time receber o arquivo errado, pede de
novo por fora, como já faz hoje. O cliente pode reenviar um item já concluído
a qualquer momento (ex.: mandou o logo errado).

## Onde os arquivos ficam

Cada cliente ganha uma pasta própria no Google Drive (`clients.drive_folder_id`
— coluna que já existe no banco, sem uso até hoje). A pasta é criada **sob
demanda, no primeiro envio** daquele cliente, não por um gatilho automático na
criação do cliente: evita ter que rodar uma migração de backfill pros clientes
que já existem. Segue o mesmo padrão de "fogo e esquece" do gatilho que cria
pasta de projeto (`2026071100_drive_provision.sql`): se a criação da pasta
falhar, o upload retorna erro pro cliente tentar de novo, mas nunca deixa o
banco em estado quebrado.

## Dados

```
client_boas_vindas_itens
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid()
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE
  item_key       text NOT NULL CHECK (item_key IN ('logo','brand_book','guidelines','acessos'))
  tipo           text NOT NULL CHECK (tipo IN ('arquivo','manual'))
  drive_file_id  text
  nome_arquivo   text
  concluido_em   timestamptz NOT NULL DEFAULT now()
  concluido_por  text  -- nome de quem preencheu, capturado do jeito que o portal já captura hoje sem login
  UNIQUE (client_id, item_key)
```

Uma linha só existe quando o item foi preenchido. Sem linha = pendente. Não
precisa de tabela de "template" porque o checklist é fixo — a lista de 4 itens
vive no código do frontend, não no banco.

`clients.drive_folder_id` (já existe) passa a ser escrito. `drive_sync_log`
(já existe, já prevê `entity_type = 'client'`) registra a criação da pasta.

## Backend

- **RPC `get_boas_vindas_lumos(token)`** (`SECURITY DEFINER`, `anon`): valida o
  token do mesmo jeito que `get_client_portal_v2`/`portal_pode_entrar` já
  fazem, resolve o `client_id`, devolve os 4 itens fixos com o status de cada
  um (pendente ou concluído + quem + quando). Função própria, separada da
  `get_client_portal_v2`: só carrega quando o cliente abre essa aba, sem
  inchar a consulta principal do portal, que já é grande.

- **Edge function `boas-vindas-upload`**: recebe `{ token, item_key, arquivo,
  nome_pessoa }`. Valida o token, garante que `clients.drive_folder_id` existe
  (cria se for o primeiro envio daquele cliente), sobe o arquivo pra pasta,
  grava a linha em `client_boas_vindas_itens` (upsert, por causa do reenvio),
  e dispara notificação pro time (abaixo). Mesmo padrão de segredo
  compartilhado (`x-drive-secret`) que a `drive-provision`/`stream-ingest` já
  usam.

- **RPC `marcar_item_boas_vindas(token, item_key, nome_pessoa)`**: mesma coisa
  que o upload, mas pro item "Acessos" (`tipo = 'manual'`), sem arquivo.

- **Notificação pro time**: novo evento no catálogo existente
  (`src/lib/notifications/events.ts`), categoria `producao`, no formato de
  `DIARIA_SOLICITADA` (evento já existe no catálogo pra "cliente pediu algo
  pelo portal", mesma família). A edge function e a RPC inserem direto na
  tabela `notifications` (mesmo formato que `notify()` já usa no frontend,
  mas chamado do lado do servidor). Quem recebe — atendimento do cliente ou
  todo admin — fica pra decidir no plano de implementação, olhando como
  `getAdminUserIds()` e a marcação `project_members.e_atendimento` já
  resolvem isso hoje.

## Frontend

- Novo item de navegação "Bem-vindo à Lumos" em `PortalCliente.tsx`, ao lado
  de Início/Projetos/Atendimento, carregado sob demanda (só busca dado quando
  a aba é aberta, mesmo padrão de lazy-load que o PDF já usa ali).
- Novo componente `src/pages/portal/BoasVindasLumos.tsx`, em vez de crescer
  ainda mais o `PortalCliente.tsx` (1662 linhas hoje) — extrai a aba nova pra
  fora, sem mexer no resto do arquivo.
- Layout: texto de intro no topo, depois 4 cartões (um por item). Pendente
  mostra botão de enviar arquivo (ou "marcar como feito", pro item Acessos, com
  a instrução de convidar `contato@produtoralumos.com.br`). Concluído mostra
  um check, o nome do arquivo e a data, com um link discreto pra reenviar.
- Segue o CSS próprio já usado no portal (`portalCliente.css.ts`, string
  isolada, sem Tailwind), estendendo com as classes novas necessárias, nas
  mesmas variáveis de cor/tema que já existem ali.
- Copy (rascunho, revisável):
  > "Que bom te ter por aqui. Antes de começarmos a gravar, precisamos de
  > algumas coisas suas, pra já sair com a cara certa desde o primeiro
  > vídeo. Manda o que puder abaixo, no seu tempo, a gente avisa o time a
  > cada item recebido."

## Regras

- Upload sem etapa de aprovação: enviou, conta como feito.
- Reenvio sempre permitido, mesmo em item já concluído.
- Falha ao criar a pasta do Drive, ou ao subir o arquivo, nunca derruba a
  experiência: a edge function devolve erro, o portal mostra uma mensagem
  pedindo pra tentar de novo ou mandar por fora, do jeito que já é hoje.
- Checklist fixo pra todo cliente. Customização por cliente fica fora de
  escopo por enquanto (ver abaixo).

## Como vamos verificar

Via portal de um cliente de teste (token válido): enviar um arquivo em cada um
dos 3 itens de upload, marcar "Acessos" como feito, conferir que os 4
aparecem como concluídos com nome e data certos, conferir que os arquivos
chegam na pasta certa do Drive (criada na hora, não antes), conferir que o
time recebe a notificação, e confirmar por curl que o token de outro cliente
não enxerga nem grava nos itens deste.

## Fora de escopo, de propósito

- Checklist customizável por cliente (item a mais ou a menos). Decidido:
  todo cliente vê os mesmos 4 itens por agora.
- Etapa de aprovação do time antes do item contar como concluído.
- Editor de conteúdo pro texto de intro (fica fixo no código, igual o
  checklist).
