# Lumos Budget Studio — Descritivo Técnico Completo
> Documento de handoff para desenvolvimento com Antigravity  
> Produtora Lumos · Versão 1.0 · Abril 2026

---

## 1. Visão geral do produto

**Lumos Budget Studio** é uma plataforma web interna para criação, gestão e exportação de orçamentos de produção audiovisual da Produtora Lumos.

### Contexto
A Lumos é uma produtora audiovisual com três verticais: **Digital** (conteúdo para redes sociais, séries, social shows), **Filme** (vídeos publicitários, institucionais, campanhas) e **Live** (transmissão ao vivo, broadcast, streaming). Hoje os orçamentos são feitos em uma planilha Google Sheets com ~170 abas de projetos reais. A plataforma substitui essa planilha com uma ferramenta dedicada, com histórico, versionamento e exportação de PDF.

### Usuários MVP
- **Caio** (co-fundador e CEO)
- **Vinícius** (co-fundador)

Sem hierarquia de permissões nesta fase — ambos têm acesso total.

### Formato de entrega
App web responsivo, rodando no browser. Stack: **React + Vite + Tailwind CSS** no frontend, **Supabase** (Postgres + Auth + Storage) no backend, hospedado no **Vercel**.

---

## 2. Identidade visual

A interface deve seguir o design system da Lumos:

| Token | Valor |
|-------|-------|
| Cor primária | `#EFC700` (amarelo Lumos) |
| Background dark | `#222222` |
| Background cards | `#2a2a2a` |
| Texto primário | `#FFFFFF` |
| Texto secundário | `#999999` |
| Fonte principal | Poppins (headings) + Work Sans (body) |
| Border radius padrão | `8px` |
| Border cor | `rgba(255,255,255,0.08)` |

A interface é **dark** por padrão. O amarelo `#EFC700` é usado apenas em acentos, CTAs principais, badges de status e destaques — nunca como background de áreas grandes.

---

## 3. Funcionalidades do MVP

### 3.1 Autenticação
- Login com email + senha via Supabase Auth
- Sessão persistente
- Sem cadastro público — usuários criados manualmente no Supabase dashboard
- Rota protegida: qualquer rota além de `/login` redireciona para login se não autenticado

### 3.2 Dashboard (Home)
- Lista de orçamentos recentes (últimos 20, ordenados por `updated_at` desc)
- Cards com: código do orçamento, nome do projeto, cliente, categoria (Digital/Filme/Live), status, valor final, data de atualização
- Filtros: por status, por categoria, busca por nome/cliente
- Botão "Novo orçamento" em destaque
- Contador de orçamentos por status (Rascunho / Em negociação / Aprovado / Reprovado)

### 3.3 Cadastro de clientes
- CRUD completo de clientes
- Campos: nome da empresa, nome do contato, e-mail, telefone, observações
- Página de perfil do cliente com histórico de todos os orçamentos vinculados
- Total histórico de negócios (soma dos orçamentos aprovados)
- Busca por nome

### 3.4 Editor de orçamento

#### Cabeçalho do orçamento
- Código (gerado automaticamente, ex: `0001` — editável)
- Nome do projeto
- Cliente (select com busca — ou criar novo inline)
- Categoria: `Digital` | `Filme` | `Live`
- Status: `Rascunho` | `Em negociação` | `Aprovado` | `Reprovado`
- Data de criação (automática)
- Versão atual (ex: v1, v2...)

#### Grupos de itens
O editor tem **4 grupos**, cada um em seção expansível:

| Grupo | Lógica | Unit label padrão |
|-------|--------|-------------------|
| **Equipe** | Funções de set (diretores, cinegrafistas, produtores, etc.) | diária |
| **Equipamentos** | Gear alugado (câmeras, lentes, iluminação, etc.) | diária |
| **Edição** | Serviços de pós-produção (não segue lógica de diária necessariamente) | vídeo |
| **Produção** | Custos avulsos de set (alimentação, transporte, locação, etc.) | unidade |

#### Adicionar item
Cada grupo tem botão "+ Adicionar item" que abre:
- **Busca no catálogo** (autocomplete pelo nome) — ao selecionar, preenche nome e custo unitário automaticamente
- **Ou item avulso** — digitar nome e valor livremente
- Campos: Nome, Custo unitário (R$), Quantidade, Unidade (diária / hora / vídeo / unidade / pacote — editável), Override de margem (opcional)
- Itens podem ser reordenados (drag-and-drop) e deletados

