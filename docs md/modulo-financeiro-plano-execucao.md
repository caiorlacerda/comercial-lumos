# Módulo Financeiro — Plano de Execução
**Plataforma:** Intranet Lumos (`comercial-lumos` · React + Vite + Tailwind + Supabase + Vercel)
**Origem:** Documento "CFO | Revisões App — Melhorias e Requisitos · Módulo Financeiro"
**Objetivo macro:** transformar o Financeiro de um registro de lançamentos em uma **camada de inteligência de rentabilidade**, capaz de responder em segundos: quanto faturamos, quanto lucramos, qual categoria/serviço/ICP é mais rentável e o que está atrasado.

---

## ⚠️ Política de deploy e validação (regra fixa — vale para todas as fases)

**Nada vai para produção sem validação prévia.**

- Toda alteração é desenvolvida e rodada **localmente** (Antigravity → `localhost`).
- Cada fase é **validada rodando de verdade em localhost** por Caio/Vinícius antes de seguir para a próxima.
- O deploy no **Vercel** (`produtoralumos.com.br`) só acontece **depois** da validação manual.
- **Migrations do Supabase:** testar primeiro em branch/ambiente de desenvolvimento. **Não** aplicar migration direto no projeto de produção (`byntpekyfhzwfihjhzuo`) antes de validar localmente. Idealmente usar uma branch do Supabase ou instância local.
- Regra prática: **codar → rodar local → validar → só então subir.** Nenhuma fase pula a validação.

---

## 0. Leitura geral do documento

O pedido inteiro gira em torno de uma ideia central: **toda movimentação financeira precisa ser "dimensionável"** — ou seja, cada custo, entrada e saída carrega vínculo com **Cliente**, **Categoria**, **Tipo de Serviço** e **ICP**. Sem isso, os relatórios das seções 7 e 8 não existem.

Por isso a execução não segue a ordem numérica do documento. A ordem técnica correta é:

1. **Fundação dimensional** (categorias, tipos de serviço, ICP, config de NF) — seções 3, 4, 5.
2. **Núcleo financeiro do projeto** (custos, margem, status) — seções 6 e 2.
3. **Lançamentos e dashboard mensal** — seção 1.
4. **Relatórios e filtros** — seções 7 e 8.
5. **Import de extrato com auto-distribuição** (futuro) — pergunta da seção 1.

---

## 1. Decisões fechadas (validadas com o Caio)

Estas decisões já estão **batidas** e devem ser seguidas à risca pelo Antigravity.

### 1.1 ✅ Fórmula de margem × NF — **decisão: B (margem líquida)**
A NF (18%) é tratada como **custo real** e entra no cálculo. A tela exibe **duas linhas** para o sócio enxergar o peso do imposto, e a margem em % é calculada sobre o **valor bruto vendido** (para comparar direto com os 40% do pricing comercial).

```
Receita Bruta      = valor_vendido
Valor NF           = valor_vendido × nf_percent
Receita Líquida    = valor_vendido − Valor NF
Lucro Operacional  = valor_vendido − Custos          (linha de referência, sem NF)
Lucro Líquido      = Receita Líquida − Custos        (lucro real, pós-NF)
Margem (%)         = Lucro Líquido / valor_vendido   (sobre o bruto vendido)
```

### 1.2 ✅ Snapshot do % de NF — **decisão: sim, congelado por projeto**
**Quando uma proposta é aprovada**, o percentual de NF vigente é **gravado dentro do projeto** (`nf_percent`). Alterar o default global depois afeta **apenas projetos novos**; projetos já aprovados preservam o percentual gravado.

### 1.3 ✅ Status — **decisão: campo único** (`status_titulo`)
Um único campo com os 5 estados sequenciais. Os filtros da seção 8 ("Status de NF" e "Status de Pagamento") agrupam sobre esse mesmo campo:

