# Portal do cliente, Pacote B: catálogo de vídeos e prazo de revisão

Data: 24/10/2026 · Decisões: Caio · Base: pacote A+F já em produção (`docs/superpowers/specs/2026-10-24-portal-clareza-status-design.md`)

## Objetivo
Mostrar ao cliente **todos os vídeos disponíveis** num catálogo que lembra a Netflix (fileiras que rolam de lado, capa, título, estado) e dar clareza de **prazo** para ele responder, com lembrete interno à equipe quando um vídeo fica parado com o cliente.

## Decisões já tomadas
1. **Onde fica:** aba nova **"Catálogo"** no menu, depois de Início. A aba "Entregas" de dentro do projeto continua como está.
2. **Ao clicar num vídeo:** abre a página de revisão que já existe (`/revisao/:token`), que toca o vídeo, tem comentários no ponto exato, aprovar, pedir ajuste, histórico de versões e Baixar (quando o link permite). Ao voltar, o cliente retorna ao Catálogo na mesma posição.
3. **Prazo de revisão:** visível ao cliente e com **lembrete interno à equipe** (sem e-mail ao cliente).
4. **Download do vídeo final:** **sem botão novo** no portal. Já existe na página de revisão, e um segundo caminho de download repetiria o problema de tráfego do Supabase (caso Masterclass, 367 GB em um dia).
5. Entrega em dois PRs: **B1 catálogo** (só front, sem SQL) e **B2 prazo e lembrete** (SQL + app interno + front).

## B1 — Catálogo

### O que o cliente vê
- Menu: Início · **Catálogo** · Projetos · Atendimento (a aba só aparece quando existe ao menos um vídeo disponível).
- **Fileiras:** a primeira é **"Esperando você"** (todos os vídeos em revisão do cliente, de todos os projetos, o mais antigo primeiro); depois **uma fileira por projeto** (nome do projeto, contagem), com os vídeos: esperando você, ajustes pedidos, aprovados, e dentro de cada estado o mais novo primeiro. Um vídeo pode aparecer em "Esperando você" e na fileira do projeto dele.
- **Card:** capa no formato real do vídeo (9:16, 1:1 ou 16:9), todos com a mesma altura dentro da fileira; abaixo da capa o **título** (nome do arquivo sem extensão e sem underline) e uma linha pequena com a **versão** ("v03"; em B2 "v03 · 3 versões") e o projeto (na fileira "Esperando você"); sobre a capa, um selo do estado (reusa os selos do portal: "Esperando você", "Ajustes pedidos", "Aprovado por você") e o formato ("9:16").
- **Quais vídeos entram:** os mesmos que o portal já mostra (`EM_REVISAO_CLIENTE`, `ALTERACOES_CLIENTE`, `APROVADO`), de projetos visíveis no portal. Vídeo em edição interna nunca aparece. Vídeo sem link de revisão aparece sem clique.
- **Rolagem:** no celular, dedo com encaixe (`scroll-snap`); no desktop, setas nas pontas da fileira (aparecem quando há mais conteúdo para aquele lado) e trackpad/mouse. Respeita `prefers-reduced-motion`. Setas escondidas em telas de toque.
- **Acessibilidade:** cada fileira é uma região com rótulo; cada card é um link de verdade (`<a href>`), alcançável por teclado; setas são botões com `aria-label`.

### Dados e custo
- **Sem SQL e sem mudar o que o portal recebe:** o catálogo é montado a partir de `dados.projetos[].entregas` (já carregado por `get_client_portal_v2`).
- **Capas:** hoje são imagens embutidas no banco (cerca de 0,5 MB cada). O catálogo pede as capas **só dos cards que chegam perto da tela** (`IntersectionObserver`, margem de 300 px), em lotes de até 6 (`portal_capas`, que já existe), com um pequeno atraso para juntar pedidos, e guarda em memória durante a visita. Nunca pede todas de uma vez.
- **Voltar do vídeo:** o "bilhete de volta" já guarda a aba; passa a aceitar `catalogo`. A rolagem vertical e a posição de cada fileira ficam em `sessionStorage` e são restauradas uma única vez, até 30 minutos depois.

## B2 — Prazo de revisão, lembrete e versões