#### Painel financeiro (sidebar ou seção inferior)
Atualizado em tempo real conforme o usuário edita os itens:

```
Custo Equipe:         R$ X.XXX,XX
Custo Equipamentos:   R$ X.XXX,XX
Custo Edição:         R$ X.XXX,XX
Custo Produção:       R$ X.XXX,XX
─────────────────────────────────
Total de Custo:       R$ X.XXX,XX
Overhead Lumos (10%): R$ X.XXX,XX
─────────────────────────────────
Margem: [40%] (editável)
NF: [18%] (editável)
Desconto: R$ [0,00] (editável)
─────────────────────────────────
VALOR FINAL:          R$ X.XXX,XX
Lucro líquido:        R$ X.XXX,XX
Margem real:          XX,X%
```

**Alerta visual** se margem real cair abaixo de 30%.

#### Campos de texto da versão
- Condições de pagamento (ex: "60 dias após emissão da NF")
- Validade da proposta em dias (padrão: 7)
- Observações internas (não aparecem no PDF)
- Observações para o cliente (aparecem no PDF)

### 3.5 Versionamento

- Toda edição em orçamento com status **Aprovado** ou **Em negociação** cria automaticamente uma **nova versão** (v2, v3...)
- A versão anterior fica arquivada e imutável
- Rascunhos podem ser editados diretamente sem criar nova versão
- Na tela do orçamento: seletor de versão com histórico (data, criado por, valor final de cada versão)
- Botão "Duplicar como nova versão" disponível em qualquer versão

### 3.6 Biblioteca de itens (Catálogo)

Tela de administração do catálogo (`/catalogo`):
- Listagem de todos os itens organizados por grupo
- CRUD: criar, editar, desativar item (não deletar — `is_active: false`)
- Campos: grupo, subcategoria, nome, custo padrão, unidade padrão
- Itens desativados não aparecem nas buscas do editor mas ficam preservados nos orçamentos existentes

**Itens pré-carregados no seed (baseados na planilha):**

**Equipe:**

| Subcategoria | Função | Valor padrão/diária |
|---|---|---|
| Direção | Diretor (Small) | R$ 1.200 |
| Direção | Diretor (Publi) | R$ 3.000 |
| Direção | Diretor de Fotografia | R$ 3.000 |
| Direção | Diretor de Arte | R$ 500 |
| Direção | Roteirista | R$ 200 |
| Captação | Cinegrafista | R$ 1.000 |
| Captação | Fotógrafo | R$ 1.000 |
| Captação | Piloto de Drone FPV | R$ 3.000 |
| Captação | Op. de TP | R$ 800 |
| Captação | DTV | R$ 1.000 |
| Captação | Logger | R$ 500 |
| Som | Áudio | R$ 1.000 |
| Iluminação | Gaffer | R$ 700 |
| Pós-produção | Editor | R$ 1.800 |
| Pós-produção | Editor (CGI) | R$ 15.000 |
| Pós-produção | Motion Designer | R$ 700 |
| Pós-produção | Colorista | R$ 900 |
| Live / Transmissão | VMix | R$ 1.000 |
| Live / Transmissão | Social Media Manager | R$ 2.000 |
| Produção | Produtor | R$ 1.000 |
| Produção | Coordenador | R$ 1.500 |
| Produção | Assist. de produção | R$ 550 |
| Produção | Atendimento | R$ 400 |
| Produção | Coord. de pós-produção | null |
| Arte / Elenco | Figurinista | R$ 800 |
| Arte / Elenco | Maquiadora | R$ 1.000 |
| Arte / Elenco | Contra-Regra | R$ 500 |
| Arte / Elenco | Segurança | R$ 300 |
| Outros | Locução | R$ 300 |
| Outros | Intérprete / Tradutor | null |
| Outros | DJ / Sonoplasta | null |

**Equipamentos:**