| Filtro pedido | Estados que cobre |
|---|---|
| Status de NF | `emitir_nf`, `pedido_nf_feito` |
| Status de Pagamento | `esperando_pagamento`, `pagamento_atraso`, `pagamento_recebido` |

Evita estados impossíveis (ex.: "NF emitida + esperando NF").

### 1.4 ✅ "Pagamento em Atraso" — **decisão: automático/derivado**
Ninguém marca atraso na mão. O sistema deriva o atraso quando `data_recebimento_negociada < hoje` e ainda não recebido. Implementado como coluna derivada na `vw_rentabilidade` (campo `vencido`).

### 1.5 ✅ Permissões — **decisão: opção A** + visão consolidada para o admin

| Recurso | admin/sócios | produção | básico |
|---|---|---|---|
| Lançamentos (entradas/saídas) | total | leitura | — |
| Custos de projeto | total | total (lança custos da produção) | — |
| **Margem / lucro** | total | **oculto** | — |
| Valor fechado do projeto | total | **oculto** | — |
| Dashboard de faturamento | total | parcial | — |

**Visão financeira consolidada (somente admin/sócios):** independentemente da regra acima, a tela financeira do projeto deve **consolidar em um único lugar**:
- valor total fechado do projeto,
- % e valor de NF,
- **todos os custos — inclusive os que a equipe de produção já lançou no módulo de Produção**,
- lucro (operacional e líquido) e margem.

> Ponto-chave: o financeiro **consome** os custos que a produção já preencheu (não recria do zero). O `custos_total` do projeto financeiro é alimentado pelos lançamentos do módulo de Produção. A produção continua lançando custo normalmente; o que ela **não** vê é a margem/lucro/valor fechado derivados.

---

## 2. Modelo de dados (Supabase — Postgres)

DDL de referência para o Antigravity gerar as migrations. Ajustar nomes às tabelas que já existem (clientes, propostas/orçamentos, controle de produção).

### 2.1 Dimensões (fundação)

```sql
-- Categoria mãe: Digital / Filme / Live
create table categorias (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,           -- 'Digital' | 'Filme' | 'Live'
  ordem       int default 0,
  ativo       boolean default true
);

-- Tipo de Serviço (filho da categoria). 'Cliente Mensal' aparece em mais de uma mãe,
-- por isso precisa de FK para a categoria — não pode ser enum global.
create table tipos_servico (
  id           uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references categorias(id),
  nome         text not null,
  ativo        boolean default true,
  unique (categoria_id, nome)
);

-- Config financeira global (default de NF e margem)
create table config_financeiro (
  id              int primary key default 1,
  nf_percent      numeric(5,4) not null default 0.18,  -- 18%
  margem_default  numeric(5,4) not null default 0.40,  -- 40%
  atualizado_em   timestamptz default now(),
  constraint single_row check (id = 1)
);
```

**Seed inicial (mapeamento das seções 3 e 4 já consolidado):**

| Categoria (mãe) | Tipos de Serviço (filhos) |
|---|---|
| Digital | Criação de Conteúdo · Cliente Mensal · Cursos · Serviço Individual · Cobertura de Eventos |
| Filme | Institucional · Publicidade · Comercial de TV |
| Live | Transmissão / Estrutura · Cliente Mensal |

> A lista "flat" da seção 4 é a **união** dos filhos acima — o modelo de 2 níveis resolve as seções 3 e 4 de uma vez. "Cliente Mensal" e "Cobertura de Eventos" são intencionalmente reutilizados entre mães.

ICP e status como enums:

```sql
create type icp_tipo as enum ('icp_1', 'icp_2');
create type status_titulo as enum (
  'emitir_nf', 'pedido_nf_feito', 'esperando_pagamento',
  'pagamento_atraso', 'pagamento_recebido'
);
```

### 2.2 Núcleo: financeiro do projeto (seção 6 + 2)

