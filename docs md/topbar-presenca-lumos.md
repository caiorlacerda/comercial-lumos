# Barra Superior, Presença de Usuários e Fix de Login — Produtora Lumos

> **Repositório:** `comercial-lumos` (Vite + React + TypeScript + Supabase + Vercel)
> **Branch:** `main`
> **Pré-requisito:** Este documento assume que os ajustes do doc anterior (`ajustes-plataforma-lumos.md`) já estão em produção — incluindo o componente `NotificationBell`, a página de Fornecedores e a permissão `fornecedores`.

---

## ⚠️ REGRA INEGOCIÁVEL — LEIA ANTES DE QUALQUER LINHA DE CÓDIGO

**A IA deve alterar APENAS o que está explicitamente descrito neste documento.**

- ❌ Não refatorar arquivos "de passagem"
- ❌ Não "melhorar" estilos, nomes ou estrutura fora do escopo de cada tarefa
- ❌ Não atualizar dependências sem aprovação prévia
- ❌ Não mexer em telas, componentes ou tabelas que não estejam citados explicitamente
- ❌ Não remover a barra lateral existente (ela CONTINUA — ver Tarefa 1)
- ✅ Cada commit referencia o número da tarefa (ex: `feat(t1): ...`)
- ✅ Antes de mudança não-trivial (nova tabela, novo context global, mudança de schema), confirmar o plano com o usuário
- ✅ Toda alteração de schema vem com **bloco SQL pronto pra copiar e colar**, separado por tarefa — o usuário roda manualmente, a IA não executa SQL
- ✅ Se algo estiver ambíguo: **parar e perguntar**

---

## Stack e padrões (referência rápida)

- **Roteamento:** React Router. Rotas em [`src/App.tsx`](src/App.tsx).
- **Layout atual:** [`src/components/layout/Sidebar.tsx`](src/components/layout/Sidebar.tsx) — envolve todo o conteúdo via `<Sidebar>{children}</Sidebar>` dentro do `AuthWrapper`. Já contém `NotificationBell`, `ThemeToggle`, avatar do usuário e botão Sair.
- **Seções de navegação** (já definidas no array `navigation` do Sidebar): `COMERCIAL`, `PRODUÇÃO`, `FINANCEIRO`, `SISTEMA`, `CONTA`.
- **Auth/permissões:** [`src/hooks/useAuth.tsx`](src/hooks/useAuth.tsx). Roles: `admin`, `producao`, `basico`. Função `can(permission)`. Objeto `profile` (de `app_users`).
- **Tema:** [`src/context/ThemeContext.tsx`](src/context/ThemeContext.tsx) + [`src/components/common/ThemeToggle.tsx`](src/components/common/ThemeToggle.tsx).
- **Notificações:** [`src/components/layout/NotificationBell.tsx`](src/components/layout/NotificationBell.tsx) (já existe).
- **Supabase client:** `supabase` de [`src/lib/supabase.ts`](src/lib/supabase.ts). Realtime disponível.
- **Estilo:** Tailwind. Tokens: `lumos-bg`, `lumos-surface`, `lumos-yellow`, `lumos-border`, `lumos-text-primary`, `lumos-text-secondary`. Utilitários `card`, `input-lumos`, `btn-primary`, `btn-secondary`.

---

# Tarefas

## ✨ Tarefa 1 — Barra superior (Topbar) global

### Resumo
Criar uma barra superior fixa, presente em **todas** as páginas autenticadas. A barra lateral **NÃO é removida** — ela continua, mas passa a ser controlada pela seção ativa selecionada na topbar.

### Comportamento esperado
- **Centro/esquerda da topbar:** botões de seção — `Comercial`, `Produção`, `Financeiro`, `Sistema`, `Conta`.
  - Cada botão só aparece se o usuário tem acesso àquela seção (mesma lógica de visibilidade já usada no `navigation` do Sidebar: `isAdmin`, `can(...)`).
  - Ao clicar numa seção, a **barra lateral esquerda passa a mostrar apenas as páginas daquela seção**.
  - A seção ativa fica destacada (cor `lumos-yellow`).
- **Canto superior direito** (da esquerda pra direita):
  1. **Notificações** (`NotificationBell` — mover pra cá, ver Tarefa 4)
  2. **Usuário logado** — avatar + nome. Ao clicar, abre dropdown com:
     - Link "Configurações" → `/configuracoes`
     - Botão "Sair"
  3. **Toggle sol/lua** (modo claro/escuro) — reusar `ThemeToggle` (pode ser uma versão compacta só com ícone).