### Prazo
- **Configuração por cliente:** nova coluna `client_portals.prazo_revisao_dias` (inteiro de 1 a 30, **padrão 3**, vazio = sem prazo), editável no modal do portal ("Prazo para o cliente revisar, em dias úteis").
- **Cálculo:** prazo = data de entrega do vídeo (`entregue_em`, `uploaded_at` ou `created_at`, em America/Sao_Paulo) + N **dias úteis** (sábado e domingo não contam; feriados não entram). Só vale para vídeo `EM_REVISAO_CLIENTE`.
- **O que o cliente lê:** "Responder até 30/10" (card do catálogo e item "O que precisamos de você"). Vencido o prazo: "Aguardando seu retorno", sem cobrança agressiva e sem data.

### Versões
Contagem de versões do vídeo no card ("v03 · 3 versões"). O histórico completo (seletor, comparação, comentários por versão) **continua na página de revisão**, que já o tem.

### Dados
`portal_visao_projetos` (já existe, pública) passa a devolver, por projeto, `revisoes: [{ review_token, n_versoes, prazo }]` com uma linha por vídeo disponível que tem link de revisão (`prazo` só para vídeo esperando o cliente e só se o cliente tem prazo configurado; `YYYY-MM-DD`). O front junta pelo `review_token`. Antes do SQL, ou em qualquer falha, o card mostra só "v03".

### Lembrete interno
- Rotina diária (9h de Brasília, `0 12 * * *` UTC) chama `portal_lembrar_revisoes()`.
- Para cada vídeo `EM_REVISAO_CLIENTE` de projeto visível, de cliente com portal ativo e com prazo configurado, **com o prazo já vencido**, e sem lembrete nos últimos **3 dias**: cria notificação `cliente_atrasado_revisao` (prioridade normal) para admins e contatos do portal (mesmo público do aviso de saúde, sem contas ocultas), com texto "**{Cliente}** está há N dias sem responder: {vídeo} v{versão}" e link `/producao/projetos?projectId=…&tab=entregas`.
- Anota o lembrete numa tabela própria (`portal_lembretes_revisao`, uma linha por vídeo) para repetir só a cada 3 dias. Se a automação estiver desligada, **não anota**: ao religar, o lembrete sai.
- **Automação nova:** `portal_revisao_lembra` ("Cliente atrasado na revisão") em Configurações → Automações; tipo de notificação `cliente_atrasado_revisao` no catálogo de eventos.

### Segurança
Tabela nova só do servidor (RLS ligada, sem acesso de visitante nem de usuário logado). `portal_lembrar_revisoes()` e a função auxiliar de dias úteis só executam para o servidor; `portal_visao_projetos` continua a única função aberta ao portal. Nada do que é interno (motivo, lembretes) chega ao cliente.

## Arquivos
**B1:** `src/pages/portal/catalogo.ts` (monta as fileiras), `src/pages/portal/useCapasPorVisibilidade.ts`, `src/pages/portal/abas/Catalogo.tsx`, `src/pages/portal/catalogo/FileiraCatalogo.tsx`, `src/pages/portal/catalogo/CardCatalogo.tsx`, `src/pages/portal/PortalCliente.tsx` (menu, aba, bilhete), `src/pages/portalCliente.css.ts`.
**B2:** `supabase/migrations/2026102406_portal_prazo_revisao.sql`, `…2026102407_portal_lembrete_revisao.sql`, `…2026102408_portal_lembrete_cron.sql`; `src/lib/notifications/events.ts`, `src/pages/ConfiguracoesAutomacoes.tsx`, `src/components/producao/PortalModal.tsx`; `src/pages/portal/tipos.ts`, `formatacao.ts`, `abas/projeto/Geral.tsx`, `catalogo/CardCatalogo.tsx`.

## Fora de escopo
Botão de download novo, e-mail ao cliente, janela de detalhe, trailer/play ao passar o mouse, player dentro do catálogo, feriados no cálculo de dias úteis, prazo por vídeo (só por cliente).

## Riscos
- **Tráfego de capas:** mitigado por carga sob demanda e cache em memória; verificar no navegador que um catálogo de 20+ vídeos não pede mais de 6 capas na abertura.
- **Fileira longa** em projeto com muitos vídeos: a rolagem lateral resolve; se virar problema, "ver todos" depois.
- **Padrão de 3 dias já ativo para todos os portais** ao rodar a migration (a coluna nasce com 3): o cliente passa a ver "Responder até…" e a equipe começa a receber lembretes de vídeos já parados com o cliente; a migration documenta e traz uma consulta para revisar antes (e a automação pode ser desligada **antes** do cron do lembrete, mas ver a advertência do aviso de saúde: desligar não reenvia).
- **Dias úteis sem feriados:** o prazo pode cair em feriado; aceito.