```sql
create table projetos_financeiro (
  id                          uuid primary key default gen_random_uuid(),
  proposta_id                 uuid references propostas(id),   -- origem (orçamento aprovado)
  cliente_id                  uuid not null references clientes(id),
  categoria_id                uuid references categorias(id),
  tipo_servico_id             uuid references tipos_servico(id),
  icp                         icp_tipo,                        -- preenchido à mão pós-aprovação

  valor_vendido               numeric(12,2) not null default 0,
  nf_percent                  numeric(5,4) not null,           -- SNAPSHOT gravado na aprovação (1.2)
  custos_total                numeric(12,2) not null default 0,-- consome custos da Produção (1.5)

  data_recebimento_negociada  date,                            -- preenchido à mão
  status_titulo               status_titulo not null default 'emitir_nf',
  data_recebido               date,

  origem                      text default 'auto_aprovacao',   -- ou 'manual'
  pendente_preenchimento      boolean default true,            -- liga a notificação
  created_at                  timestamptz default now()
);
```

> **`custos_total` não é digitado solto no financeiro.** Ele agrega os custos que a equipe de produção lançou no controle de Produção (vincular via `proposta_id`/projeto). O financeiro lê esses custos; quem edita o custo continua sendo a produção. Confirmar o nome/estrutura da tabela de custos de produção existente para amarrar o `sum()`.

**View de rentabilidade** (centraliza a fórmula da 1.1 — nunca recalcular na UI):

```sql
create view vw_rentabilidade as
select
  p.*,
  round(p.valor_vendido * p.nf_percent, 2)                          as valor_nf,
  round(p.valor_vendido * (1 - p.nf_percent), 2)                   as receita_liquida,
  round(p.valor_vendido - p.custos_total, 2)                       as lucro_operacional,
  round(p.valor_vendido * (1 - p.nf_percent) - p.custos_total, 2)  as lucro_liquido,
  case when p.valor_vendido > 0
       then round((p.valor_vendido*(1-p.nf_percent) - p.custos_total)
                  / p.valor_vendido, 4)
       else 0 end                                                   as margem,
  (p.status_titulo = 'esperando_pagamento'
     and p.data_recebimento_negociada < current_date)               as vencido
from projetos_financeiro p;
```

### 2.3 Lançamentos / fluxo de caixa (seção 1)

```sql
create table lancamentos_financeiros (
  id                    uuid primary key default gen_random_uuid(),
  tipo                  text not null check (tipo in ('entrada','saida')),
  valor                 numeric(12,2) not null,
  data                  date not null,
  descricao             text,

  cliente_id            uuid references clientes(id),
  categoria_id          uuid references categorias(id),
  tipo_servico_id       uuid references tipos_servico(id),
  projeto_financeiro_id uuid references projetos_financeiro(id),

  origem                text default 'manual',  -- 'manual' | 'import_extrato' | 'auto'
  created_at            timestamptz default now()
);

-- Resumo mensal (dashboard). Computado, não armazenado em duplicidade.
create view vw_resumo_mensal as
select
  date_trunc('month', data)::date                                   as mes,
  sum(valor) filter (where tipo = 'entrada')                        as entradas,
  sum(valor) filter (where tipo = 'saida')                          as saidas,
  sum(valor) filter (where tipo = 'entrada')
    - sum(valor) filter (where tipo = 'saida')                      as lucro
from lancamentos_financeiros
group by 1
order by 1;
```

> **Histórico dos meses anteriores (seção 1):** não precisa de tabela de snapshot — a `vw_resumo_mensal` já entrega todos os meses a partir dos lançamentos. Só criar `fechamento_mensal` se quiser **travar** meses fechados (imutáveis). Recomendo começar sem isso.

---

## 3. Detalhamento por requisito

