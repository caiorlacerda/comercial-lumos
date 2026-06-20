# Ajustes na Plataforma Interna — Produtora Lumos

> **Repositório:** `comercial-lumos` (Vite + React + TypeScript + Supabase + Vercel)
> **Branch:** `main`

---

## ⚠️ REGRA INEGOCIÁVEL — LEIA ANTES DE QUALQUER LINHA DE CÓDIGO

**A IA deve alterar APENAS o que está explicitamente descrito neste documento.**

- ❌ Não refatorar arquivos "de passagem"
- ❌ Não "melhorar" estilos, nomes de variáveis ou estrutura de código fora do escopo de cada tarefa
- ❌ Não atualizar dependências
- ❌ Não mexer em telas, componentes ou tabelas que não estejam citados explicitamente
- ❌ Não criar arquivos de configuração, README, .env.example ou similares se não foram solicitados
- ❌ Não rodar `npm install` de novas libs sem aprovação prévia
- ✅ Cada commit deve resolver UMA tarefa deste documento (de preferência), e a mensagem deve referenciar o número da tarefa (ex: `fix(t1): ...`)
- ✅ Antes de cada alteração não-trivial (nova tabela, mudança de schema, nova rota), confirmar o plano com o usuário
- ✅ Toda mudança no schema do Supabase deve vir acompanhada de **um bloco SQL pronto pra copiar e colar**, separado por tarefa, e o usuário roda manualmente — a IA não tenta executar SQL

Se alguma tarefa estiver ambígua, **parar e perguntar** em vez de inferir.

---

## Stack e padrões do projeto (referência rápida)

- **Roteamento:** React Router (`/path` e `/path/:id`), não Next.js. Rotas registradas em [`src/App.tsx`](src/App.tsx).
- **Sidebar:** [`src/components/layout/Sidebar.tsx`](src/components/layout/Sidebar.tsx) — seções: COMERCIAL, PRODUÇÃO, FINANCEIRO, SISTEMA, CONTA.
- **Permissões:** centralizadas em [`src/hooks/useAuth.tsx`](src/hooks/useAuth.tsx). Roles: `admin`, `producao`, `basico`. Permissões custom via `custom_permissions` em `app_users`.
- **Guarda de rota:** `<PermissionGuard permission="...">` em [`src/components/auth/PermissionGuard.tsx`](src/components/auth/PermissionGuard.tsx).
- **Toast:** `useToast()` de [`src/context/ToastContext.tsx`](src/context/ToastContext.tsx). `toast.success(...)`, `toast.error(...)`.
- **Supabase client:** `supabase` de [`src/lib/supabase.ts`](src/lib/supabase.ts).
- **Modais:** componente `Modal` de [`src/components/common/Modal.tsx`](src/components/common/Modal.tsx).
- **PDFs:** `@react-pdf/renderer` v4.x, fontes em [`src/lib/pdfFonts.ts`](src/lib/pdfFonts.ts).
- **Estilo:** Tailwind. Cores temáticas `lumos-bg`, `lumos-surface`, `lumos-yellow`, `lumos-border`, `lumos-text-primary`, `lumos-text-secondary`. Classes utilitárias `card`, `input-lumos`, `btn-primary`, `btn-secondary`.

### Tabelas do Supabase relevantes (resumo)

- `clients` — clientes
- `client_contacts` — contatos vinculados a clientes (causa da Tarefa 1)
- `app_users` — usuários da plataforma (com `role`, `phone`, `custom_permissions`)
- `budgets`, `budget_versions`, `budget_items` — orçamentos
- `projects` — projetos (id, name, code, budget_id, client_id, production_value)
- `project_costs` — custos de cada projeto (já tem `project_id`, `budget_id`, `payment_due_date`, `category` (TEXT), `cost_date`, `created_at`)
- `payables` — contas a pagar
- `receivables` — contas a receber
- `reimbursements` — reembolsos
- `cash_flow_entries` — fluxo de caixa
- `ordens_do_dia` — ordens do dia

---

# Tarefas

## 🐛 Tarefa 1 — Bug de duplicação de contatos ao editar cliente