| Item | Valor médio/diária |
|---|---|
| FX3 | R$ 649 |
| FX30 | R$ 499 |
| BMPCC6K | R$ 549 |
| Outra câmera | R$ 549 |
| Lente 16-35 | R$ 250 |
| Lente 24-70 | R$ 250 |
| Lente 70-200 | R$ 320 |
| Outras lentes | R$ 250 |
| Amaran 200x | R$ 190 |
| Amaran 300c | R$ 299 |
| Amaran 60x | R$ 129 |
| Amaran T2C | R$ 99 |
| Amaran T4C | R$ 139 |
| Outra iluminação | R$ 239 |
| DJI Mic Lapela | R$ 159 |
| Deity S-Mic 2S Shotgun | R$ 120 |
| Zoom H6 | R$ 179 |
| Kit Podcast | R$ 1.290 |
| Ronin RS3PRO | R$ 429 |
| DJI Mini 3 Pro | R$ 449 |
| Insta360 X3 Câmera 360º | R$ 399 |
| Softbox Aputure Light Dome II | R$ 69 |
| Atem Mini Pro | R$ 350 |
| Hydra Tilta | R$ 600 |
| Bateria V-Mount | R$ 299 |
| Switcher VMix | R$ 1.000 |
| Sony NX5R | R$ 420 |
| Teradek Bolt 6 LT 750 | R$ 1.000 |
| Rádios HT | R$ 35 |
| Compania do TP | R$ 800 |
| Allen & Heat SQ 5 | R$ 600 |
| Monitor | R$ 250 |
| Transmissão Sem-fio | R$ 250 |
| Easy-Rig | R$ 300 |
| Follow-Focus | R$ 350 |
| HD ou SSD 2TB | R$ 1.300 |
| HD ou SSD 4TB | R$ 2.300 |
| Microfone Lapela | R$ 350 |
| Intercom | R$ 1.000 |
| Painel de Led 2.5m x 3m | R$ 8.000 |
| NoBreak | R$ 350 |

**Edição:**

| Item | Valor padrão | Unidade |
|---|---|---|
| Decupagem | null | vídeo |
| Montagem e edição | null | vídeo |
| Correção de cor | null | vídeo |
| Motion graphics | null | vídeo |
| Mixagem e masterização de áudio | null | vídeo |
| Finalização | null | vídeo |
| Banco de imagens | R$ 299 | unidade |
| Assets 3D | null | unidade |
| Trilha original | R$ 2.500 | unidade |
| Pacote de pós-produção | null | pacote |

**Produção (custos de set):**

| Item | Valor base | Unidade |
|---|---|---|
| Alimentação | R$ 80 | pessoa |
| Transporte (Van) | R$ 500 | diária |
| Gasolina / Pedágio | R$ 6,37 | km/viagem |
| Hospedagem | R$ 300 | noite |
| Passagem Aérea | null | trecho |
| Cenário | null | unidade |
| Locação | null | diária |
| Casting | null | unidade |
| Autorização de gravação | null | unidade |
| Bebidas, snacks & etc. | R$ 40 | pessoa |
| Aluguel de carro | R$ 400 | diária |
| Logística | null | unidade |
| Roupas | null | unidade |
| Catering | null | unidade |
| Estúdio | R$ 800 | diária |
| Internet dedicada | R$ 7.000 | evento |
| Painel de Led | R$ 8.500 | diária |
| Programação de jogos | R$ 3.000 | unidade |
| Produção de objetos | null | unidade |
| Segurança | R$ 400 | diária |
| Libras | R$ 500 | vídeo |
| Documentação | null | unidade |

### 3.7 Exportação PDF

Gera um PDF da versão ativa do orçamento com layout da Lumos:

**Estrutura do PDF:**
1. **Capa / Cabeçalho** — logo Lumos, dados da empresa (CNPJ, e-mail, telefone, site), data, código da proposta
2. **Identificação** — tabela com Projeto, Cliente, Contato, E-mail
3. **Briefing / Escopo** — campo livre (observações para o cliente)
4. **Tabela de itens** — agrupada por Equipe / Equipamentos / Edição / Produção. Colunas: Item, Qtd, Unidade, Valor unitário, Total. Subtotal por grupo ao final de cada seção.
5. **Resumo financeiro** — só o valor total cobrado (sem margem, sem custo real, sem overhead)
6. **Condições comerciais** — condições de pagamento, validade da proposta, cláusulas padrão (cancelamento 70%, remarcação 48h/R$2.000, juros 1%a.m.)
7. **Campo de assinatura** — linha para assinatura do cliente, nome, cargo, data / linha para assinatura Lumos

**Regra crítica:** nunca exibir no PDF os campos `unit_cost`, `margin_pct`, `overhead`, `lucro`, `notes_internal`.

**Numeração:** `PROPOSTA · LUMOS · [code] · v[version_number]` ex: `PROPOSTA · LUMOS · 0192 · v1`

**Identidade visual do PDF:** fundo branco, texto preto, cabeçalho com logo Lumos, linha divisória em `#EFC700`, tipografia Poppins. Layout sóbrio e profissional — sem blocos coloridos. Referência: proposta Sicredi/Jotacom (0192).

