# Barra lateral: ocultar e encerrar projetos, plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir ocultar projetos da barra lateral para o time todo e encerrar/reabrir projetos pelo botão direito, com confirmação que mostra o que está em aberto.

**Architecture:** Coluna nova `projects.oculto_na_barra` (SQL manual). Funções puras em `src/lib/arvoreProjetos.ts` montam a árvore (visíveis, ocultos, encerrados) e formatam as pendências. `SidebarProjectTree.tsx` usa essas funções, ganha o grupo "Ocultos" e novos itens no menu. Um componente novo, `EncerrarProjetoConfirmModal.tsx`, confere as pendências e confirma. O app funciona antes do SQL (os itens de ocultar só aparecem quando a coluna existe).

**Tech Stack:** React 19, TypeScript, Tailwind (tokens `lumos-*`), Supabase JS (cliente com anon key).

**Spec:** `docs/superpowers/specs/2026-10-24-barra-lateral-ocultar-encerrar-design.md`

## Global Constraints

- O desktop (`lg:`/≥1024px) não regride; a barra lateral é só desktop.
- Usar sempre tokens `lumos-*` (`lumos-surface`, `lumos-border`, `lumos-yellow`, `lumos-text-primary`, `lumos-text-secondary`) e `rounded-lumos`; nunca cor crua nova (vermelho `red-400/500` já é usado no menu de exclusão e pode ser reusado só para ações destrutivas).
- **Não alterar** `projects.status` além de `ativo`↔`concluido`; não criar status novo.
- **Não chamar `notify()`** para encerramento: o aviso vem do gatilho `trg_project_closed_notification`.
- Textos em português do Brasil.
- Permissão de "Encerrar/Reabrir/Ocultar/Mostrar": `isAdmin || can('ordem_do_dia')`. "Editar" e "Excluir": `isAdmin`.
- SQL só é entregue como arquivo em `supabase/migrations/`; **nunca rodar SQL**, nunca usar o `.env` (aponta para produção). Servidor de teste: `VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=teste npx vite --port 5199 --strictPort`.
- Não mexer em nada fora de `SidebarProjectTree.tsx`, nos arquivos novos e na migration (nada de refactor de oportunidade em `Projetos.tsx`, `SeletorDeProjeto.tsx` etc.).
- Antes de considerar pronto: `npx tsc --noEmit` (nesta worktree, ignorar os erros de pacotes ausentes `hls.js`, `pdfjs-dist`, `@tiptap/extension-mention` e os que decorrem deles).

## Mapa de arquivos

- Create: `supabase/migrations/2026102409_projects_oculto_na_barra.sql`
- Create: `src/lib/arvoreProjetos.ts` (funções puras)
- Create: `src/components/layout/EncerrarProjetoConfirmModal.tsx`
- Modify: `src/components/layout/SidebarProjectTree.tsx`

---

### Task 1: Migration da coluna `oculto_na_barra`

**Files:**
- Create: `supabase/migrations/2026102409_projects_oculto_na_barra.sql`

**Interfaces:**
- Produces: coluna `public.projects.oculto_na_barra boolean NOT NULL DEFAULT false`, lida e gravada pelo app com as permissões que a tabela `projects` já tem.

- [ ] **Step 1: Escrever o arquivo**

```sql
-- Barra lateral: ocultar projeto para o time todo (24/10/2026)
--
-- Marca simples no projeto. NÃO muda `status`: o projeto continua ativo e
-- aparece em Todos os Projetos, tarefas, financeiro, portal e vídeos em
-- revisão. Só some da árvore da barra lateral (fica no grupo "Ocultos").
--
-- Rodar à mão no SQL Editor do Supabase. É seguro rodar mais de uma vez.
-- O app funciona antes e depois deste SQL: sem a coluna, os itens
-- "Ocultar da barra" / "Mostrar na barra" simplesmente não aparecem.
--
-- Desfazer (se um dia precisar): ALTER TABLE public.projects DROP COLUMN oculto_na_barra;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS oculto_na_barra boolean NOT NULL DEFAULT false;

-- Conferência: deve devolver 1 linha (coluna existe) e 0 projetos ocultos.
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'oculto_na_barra'
  ) AS coluna_existe,
  (SELECT count(*) FROM public.projects WHERE oculto_na_barra) AS ocultos;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/2026102409_projects_oculto_na_barra.sql
git commit -m "feat(barra): coluna oculto_na_barra em projects"
```