### Sintoma
Ao editar um cliente em `/clientes` e salvar, os contatos vinculados a ele são duplicados na tabela `client_contacts`. Mesmo apagando os duplicados manualmente, ao salvar de novo eles voltam.

### Onde olhar
- [`src/components/clients/ClientModal.tsx`](src/components/clients/ClientModal.tsx) — função de salvamento (provavelmente está fazendo INSERT de todos os contatos em vez de UPSERT/diff).
- [`src/pages/Clients.tsx`](src/pages/Clients.tsx) e [`src/pages/ClientProfile.tsx`](src/pages/ClientProfile.tsx) — verificar se há outro lugar que também salva contatos.

### Hipótese da causa
A função de save está iterando todos os contatos do estado do form e fazendo `insert()` em cada um, sem verificar se já existem no banco. Cada save dobra o número de contatos.

### O que fazer

**1.1 — Corrigir a lógica de save dos contatos**
- Garantir que contatos com `id` (já existentes) sejam atualizados com `update().eq('id', ...)`, não re-inseridos.
- Contatos sem `id` (novos) devem ser inseridos com `insert()`.
- Contatos removidos do form (que existiam no banco mas não estão mais no estado) devem ser deletados com `delete().eq('id', ...)`.

**1.2 — SQL pra limpar duplicações existentes** (a IA deve gerar e entregar pronto pra rodar)
- Listar duplicados (contatos com mesmo `client_id` + `name` + `email` ou `phone`).
- Manter o registro mais antigo (`created_at` mais antigo) e deletar os outros.
- **Antes de deletar**, mostrar pro usuário a query de SELECT que lista os duplicados pra ele confirmar antes de rodar o DELETE.

### Aceitação
- [ ] Salvar um cliente duas vezes seguidas não duplica os contatos
- [ ] Adicionar, editar e remover contatos funciona corretamente
- [ ] Os duplicados existentes foram removidos do banco
- [ ] Nenhum cliente perdeu contato legítimo (apenas duplicados)

---

## 🐛 Tarefa 2 — Erro ao marcar conta a pagar como paga

### Sintoma
Em `/financeiro/contas-pagar`, ao clicar pra marcar um custo como pago, aparece o seguinte erro:

> **Could not find the 'paid_at' column of 'project_costs' in the schema cache**

O custo foi originado em `/financeiro/custos-projeto/:id` (ou seja, foi criado como um `project_cost`, não como uma `payable` "pura").

### Diagnóstico
O handler de "marcar como pago" em [`src/pages/ContasPagar.tsx`](src/pages/ContasPagar.tsx) está tentando rodar `update({ paid_at, status: 'pago' })` na tabela `project_costs`, mas essa tabela **não tem** as colunas `paid_at` nem `status` — essas colunas existem apenas em `payables`.

Provavelmente a página de Contas a Pagar está unificando dados das duas tabelas (`payables` + `project_costs`) na mesma lista, mas o handler de pagamento sempre tenta atualizar em uma só sem detectar a origem.

### Onde olhar
- [`src/pages/ContasPagar.tsx`](src/pages/ContasPagar.tsx) — handler de "marcar como pago" (provavelmente nome `markAsPaid`, `handlePay`, `togglePaid`, etc).
- Função de fetch da lista — confirmar se está mesclando `payables` e `project_costs`.
- Schema da tabela `project_costs` no Supabase — confirmar que `paid_at` e `status` não existem.

### O que fazer

Há duas abordagens — **alinhar com o usuário antes de escolher**:

#### Opção A — Adicionar colunas em `project_costs` (modelo unificado)
Mais simples no código, mas duplica informação de pagamento entre tabelas.

```sql
ALTER TABLE project_costs
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES app_users(id) ON DELETE SET NULL;
```

Depois, ajustar o handler pra atualizar essas colunas direto em `project_costs` quando o item for dessa tabela.

#### Opção B — Criar `payable` automaticamente ao registrar um custo de projeto
Mais correto do ponto de vista do modelo (uma "conta a pagar" é sempre `payable`, e `project_costs` é só o registro do custo dentro do projeto).