---

## 4. Modelo de dados (Supabase / Postgres)

### 4.1 Enums

```sql
CREATE TYPE budget_category AS ENUM ('digital', 'filme', 'live');
CREATE TYPE budget_status AS ENUM ('rascunho', 'em_negociacao', 'aprovado', 'reprovado');
CREATE TYPE item_group AS ENUM ('equipe', 'equipamentos', 'edicao', 'producao');
CREATE TYPE unit_label AS ENUM ('diaria', 'hora', 'video', 'unidade', 'pacote', 'pessoa', 'noite', 'trecho', 'km', 'evento');
```

### 4.2 Tabelas

```sql
-- Clientes
CREATE TABLE clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  contact_name text,
  email       text,
  phone       text,
  notes       text,
  created_at  timestamptz DEFAULT now()
);

-- Orçamentos (container)
CREATE TABLE budgets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid REFERENCES clients(id),
  code              text UNIQUE NOT NULL, -- ex: '0192'
  project_name      text NOT NULL,
  category          budget_category NOT NULL,
  status            budget_status NOT NULL DEFAULT 'rascunho',
  active_version_id uuid, -- FK para budget_versions (adicionado após criar a tabela)
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Versões de orçamento
CREATE TABLE budget_versions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id            uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  version_number       integer NOT NULL DEFAULT 1,
  margin_pct           numeric NOT NULL DEFAULT 0.40,
  nf_pct               numeric NOT NULL DEFAULT 0.18,
  lumos_overhead_pct   numeric NOT NULL DEFAULT 0.10,
  discount_value       numeric NOT NULL DEFAULT 0,
  notes_internal       text,
  notes_client         text,
  payment_terms        text DEFAULT '60 dias após emissão da NF',
  validity_days        integer DEFAULT 7,
  created_at           timestamptz DEFAULT now(),
  created_by           uuid REFERENCES auth.users(id),
  UNIQUE(budget_id, version_number)
);

-- FK circular (budgets → active_version)
ALTER TABLE budgets
  ADD CONSTRAINT budgets_active_version_fkey
  FOREIGN KEY (active_version_id) REFERENCES budget_versions(id) DEFERRABLE INITIALLY DEFERRED;

-- Itens de cada versão
CREATE TABLE budget_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       uuid NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  catalog_item_id  uuid REFERENCES item_catalog(id), -- nullable = item avulso
  item_group       item_group NOT NULL,
  name             text NOT NULL,
  unit_cost        numeric NOT NULL DEFAULT 0,
  quantity         numeric NOT NULL DEFAULT 1,
  unit_label       text NOT NULL DEFAULT 'diaria',
  override_margin  numeric, -- nullable: sobrescreve margin_pct da versão
  sort_order       integer NOT NULL DEFAULT 0
);

-- Catálogo de itens
CREATE TABLE item_catalog (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_group        item_group NOT NULL,
  subcategory       text,
  name              text NOT NULL,
  default_unit_cost numeric, -- null = "a definir"
  unit_label        text NOT NULL DEFAULT 'diaria',
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz DEFAULT now()
);
```

### 4.3 Índices úteis

```sql
CREATE INDEX idx_budgets_client ON budgets(client_id);
CREATE INDEX idx_budgets_status ON budgets(status);
CREATE INDEX idx_budget_versions_budget ON budget_versions(budget_id);
CREATE INDEX idx_budget_items_version ON budget_items(version_id);
CREATE INDEX idx_item_catalog_group ON item_catalog(item_group) WHERE is_active = true;
```

### 4.4 Trigger: updated_at automático

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budgets_updated_at
  BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 4.5 Gerador de código sequencial

```sql
CREATE SEQUENCE budget_code_seq START 1;

CREATE OR REPLACE FUNCTION next_budget_code()
RETURNS text AS $$
BEGIN
  RETURN LPAD(nextval('budget_code_seq')::text, 4, '0');
END;
$$ LANGUAGE plpgsql;
```

Usar `next_budget_code()` ao criar novo orçamento.

---

## 5. Lógica financeira (frontend)

Todos os cálculos são feitos no cliente em tempo real. **Nunca salvar totais calculados no banco.**