---

### Task 2: Funções puras `arvoreProjetos.ts`

**Files:**
- Create: `src/lib/arvoreProjetos.ts`

**Interfaces:**
- Produces (usados nas Tasks 3 e 4):
  - `interface ProjetoArvore { id: string; name: string; client_id: string | null; code: string | null; category: string | null; status?: string; oculto_na_barra?: boolean | null }`
  - `interface ClienteBasico { id: string; name: string }`
  - `interface ClienteNaArvore extends ClienteBasico { projects: ProjetoArvore[] }`
  - `interface ProjetoOculto extends ProjetoArvore { clienteNome: string | null }`
  - `interface ArvoreMontada { clientes: ClienteNaArvore[]; semCliente: ProjetoArvore[]; ocultos: ProjetoOculto[]; encerrados: ProjetoArvore[] }`
  - `codeSeq(p: { code: string | null }): number` (mesmo comportamento do `codeSeq` que hoje vive no componente: dígitos finais do código, ou `Number.MAX_SAFE_INTEGER`)
  - `montarArvore(projetos: ProjetoArvore[], clientes: ClienteBasico[]): ArvoreMontada`
  - `type TomPendencia = 'ok' | 'aviso' | 'desconhecido'`
  - `interface LinhaPendencia { texto: string; tom: TomPendencia }`
  - `resumoPendencias(c: { tarefas: number | null; videos: number | null; aReceber: number | null | undefined }): LinhaPendencia[]` (`null` = não foi possível conferir; `undefined` em `aReceber` = o projeto não tem proposta, a linha não aparece)

**Regras de `montarArvore`:**
1. `status === 'concluido'` → vai para `encerrados` (mesmo se oculto), ordenado por `codeSeq` decrescente.
2. Senão, `oculto_na_barra === true` → vai para `ocultos` com `clienteNome` (nome do cliente ou `null`), ordenado por `codeSeq` crescente.
3. Senão, agrupa por `client_id`; projetos sem cliente (ou com `client_id` que não existe em `clientes`) vão para `semCliente`. Dentro de cada cliente e em `semCliente`, ordena por `codeSeq` crescente.
4. `clientes` da árvore: só os que têm ao menos um projeto visível, na ordem recebida em `clientes`.

**Regras de `resumoPendencias`** (nesta ordem):
- tarefas: `null` → `{ texto: 'Tarefas abertas: não foi possível conferir', tom: 'desconhecido' }`; `0` → omite; `n` → `{ texto: 'n tarefa aberta' | 'n tarefas abertas', tom: 'aviso' }`.
- vídeos: `null` → `'Vídeos aguardando o cliente: não foi possível conferir'`; `0` → omite; `n` → `'n vídeo aguardando o cliente' | 'n vídeos aguardando o cliente'`.
- a receber: `undefined` → omite; `null` → `'A receber: não foi possível conferir'`; `0` (ou ≤ 0,004) → omite; valor → `A receber: R$ 1.234,56` (use `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`, tom `aviso`).
- se a lista ficar vazia: `[{ texto: 'Nada em aberto encontrado.', tom: 'ok' }]`.

- [ ] **Step 1: Escrever `src/lib/arvoreProjetos.ts`** com os tipos e funções acima (sem importar React nem Supabase).

- [ ] **Step 2: Conferir com script Node descartável** (no diretório do scratchpad da sessão, nunca no repositório): compilar/rodar o `.ts` com o que existir em `node_modules` (`npx --no-install tsx`, ou `esbuild` para JS e `node`). Casos mínimos:
  - projeto encerrado e oculto → só em `encerrados`;
  - oculto ativo → em `ocultos` com `clienteNome` certo, e o cliente sem outros projetos some de `clientes`;
  - `client_id` inexistente → `semCliente`;
  - ordenação por `codeSeq` (`'2026-229'` antes de `'2026-230'`; sem código por último);
  - `resumoPendencias` com `{0,0,undefined}` → só "Nada em aberto encontrado."; `{1,2,1234.5}` → 3 linhas, singular "1 tarefa aberta", plural "2 vídeos aguardando o cliente", "A receber: R$ 1.234,50"; `{null,0,null}` → 2 linhas `desconhecido`.
  Expected: todos passam; guardar a saída no relatório.