### Seção 1 — Dashboard Financeiro
- Cards mensais: **Entradas · Saídas · Lucro** (`Lucro = Entradas − Saídas`) lidos da `vw_resumo_mensal`.
- Seletor de mês + série histórica (barras entradas/saídas + linha de lucro).
- **Remover custo fixo das saídas:** custo fixo recorrente **não** é lançado como saída manual (já vem no extrato → senão duplica). Tratar custo fixo só como parâmetro de projeção/margem, em tabela separada (`custos_fixos`, fora do fluxo de caixa real). Deixar claro na UI: "custo fixo ≠ lançamento de caixa".
- **Anexar extrato e distribuir sozinho:** ver Fase 4 (futuro).

### Seção 2 — Contas a Receber
- **Remover** recebimento parcial / lançamento manual de valores parciais (Lumos divide em títulos, não em parcelas).
- Campo `status_titulo` com os 5 estados (1.3).
- `pagamento_atraso` derivado automaticamente (1.4).

### Seções 3, 4, 5 — Categorias, Tipo de Serviço e ICP
- Modelo de 2 níveis (`categorias` → `tipos_servico`) + enum `icp`.
- UI: ao escolher a Categoria, o select de Tipo de Serviço filtra só os filhos daquela mãe.
- ICP é seleção simples (ICP 1 / ICP 2), preenchida pós-aprovação.

### Seção 6 — Custos de Projeto (núcleo)
- Tela espelhada do controle de **Produção**, porém com **valores inteiros do projeto** (não só produção): valor vendido, % NF (snapshot), custos, lucro operacional, lucro líquido e margem — tudo da `vw_rentabilidade`.
- **Visão consolidada (admin):** valor fechado + NF + custos (inclusive os da produção) + lucro + margem num lugar só (1.5).
- **OBS dimensional:** todo custo/entrada/saída referencia Cliente + Categoria/Serviço (garantido pelos FKs).
- **Automação na aprovação:** quando uma proposta/OS é aprovada, o app cria automaticamente o `projetos_financeiro` pré-preenchido com `valor_vendido` (total da proposta), `nf_percent` (snapshot do default atual) e `custos_total` (consumido da produção). Deixa **em branco** `icp`, `tipo_servico_id` e `data_recebimento_negociada`, marca `pendente_preenchimento = true` e **dispara notificação** pedindo o preenchimento.

### Seção 7 — Relatórios / Inteligência
Lucro por **Projeto · Cliente · Categoria · Tipo de Serviço · ICP**, todos lendo da `vw_rentabilidade` agregada.

### Seção 8 — Filtros globais
- **Obrigatórios:** Categoria · Tipo de Serviço · ICP.
- **Desejáveis:** Cliente · Período · Status de Pagamento · Status de NF (mapeados sobre `status_titulo`, 1.3).
- Estado global de filtro que alimenta todas as views de relatório.

---

## 4. Integração com módulos existentes

Dois ganchos críticos:

**A) Orçamento aprovado → cria projeto financeiro**
```
Orçamento (Equipe/Equipamentos/Produção/Pós) ──aprovação OS──▶
   cria projetos_financeiro
     · valor_vendido = total da proposta
     · nf_percent = SNAPSHOT do default atual (1.2)
     · custos_total = consumido do módulo de Produção
   ──▶ marca pendente_preenchimento + notifica
   ──▶ Caio/Vinícius completam ICP, Tipo de Serviço, data de recebimento
```

**B) Produção → Financeiro (custos)**
Os custos lançados pela equipe de produção no controle de Produção **alimentam** o `custos_total` do projeto financeiro (1.5). O financeiro não duplica esses custos — ele os referencia/soma. Confirmar a tabela de custos de produção existente para fechar o vínculo.

Implementar o gancho de aprovação no **handler da OS** (nível app), não em trigger de banco, para controlar payload e notificação.

---

## 5. Queries que respondem às perguntas de CEO