```typescript
interface VersionFinancials {
  custoEquipe: number;
  custoEquipamentos: number;
  custoEdicao: number;
  custoProducao: number;
  totalCusto: number;
  overhead: number;
  basePreco: number;
  valorSemNF: number;
  valorComNF: number;
  valorFinal: number;
  lucro: number;
  margemReal: number; // percentual
}

function calcFinancials(items: BudgetItem[], version: BudgetVersion): VersionFinancials {
  const sum = (group: string) =>
    items
      .filter(i => i.item_group === group)
      .reduce((acc, i) => acc + i.unit_cost * i.quantity, 0);

  const custoEquipe        = sum('equipe');
  const custoEquipamentos  = sum('equipamentos');
  const custoEdicao        = sum('edicao');
  const custoProducao      = sum('producao');
  const totalCusto         = custoEquipe + custoEquipamentos + custoEdicao + custoProducao;

  const overhead    = totalCusto * version.lumos_overhead_pct;
  const basePreco   = totalCusto + overhead;

  // markup sobre margem: preco = custo / (1 - margem)
  const valorSemNF  = basePreco / (1 - version.margin_pct);
  // gross-up NF
  const valorComNF  = valorSemNF / (1 - version.nf_pct);
  const valorFinal  = valorComNF - version.discount_value;

  const lucro       = valorFinal - totalCusto - overhead;
  const margemReal  = valorFinal > 0 ? (lucro / valorFinal) * 100 : 0;

  return {
    custoEquipe, custoEquipamentos, custoEdicao, custoProducao,
    totalCusto, overhead, basePreco, valorSemNF, valorComNF,
    valorFinal, lucro, margemReal
  };
}
```

**Alerta de margem:** exibir warning visual se `margemReal < 30`.

---

## 6. Regras de negócio críticas

### Versionamento
- Orçamentos com status `rascunho` → editáveis diretamente, sem criar nova versão
- Orçamentos com status `em_negociacao` ou `aprovado` → ao editar, criar nova `budget_version` com `version_number + 1`, copiar todos os `budget_items` da versão anterior. A versão anterior torna-se imutável.
- `budgets.active_version_id` sempre aponta para a versão mais recente
- "Reprovado" pode ser editado livremente (volta para rascunho)

### Código do orçamento
- Sequência global de 4 dígitos com zero-padding: `0001`, `0002`...
- Gerado automaticamente via `next_budget_code()`, mas editável pelo usuário antes de salvar

### Itens avulsos vs catálogo
- `catalog_item_id = null` → item avulso (nome e valor digitados livremente)
- `catalog_item_id != null` → item do catálogo (nome copiado, custo padrão pré-preenchido mas editável)
- `item_group` é sempre obrigatório, independente da origem

### PDF — dados ocultos
Nunca exibir no PDF: `unit_cost` individual, `margin_pct`, `nf_pct`, `lumos_overhead_pct`, `lucro`, `margemReal`, `notes_internal`. O PDF exibe apenas: nome do item, quantidade, unidade, e o valor proporcional cobrado ao cliente.

---

## 7. Rotas da aplicação

```
/login                    → tela de autenticação
/                         → dashboard (lista de orçamentos)
/clientes                 → listagem de clientes
/clientes/[id]            → perfil do cliente + histórico
/orcamentos/novo          → criar novo orçamento
/orcamentos/[id]          → editor do orçamento (versão ativa)
/orcamentos/[id]/v[n]     → versão específica (read-only se não for ativa)
/catalogo                 → biblioteca de itens (admin)
```

---

## 8. Componentes de UI principais

| Componente | Descrição |
|---|---|
| `BudgetEditor` | Tela principal. Header do orçamento + 4 grupos de itens + painel financeiro |
| `ItemGroup` | Seção expansível de um grupo (Equipe/Equipamentos/Edição/Produção) com lista de itens e botão de adicionar |
| `ItemRow` | Linha de item editável: nome, custo, qtd, unidade, ações |
| `AddItemModal` | Modal de busca no catálogo + opção de item avulso |
| `FinancialPanel` | Painel lateral ou inferior com todos os totais em tempo real |
| `VersionSelector` | Dropdown com histórico de versões do orçamento |
| `StatusBadge` | Badge colorido de status (Rascunho/Em negociação/Aprovado/Reprovado) |
| `ClientSelect` | Combobox de seleção/criação de cliente |
| `BudgetCard` | Card do dashboard com resumo do orçamento |
| `PDFExport` | Componente de geração do PDF da proposta |

---

## 9. Status — cores e comportamento

| Status | Cor | Comportamento ao editar |
|---|---|---|
| Rascunho | Cinza `#666` | Edição direta |
| Em negociação | Amarelo `#EFC700` | Cria nova versão |
| Aprovado | Verde `#22c55e` | Cria nova versão |
| Reprovado | Vermelho `#ef4444` | Edição direta (volta p/ rascunho) |