Implica:
- Quando um `project_cost` é criado, criar automaticamente uma `payable` vinculada (via `project_cost_id` em `payables`, ou similar).
- Marcar como pago atualiza só a `payable`.
- A página de Contas a Pagar consulta só `payables` (não precisa unificar).
- O detalhe do custo no projeto puxa o status de pagamento via JOIN com `payables`.

**Recomendação:** começar pela **Opção A** (menos invasiva, mais rápida). Se no futuro precisar de mais sofisticação (parcelamentos, múltiplos pagamentos por custo), migrar pra B.

**2.1** Confirmar com o usuário qual opção seguir antes de codar.

**2.2** Implementar a opção escolhida — incluindo SQL de migração e ajuste do handler em `ContasPagar.tsx`.

**2.3** Garantir que o handler **detecta a origem** do registro (id de `payables` vs id de `project_costs`) e roda o update na tabela correta.

### Aceitação
- [ ] Erro de schema some
- [ ] Marcar como pago funciona para custos que vieram de projetos
- [ ] Marcar como pago continua funcionando para `payables` "puras" (reembolsos, custos manuais, etc)
- [ ] O status é refletido na lista imediatamente após o save
- [ ] Se um custo é marcado como pago via Contas a Pagar, o mesmo status aparece na página do projeto (Custos de Projeto)

---

## 🐛 Tarefa 3 — Navegação incorreta ao clicar em item de Contas a Pagar

### Sintoma
Em `/financeiro/contas-pagar`, clicar num item leva pra `/financeiro/custos-projeto` (lista geral) em vez de `/financeiro/custos-projeto/{project_id}` (detalhe do projeto onde o custo está).

### Onde olhar
- [`src/pages/ContasPagar.tsx`](src/pages/ContasPagar.tsx) — handler de click na linha.

### O que fazer
**3.1** Verificar se a `payable` tem referência ao `project_id` (direta ou via `project_costs`).

**3.2** No click handler:
- Se o item tem `project_id`, navegar pra `/financeiro/custos-projeto/{project_id}`.
- Se não tem (ex: payable criada manualmente sem vínculo), manter o comportamento atual ou desativar o click.

**3.3** Se `payables` não tem `project_id` diretamente, pode ser necessário JOIN com `project_costs` ou adicionar coluna `project_id` em `payables` com SQL. Avaliar o caminho menos invasivo.

### Aceitação
- [ ] Clicar num item de Contas a Pagar que veio de um custo de projeto leva direto pra página do projeto correto
- [ ] Itens sem projeto vinculado não quebram (mantêm comportamento atual ou ficam não-clicáveis)

---

## ✨ Tarefa 4 — Filtro/visualização por projeto em Contas a Pagar

### Onde olhar
- [`src/pages/ContasPagar.tsx`](src/pages/ContasPagar.tsx)

### O que fazer
**4.1** Adicionar um filtro dropdown (similar ao filtro de cliente em Custos de Projeto):
- "Todos os projetos" (padrão)
- Lista de projetos da tabela `projects` (mostrar `#{code} — {name}`)

**4.2** Quando um projeto for selecionado, mostrar apenas as `payables` vinculadas a ele (via `project_id` direto ou JOIN com `project_costs`).

**4.3** Posicionar junto aos outros filtros já existentes na página (manter o padrão visual de `card p-4` com `grid` de inputs).

### Aceitação
- [ ] Dropdown de projetos aparece na página de Contas a Pagar
- [ ] Seleciona um projeto → lista filtra corretamente
- [ ] Indicador "X de N contas" aparece quando filtro está ativo (mesmo padrão de Custos de Projeto)

---

## ✨ Tarefa 5 — Coluna "Data de Cadastro" em Contas a Pagar

### Onde olhar
- [`src/pages/ContasPagar.tsx`](src/pages/ContasPagar.tsx)

### O que fazer
**5.1** Adicionar uma coluna na tabela que mostra a data em que a `payable` foi criada (`created_at`).