### Arquitetura sugerida

**1.1** Criar `src/context/LayoutContext.tsx`:
- Estado `activeSection: 'comercial' | 'producao' | 'financeiro' | 'sistema' | 'conta'`
- `setActiveSection(...)`
- Valor inicial **derivado da rota atual** (ex: rota começa com `/financeiro` → `financeiro`; `/producao` ou `/ordem-do-dia` → `producao`; `/configuracoes` → `conta`; etc).
- Ao navegar, sincronizar `activeSection` com a rota.

**1.2** Criar `src/components/layout/Topbar.tsx`:
- Renderiza os botões de seção (filtrados por permissão)
- Renderiza notificações + menu de usuário + theme toggle à direita
- Usa `LayoutContext` pra marcar a seção ativa e trocar ao clicar

**1.3** Modificar [`src/components/layout/Sidebar.tsx`](src/components/layout/Sidebar.tsx):
- Em vez de renderizar TODAS as seções empilhadas, renderizar **apenas os itens da `activeSection`** vinda do `LayoutContext`.
- Manter o avatar/sair no rodapé OU mover totalmente pro menu de usuário da topbar (decidir com usuário — ver 1.5).
- Manter o comportamento mobile (drawer).

**1.4** Wrapper de layout:
- Onde hoje é `<Sidebar>{children}</Sidebar>`, passar a ter a Topbar no topo + Sidebar à esquerda + conteúdo. Estrutura sugerida:
  ```
  <LayoutProvider>
    <Topbar />
    <div className="flex">
      <Sidebar />
      <main>{children}</main>
    </div>
  </LayoutProvider>
  ```
- Ajustar paddings/margens (a `main` hoje usa `lg:ml-64` por causa da sidebar fixa; agora precisa também de `pt-[altura-da-topbar]`).

**1.5 — CONFIRMAR COM USUÁRIO antes de implementar:**
- O avatar/nome/sair devem ficar **só na topbar** (removendo do rodapé da sidebar) ou em **ambos**? (Recomendação: só na topbar, pra não duplicar.)
- A topbar deve ser fixa (sticky no topo) em todas as resoluções? (Recomendação: sim.)

### Aceitação
- [ ] Topbar aparece em todas as páginas autenticadas
- [ ] Botões de seção respeitam permissões (usuário só vê o que pode acessar)
- [ ] Clicar numa seção troca o conteúdo da sidebar pra aquela seção
- [ ] Seção ativa fica destacada
- [ ] Menu de usuário (canto direito) abre com Configurações + Sair
- [ ] Theme toggle funciona na topbar
- [ ] Sidebar continua existindo e funcional (não foi removida)
- [ ] Mobile continua funcionando (drawer)

---

## ✨ Tarefa 2 — Sidebar controlada pela seção ativa

> Tecnicamente parte da Tarefa 1, mas listada separada pra clareza dos critérios.

### O que fazer
- A sidebar lê `activeSection` do `LayoutContext` e renderiza só os itens daquela seção.
- Ao entrar numa página por URL direta (ex: colar `/financeiro/contas-pagar`), a `activeSection` deve inicializar como `financeiro` automaticamente (derivada da rota).
- Se o usuário troca de seção na topbar mas não navega, a sidebar mostra os itens da nova seção; ao clicar num item, navega normalmente.

### Mapa rota → seção (referência)
- `/`, `/clientes`, `/orcamentos`, `/catalogo`, `/templates` → **comercial**
- `/ordem-do-dia*`, `/producao/*` → **produção**
- `/financeiro*` → **financeiro**
- `/usuarios`, `/auditoria` → **sistema**
- `/configuracoes` → **conta**

### Aceitação
- [ ] URL direta seleciona a seção correta automaticamente
- [ ] Trocar seção na topbar atualiza a sidebar sem navegar
- [ ] Itens continuam respeitando permissões individuais

---

## ✨ Tarefa 3 — Presença de usuários (status online/offline/ocupado/ausente)

### Resumo
Cada usuário tem um indicador de status (bolinha colorida). Todos podem ver uma página com os usuários e seus status, pra futura interação e atribuição de tarefas.

### Estados
- 🟢 **Online** — logado e ativo
- ⚪ **Offline** — não está logado
- 🔴 **Ocupado** — definido manualmente pelo usuário
- 🟡 **Ausente** — definido manualmente (ou automático após inatividade)