---

## 10. Seed data — script SQL

O banco deve ser populado com o catálogo de itens ao fazer deploy. Ver seção 3.6 para a lista completa. Estrutura do insert:

```sql
INSERT INTO item_catalog (item_group, subcategory, name, default_unit_cost, unit_label) VALUES
-- Equipe
('equipe', 'Direção', 'Diretor (Small)', 1200, 'diaria'),
('equipe', 'Direção', 'Diretor (Publi)', 3000, 'diaria'),
('equipe', 'Direção', 'Diretor de Fotografia', 3000, 'diaria'),
('equipe', 'Direção', 'Diretor de Arte', 500, 'diaria'),
('equipe', 'Direção', 'Roteirista', 200, 'diaria'),
('equipe', 'Captação', 'Cinegrafista', 1000, 'diaria'),
('equipe', 'Captação', 'Fotógrafo', 1000, 'diaria'),
('equipe', 'Captação', 'Piloto de Drone FPV', 3000, 'diaria'),
('equipe', 'Captação', 'Op. de TP', 800, 'diaria'),
('equipe', 'Captação', 'DTV', 1000, 'diaria'),
('equipe', 'Captação', 'Logger', 500, 'diaria'),
('equipe', 'Som', 'Áudio', 1000, 'diaria'),
('equipe', 'Iluminação', 'Gaffer', 700, 'diaria'),
('equipe', 'Pós-produção', 'Editor', 1800, 'diaria'),
('equipe', 'Pós-produção', 'Editor (CGI)', 15000, 'diaria'),
('equipe', 'Pós-produção', 'Motion Designer', 700, 'diaria'),
('equipe', 'Pós-produção', 'Colorista', 900, 'diaria'),
('equipe', 'Live / Transmissão', 'VMix', 1000, 'diaria'),
('equipe', 'Live / Transmissão', 'Social Media Manager', 2000, 'diaria'),
('equipe', 'Produção', 'Produtor', 1000, 'diaria'),
('equipe', 'Produção', 'Coordenador', 1500, 'diaria'),
('equipe', 'Produção', 'Assist. de produção', 550, 'diaria'),
('equipe', 'Produção', 'Atendimento', 400, 'diaria'),
('equipe', 'Produção', 'Coord. de pós-produção', null, 'diaria'),
('equipe', 'Arte / Elenco', 'Figurinista', 800, 'diaria'),
('equipe', 'Arte / Elenco', 'Maquiadora', 1000, 'diaria'),
('equipe', 'Arte / Elenco', 'Contra-Regra', 500, 'diaria'),
('equipe', 'Arte / Elenco', 'Segurança', 300, 'diaria'),
('equipe', 'Outros', 'Locução', 300, 'diaria'),
('equipe', 'Outros', 'Intérprete / Tradutor', null, 'diaria'),
('equipe', 'Outros', 'DJ / Sonoplasta', null, 'diaria'),
-- Equipamentos
('equipamentos', null, 'FX3', 649, 'diaria'),
('equipamentos', null, 'FX30', 499, 'diaria'),
('equipamentos', null, 'BMPCC6K', 549, 'diaria'),
('equipamentos', null, 'Outra câmera', 549, 'diaria'),
('equipamentos', 'Lentes', 'Lente 16-35', 250, 'diaria'),
('equipamentos', 'Lentes', 'Lente 24-70', 250, 'diaria'),
('equipamentos', 'Lentes', 'Lente 70-200', 320, 'diaria'),
('equipamentos', 'Lentes', 'Outras lentes', 250, 'diaria'),
('equipamentos', 'Iluminação', 'Amaran 200x', 190, 'diaria'),
('equipamentos', 'Iluminação', 'Amaran 300c', 299, 'diaria'),
('equipamentos', 'Iluminação', 'Amaran 60x', 129, 'diaria'),
('equipamentos', 'Iluminação', 'Amaran T2C', 99, 'diaria'),
('equipamentos', 'Iluminação', 'Amaran T4C', 139, 'diaria'),
('equipamentos', 'Iluminação', 'Outra iluminação', 239, 'diaria'),
('equipamentos', 'Áudio', 'DJI Mic Lapela', 159, 'diaria'),
('equipamentos', 'Áudio', 'Deity S-Mic 2S Shotgun', 120, 'diaria'),
('equipamentos', 'Áudio', 'Zoom H6', 179, 'diaria'),
('equipamentos', 'Áudio', 'Kit Podcast', 1290, 'diaria'),
('equipamentos', 'Suporte', 'Ronin RS3PRO', 429, 'diaria'),
('equipamentos', null, 'DJI Mini 3 Pro', 449, 'diaria'),
('equipamentos', null, 'Insta360 X3 Câmera 360º', 399, 'diaria'),
('equipamentos', 'Iluminação', 'Softbox Aputure Light Dome II', 69, 'diaria'),
('equipamentos', 'Live', 'Atem Mini Pro', 350, 'diaria'),
('equipamentos', 'Suporte', 'Hydra Tilta', 600, 'diaria'),
('equipamentos', null, 'Bateria V-Mount', 299, 'diaria'),
('equipamentos', 'Live', 'Switcher VMix', 1000, 'diaria'),
('equipamentos', null, 'Sony NX5R', 420, 'diaria'),
('equipamentos', 'Live', 'Teradek Bolt 6 LT 750', 1000, 'diaria'),
('equipamentos', null, 'Rádios HT', 35, 'diaria'),
('equipamentos', null, 'Compania do TP', 800, 'diaria'),
('equipamentos', 'Áudio', 'Allen & Heat SQ 5', 600, 'diaria'),
('equipamentos', null, 'Monitor', 250, 'diaria'),
('equipamentos', 'Live', 'Transmissão Sem-fio', 250, 'diaria'),
('equipamentos', 'Suporte', 'Easy-Rig', 300, 'diaria'),
('equipamentos', 'Suporte', 'Follow-Focus', 350, 'diaria'),
('equipamentos', null, 'HD ou SSD 2TB', 1300, 'diaria'),
('equipamentos', null, 'HD ou SSD 4TB', 2300, 'diaria'),
('equipamentos', 'Áudio', 'Microfone Lapela', 350, 'diaria'),
('equipamentos', null, 'Intercom', 1000, 'diaria'),
('equipamentos', 'Iluminação', 'Painel de Led 2.5m x 3m', 8000, 'diaria'),
('equipamentos', null, 'NoBreak', 350, 'diaria'),
-- Edição
('edicao', 'Pós-produção', 'Decupagem', null, 'video'),
('edicao', 'Pós-produção', 'Montagem e edição', null, 'video'),
('edicao', 'Pós-produção', 'Correção de cor', null, 'video'),
('edicao', 'Pós-produção', 'Motion graphics', null, 'video'),
('edicao', 'Pós-produção', 'Mixagem e masterização de áudio', null, 'video'),
('edicao', 'Pós-produção', 'Finalização', null, 'video'),
('edicao', 'Assets', 'Banco de imagens', 299, 'unidade'),
('edicao', 'Assets', 'Assets 3D', null, 'unidade'),
('edicao', 'Assets', 'Trilha original', 2500, 'unidade'),
('edicao', 'Pacote', 'Pacote de pós-produção', null, 'pacote'),
-- Produção
('producao', null, 'Alimentação', 80, 'pessoa'),
('producao', null, 'Transporte (Van)', 500, 'diaria'),
('producao', null, 'Gasolina / Pedágio', 6.37, 'km'),
('producao', null, 'Hospedagem', 300, 'noite'),
('producao', null, 'Passagem Aérea', null, 'trecho'),
('producao', null, 'Cenário', null, 'unidade'),
('producao', null, 'Locação', null, 'diaria'),
('producao', null, 'Casting', null, 'unidade'),
('producao', null, 'Autorização de gravação', null, 'unidade'),
('producao', null, 'Bebidas, snacks & etc.', 40, 'pessoa'),
('producao', null, 'Aluguel de carro', 400, 'diaria'),
('producao', null, 'Logística', null, 'unidade'),
('producao', null, 'Roupas', null, 'unidade'),
('producao', null, 'Catering', null, 'unidade'),
('producao', null, 'Estúdio', 800, 'diaria'),
('producao', null, 'Internet dedicada', 7000, 'evento'),
('producao', null, 'Painel de Led', 8500, 'diaria'),
('producao', null, 'Programação de jogos', 3000, 'unidade'),
('producao', null, 'Produção de objetos', null, 'unidade'),
('producao', null, 'Segurança', 400, 'diaria'),
('producao', null, 'Libras', 500, 'video'),
('producao', null, 'Documentação', null, 'unidade');
```