**5.2** Formato: `dd/MM/yyyy` (consistente com o resto da plataforma, usando `date-fns` ou `Intl.DateTimeFormat('pt-BR')`).

**5.3** Posicionar a coluna em local lógico (sugestão: entre "Descrição" e "Vencimento").

### Aceitação
- [ ] Nova coluna "Cadastro" exibida na tabela
- [ ] Mostra a data real de criação do registro
- [ ] Layout responsivo mantido

---

## ✨ Tarefa 6 — Notificações de vencimento

### Resumo
Usuários com acesso a Contas a Pagar (admin + permissão `financeiro_admin`) devem receber uma notificação quando uma conta vencer no dia atual.

### Decisões em aberto (CONFIRMAR COM USUÁRIO ANTES DE IMPLEMENTAR)
- **Canal:** email, in-app (badge na sidebar ao logar), ou ambos?
- **Frequência:** uma vez ao dia (manhã) ou a cada login?
- **Escopo do "vencendo hoje":** só hoje, ou inclui atrasadas?

### Implementação sugerida (in-app, MVP)
**6.1** Criar componente `NotificationBell` no sidebar (canto superior direito ou ao lado do avatar).

**6.2** Ao montar o componente, buscar `payables` com:
- `status` = `pendente` (ou equivalente)
- `due_date` <= hoje
- E o usuário tem permissão `financeiro_admin`

**6.3** Mostrar badge com contagem. Click abre um popover com a lista, cada item linkando pra `/financeiro/contas-pagar`.

### Implementação alternativa (email, mais robusto)
**6.4** Criar Supabase Edge Function que roda em cron diário (07:00 BRT):
- Query: `payables` com `due_date = current_date` e `status != 'pago'`
- Pra cada uma, identificar admins com permissão financeira
- Enviar email via Resend / Supabase Auth Email API

### Aceitação
- [ ] Tipo de notificação definido em conjunto com usuário
- [ ] Notificação dispara para contas com vencimento no dia
- [ ] Apenas usuários com permissão financeira recebem
- [ ] Click/link leva pra `/financeiro/contas-pagar`

---

## ✨ Tarefa 7 — Página de Fornecedores

### Resumo
Nova página em PRODUÇÃO pra cadastrar fornecedores (PJ ou PF). Cada fornecedor pode ter vários serviços. Esses serviços podem ser puxados como custo num projeto.

### Estrutura de dados (SQL pra rodar)

```sql
-- Tabela principal de fornecedores
CREATE TABLE fornecedores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         TEXT NOT NULL,
  cnpj         TEXT,              -- opcional, pode ser PF
  telefone     TEXT,
  email        TEXT,
  payment_info TEXT,              -- chave PIX, conta bancária, etc (texto livre)
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  created_by   UUID REFERENCES app_users(id) ON DELETE SET NULL
);

-- Serviços oferecidos pelo fornecedor (um pra muitos)
CREATE TABLE fornecedor_servicos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id  UUID NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
  tipo_servico   TEXT NOT NULL,         -- ex: "Locação de drone", "Diária de filmmaker"
  valor          NUMERIC(12,2),         -- valor padrão do serviço
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE fornecedor_servicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access to fornecedores"
  ON fornecedores FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated full access to fornecedor_servicos"
  ON fornecedor_servicos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Vínculo opcional: cada project_cost pode ter sido gerado a partir de um serviço de fornecedor
ALTER TABLE project_costs
  ADD COLUMN IF NOT EXISTS fornecedor_id UUID REFERENCES fornecedores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fornecedor_servico_id UUID REFERENCES fornecedor_servicos(id) ON DELETE SET NULL;
```

### Permissões
- Acesso por padrão pra `admin` e `producao`
- Adicionar nova permission `fornecedores` em [`src/hooks/useAuth.tsx`](src/hooks/useAuth.tsx) no array de `producao`

### Páginas e arquivos a criar

**7.1** `src/types/fornecedor.ts` — tipos TypeScript pra `Fornecedor` e `FornecedorServico`