- [ ] **Step 3: `npx tsc --noEmit`** (filtrando os erros de pacotes ausentes). Expected: nenhum erro novo.

- [ ] **Step 4: Commit**

```bash
git add src/lib/arvoreProjetos.ts
git commit -m "feat(barra): funções puras para montar a árvore de projetos e resumir pendências"
```

---

### Task 3: Barra lateral: grupo "Ocultos", novo menu e compatibilidade antes do SQL

**Files:**
- Modify: `src/components/layout/SidebarProjectTree.tsx`

**Interfaces:**
- Consumes: `montarArvore`, `codeSeq`, `ProjetoArvore`, `ClienteNaArvore`, `ProjetoOculto` da Task 2.
- Produces: no componente, estado `ocultarDisponivel: boolean`, função `alternarOculto(proj, ocultar)`, e o ponto de entrada `setConfirmStatus({ proj, acao: 'encerrar' | 'reabrir' })` para a Task 4 (nesta task o menu já chama `setConfirmStatus`, e a janela é conectada na Task 4; para a Task 3 compilar sozinha, declarar o estado e deixar um `{confirmStatus && null}` ou comentário claro no ponto onde a Task 4 renderiza a janela).

- [ ] **Step 1: Trocar o tipo e o `codeSeq` locais** (`TreeProject`, `TreeClient`, `codeSeq` no topo do arquivo) pelos importados de `@/lib/arvoreProjetos`. Manter `CLIENT_COLOR_OPTIONS` e o resto intocados.

- [ ] **Step 2: Carga com fallback.** No `useEffect` de carga, substituir a busca de projetos por:

```ts
const COLUNAS = 'id, name, client_id, code, category, status';
const buscar = (comOculto: boolean) =>
  supabase.from('projects')
    .select(comOculto ? `${COLUNAS}, oculto_na_barra` : COLUNAS)
    .in('status', ['ativo', 'concluido'])
    .order('name');
let projRes = await buscar(true);
let temColuna = true;
if (projRes.error) {            // coluna ainda não existe (SQL pendente)
  temColuna = false;
  projRes = await buscar(false);
}
```
(manter as buscas de clientes e cores em `Promise.all` como hoje; só a de projetos sai dele). Guardar `temColuna` em `setOcultarDisponivel(temColuna)`. Montar o estado com `montarArvore(all, clientesLista)`; os estados `clients`, `noClientProjects`, `concluded` passam a vir de `.clientes`, `.semCliente`, `.encerrados`, e há um novo estado `hidden` (`ocultos`). Guardar também `clientesLista` (id, nome) em estado para remontar a árvore depois de ocultar/mostrar.

- [ ] **Step 3: Remontagem local.** Criar um único estado `todos: ProjetoArvore[]` com todos os projetos carregados e derivar a árvore com `useMemo(() => montarArvore(todos, clientesLista), [...])`. Ocultar, mostrar, editar, excluir, encerrar e reabrir passam a **só atualizar `todos`** (mapear/filtrar), e a árvore se remonta sozinha. Ajustar `handleSaveEdit` e `handleDeleteProject` para atualizar `todos` em vez dos três estados antigos. O contador do cliente (`client.projects.length`) já conta só os visíveis.

- [ ] **Step 4: Permissão e menu.** `const podeEncerrar = isAdmin || can('ordem_do_dia');` (junto de `podeGerirPortal`, que tem a mesma regra: pode reusar). `openProjMenu` abre se `podeEncerrar`. O menu mostra, na ordem da tabela da spec: Ocultar da barra / Mostrar na barra (só se `ocultarDisponivel` e o projeto não está encerrado; ícones `EyeOff`/`Eye` de `lucide-react`), Encerrar projeto… / Reabrir projeto… (ícones `Archive`/`RotateCcw`, ambos já importados ou a importar), e Editar/Excluir só se `isAdmin`. Se o menu ficar sem nenhum item, não abrir. Trocar `title` dos botões de projeto de "botão direito para excluir" para `${proj.name} — botão direito para as opções` quando `podeEncerrar`.

- [ ] **Step 5: `alternarOculto`.**