---

## 11. Notas de implementação

- **Formatação monetária:** usar `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` em todo o frontend
- **Decimais:** arredondar exibição para 2 casas — nunca exibir `R$ 1.782,539999`
- **Supabase RLS:** habilitar Row Level Security em todas as tabelas. Política simples para MVP: usuários autenticados têm acesso total (`auth.uid() IS NOT NULL`)
- **PDF:** gerar client-side com `@react-pdf/renderer` para evitar dependência de servidor. Armazenar PDF gerado no Supabase Storage opcionalmente
- **Autosave:** implementar debounce de 1.5s no editor — salvar automaticamente ao parar de digitar
- **Toast notifications:** feedback visual em todas as ações de salvar, criar versão, exportar PDF

---

## PROMPT INICIAL PARA O ANTIGRAVITY

---

Crie uma aplicação web chamada **Lumos Budget Studio** — uma plataforma interna de orçamentos para a Produtora Lumos, empresa brasileira de produção audiovisual.

### Stack
- **Frontend:** React + Vite + Tailwind CSS
- **Backend/DB:** Supabase (Postgres + Auth)
- **PDF:** @react-pdf/renderer
- **Hosting:** Vercel

### Design system
Interface dark. Cores:
- Background principal: `#222222`
- Cards/superfícies: `#2a2a2a`
- Amarelo Lumos (acentos/CTAs): `#EFC700`
- Texto primário: `#FFFFFF`
- Texto secundário: `#999999`
- Bordas: `rgba(255,255,255,0.08)`
- Fontes: Poppins (headings) + Work Sans (body)
- Border radius: 8px