### Abordagem técnica (CONFIRMAR COM USUÁRIO)

**Opção A — Supabase Realtime Presence (recomendada pra online/offline)**
- Cada cliente entra num canal de presença ao logar e "track" seu estado.
- Online/offline é automático (canal detecta conexão/desconexão).
- Ocupado/ausente é um campo manual que o usuário define, propagado pelo presence state.
- Vantagem: tempo real, sem polling.

**Opção B — Campo `status` + `last_seen` em `app_users` com heartbeat**
- Mais simples de entender, mas precisa de polling/heartbeat e não é "tempo real puro".

```sql
-- (Opção B ou complemento da A) — status manual + último acesso
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS presence_status TEXT DEFAULT 'offline',  -- online | offline | busy | away
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
```

### O que fazer

**3.1** Definir abordagem (A recomendada). Confirmar com usuário.

**3.2** Criar lógica de presença:
- Ao logar/montar o app, registrar presença (canal realtime ou update de `last_seen` + `presence_status = 'online'`).
- Ao deslogar/fechar, marcar offline (ou deixar o realtime detectar).
- Permitir o usuário trocar manualmente entre Online / Ocupado / Ausente (ex: clicando na própria bolinha no menu de usuário da topbar).

**3.3** Componente `StatusDot`:
- Bolinha colorida reutilizável (recebe `status` e renderiza a cor certa).
- Usar no avatar da topbar, na lista de usuários, e onde mais fizer sentido.

**3.4** Página de visualização de usuários:
- Rota nova: sugestão `/equipe` (acessível a TODOS os usuários autenticados — não só admin).
- Lista todos os `app_users` com: avatar, nome, cargo/role, e `StatusDot` ao vivo.
- Agrupar ou ordenar por status (online primeiro).
- Adicionar item no sidebar — decidir em qual seção (sugestão: nova entrada "Equipe" visível a todos, ou dentro de "Conta"/"Sistema"). **Confirmar com usuário.**

**3.5** (Preparação futura — NÃO implementar agora, só deixar o schema pronto se o usuário quiser)
- A ideia declarada é evoluir pra atribuição de tarefas. **Não criar sistema de tarefas nesta rodada.** Apenas garantir que a presença e a página de equipe existam como base.

### Aceitação
- [ ] Bolinha de status aparece no avatar e na lista de usuários
- [ ] Online/offline reflete o estado real de conexão
- [ ] Usuário consegue se marcar como Ocupado / Ausente manualmente
- [ ] Página `/equipe` lista todos os usuários com status ao vivo, acessível a todos
- [ ] Status atualiza em tempo (real ou near-real) sem precisar recarregar a página

---

## ✨ Tarefa 4 — Notificações personalizadas por perfil

### Resumo
O `NotificationBell` já existe. Esta tarefa o move pra topbar e o torna **sensível ao perfil** do usuário.

### Regras de quem recebe o quê
- **Admin / `financeiro_admin`:** notificações de pagamentos (contas a pagar vencendo hoje/atrasadas) — já implementado no doc anterior.
- **Produção (`producao`):** notificações de conteúdo de produção (ex: nova Ordem do Dia atribuída, novo custo aguardando, etc).
- Cada usuário só vê as notificações relevantes ao seu perfil/permissões.

### O que fazer

**4.1** Mover o `NotificationBell` pra dentro da `Topbar` (canto superior direito, à esquerda do menu de usuário). Remover da localização atual no Sidebar.

**4.2** Generalizar a fonte de notificações por perfil:
- Manter a regra de pagamentos pra quem tem `financeiro_admin`.
- Adicionar regra(s) de produção pra quem tem role `producao` / permissão de produção.
- **Definir com o usuário** exatamente quais eventos de produção geram notificação (ex: "nova ordem do dia criada", "custo registrado em projeto X"). Não inventar eventos — confirmar a lista.

**4.3** (Opcional, se o usuário quiser histórico persistente) criar tabela de notificações:
```sql
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES app_users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,        -- 'pagamento' | 'producao' | ...
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,                 -- rota pra onde o clique leva
  read        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user sees own notifications"
  ON notifications FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
```
> Confirmar com usuário se quer histórico persistente (tabela) ou se notificação derivada em tempo real (consultando payables/ordens) já basta.

### Aceitação
- [ ] Sino de notificações está na topbar
- [ ] Admin vê notificações de pagamento
- [ ] Produção vê notificações de produção (eventos definidos com o usuário)
- [ ] Cada perfil só vê o que lhe é relevante
- [ ] Clique numa notificação leva pra página correspondente