```ts
const alternarOculto = async (proj: ProjetoArvore, ocultar: boolean) => {
  setProjMenu(null);
  const { error } = await supabase.from('projects').update({ oculto_na_barra: ocultar }).eq('id', proj.id);
  if (error) { toast.error('Não foi possível salvar. Tente de novo.'); return; }
  setTodos(prev => prev.map(p => p.id === proj.id ? { ...p, oculto_na_barra: ocultar } : p));
  toast.success(ocultar ? `"${proj.name}" ficou oculto da barra.` : `"${proj.name}" voltou para a barra.`);
};
```

- [ ] **Step 6: Grupo "Ocultos".** Entre "Sem cliente" e "Encerrados", `hidden.length > 0 &&` um botão no mesmo formato do "Encerrados" (chave de expansão `__hidden__`, ícone `EyeOff`, contagem), com lista plana; cada item mostra `{clienteNome} · {código} {nome}` (nome do cliente em `text-lumos-text-secondary/60`, e se `clienteNome` for `null`, só o código e o nome), `onContextMenu={e => openProjMenu(e, proj)}`. Estender o `useEffect` que expande o cliente do projeto aberto: se o projeto ativo está em `hidden`, `setExpanded(prev => ({ ...prev, __hidden__: true }))`.

- [ ] **Step 7: Verificar no navegador** (servidor de banco morto; antes de carregar a página, instalar via `javascript_tool` um `fetch` simulado que responde às rotas `/rest/v1/projects`, `/rest/v1/clients`, `/rest/v1/client_colors` com dados de teste — incluindo um cliente com 4 projetos dos quais 2 ocultos, um projeto encerrado oculto, um projeto sem cliente — e `PATCH /rest/v1/projects` com sucesso). Conferir:
  - com a coluna presente: grupo "Ocultos" com 2 itens `Cliente · código nome`, contador do cliente = 2, projeto encerrado oculto só em "Encerrados";
  - simulando erro 400 na primeira busca (coluna ausente): árvore igual à de hoje, sem itens "Ocultar/Mostrar" no menu e sem erro no console;
  - menu: admin vê tudo; usuário com só `ordem_do_dia` vê Ocultar/Encerrar mas não Editar/Excluir; sem permissão não abre menu;
  - ocultar e mostrar movem o projeto e atualizam o contador na hora;
  - tema claro e escuro.
  (Para trocar o papel do usuário no teste, o implementador deve achar o jeito mais simples e descartável; não commitar nada de teste.)

- [ ] **Step 8: `npx tsc --noEmit`** (filtrado). Commit:

```bash
git add src/components/layout/SidebarProjectTree.tsx
git commit -m "feat(barra): grupo Ocultos e menu de ocultar/mostrar projeto na barra lateral"
```

---

### Task 4: Confirmação de encerrar/reabrir com pendências

**Files:**
- Create: `src/components/layout/EncerrarProjetoConfirmModal.tsx`
- Modify: `src/components/layout/SidebarProjectTree.tsx`

**Interfaces:**
- Consumes: `resumoPendencias`, `LinhaPendencia`, `ProjetoArvore` (Task 2); `setConfirmStatus` e `setTodos` (Task 3).
- Produces: `EncerrarProjetoConfirmModal` com props `{ proj: ProjetoArvore; acao: 'encerrar' | 'reabrir'; onClose: () => void; onDone: (novoStatus: 'ativo' | 'concluido') => void }`.

**Comportamento do componente:**
- Usa `Modal` de `@/components/common/Modal` (mesmo padrão do modal de exclusão: `isOpen`, `onClose`, `title`, `size="md"`, `footer`).
- Em `acao === 'encerrar'`, ao abrir faz as três conferências **em paralelo**, cada uma isolada em try/catch (falha → `null`):
  - **tarefas:** `supabase.from('project_tasks').select('id', { count: 'exact', head: true }).eq('project_id', proj.id).is('deleted_at', null).not('status', 'in', '("concluido","entregue")')` → `count`.
  - **vídeos:** `supabase.from('video_versions').select('group_id, status, updated_at').eq('project_id', proj.id).order('updated_at', { ascending: false })`; em memória, pega a primeira linha de cada `group_id` e conta as que estão em `EM_REVISAO_CLIENTE`.
  - **a receber:** a proposta do projeto mora no financeiro: `supabase.from('projetos_financeiro').select('proposta_id').eq('project_id', proj.id)`; pega a primeira linha com `proposta_id`; se não houver nenhuma, `aReceber = undefined` (sem a linha). Senão `supabase.from('receivables').select('total_amount, received_amount').eq('budget_id', proposta_id).not('status', 'in', '("recebido","cancelado")')` e soma `total_amount - received_amount` (falha em qualquer das duas consultas → `null`).