| Pergunta do CEO | Fonte |
|---|---|
| Quanto faturamos este mês? | `vw_resumo_mensal.entradas` (mês atual) |
| Quanto lucramos este mês? | `vw_resumo_mensal.lucro` |
| Qual categoria gera mais lucro? | `vw_rentabilidade` agrupado por `categoria_id` |
| Quais serviços são mais rentáveis? | agrupado por `tipo_servico_id`, ordenado por `margem` |
| Qual ICP traz melhores resultados? | agrupado por `icp` |
| Quais projetos estão atrasados? | `vw_rentabilidade where vencido = true` |
| Margem de cada projeto | `vw_rentabilidade.margem` |
| Margem por categoria/serviço | `vw_rentabilidade` agregado por dimensão |

---

## 6. Plano de execução em fases

> Lembrete da política: **cada fase roda e é validada em localhost antes de subir.** Migrations testadas em dev antes de tocar no Supabase de produção.

### Fase 0 — Fundação dimensional
- [ ] Migrations: `categorias`, `tipos_servico`, `config_financeiro`, enums `icp_tipo` e `status_titulo`.
- [ ] Seed de categorias e tipos de serviço (tabela da 2.1).
- [ ] Tela de admin para gerenciar categorias/tipos.
- [ ] Aplicar RLS (1.5).
- [ ] **Validar em localhost. Não subir ainda.**

### Fase 1 — Custos de Projeto + Contas a Receber
- [ ] Migrations: `projetos_financeiro`, `vw_rentabilidade`.
- [ ] Vincular `custos_total` aos custos do módulo de Produção (integração B).
- [ ] Tela financeira consolidada do projeto (1.5): valor fechado, NF, custos, lucro operacional + líquido, margem.
- [ ] Campo de status + lógica de `vencido` automático.
- [ ] Gancho de aprovação da OS → cria projeto financeiro (snapshot de NF) + notificação.
- [ ] **Validar em localhost. Não subir ainda.**

### Fase 2 — Lançamentos + Dashboard mensal
- [ ] Migrations: `lancamentos_financeiros`, `vw_resumo_mensal`, `custos_fixos`.
- [ ] CRUD de entradas/saídas com vínculo dimensional obrigatório.
- [ ] Cards e gráficos do dashboard mensal + histórico.
- [ ] Remover custo fixo do fluxo de caixa (anti-duplicação).
- [ ] **Validar em localhost. Não subir ainda.**

### Fase 3 — Relatórios e Filtros
- [ ] Filtros globais (obrigatórios + desejáveis).
- [ ] Telas de lucro por projeto/cliente/categoria/serviço/ICP.
- [ ] Painel "respostas de CEO" (seção 5).
- [ ] **Validar em localhost. Só então deploy do conjunto no Vercel.**

### Fase 4 — Import de extrato com auto-distribuição *(futuro / pesquisa)*
1. Import de **CSV/OFX** do banco → `lancamentos_financeiros` (`origem='import_extrato'`).
2. **Regras de categorização** (memória de descrições → cliente/categoria), aprendendo com o histórico.
3. Camada de **IA opcional** sugerindo a dimensão de cada linha, com **revisão humana antes de salvar**. Nunca lançar automático sem confirmação.
> Fora do MVP. Depende das Fases 0–2 prontas.

---

## 7. Riscos e pontos de atenção
- **Deploy sem validação:** proibido (ver política no topo). Migrations só em produção após teste em dev.
- **Duplicação de saídas:** custo fixo no fluxo de caixa + extrato é o risco nº 1. Reforçar a separação na UI.
- **Custo duplicado produção × financeiro:** o financeiro consome o custo da produção; não recriar. Confirmar a tabela de origem.
- **Margem sem dimensão:** projeto criado na aprovação mas nunca completado (ICP/serviço em branco) some dos relatórios → notificação de `pendente_preenchimento` é obrigatória.
- **Snapshot de NF:** gravar no projeto na aprovação. Implementar como campo global mutável quebra o histórico.
- **Consistência de status:** único `status_titulo` evita estados impossíveis.

---

### Próximo passo
Seguir direto para a **Fase 0** (não depende de mais nenhuma decisão). Rodar em localhost, validar, e só então avançar.