### Banco de dados — criar essas tabelas no Supabase:

**Enums:**
```sql
CREATE TYPE budget_category AS ENUM ('digital', 'filme', 'live');
CREATE TYPE budget_status AS ENUM ('rascunho', 'em_negociacao', 'aprovado', 'reprovado');
CREATE TYPE item_group AS ENUM ('equipe', 'equipamentos', 'edicao', 'producao');
```

**Tabelas:** `clients`, `budgets`, `budget_versions`, `budget_items`, `item_catalog` — com todas as colunas, FKs, índices, trigger de `updated_at` e função `next_budget_code()` conforme especificado no modelo de dados.

### Rotas
```
/login → autenticação Supabase
/ → dashboard com lista de orçamentos + filtros + KPIs
/clientes → listagem + perfil com histórico
/orcamentos/novo → criar orçamento
/orcamentos/[id] → editor completo
/catalogo → gerenciar biblioteca de itens
```

### Editor de orçamento
O editor tem: cabeçalho (código, projeto, cliente, categoria, status), 4 grupos de itens expansíveis (Equipe / Equipamentos / Edição / Produção), e painel financeiro em tempo real.

**Lógica financeira (calcular no frontend, nunca salvar no banco):**
```
overhead   = totalCusto × 0.10
basePreco  = totalCusto + overhead
valorSemNF = basePreco / (1 - margin_pct)    // markup sobre margem, padrão 40%
valorComNF = valorSemNF / (1 - nf_pct)       // gross-up NF, padrão 18%
valorFinal = valorComNF - discount_value
lucro      = valorFinal - totalCusto - overhead
margemReal = lucro / valorFinal × 100
```
Exibir alerta visual se `margemReal < 30%`.

### Versionamento
- Status `rascunho` e `reprovado`: editáveis diretamente
- Status `em_negociacao` e `aprovado`: ao editar, criar nova `budget_version` com `version_number + 1` e copiar todos os `budget_items`. Versão anterior torna-se imutável.

### PDF
Gerar PDF com `@react-pdf/renderer`. Layout Lumos (fundo branco, preto e amarelo `#EFC700` só em acentos e divisórias). Estrutura: cabeçalho com logo, identificação do projeto, briefing (notes_client), tabela de itens agrupada, valor total, condições comerciais, campo de assinatura. **Nunca exibir no PDF:** custo real, margem, overhead, lucro, notes_internal.

### Seed
Popular `item_catalog` com ~90 itens nos 4 grupos (equipe, equipamentos, edição, produção) com os valores base da planilha interna da Lumos.

### Outros requisitos
- Autosave com debounce de 1.5s no editor
- Formatação monetária em pt-BR (`Intl.NumberFormat`)
- Supabase RLS: usuários autenticados têm acesso total
- Sem cadastro público — usuários criados manualmente no Supabase dashboard
- Usuários MVP: Caio e Vinícius (sem hierarquia de permissões)

**Comece pelo setup do projeto (Vite + React + Tailwind + Supabase client), criação das tabelas no Supabase e implementação da autenticação. Depois siga para o dashboard e o editor de orçamento.**
