# CLAUDE.md — Intranet Lumos (`comercial-lumos`)

Guia de onboarding para agentes de IA e desenvolvedores. Leia antes de mexer no código.

## O que é

Plataforma interna (intranet) da **Produtora Lumos**, reunindo Comercial, Financeiro, Produção e Administração num único app web. É um **PWA** com forte foco em usabilidade mobile (sensação de app nativo), mantendo o desktop completo.

## Stack

- **Frontend:** Vite 8 + React 19 + TypeScript 6 + Tailwind CSS 4
- **Backend:** Supabase (Postgres + RLS, Auth, Realtime, Storage, Edge Functions)
- **Roteamento:** React Router 7 (SPA — **não** é Next.js)
- **Deploy:** Vercel
- **Libs relevantes:** `@react-pdf/renderer` (PDFs), `recharts` (gráficos), `@dnd-kit` (drag-and-drop), `@tiptap` (editor rich text), `framer-motion`, `vaul` (bottom sheets mobile), `xlsx` (export Excel), `lucide-react` (ícones)

## Comandos

```bash
npm run dev      # servidor de desenvolvimento (vite)
npm run build    # tsc && vite build (type-check + build de produção)
npm run preview  # preview do build
```

Sempre rode `npm run build` (ou ao menos `npx tsc --noEmit`) antes de considerar uma mudança pronta.

## Regras de trabalho (importantes)

1. **Não altere nada que não foi explicitamente pedido.** Nada de refactor de oportunidade ou renomeação "de passagem". Anote observações fora de escopo em vez de corrigir por conta própria.
2. **O desktop (`lg:` / ≥1024px) funciona bem — não regride.** Mudanças de UX são mobile-first, escondidas atrás de breakpoints.
3. **SQL é executado manualmente pelo usuário (Caio) no Supabase.** A IA **nunca** roda SQL nem expõe a `service_role` key. Entregue SQL como bloco pronto para copiar. Migrations versionadas ficam em `supabase/migrations/`.
4. **Antes de começar, garanta que está no `main` atualizado.** O histórico deste repo já teve descompasso entre branches — confira `git log` e sincronize.

## Arquitetura

### Roteamento e proteção (`src/App.tsx`)
- Todas as páginas são **lazy-loaded** (`React.lazy` + `Suspense` com `PageLoader`). Ao adicionar página nova, siga o padrão `const X = lazy(() => import('@/pages/X'))`.
- `<AuthWrapper>` envolve rotas privadas: trata sessão, perfil pendente/inativo, e timeout de inatividade (3h). Rotas públicas ficam fora dele: `/login`, `/aprovar/:token`, `/cadastro-fornecedor`.
- `<PermissionGuard permission="...">` bloqueia por permissão dentro do AuthWrapper.
- `/` = **Home universal** (landing de todos os papéis). O dashboard comercial fica em `/comercial`.
- `<VersionWatcher>` detecta novo deploy (`/version.json`) e recarrega a página com segurança (proteção anti-loop).

### Auth e permissões (`src/hooks/useAuth.tsx`)
- Papéis: `admin`, `producao`, `basico`, `editor`.
- `custom_permissions` (JSON por usuário) sobrescreve os defaults do papel.
- Use `can('permissao')` para checagens. Defaults por papel estão em `can()`:
  - `admin`: tudo (`*`)
  - `producao`: `reembolso`, `custos_projeto`, `ordem_do_dia`, `fornecedores`, `cronograma_edicao`
  - `basico`: `reembolso`
  - `editor`: `cronograma_edicao`
- **Atenção:** existe uma cópia desses defaults em `getUserIdsWithPermission` (`src/lib/notifications/notify.ts`). Se mudar um, mude o outro.
- Perfil vem da tabela `app_users` (join por `auth_user_id`). Campos-chave: `id`, `role`, `status` (`ativo`/`inativo`), `custom_permissions`, `presence_status`.

### Navegação (`src/lib/navigation.ts`)
- Fonte única de verdade da navegação: `NAV_SECTIONS` (4 seções: `comercial`, `producao`, `financeiro`, `configuracoes`).
- Consumida tanto pela `Sidebar` (desktop) quanto pela sub-nav mobile. **Não duplique a lista** — edite aqui.
- `getVisibleSections(ctx)` e `getSectionItems(sectionId, ctx)` aplicam a filtragem por permissão.