- Enquanto confere: linhas em esqueleto; o botão "Encerrar projeto" já fica habilitado (a conferência é informativa e não bloqueia).
- Mostra `resumoPendencias(...)` (`aviso` em tom `text-lumos-yellow`, `ok` em `text-lumos-text-secondary`, `desconhecido` em `text-lumos-text-secondary italic`), depois o texto fixo da spec.
- Em `acao === 'reabrir'`: sem conferência; texto "Reabrir *Nome*? Ele volta para a árvore de projetos ativos."
- **Confirmar (guarda de status):**

```ts
const de = acao === 'encerrar' ? 'ativo' : 'concluido';
const para = acao === 'encerrar' ? 'concluido' : 'ativo';
const { data, error } = await supabase.from('projects')
  .update({ status: para }).eq('id', proj.id).eq('status', de).select('id');
if (error) { toast.error('Não foi possível salvar. Tente de novo.'); return; }
if (!data || data.length === 0) {
  toast.error('Esse projeto já foi alterado por outra pessoa. Recarregue a barra.');
  return;
}
toast.success(acao === 'encerrar' ? 'Projeto encerrado.' : 'Projeto reaberto.');
onDone(para);
```
  Botão com spinner enquanto grava; sem `notify()`.

- [ ] **Step 1: Escrever o componente** conforme acima (`useToast` de `@/context/ToastContext`).

- [ ] **Step 2: Ligar na barra.** Em `SidebarProjectTree.tsx`: estado `confirmStatus: { proj: ProjetoArvore; acao: 'encerrar' | 'reabrir' } | null`; os itens "Encerrar projeto…"/"Reabrir projeto…" fazem `setConfirmStatus(...)` e `setProjMenu(null)`; renderizar `<EncerrarProjetoConfirmModal ... onClose={() => setConfirmStatus(null)} onDone={novo => { setTodos(prev => prev.map(p => p.id === confirmStatus.proj.id ? { ...p, status: novo } : p)); setConfirmStatus(null); }} />`. Não navegar para outra rota depois de encerrar (a pessoa continua onde estava; o projeto aberto, se encerrado, passa a aparecer em "Encerrados" e o `useEffect` de expansão do projeto ativo deve também expandir `__done__` quando o projeto aberto está em `concluded`).

- [ ] **Step 3: Verificar no navegador** (mesmo `fetch` simulado da Task 3, com respostas para `project_tasks` (cabeçalho `content-range` para o `count`), `video_versions`, `projetos_financeiro?select=proposta_id`, `receivables` e `PATCH` com e sem linha devolvida). Conferir:
  - encerrar com pendências: as três linhas, singular/plural, "A receber: R$ …"; sem pendências: "Nada em aberto encontrado."; com `receivables` devolvendo 403: "A receber: não foi possível conferir"; projeto sem proposta: sem a linha de a receber;
  - confirmar move o projeto para "Encerrados", atualiza o contador do cliente e dá toast de sucesso;
  - `PATCH` devolvendo lista vazia → toast "já foi alterado por outra pessoa", e o projeto **não** muda de lugar;
  - reabrir devolve o projeto à árvore do cliente; nenhuma chamada a `notifications` na aba Network;
  - tema claro e escuro; sem erro no console.

- [ ] **Step 4: `npx tsc --noEmit`** (filtrado). Commit:

```bash
git add src/components/layout/EncerrarProjetoConfirmModal.tsx src/components/layout/SidebarProjectTree.tsx
git commit -m "feat(barra): encerrar e reabrir projeto pelo botão direito com confirmação do que está em aberto"
```

---

## Depois das tarefas (controlador)
- Revisão final do conjunto, PR único contra `main` (app + o SQL `2026102409`).
- No PR: o SQL é à mão e **opcional para o resto funcionar** (sem ele só faltam os itens de ocultar); o aviso "Projeto encerrado" vem do gatilho; lista de "fora do escopo" da spec; passos de teste no preview (rodar o SQL primeiro, depois ocultar/mostrar/encerrar/reabrir, e conferir a conferência de pendências).
- Mesclar só após o "pode mesclar" do Caio.
