# Lumos Intranet — Módulo Financeiro
> Documento de handoff para desenvolvimento com Antigravity  
> Produtora Lumos · Versão 1.0 · Abril 2026

---

## 0. Premissa crítica

**Não alterar nada do que já existe.** A plataforma comercial está em produção e funcionando. Este documento descreve exclusivamente:

1. A extensão do sistema de autenticação para suportar **3 níveis de permissão**
2. A adição do **Módulo Financeiro** como um conjunto de novas rotas e páginas
3. Os ajustes necessários na **navegação lateral** (`Sidebar`) para refletir o acesso de cada perfil

Nenhuma página existente (`Dashboard`, `Budgets`, `BudgetEditorPage`, `Clients`, `Catalog`, `Templates`, `Settings`) deve ser modificada.

---

## 1. Estado atual da plataforma

### Stack
- **Frontend:** React + Vite + Tailwind CSS
- **Backend/DB:** Supabase (Postgres + Auth + Storage)
- **Hosting:** Vercel
- **PDF:** @react-pdf/renderer

### Estrutura de arquivos relevante
```
src/
  hooks/
    useAuth.tsx         ← AuthContext atual (APENAS user, loading, error, signOut, updateProfile, updateAvatar)
    useGoogleDrive.ts   ← hook já existente para upload de arquivos ao Drive
  pages/
    Login.tsx
    Dashboard.tsx
    Budgets.tsx
    BudgetEditorPage.tsx
    Clients.tsx
    ClientProfile.tsx
    Catalog.tsx
    Templates.tsx
    Settings.tsx
  components/
    layout/
      Sidebar.tsx       ← Navegação lateral (precisa de ajuste para permissões)
    common/
      ThemeToggle.tsx
  context/
    ThemeContext.tsx
  lib/
    supabase.ts
App.tsx                 ← Roteador principal com AuthWrapper
```

### Como a autenticação funciona hoje
O `useAuth.tsx` atual:
- Usa `supabase.auth.getSession()` e `onAuthStateChange`
- Expõe: `user` (Supabase `User`), `loading`, `error`, `signOut`, `updateProfile`, `updateAvatar`
- **Não tem nenhum conceito de role/permissão** — todos os usuários autenticados têm acesso total
- O `AuthWrapper` no `App.tsx` simplesmente redireciona para `/login` se não há `user`

---

## 2. Sistema de Permissões

### 2.1 Níveis de acesso

| Nível | Quem | Acesso |
|-------|------|--------|
| `admin` | Caio, Vinícius | Tudo |
| `producao` | Equipe de produção | Reembolso + Custos de Projeto |
| `basico` | Demais funcionários | Apenas Reembolso |

### 2.2 Tabela de usuários no Supabase

Criar uma tabela `app_users` para gerenciar perfis e permissões. **Importante:** esta tabela é separada de `auth.users` — ela é gerenciada pelos admins da plataforma, não pelo Supabase Auth diretamente.

```sql
CREATE TYPE user_role AS ENUM ('admin', 'producao', 'basico');
CREATE TYPE user_status AS ENUM ('ativo', 'inativo');

CREATE TABLE app_users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id      uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name         text NOT NULL,
  email             text NOT NULL UNIQUE,
  role              user_role NOT NULL DEFAULT 'basico',
  job_title         text,                          -- ex: "Coordenadora de Produção"
  status            user_status NOT NULL DEFAULT 'ativo',
  custom_permissions jsonb DEFAULT '{}',           -- overrides específicos além do role padrão
  invited_by        uuid REFERENCES app_users(id),
  joined_at         timestamptz DEFAULT now(),
  last_seen_at      timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_app_users_auth_id ON app_users(auth_user_id);
CREATE INDEX idx_app_users_role ON app_users(role);
CREATE INDEX idx_app_users_status ON app_users(status);

CREATE TRIGGER app_users_updated_at
  BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

> **Nota:** A função `update_updated_at()` já existe no banco (criada no schema original). Reutilizá-la.

### 2.3 Log de atividades (para auditoria)

```sql
CREATE TABLE user_activity_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES app_users(id),
  action      text NOT NULL,          -- ex: 'login', 'criou_reembolso', 'editou_despesa'
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_activity_log_user ON user_activity_log(user_id);
CREATE INDEX idx_activity_log_created ON user_activity_log(created_at DESC);
```

### 2.4 RLS para app_users

```sql
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados podem ver seu próprio perfil
CREATE POLICY "users_see_own" ON app_users
  FOR SELECT USING (auth_user_id = auth.uid());