**7.2** `src/pages/Fornecedores.tsx` — listagem com:
- Botão "+ Novo Fornecedor" no header
- Card de busca (nome, CNPJ, tipo de serviço)
- Lista de fornecedores em cards (estilo similar a Custos de Projeto / Ordens do Dia)
- Cada card mostra: nome, CNPJ, contato resumido, quantos serviços
- Click no card abre `/producao/fornecedores/:id` ou um modal de edição

**7.3** `src/pages/FornecedorEditor.tsx` (ou modal) — formulário com:
- Campos do fornecedor: nome, CNPJ, telefone, email, dados de pagamento, observações
- Subseção "Serviços" com lista dinâmica (botão "+ Adicionar serviço"):
  - Cada linha: tipo de serviço (input), valor (CurrencyInput), observações
  - Permite adicionar/remover livremente
- Salvar grava fornecedor + faz upsert dos serviços

**7.4** Rotas em [`src/App.tsx`](src/App.tsx):
- `/producao/fornecedores` → `Fornecedores` (com `PermissionGuard permission="fornecedores"`)
- `/producao/fornecedores/nova` → `FornecedorEditor`
- `/producao/fornecedores/:id` → `FornecedorEditor`

**7.5** Sidebar — adicionar item "Fornecedores" na seção PRODUÇÃO em [`src/components/layout/Sidebar.tsx`](src/components/layout/Sidebar.tsx). Ícone sugerido: `Truck` ou `Package` do `lucide-react`.

### Integração com Custos de Projeto

**7.6** No modal de "Registrar Custo" em [`src/pages/CustosProjetoDetalhe.tsx`](src/pages/CustosProjetoDetalhe.tsx):
- Adicionar dropdown opcional "Fornecedor" com busca (similar ao dropdown de projetos no Reembolso)
- Quando selecionado, mostrar um segundo dropdown "Serviço" com os serviços daquele fornecedor
- Ao selecionar um serviço:
  - Preencher `description` com o tipo de serviço
  - Preencher `amount` com o valor padrão do serviço (editável)
- Salvar `fornecedor_id` e `fornecedor_servico_id` no `project_cost`

**7.7** Na tabela de custos do projeto, opcionalmente mostrar o nome do fornecedor quando vinculado.

### Aceitação
- [ ] SQL rodado, tabelas criadas
- [ ] Página `/producao/fornecedores` acessível pra admin e produção
- [ ] CRUD completo de fornecedor (criar, editar, excluir)
- [ ] Cada fornecedor pode ter N serviços cadastrados
- [ ] Em "Registrar Custo" de um projeto, é possível selecionar um fornecedor + serviço e o custo é preenchido automaticamente
- [ ] `project_cost` salva `fornecedor_id` e `fornecedor_servico_id`

---

# Out of Scope (NÃO MEXER)

Estes pontos NÃO devem ser tocados nesta rodada:
- Página de Orçamentos e fluxo de geração de PDF
- Página de Ordem do Dia e PDF (recém terminada, está em uso)
- Página de Reembolso
- Fluxo de Caixa e Custos Fixos
- Layout do Sidebar, header, ou Login
- Sistema de autenticação ou criação de usuários
- Integração com Google Drive ou Google Maps
- Tabela de `clients` em si (apenas a sub-tabela `client_contacts` na Tarefa 1)
- Estilo/tema (modo escuro, cores, fontes)
- Configurações pessoais do usuário

Se durante a implementação de alguma tarefa for descoberto que um destes itens **precisa** ser alterado pra resolver o que foi pedido: **parar, perguntar, esperar autorização**.

---

# Checklist final antes de marcar "pronto"

- [ ] Cada commit tem prefixo da tarefa (`fix(t1)`, `feat(t7)`, etc)
- [ ] Nenhum arquivo fora do escopo foi alterado
- [ ] Build TS passou (`npx tsc --noEmit`)
- [ ] Build Vercel passou (deploy verde)
- [ ] Todas as queries SQL necessárias foram entregues ao usuário pra rodar manualmente
- [ ] Notas de uso/teste foram comunicadas pro usuário (o que fazer pra validar cada feature)