---

## 🐛 Tarefa 5 — Flash da tela "Acesso Pendente" no login

### Sintoma
Ao logar, a tela amarela **"Acesso Pendente — Sua conta Supabase foi criada, mas você ainda não possui um perfil autorizado..."** aparece por 1-2 segundos e some, mesmo para usuários que TÊM perfil válido.

### Diagnóstico
Em [`src/App.tsx`](src/App.tsx), o `AuthWrapper` tem uma checagem do tipo:
```tsx
if (!loading && !profile) {
  return <AcessoPendente />;
}
```
O problema é uma **condição de corrida**: o `loading` vira `false` antes do `profile` terminar de ser buscado. Durante essa janela, `user` já existe mas `profile` ainda é `null`, então a tela de "Acesso Pendente" pisca antes do profile chegar.

Ver [`src/hooks/useAuth.tsx`](src/hooks/useAuth.tsx): tanto `getSession().then(...)` quanto `onAuthStateChange(...)` chamam `fetchProfile(...).finally(() => setLoading(false))`. Dependendo da ordem dos eventos, `loading` pode ficar `false` num momento em que `profile` ainda não foi setado.

### O que fazer

**5.1** Em [`src/hooks/useAuth.tsx`](src/hooks/useAuth.tsx), introduzir um estado explícito que distingue "ainda não terminei de verificar o perfil" de "verifiquei e não existe":
- Ex: `profileChecked: boolean` (começa `false`, vira `true` somente APÓS a primeira tentativa de `fetchProfile` concluir).
- Expor esse estado no contexto.

**5.2** Em [`src/App.tsx`](src/App.tsx), só mostrar "Acesso Pendente" quando:
```tsx
if (user && profileChecked && !profile) {
  return <AcessoPendente />;
}
```
- Enquanto `!profileChecked`, continuar mostrando o spinner de loading (não a tela de acesso pendente).

**5.3** Garantir que `fetchProfile` seta `profileChecked = true` no `finally`, e que `loading` só vira `false` depois que o profile foi resolvido (ou confirmado inexistente).

**5.4** Cuidar pra não introduzir loop ou tela de loading infinita — testar:
- Login de usuário com perfil válido → vai direto pro app, SEM flash
- Login de usuário sem perfil → mostra "Acesso Pendente" (corretamente, sem piscar antes)
- Refresh de página logado → sem flash

### Aceitação
- [ ] Usuário com perfil válido nunca vê a tela "Acesso Pendente"
- [ ] Usuário sem perfil vê a tela corretamente (e só ela, sem piscar)
- [ ] Não há flash em login nem em refresh
- [ ] Nenhuma regressão no fluxo de loading/spinner

---

# Out of Scope (NÃO MEXER)

- Sistema de tarefas/assign (apenas preparar a base de presença na T3 — NÃO construir o gerenciador de tarefas agora)
- Lógica de geração de PDF (Orçamento, Ordem do Dia, OS)
- Fluxo de Reembolso, Fluxo de Caixa, Custos Fixos
- Schema de `budgets`, `projects`, `project_costs`, `payables`, `receivables` (exceto o que cada tarefa pedir explicitamente)
- Sistema de criação/convite de usuários
- Integrações Google (Drive, Maps)
- Tema visual (cores, fontes) — apenas reposicionar o toggle existente

Se durante a implementação descobrir que um item acima precisa mudar pra resolver o pedido: **parar, perguntar, esperar autorização.**

---

# Ordem de execução sugerida

1. **Tarefa 5** (fix do flash) — rápida, isolada, melhora UX imediata
2. **Tarefa 1 + 2** (topbar + sidebar section-aware) — núcleo da mudança de layout
3. **Tarefa 4** (mover/personalizar notificações) — depende da topbar existir
4. **Tarefa 3** (presença + página de equipe) — maior, mais independente

---

# Checklist final antes de marcar "pronto"

- [ ] Cada commit referencia a tarefa (`fix(t5)`, `feat(t1)`, etc)
- [ ] Nenhum arquivo fora do escopo foi alterado
- [ ] `npx tsc --noEmit` passou
- [ ] Build Vercel verde
- [ ] SQL necessário entregue ao usuário pra rodar manualmente
- [ ] Decisões "confirmar com usuário" (1.5, 3.1, 3.4, 4.2, 4.3) foram efetivamente confirmadas antes de codar
- [ ] Instruções de teste comunicadas pro usuário