-- Admins veem todos
CREATE POLICY "admins_see_all" ON app_users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid() AND role = 'admin'
    )
  );
```

### 2.5 Extensão do useAuth

O hook `useAuth.tsx` precisa ser **estendido** (não reescrito) para incluir o perfil da `app_users`:

```typescript
// Adicionar ao AuthContext:
interface AppUserProfile {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'producao' | 'basico';
  job_title: string | null;
  status: 'ativo' | 'inativo';
  custom_permissions: Record<string, boolean>;
  joined_at: string;
}

// Novos campos no contexto:
profile: AppUserProfile | null;
isAdmin: boolean;
isProducao: boolean;
can: (permission: string) => boolean;  // verifica custom_permissions ou role padrão
```

A lógica de `can()`:

```typescript
const can = (permission: string): boolean => {
  if (!profile) return false;
  // custom_permissions sobrescreve o padrão do role
  if (permission in profile.custom_permissions) {
    return profile.custom_permissions[permission];
  }
  // Permissões padrão por role
  const defaults: Record<string, string[]> = {
    admin:    ['*'],
    producao: ['reembolso', 'custos_projeto'],
    basico:   ['reembolso'],
  };
  return defaults[profile.role]?.includes('*') || 
         defaults[profile.role]?.includes(permission) || false;
};
```

### 2.6 Atualização do AuthWrapper no App.tsx

Após autenticação, verificar se o usuário tem `app_users` cadastrado e se está `ativo`. Se não, redirecionar para uma tela de "acesso não autorizado".

```typescript
// Adicionar ao AuthWrapper — sem modificar a lógica existente:
// Após confirmar que user !== null, buscar profile na app_users
// Se profile === null ou profile.status === 'inativo' → mostrar tela de erro
```

---

## 3. Novas rotas

Adicionar ao `App.tsx`, **após** as rotas existentes, sem modificar nenhuma das rotas atuais:

```
/financeiro                   → FinanceiroDashboard   (admin only)
/financeiro/contas-pagar      → ContasPagar           (admin only)
/financeiro/contas-receber    → ContasReceber         (admin only)
/financeiro/reembolso         → Reembolso             (admin + producao + basico)
/financeiro/custos-projeto    → CustosProjeto         (admin + producao)
/financeiro/custos-projeto/:id → CustosProjetoDetalhe (admin + producao)
/usuarios                     → GerenciamentoUsuarios (admin only)
```

### Componente de guarda por permissão

Criar um `PermissionGuard` para usar nas rotas protegidas por nível:

```typescript
function PermissionGuard({ 
  permission, 
  children 
}: { 
  permission: string; 
  children: React.ReactNode 
}) {
  const { can, profile } = useAuth();
  
  if (!profile) return <Navigate to="/login" />;
  if (profile.status === 'inativo') return <AcessoBloqueado />;
  if (!can(permission)) return <SemPermissao />;
  
  return <>{children}</>;
}
```

Uso no App.tsx:
```tsx
<Route 
  path="/financeiro" 
  element={
    <AuthWrapper>
      <PermissionGuard permission="financeiro_dashboard">
        <FinanceiroDashboard />
      </PermissionGuard>
    </AuthWrapper>
  } 
/>
```

---

## 4. Sidebar — ajuste de navegação

O `Sidebar.tsx` existente deve ser atualizado para exibir itens de menu condicionalmente baseado no `role` do usuário. **Não alterar os itens existentes** — apenas controlar visibilidade dos novos e, opcionalmente, ocultar seções financeiras de quem não tem acesso.

### Estrutura de navegação por nível

**Admin vê tudo:**
```
COMERCIAL
  Dashboard
  Orçamentos
  Clientes
  Catálogo
  Templates