### Layout
- **Desktop:** `Sidebar.tsx` (lateral) + `Topbar.tsx` (topo).
- **Mobile:** `MobileHeader.tsx` + `MobileSubNav.tsx` (chips das subpáginas) + `MobileTabBar.tsx` (tab bar inferior). Modais viram bottom sheets (`ui/BottomSheet.tsx`, lib `vaul`).
- `LayoutContext.tsx` guarda a seção ativa (`activeSection`), navegação entre seções e a **presença em tempo real** (canal Supabase `online-users`).

### Supabase (`src/lib/supabase.ts`)
- Client único com **anon key** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- **RLS:** policies precisam cobrir `authenticated` **e** `anon` separadamente quando a rota é pública (ex.: `/cadastro-fornecedor`, `/aprovar/:token`). Desabilitar RLS não basta — o PostgREST ainda bloqueia sem policy permissiva.
- Migrations em `supabase/migrations/` (nome `AAAAMMDDNN_descricao.sql`). Edge Functions em `supabase/functions/` (`invite-user`, `list-pending-users`, `google-auth-start`, `google-callback`, `get-calendar-events`).

### Notificações (arquitetura HÍBRIDA — cuidado)
Notificações in-app são criadas por **dois caminhos**. Antes de adicionar uma, confira se já não existe pelo outro lado (risco de duplicidade):

- **Triggers no banco** (`supabase/migrations/2026070403_*` e `2026070402_*`) — disparam sozinhos no Postgres:
  - `todo_atribuido` (INSERT/UPDATE em `project_tasks.responsavel_id`)
  - `comentario_tarefa` (INSERT em `task_comments`)
  - `projeto_encerrado` (UPDATE `projects.status` → `concluido`)
  - `orcamento_aprovado` (UPDATE `budgets.status` → `aprovado`)
  - `mencao_comentario` (menções `@nome`)
- **Cliente** via helper `notify()` (`src/lib/notifications/notify.ts`) — chamado nas páginas:
  - `orcamento_criado`, `ordem_dia_publicada`, `pagamento_recebido`, `reembolso_pendente_aprovacao`, `fornecedor_autocadastro`, `novo_usuario_acesso`, `permissao_alterada`

**Regra:** eventos com trigger de banco **não** devem também chamar `notify()` no cliente (isso já causou notificação duplicada de orçamento aprovado — corrigido). Além disso, chamadas `notify()` em páginas públicas (contexto `anon`) falham por RLS — para esses casos, use trigger.

- Catálogo de tipos: `src/lib/notifications/events.ts` (fonte única — não espalhe strings cruas).
- Consumo em tempo real: `src/hooks/useNotifications.tsx` (canal Realtime + filtro por preferências).
- Preferências por usuário: página `/configuracoes/notificacoes` + tabela `notification_preferences`.
- **Links de notificação devem apontar para rotas reais** de `App.tsx` (ex.: `/orcamentos/:id`, não `/comercial/orcamentos`). Valide o path ao criar uma notificação.

### Presença (online/offline)
Supabase Realtime Presence via canal `online-users` em `LayoutContext`. O status ao vivo vem de `getLiveStatus(profileId)` (não da coluna estática `presence_status`). `Equipe.tsx` exibe a equipe com esse status.

## Design tokens (Tailwind)
Use sempre os tokens `lumos-*` (definidos em `tailwind.config.js` / `src/index.css`), nunca cores cruas:
`lumos-bg`, `lumos-surface`, `lumos-border`, `lumos-yellow`, `lumos-text-primary`, `lumos-text-secondary`. Cantos: `rounded-lumos`. Tema claro/escuro via `ThemeContext`.

## Convenções de UI mobile
- Respeite safe areas do iPhone: `env(safe-area-inset-top/bottom)`.
- Sem scroll horizontal (`overflow-x: hidden` global); transições de página só com fade, sem slide lateral.
- Toasts: `bottom-center` no mobile.

## Armadilhas conhecidas
- **Descompasso de branch:** confirme que está no `main` mais recente antes de começar.
- **Notificação duplicada:** ver seção de notificações (trigger vs cliente).
- **RLS em rotas públicas:** precisa de policy para `anon`.
- **Defaults de permissão duplicados** entre `useAuth.can()` e `notify.ts` — mantenha em sincronia.
- **Bundle:** páginas são lazy — não volte a importar página de forma estática no `App.tsx`.