FINANCEIRO
  Dashboard Financeiro
  Contas a Pagar
  Contas a Receber
  Reembolso
  Custos de Projeto

SISTEMA
  Usuários
  Configurações
```

**Produção vê:**
```
FINANCEIRO
  Reembolso
  Custos de Projeto
```

**Básico vê:**
```
FINANCEIRO
  Reembolso
```

> A seção COMERCIAL e SISTEMA não aparecem para Produção e Básico. O usuário ao fazer login vai direto para a primeira página que tem acesso.

---

## 5. Banco de dados — Módulo Financeiro

### 5.1 Enums adicionais

```sql
CREATE TYPE payment_method AS ENUM (
  'pix', 'transferencia', 'boleto', 'cartao_credito', 
  'cartao_debito', 'dinheiro', 'cheque', 'outro'
);

CREATE TYPE expense_category AS ENUM (
  'equipe', 'equipamento', 'locacao', 'transporte', 
  'alimentacao', 'hospedagem', 'marketing', 'software',
  'impostos', 'servicos_terceiros', 'manutencao', 'outro'
);

CREATE TYPE reimbursement_status AS ENUM (
  'pendente', 'aprovado', 'pago', 'rejeitado'
);

CREATE TYPE receivable_status AS ENUM (
  'aguardando', 'parcial', 'recebido', 'inadimplente', 'cancelado'
);
```

### 5.2 Contas a Pagar

```sql
CREATE TABLE payables (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description       text NOT NULL,
  amount            numeric NOT NULL,
  due_date          date NOT NULL,
  paid_at           timestamptz,
  category          expense_category NOT NULL,
  payment_method    payment_method,
  supplier          text,
  responsible_id    uuid REFERENCES app_users(id),
  tags              text[] DEFAULT '{}',
  notes             text,
  drive_folder_id   text,                  -- ID da pasta no Google Drive
  attachments       jsonb DEFAULT '[]',    -- [{name, drive_file_id, url, uploaded_at}]
  created_by        uuid REFERENCES app_users(id),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_payables_due_date ON payables(due_date);
CREATE INDEX idx_payables_category ON payables(category);
CREATE INDEX idx_payables_responsible ON payables(responsible_id);
```

### 5.3 Contas a Receber

```sql
CREATE TABLE receivables (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id           uuid REFERENCES budgets(id),     -- FK para a tabela existente
  budget_version_id   uuid REFERENCES budget_versions(id),
  description         text NOT NULL,
  client_id           uuid REFERENCES clients(id),     -- FK para a tabela existente
  total_amount        numeric NOT NULL,
  received_amount     numeric NOT NULL DEFAULT 0,
  due_date            date,
  received_at         timestamptz,
  status              receivable_status NOT NULL DEFAULT 'aguardando',
  payment_method      payment_method,
  notes               text,
  created_by          uuid REFERENCES app_users(id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_receivables_budget ON receivables(budget_id);
CREATE INDEX idx_receivables_client ON receivables(client_id);
CREATE INDEX idx_receivables_status ON receivables(status);
CREATE INDEX idx_receivables_due_date ON receivables(due_date);
```

**Trigger de integração comercial → financeiro:**

Quando um orçamento passa para status `aprovado`, criar automaticamente um `receivable`:

```sql
CREATE OR REPLACE FUNCTION create_receivable_on_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- Só criar quando status muda para 'aprovado'
  IF NEW.status = 'aprovado' AND OLD.status != 'aprovado' THEN
    INSERT INTO receivables (
      budget_id,
      active_version_id,
      description,
      client_id,
      total_amount,
      status,
      created_by
    )
    SELECT
      NEW.id,
      NEW.active_version_id,
      NEW.project_name,
      NEW.client_id,
      -- Buscar valor final da versão ativa (calculado)
      -- O valor deve ser passado como campo calculado ou buscado aqui
      0,  -- placeholder: frontend deve atualizar com o valor real após criação
      'aguardando',
      NEW.created_by
    WHERE NOT EXISTS (
      SELECT 1 FROM receivables WHERE budget_id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgpql;

CREATE TRIGGER budgets_approval_trigger
  AFTER UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION create_receivable_on_approval();
```

> **Nota sobre o valor:** Como o valor final é calculado no frontend (nunca salvo no banco), o trigger cria o receivable com `total_amount = 0` e o frontend atualiza imediatamente com o valor correto ao detectar a mudança de status.

### 5.4 Reembolsos

```sql
CREATE TABLE reimbursements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id    uuid NOT NULL REFERENCES app_users(id),
  description     text NOT NULL,
  amount          numeric NOT NULL,
  expense_date    date NOT NULL,
  payment_method  payment_method NOT NULL,
  status          reimbursement_status NOT NULL DEFAULT 'pendente',
  notes           text,
  drive_folder_id text,
  attachments     jsonb DEFAULT '[]',     -- [{name, drive_file_id, url, uploaded_at}]
  reviewed_by     uuid REFERENCES app_users(id),
  reviewed_at     timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_reimbursements_requester ON reimbursements(requester_id);
CREATE INDEX idx_reimbursements_status ON reimbursements(status);
CREATE INDEX idx_reimbursements_date ON reimbursements(expense_date);
```

### 5.5 Custos de Projeto

```sql
CREATE TABLE project_costs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id       uuid NOT NULL REFERENCES budgets(id),
  description     text NOT NULL,
  amount          numeric NOT NULL,
  cost_date       date NOT NULL,
  category        expense_category NOT NULL,
  payment_method  payment_method,
  supplier        text,
  responsible_id  uuid REFERENCES app_users(id),
  notes           text,
  drive_folder_id text,
  attachments     jsonb DEFAULT '[]',
  created_by      uuid NOT NULL REFERENCES app_users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_project_costs_budget ON project_costs(budget_id);
CREATE INDEX idx_project_costs_category ON project_costs(category);
CREATE INDEX idx_project_costs_date ON project_costs(cost_date);
```

**Trigger para criar espaço de Custos de Projeto ao aprovar orçamento:**

```sql
-- Nota: o espaço já existe implicitamente via budget_id.
-- O trigger create_receivable_on_approval acima já cobre a aprovação.
-- Custos de Projeto são simplesmente filtrados por budget_id na página dedicada.
-- Não é necessário criar uma tabela de "projeto" separada.
```

### 5.6 Todos os triggers de updated_at

```sql
CREATE TRIGGER payables_updated_at
  BEFORE UPDATE ON payables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER receivables_updated_at
  BEFORE UPDATE ON receivables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER reimbursements_updated_at
  BEFORE UPDATE ON reimbursements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER project_costs_updated_at
  BEFORE UPDATE ON project_costs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 5.7 RLS — Regras de acesso por tabela

```sql
-- Habilitar RLS em todas as novas tabelas
ALTER TABLE payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE reimbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_log ENABLE ROW LEVEL SECURITY;

-- Helper function
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM app_users WHERE auth_user_id = auth.uid() AND status = 'ativo';
$$ LANGUAGE sql SECURITY DEFINER;

-- payables: apenas admin
CREATE POLICY "payables_admin_only" ON payables
  FOR ALL USING (get_user_role() = 'admin');

-- receivables: apenas admin
CREATE POLICY "receivables_admin_only" ON receivables
  FOR ALL USING (get_user_role() = 'admin');

-- reimbursements: todos podem criar/ver os próprios; admin vê tudo
CREATE POLICY "reimbursements_own" ON reimbursements
  FOR SELECT USING (
    requester_id = (SELECT id FROM app_users WHERE auth_user_id = auth.uid())
  );
CREATE POLICY "reimbursements_create" ON reimbursements
  FOR INSERT WITH CHECK (
    requester_id = (SELECT id FROM app_users WHERE auth_user_id = auth.uid())
  );
CREATE POLICY "reimbursements_admin_all" ON reimbursements
  FOR ALL USING (get_user_role() = 'admin');

-- project_costs: producao + admin
CREATE POLICY "project_costs_producao_admin" ON project_costs
  FOR ALL USING (get_user_role() IN ('admin', 'producao'));
```

---

## 6. Google Drive — estrutura de pastas para anexos

O hook `useGoogleDrive.ts` já existe. O módulo financeiro deve utilizá-lo para upload de comprovantes e anexos.

### Estrutura de pastas no Drive

```
Lumos Intranet/
  Financeiro/
    Contas a Pagar/
      YYYY-MM/               ← pasta por mês criada automaticamente
        [ID da despesa]/
    Reembolsos/
      [Nome do funcionário]/
        YYYY-MM/
    Custos de Projeto/
      [Código do Orçamento] - [Nome do Projeto]/
```

### Fluxo de upload

1. Ao salvar uma despesa/reembolso com anexo, chamar `useGoogleDrive` para:
   - Verificar/criar a estrutura de pasta necessária
   - Fazer upload do arquivo
   - Receber o `drive_file_id` e URL público
2. Salvar no campo `attachments` (jsonb) do registro correspondente
3. Salvar o `drive_folder_id` no registro para referência futura

### Interface do anexo (jsonb)

```typescript
interface Attachment {
  name: string;           // nome original do arquivo
  drive_file_id: string;  // ID no Google Drive
  url: string;            // URL de visualização
  size: number;           // bytes
  mime_type: string;
  uploaded_at: string;    // ISO timestamp
  uploaded_by: string;    // app_users.id
}
```

---

## 7. Páginas do Módulo Financeiro

### 7.1 Dashboard Financeiro (`/financeiro`)
**Acesso:** Admin

Interface com cards configuráveis. Cada usuário admin pode personalizar quais KPIs quer ver via preferências salvas em `app_users.custom_permissions` (ou em uma tabela separada `dashboard_preferences` se necessário).

**KPIs disponíveis:**

| KPI | Fonte |
|-----|-------|
| Saldo geral | `receivables.received_amount` - `payables.amount` (pagas) |
| Fluxo de caixa diário | Gráfico de linha: recebimentos vs pagamentos por dia |
| Balanço do mês | Receitas recebidas - Despesas pagas no mês corrente |
| Contas a pagar na semana | `payables` com `due_date` nos próximos 7 dias e `paid_at IS NULL` |
| Contas a receber na semana | `receivables` com `due_date` nos próximos 7 dias e `status != 'recebido'` |
| Ticket médio por cliente | `receivables` agrupado por `client_id`, média de `total_amount` |
| Lucro / Prejuízo | Receitas recebidas - Total de custos (payables + project_costs) |
| EBITDA | Lucro operacional antes de impostos — calculado manualmente pelo admin |
| Faturamento | Soma de `receivables.total_amount` por período |
| Ticket médio por produto | `receivables` agrupado por categoria do `budget` |

**Personalização:**
- Usuário clica em "Personalizar Dashboard" → modal com toggles para cada KPI
- Preferências salvas em `app_users.custom_permissions` como `{ dashboard_cards: ['saldo', 'faturamento', ...] }`
- Admin pode definir um layout padrão que serve como fallback para novos admins

### 7.2 Contas a Pagar (`/financeiro/contas-pagar`)
**Acesso:** Admin

**Visualização principal:**
- Tabela com colunas: Descrição, Data, Valor, Categoria, Fornecedor, Responsável, Forma de Pagamento, Status (pago/pendente), Ações
- Filtros laterais ou em header: data (range), mês, categoria, responsável, fornecedor, forma de pagamento
- Totalizador no topo: total pendente no mês, total pago no mês, próximos vencimentos
- Botão "Nova Despesa"

**Formulário de cadastro (modal ou página lateral):**

| Campo | Tipo | Obrigatório |
|-------|------|------------|
| Descrição | text | ✓ |
| Data do gasto | date | ✓ |
| Valor | numeric (R$) | ✓ |
| Categoria | select (expense_category) | ✓ |
| Fornecedor | text | — |
| Responsável | select (app_users) | — |
| Forma de pagamento | select (payment_method) | — |
| Tags | text[] (chips) | — |
| Anexos | file upload → Google Drive | — |
| Observações | textarea | — |

**Marcar como pago:** botão de ação que abre mini-form com `paid_at` e `payment_method`.

### 7.3 Contas a Receber (`/financeiro/contas-receber`)
**Acesso:** Admin

**Visualização principal:**
- Tabela com colunas: Projeto, Cliente, Valor Total, Recebido, Saldo, Vencimento, Status, Origem (link para orçamento)
- Filtros: status, cliente, período, valor (range)
- Totalizadores: total a receber, total recebido no mês, inadimplências

**Integração com orçamentos:**
- Registros criados automaticamente via trigger quando `budgets.status = 'aprovado'`
- Badge "Ver Orçamento" que leva para `/orcamentos/:id`
- Edição manual possível (ajuste de valor, data de vencimento, notas)

**Atualizar recebimento:** ação para registrar pagamento parcial ou total com data e forma.

### 7.4 Reembolso (`/financeiro/reembolso`)
**Acesso:** Admin + Produção + Básico

**Para o funcionário (usuário não-admin):**
- Formulário simples com visual clean
- Campos:
  - Descrição
  - Data da despesa
  - Valor (R$)
  - Forma de pagamento utilizada
  - Anexo do comprovante (obrigatório)
  - Observações
- Após enviar: lista dos próprios pedidos com status (Pendente / Aprovado / Pago / Rejeitado)
- Sem acesso aos pedidos de outros usuários

**Para o Admin:**
- Visão de todos os pedidos de todos os funcionários
- Filtros por status, funcionário, período, valor
- Ações: Aprovar / Rejeitar (com campo de justificativa) / Marcar como Pago
- Totalizador: total pendente de aprovação, total aprovado aguardando pagamento

### 7.5 Custos de Projeto (`/financeiro/custos-projeto`)
**Acesso:** Admin + Produção

**Listagem de projetos ativos:**
- Cards ou tabela de orçamentos com status `aprovado`
- Informações: nome do projeto, cliente, valor contratado, total de custos registrados, margem real atual
- Clique leva para `/financeiro/custos-projeto/:budget_id`

**Página do projeto (`/financeiro/custos-projeto/:budget_id`):**
- Header: nome do projeto, cliente, código do orçamento, link para ver orçamento
- Painel de resumo:
  - Valor contratado (read-only, vindo do `receivable` correspondente)
  - Total de custos registrados
  - Margem de contribuição atual (valor contratado - custos)
  - Alerta visual se custos ultrapassarem X% do valor contratado
- Tabela de custos registrados: data, descrição, categoria, valor, responsável, anexo
- Botão "Registrar Custo" → formulário:

| Campo | Tipo | Obrigatório |
|-------|------|------------|
| Descrição | text | ✓ |
| Data | date | ✓ |
| Valor | numeric (R$) | ✓ |
| Categoria | select (expense_category) | ✓ |
| Forma de pagamento | select | — |
| Fornecedor | text | — |
| Responsável | select (app_users com role producao/admin) | — |
| Anexo | file upload → Google Drive | — |
| Observações | textarea | — |

### 7.6 Gerenciamento de Usuários (`/usuarios`)
**Acesso:** Admin

**Listagem:**
- Tabela com: Avatar/Iniciais, Nome, E-mail, Cargo, Nível de acesso, Status (Ativo/Inativo), Data de entrada, Ações
- Filtros: role, status, cargo
- Badge colorido por role: Admin (amarelo `#EFC700`) / Produção (azul) / Básico (cinza)
- Botão "Convidar Usuário"

**Convidar usuário:**
- Input de e-mail + select de role + campo de cargo
- Chama `supabase.auth.admin.inviteUserByEmail()` via Supabase Admin API (ou via Edge Function)
- Cria registro em `app_users` com status `ativo` e `auth_user_id = null` (preenche quando o usuário aceitar o convite)

**Editar usuário (inline ou modal):**
- Campos editáveis: nome, cargo, role, custom_permissions, status
- Mudança de status para "Inativo" impede acesso imediatamente (verificado no `AuthWrapper`)

**Histórico de atividades:**
- Painel expansível por usuário mostrando últimas ações de `user_activity_log`

---

## 8. Componentes compartilhados a criar

### 8.1 `FinanceiroLayout`
Wrapper de layout para todas as páginas do módulo financeiro. Reutiliza o mesmo `Sidebar` existente (que já terá as novas entradas condicionais).

### 8.2 `AttachmentUploader`
Componente reutilizável para upload de arquivos ao Google Drive. Usado em: Contas a Pagar, Reembolso, Custos de Projeto.

```typescript
interface AttachmentUploaderProps {
  driveFolder: string;      // caminho da pasta no Drive
  attachments: Attachment[];
  onChange: (attachments: Attachment[]) => void;
  maxFiles?: number;        // default: 5
  accept?: string;          // default: 'image/*,application/pdf'
}
```

### 8.3 `StatusBadge` (extensão)
O `StatusBadge` existente cobre status de orçamento. Criar variante para `reimbursement_status` e `receivable_status`.

### 8.4 `CurrencyInput`
Campo de input formatado em R$ para uso nos formulários financeiros. Formatar com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.

### 8.5 `PermissionGuard`
Descrito na seção 2.6. Reutilizável em qualquer rota ou elemento condicional.

---

## 9. Identidade visual

Manter rigorosamente o design system existente:

| Token | Valor |
|-------|-------|
| Background principal | `#222222` |
| Cards/superfícies | `#2a2a2a` |
| Amarelo Lumos | `#EFC700` |
| Texto primário | `#FFFFFF` |
| Texto secundário | `#999999` |
| Bordas | `rgba(255,255,255,0.08)` |
| Verde (aprovado/recebido) | `#22c55e` |
| Vermelho (reprovado/inadimplente) | `#ef4444` |
| Azul (em processamento) | `#3b82f6` |
| Fontes | Poppins (headings) + Work Sans (body) |
| Border radius | `8px` |

As classes Tailwind customizadas já existentes (`card`, `btn-primary`, `input-lumos`, etc.) devem ser reaproveitadas em todas as novas páginas.

---

## 10. Rotas completas após o módulo (para referência)

```
EXISTENTES (não alterar):
/login
/
/orcamentos
/orcamentos/novo
/orcamentos/:id
/clientes
/clientes/:id
/catalogo
/templates
/configuracoes

NOVAS (adicionar):
/financeiro                          admin
/financeiro/contas-pagar             admin
/financeiro/contas-receber           admin
/financeiro/reembolso                admin + producao + basico
/financeiro/custos-projeto           admin + producao
/financeiro/custos-projeto/:id       admin + producao
/usuarios                            admin
```

---

## 11. Ordem de implementação recomendada

1. **Schema SQL** — criar todas as tabelas, enums, índices, triggers e RLS
2. **useAuth extension** — adicionar `profile`, `isAdmin`, `can()` sem quebrar o existente
3. **PermissionGuard** — componente de guarda de rotas
4. **Sidebar update** — navegação condicional por role
5. **Gerenciamento de Usuários** (`/usuarios`) — necessário para criar usuários antes de testar os outros módulos
6. **Reembolso** (`/financeiro/reembolso`) — módulo mais simples, bom para validar o fluxo de upload
7. **Contas a Pagar** (`/financeiro/contas-pagar`)
8. **Custos de Projeto** (`/financeiro/custos-projeto`)
9. **Contas a Receber** (`/financeiro/contas-receber`) + trigger de integração comercial
10. **Dashboard Financeiro** (`/financeiro`) — depende de todos os módulos anteriores para ter dados reais

---

## 12. Variáveis de ambiente

Nenhuma variável nova é necessária além das já existentes (Supabase URL + anon key). O Google Drive já tem hook próprio com suas credenciais configuradas.

Se necessário usar a **Supabase Admin API** para convidar usuários (seção 7.6), adicionar a `SUPABASE_SERVICE_ROLE_KEY` como variável de ambiente no Vercel (apenas server-side, nunca exposta no frontend).

---

*Lumos Intranet · Módulo Financeiro · Handoff v1.0 · Abril 2026*
