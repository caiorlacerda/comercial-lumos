# Portal do cliente: clareza de status (A) + base técnica (F) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refatorar o front do portal em módulos e acrescentar ao portal do cliente os blocos Saúde, Próximo marco, "O que precisamos de você" e Equipe do projeto, com aviso de 24 h à equipe antes de o cliente ver "Atenção" ou "Atrasado".

**Architecture:** O front deixa de ser um arquivo de 1.789 linhas e vira a pasta `src/pages/portal/`. O banco ganha 3 tabelas e 6 funções novas, todas separadas de `get_client_portal_v2`; só `portal_visao_projetos` é aberta a visitantes. A saúde é calculada por uma função única, recalculada de hora em hora por `pg_cron`, e a piora fica segurada por 24 h.

**Tech Stack:** Vite + React 19 + TypeScript + Tailwind (app interno), CSS em string (portal), Supabase (Postgres, RLS, `pg_cron`), `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-10-24-portal-clareza-status-design.md`

## Global Constraints

- **Não regredir o desktop (≥1024px)** do app interno; mudanças interativas são mobile-first.
- **SQL é rodado manualmente pelo Caio no Supabase.** A IA nunca roda SQL em produção nem toca `service_role`. Cada migration entregue como bloco para copiar. Nome `AAAAMMDDNN_descricao.sql` em `supabase/migrations/`. O banco **local** (container `supabase_db_proposta-lumos`, `psql -U postgres`) pode ser usado para testes.
- **Toda função nova:** `REVOKE ALL ... FROM PUBLIC, anon` logo após criar, e `GRANT EXECUTE` só a quem precisa. Só `portal_visao_projetos` é concedida a `anon`.
- **Notificações:** este evento é criado só por função do banco. **Não** chamar `notify()` no cliente (evita duplicidade). O tipo entra em `src/lib/notifications/events.ts`.
- **Tokens do design:** `lumos-*` no app interno; variáveis do próprio portal (`--luz`, `--fio`, `--meia-luz`, `--aprovado`, `--producao`) no portal. Nada de cores cruas.
- **Páginas continuam lazy:** `App.tsx` mantém `lazy(() => import('@/pages/PortalCliente'))`.
- **`git add` sempre com caminhos explícitos.** Nunca `git add -A`, `supabase/.temp`, `supabase/.branches`, `node_modules`.
- **Antes de dar um PR por pronto:** `npx tsc --noEmit -p . 2>&1 | grep -E "portal|Portal|producao/SecaoPortal"` sem linhas. (O `tsc` global tem erros antigos de módulos ausentes no `node_modules` da worktree; ignorar os que não são dos arquivos tocados.)
- **Merge só depois do OK do Caio:** `gh pr merge N --repo caiorlacerda/comercial-lumos --merge --delete-branch`.
- **Textos de tela em português do Brasil.**
- **Fuso:** datas "de hoje" no banco usam `America/Sao_Paulo`, não UTC.

## Mapa de arquivos

**PR 1 — refatoração (sem mudança visível)**
- Create `src/pages/portal/tipos.ts` — interfaces `Entrega`, `EscopoItem`, `FaseRaw`, `Projeto`, `Portal`, `Agenda`, `Gravacao`, `AbaProjeto`, `ABAS_PROJETO`.
- Create `src/pages/portal/motivos.ts` — `MOTIVOS`, `MOTIVO_GENERICO`, `motivoPedido`, `motivoCancelar`, `motivoAgenda`, `ESTADO`, `ESTADO_PEDIDO`, `MARCOS`.
- Create `src/pages/portal/armazenamento.ts` — `NOME_SALVO`, `EMAIL_SALVO`, `BILHETE`, `lerSalvo`, `gravarSalvo`, `apagarSalvo`.
- Create `src/pages/portal/formatacao.ts` — `dia`, `mesPorExtenso`, `dataPorExtenso`, `horario`, `noDia`, `duracaoTexto`, `mesDeHoje`, `quandoRelativo`, `nomeBonito`, `formato`, `linkZap`, `linkSlack`.
- Create `src/pages/portal/icones.tsx` — `Sol`, `Lua`, `IconeZap`, `IconeSlack`, `IconeMail`, `ChevronDown`, `IconeFechar`, `SetaMes`.
- Create `src/pages/portal/useJanela.ts`, `src/pages/portal/Calendario.tsx`.
- Create `src/pages/portal/PortalFrame.tsx` (fundo + `<style>` + tema, uma vez só) e `src/pages/portal/PortalErro.tsx` (ErrorBoundary).
- Create `src/pages/portal/abas/Inicio.tsx`, `abas/Atendimento.tsx`, `abas/BoasVindas.tsx`, `abas/projeto/Geral.tsx`, `abas/projeto/Entregas.tsx`, `abas/projeto/Diarias.tsx`, `abas/projeto/Arquivos.tsx`.
- Create `src/pages/portal/PortalCliente.tsx` (casca) e **Modify** `src/pages/PortalCliente.tsx` para só reexportar.
- Create `scripts/portal-harness.js` (roteiro de teste no navegador).

**PR 2 — banco (SQL que o Caio roda)**
- Create `supabase/migrations/2026102401_portal_clareza_tabelas.sql`
- Create `supabase/migrations/2026102402_portal_saude_funcoes.sql`
- Create `supabase/migrations/2026102403_portal_visao_projetos.sql`

**PR 3 — app interno**
- Modify `src/lib/notifications/events.ts` (novo tipo), `src/pages/ConfiguracoesAutomacoes.tsx` (nova automação).
- Create `src/components/producao/SecaoPortalProjeto.tsx`; **Modify** `src/pages/Projetos.tsx` (montar a seção); **Modify** `src/components/producao/PortalModal.tsx` (pendências do cliente inteiro).

**PR 4 — front do cliente**
- Create `src/pages/portal/useVisaoProjetos.ts`, `src/pages/portal/marcos.ts`, `src/pages/portal/projeto/Saude.tsx`, `ProximoMarco.tsx`, `Pendencias.tsx`, `EquipeProjeto.tsx`.
- Modify `src/pages/portal/tipos.ts`, `src/pages/portal/abas/projeto/Geral.tsx`, `src/pages/portal/abas/Inicio.tsx`, `src/pages/portalCliente.css.ts`.

**PR 5 — rotina automática**
- Create `supabase/migrations/2026102404_portal_saude_cron.sql`

---

# PR 1 — Refatoração do front (branch `refactor/portal-estrutura`)

Pré-requisito: `git fetch origin && git checkout -B refactor/portal-estrutura origin/main`. A referência de linhas abaixo é do `PortalCliente.tsx` de `origin/main` no commit `731c9505` (1.789 linhas). **Se o arquivo tiver mudado, refaça os `grep -n` do Task 1 e ajuste os intervalos.**

### Task 1: Roteiro de teste e linha de base

**Files:**
- Create: `scripts/portal-harness.js`

**Interfaces:**
- Produces: um snippet de console que, numa página do portal que acabou de falhar a rede, simula as respostas do banco, entra no portal e devolve um objeto com o estado da tela. Usado em todas as tarefas de verificação deste e do PR 4.

- [ ] **Step 1: Criar o roteiro**

```js
// scripts/portal-harness.js
// Como usar (sem tocar em produção):
//   VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=teste npx vite --port 5199 --strictPort
//   Abrir http://localhost:5199/portal/teste123 (aparece "Tentar de novo"), colar este arquivo no console.
// Devolve um objeto com o que a tela mostrou. Compare o resultado antes e depois de mexer.
(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const fake = {
    cliente: { nome: 'Cliente Teste' },
    portal: { show_financeiro: false, blocks: {}, exige_login: false },
    voce: null, abrir_projeto: null,
    projetos: [
      { id: 'p1', nome: 'Campanha Alfa', code: 'A', status: 'em_andamento', data_inicio: null, data_fim: '2026-11-20',
        entregas: [
          { file_name: 'video_um.mp4', versao: 1, status: 'EM_REVISAO_CLIENTE', largura: 1920, altura: 1080, client_decision: null, client_decided_by: null, client_decided_at: null, entregue_em: '2026-10-20T10:00:00', review_token: 'rev1', allow_download: false },
          { file_name: 'video_dois.mp4', versao: 2, status: 'APROVADO', largura: 1080, altura: 1920, client_decision: 'aprovado', client_decided_by: 'Ana', client_decided_at: '2026-10-21T10:00:00', entregue_em: '2026-10-19T10:00:00', review_token: 'rev2', allow_download: false },
        ],
        cronograma: [
          { etapa: 'em_progresso', n: 2, inicio: '2026-10-10', fim: '2026-10-25', prazo_cliente: null },
          { etapa: 'revisao_cliente', n: 1, inicio: null, fim: null, prazo_cliente: '2026-11-05' },
        ],
        stages: { em_progresso: 2, revisao_cliente: 1 },
        escopo: [{ rotulo: 'Reels', meta: 0, realizado: 3 }, { rotulo: 'Posts', meta: 4, realizado: 1 }],
        arquivos: [] },
      { id: 'p2', nome: 'Projeto Beta', code: 'B', status: 'em_andamento', data_inicio: null, data_fim: null, entregas: [], cronograma: [], stages: {}, escopo: [], arquivos: [] },
    ],
    contatos: [{ nome: 'Marina', email: 'marina@lumos.com', cargo: 'Atendimento', foto: null, whatsapp: '11999990000', slack: null }],
    financeiro: null,
    atividade: [{ tipo: 'entrega', projeto: 'Campanha Alfa', file_name: 'video_um.mp4', quando: '2026-10-20T10:00:00' }],
  };
  const visao = window.__visao || null; // PR 4: defina window.__visao antes de rodar para simular portal_visao_projetos
  const orig = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    const u = String(url);
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('rpc/get_client_portal_v2')) return json(fake);
    if (u.includes('rpc/portal_visao_projetos')) return json(visao);
    if (u.includes('rpc/portal_agenda')) return json({ antecedencia_dias: 2, dias: [], agendadas: [], pacote: null, pedidos: [] });
    if (u.includes('rpc/portal_capas')) return json([]);
    if (u.includes('rpc/')) return json(null);
    return orig(url, opts);
  };
  document.querySelector('button.botao')?.click();      // "Tentar de novo"
  await wait(1200);
  const campo = document.querySelector('input');          // tela "Como te chamamos?"
  if (campo) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(campo, 'Teste');
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    document.querySelector('button.botao').click();
    await wait(800);
  }
  const nav = () => [...document.querySelectorAll('nav.navegacao .link')];
  const out = {};
  out.abaInicial = nav().filter(b => b.getAttribute('aria-current') === 'true').map(b => b.textContent);
  nav()[1].click(); await wait(500);                       // Início
  out.inicio = !!document.querySelector('.chamada');
  out.projHref = document.querySelector('a.proj')?.getAttribute('href');
  document.querySelector('a.proj').click(); await wait(500);       // abre Campanha Alfa
  out.projeto = document.querySelector('.cabeca-proj h2')?.textContent;
  out.escopo = [...document.querySelectorAll('.secao .proj')].map(e => e.textContent).join(' | ');
  out.nan = document.body.innerHTML.includes('NaN');
  out.etapas = [...document.querySelectorAll('.etapas .etapa')].map(e => e.className.replace('etapa ', '') + ':' + e.textContent).join(' | ');
  const abas = [...document.querySelectorAll('.fita-proj .link')];
  out.abasProjeto = abas.map(b => b.textContent);
  abas.find(b => b.textContent.startsWith('Entregas'))?.click(); await wait(300);
  out.entregas = document.querySelectorAll('a.quadro').length;
  abas.find(b => b.textContent.startsWith('Diárias'))?.click(); await wait(800);
  out.diarias = !!document.querySelector('.mes');
  nav()[3].click(); await wait(400);                       // Atendimento
  out.atendimento = document.querySelector('.pessoa .nm')?.textContent;
  nav()[0].click(); await wait(400);                       // Bem-vindo
  out.bemVindo = !!document.querySelector('.folha');
  return out;
})()
```

- [ ] **Step 2: Subir o servidor de teste e capturar a linha de base**

Run (em segundo plano): `VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=teste npx vite --port 5199 --strictPort`
Abrir `http://localhost:5199/portal/teste123` no painel de navegação, colar o conteúdo de `scripts/portal-harness.js` no console (`javascript_tool`) e **salvar o objeto devolvido** em `/private/tmp/claude-501/-Users-caiorizzuttl-Documents-LUMOS-proposta-lumos/b1b45fad-8ff5-4369-9169-da8f1a7cda8e/scratchpad/baseline-portal.json`.
Expected: `abaInicial: ["Bem-vindo à Lumos"]`, `inicio: true`, `projHref: "/portal/teste123?aba=p1"`, `projeto: "Campanha Alfa"`, `escopo: "Posts1 de 4"`, `nan: false`, `abasProjeto` com Visão geral, Entregas (com contador), Diárias; `entregas: 2`; `diarias: true`; `atendimento: "Marina"`; `bemVindo: true`.

- [ ] **Step 3: Commit**

```bash
git add scripts/portal-harness.js
git commit -m "test(portal): roteiro de navegador com respostas simuladas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: Extrair tipos, textos, armazenamento, formatação e ícones

**Files:**
- Create: `src/pages/portal/tipos.ts`, `motivos.ts`, `armazenamento.ts`, `formatacao.ts`, `icones.tsx`
- Modify: `src/pages/PortalCliente.tsx` (remover o que saiu e importar)

**Interfaces:**
- Produces: todos os nomes listados no mapa de arquivos, **com os mesmos nomes e assinaturas de hoje**, agora com `export`.

- [ ] **Step 1: Mapear as linhas atuais**

Run: `grep -n "^interface \|^type \|^const [A-Za-z_]* = \|^function " src/pages/PortalCliente.tsx | head -60`
Expected: as declarações listadas no mapa de arquivos, nas linhas citadas na seção PR 1 (tipos 21–94; `ESTADO`/`MARCOS`/`ESTADO_PEDIDO`/`MOTIVOS` ~97–157; armazenamento 160–174; ícones 176–236; formatação 243–318, `linkZap`/`linkSlack` 203–209).

- [ ] **Step 2: Gerar os arquivos copiando os trechos verbatim**

Para cada arquivo, copiar o intervalo exato com `sed -n 'A,Bp'` e acrescentar `export` na frente de cada declaração de nível superior. Exemplo para `tipos.ts`:

```bash
{
  echo "// Formatos que o portal recebe do banco. Movido de PortalCliente.tsx sem alterar."
  sed -n '21,94p' src/pages/PortalCliente.tsx
} > src/pages/portal/tipos.ts
sed -i '' -E 's/^(interface|type) /export \1 /; s/^const ABAS_PROJETO/export const ABAS_PROJETO/' src/pages/portal/tipos.ts
```

Repetir com os intervalos de cada módulo (`motivos.ts` = `ESTADO`, `MARCOS`, `ESTADO_PEDIDO`, `MOTIVOS`, `MOTIVO_GENERICO`, `motivoPedido`, `motivoCancelar`, `motivoAgenda`; `armazenamento.ts` = `NOME_SALVO`, `EMAIL_SALVO`, `BILHETE` (com o comentário "DE ONDE A PESSOA VEIO"), `lerSalvo`, `gravarSalvo`, `apagarSalvo`; `formatacao.ts` = o resto das funções puras e `linkZap`/`linkSlack`; `icones.tsx` = os componentes SVG, com `import` nenhum além do JSX automático).

Cabeçalhos de importação necessários:
- `motivos.ts`: nenhum.
- `formatacao.ts`: `import type { Gravacao } from './tipos';`
- `armazenamento.ts`: nenhum.
- `icones.tsx`: nenhum.
- `tipos.ts`: nenhum.

- [ ] **Step 3: Trocar no arquivo original**

Apagar do `PortalCliente.tsx` os trechos movidos e acrescentar no topo:

```ts
import type { Entrega, EscopoItem, FaseRaw, Projeto, Portal, Agenda, Gravacao, AbaProjeto } from './portal/tipos';
import { ABAS_PROJETO } from './portal/tipos';
import { ESTADO, ESTADO_PEDIDO, MARCOS, MOTIVO_GENERICO, motivoPedido, motivoCancelar, motivoAgenda } from './portal/motivos';
import { NOME_SALVO, EMAIL_SALVO, BILHETE, lerSalvo, gravarSalvo, apagarSalvo } from './portal/armazenamento';
import { dia, mesPorExtenso, dataPorExtenso, horario, noDia, duracaoTexto, mesDeHoje, quandoRelativo, nomeBonito, formato, linkZap, linkSlack } from './portal/formatacao';
import { Sol, Lua, IconeZap, IconeSlack, IconeMail, ChevronDown, IconeFechar, SetaMes } from './portal/icones';
```
(Ajustar para só importar o que ainda for usado; `tsc` reclama de importação sobrando com `noUnusedLocals`.)

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit -p . 2>&1 | grep -iE "portal"`
Expected: nenhuma linha.
Rodar o roteiro (Task 1, Step 2) e comparar com `baseline-portal.json`. Expected: objeto idêntico.

- [ ] **Step 5: Commit**

```bash
git add src/pages/portal/tipos.ts src/pages/portal/motivos.ts src/pages/portal/armazenamento.ts src/pages/portal/formatacao.ts src/pages/portal/icones.tsx src/pages/PortalCliente.tsx
git commit -m "refactor(portal): move tipos, textos, formatação e ícones para módulos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: Extrair `useJanela` e `Calendario`

**Files:**
- Create: `src/pages/portal/useJanela.ts`, `src/pages/portal/Calendario.tsx`
- Modify: `src/pages/PortalCliente.tsx`

**Interfaces:**
- Consumes: `mesDeHoje` de `./formatacao`, `SetaMes` de `./icones`.
- Produces: `export function useJanela(aberta: boolean, modalRef: React.RefObject<HTMLDivElement | null>, gatilhoRef: React.RefObject<HTMLButtonElement | null>, fechar: () => void): void` e `export default function Calendario(props: { dias: { data: string; estado: string }[]; suas: Record<string, string>; escolhido: string | null; onEscolher: (d: string, gatilho?: HTMLButtonElement) => void })`.

- [ ] **Step 1: Copiar os trechos**

```bash
{
  echo "import { useEffect, useRef } from 'react';"
  echo
  sed -n '448,494p' src/pages/PortalCliente.tsx   # comentário + function useJanela (confirmar o intervalo com grep)
} > src/pages/portal/useJanela.ts
sed -i '' 's/^function useJanela/export function useJanela/' src/pages/portal/useJanela.ts

{
  echo "import { useEffect, useMemo, useState } from 'react';"
  echo "import { mesDeHoje } from './formatacao';"
  echo "import { SetaMes } from './icones';"
  echo
  sed -n '320,446p' src/pages/PortalCliente.tsx   # SEMANA, MES_NOME e function Calendario (confirmar com grep)
} > src/pages/portal/Calendario.tsx
sed -i '' 's/^function Calendario/export default function Calendario/' src/pages/portal/Calendario.tsx
```
Confirmar os intervalos antes: `grep -n "^const SEMANA\|^function Calendario\|^function useJanela\|^function PortalClienteConteudo" src/pages/PortalCliente.tsx`.

- [ ] **Step 2: Importar no original e apagar os trechos**

```ts
import Calendario from './portal/Calendario';
import { useJanela } from './portal/useJanela';
```

- [ ] **Step 3: Verificar** (`tsc` sem linhas de portal; roteiro idêntico ao baseline; o campo `diarias` continua `true`)

- [ ] **Step 4: Commit**

```bash
git add src/pages/portal/useJanela.ts src/pages/portal/Calendario.tsx src/pages/PortalCliente.tsx
git commit -m "refactor(portal): move calendário e hook de janela para módulos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: `PortalFrame` e `PortalErro`

**Files:**
- Create: `src/pages/portal/PortalFrame.tsx`, `src/pages/portal/PortalErro.tsx`
- Modify: `src/pages/PortalCliente.tsx`

**Interfaces:**
- Produces: `export default function PortalFrame(props: { tema: 'escuro' | 'claro'; children: ReactNode; centralizado?: boolean; padding?: number; fundo?: boolean }): JSX.Element` — renderiza `<div className="portal-lumos [claro]">`, o `<FundoDeck>` e **um único** `<style>{PORTAL_CSS}</style>`. E `export default class PortalErro` (o mesmo ErrorBoundary de hoje).

- [ ] **Step 1: Criar `PortalFrame.tsx`**

```tsx
import type { ReactNode } from 'react';
import FundoDeck from '@/components/common/FundoDeck';
import { PORTAL_CSS } from '../portalCliente.css';

/** A moldura do portal: fundo, folha de estilo e tema, escritos uma vez só.
 *  Antes, cada tela (erro, entrada, nome, carregando, portal) repetia isto. */
export default function PortalFrame({ tema, children, centralizado = false, padding, fundo = true }: {
  tema: 'escuro' | 'claro';
  children: ReactNode;
  /** Centraliza o conteúdo na tela inteira (telas de erro, entrada e carregando). */
  centralizado?: boolean;
  padding?: number;
  /** O ErrorBoundary não monta o fundo animado para não repetir um erro dele. */
  fundo?: boolean;
}) {
  return (
    <div className={`portal-lumos ${tema === 'claro' ? 'claro' : ''}`}
      style={centralizado ? { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding } : undefined}>
      {fundo && <div className="fundo-portal" aria-hidden><FundoDeck tema={tema === 'claro' ? 'light' : 'dark'} /></div>}
      <style>{PORTAL_CSS}</style>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Criar `PortalErro.tsx`** — mover a classe `PortalErro` de `PortalCliente.tsx` (linhas ~1763–1785, comentário incluso) trocando o `<div className=...><style>` pelo `PortalFrame`:

```tsx
import { Component } from 'react';
import type { ReactNode } from 'react';
import PortalFrame from './PortalFrame';
import { lerSalvo } from './armazenamento';

/** Se qualquer parte da tela quebrar, o cliente vê um aviso com saída em vez de
 *  uma página em branco. */
export default class PortalErro extends Component<{ children: ReactNode }, { quebrou: boolean }> {
  state = { quebrou: false };
  static getDerivedStateFromError() { return { quebrou: true }; }
  componentDidCatch(erro: unknown) { console.error('[portal] erro de tela', erro); }
  render() {
    if (!this.state.quebrou) return this.props.children;
    const tema = lerSalvo('portal_tema') === 'claro' ? 'claro' : 'escuro';
    return (
      <PortalFrame tema={tema} centralizado padding={24} fundo={false}>
        <div style={{ textAlign: 'center' }} role="alert">
          <p className="rotulo">Algo deu errado ao mostrar o portal.</p>
          <button type="button" className="botao" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      </PortalFrame>
    );
  }
}
```

- [ ] **Step 3: Usar o `PortalFrame` nas cinco telas do `PortalCliente.tsx`** (erro, login, "Como te chamamos?", carregando e o portal). Cada `<div className={`portal-lumos ...`}> <div className="fundo-portal" ...> <style>{PORTAL_CSS}</style> ...` vira `<PortalFrame tema={tema} centralizado ...>...</PortalFrame>`. Para o portal principal, sem `centralizado`. Remover os imports `PORTAL_CSS` e `FundoDeck` do arquivo original (manter `LOGO_LUMOS` e `LOGO_LUMOS_ESCURO`).

- [ ] **Step 4: Verificar** — `tsc`; roteiro idêntico ao baseline; confirmar no navegador que há **um** `<style>` do portal: `document.querySelectorAll('style').length` não aumenta ao trocar de tela.

- [ ] **Step 5: Commit**

```bash
git add src/pages/portal/PortalFrame.tsx src/pages/portal/PortalErro.tsx src/pages/PortalCliente.tsx
git commit -m "refactor(portal): moldura única (fundo, estilo, tema) e ErrorBoundary em módulo

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5: Mover as Diárias para a própria aba

**Files:**
- Create: `src/pages/portal/abas/projeto/Diarias.tsx`
- Modify: `src/pages/PortalCliente.tsx`

**Interfaces:**
- Consumes: `Calendario`, `useJanela`, `noDia`, `horario`, `dia`, `dataPorExtenso`, `mesPorExtenso`, `mesDeHoje`, `duracaoTexto`, `ESTADO_PEDIDO`, `MOTIVO_GENERICO`, `motivoPedido`, `motivoCancelar`, `motivoAgenda`, `gravarSalvo`, `lerSalvo`, `NOME_SALVO`, `EMAIL_SALVO`, `IconeFechar`, tipos `Agenda`, `Gravacao`, `Projeto`, `Portal`.
- Produces: `export default function Diarias(props: { token: string; projeto: Projeto; voce: Portal['voce']; nome: string; exigeLogin: boolean }): JSX.Element`. Contém **todo** o estado e as funções de diárias (`agenda`, `carregandoAgenda`, `erroAgenda`, `geracaoAgenda`, `dataEscolhida`, `gravacaoAberta`, `abrirGravacao`, `baixarOrdemPdf`, `abrirPedido`, `pacoteDaData`, campos do pedido, `enviarPedido`, `cancelarPedido`) e o JSX hoje em `{abaProj === 'diarias' && (...)}`.

- [ ] **Step 1: Mapear** — `grep -n "Diárias: agenda do projeto aberto\|const cancelarPedido\|abaProj === 'diarias'\|abaProj === 'arquivos'" src/pages/PortalCliente.tsx`. O bloco de estado/funções vai de `// ── Diárias: agenda do projeto aberto` até o fim de `cancelarPedido`; o JSX vai de `{abaProj === 'diarias' && (` até o `)}` antes de `{abaProj === 'arquivos' ...`.

- [ ] **Step 2: Criar `Diarias.tsx`**

Estrutura (o corpo é o código movido sem alteração, com estas únicas mudanças):
1. `projetoAberto` passa a ser a prop `projeto`; `dados.voce` passa a ser a prop `voce`; `token`, `nome`, `exigeLogin` vêm de props.
2. O `useEffect` que busca a agenda perde a condição `abaProj !== 'diarias'` (o componente só existe quando a aba está aberta) e depende de `[projeto.id, token, exigeLogin]`.
3. O `useEffect(() => { setDataEscolhida(null); ... }, [abaProj, projetoAberto?.id])` some (o remonte já zera). Manter o `useEffect(() => { setErroPedido(null); }, [dataEscolhida])`.
4. `pedNome` inicial = `nome`; manter o efeito que o sincroniza enquanto `pedNomeTocado.current` for falso.

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Calendario from '../../Calendario';
import { useJanela } from '../../useJanela';
import type { Agenda, Gravacao, Portal, Projeto } from '../../tipos';
// ...demais imports de formatacao, motivos, armazenamento, icones listados em Interfaces

export default function Diarias({ token, projeto, voce, nome, exigeLogin }: {
  token: string; projeto: Projeto; voce: Portal['voce']; nome: string; exigeLogin: boolean;
}) {
  // [estado e funções movidos de PortalCliente.tsx, com projetoAberto -> projeto]
  return (
    <>
      {/* [JSX movido de {abaProj === 'diarias' && (...)}, sem o condicional externo] */}
    </>
  );
}
```
O JSX do bloco `erroAgenda ? ... : ...` fica como está dentro do `return`.

- [ ] **Step 3: No `PortalCliente.tsx`**, substituir o bloco por `{abaProj === 'diarias' && <Diarias token={token} projeto={projetoAberto} voce={dados.voce} nome={nome} exigeLogin={exigeLogin} />}` e apagar o estado movido (incluindo `gatilhoGravacaoRef`, `gravacaoModalRef`, `baixandoOrdemPdf`, `erroOrdemPdf`, `gatilhoPedidoRef`, `pedidoModalRef`, `pedDescricao`, `pedLocal`, `pedDuracao`, `pedNome`, `pedNomeTocado`, `pedEmail`, `enviandoPedido`, `enviandoRef`, `erroPedido`, `cancelandoId`, `erroCancelar`).

- [ ] **Step 4: Verificar** — `tsc`; roteiro idêntico (o campo `diarias` continua `true`). Teste manual extra: abrir Diárias, escolher um dia livre (simular `dias` no harness com `{data, estado:'livre'}`), conferir que o formulário abre, Esc fecha e o foco volta ao dia.

- [ ] **Step 5: Commit**

```bash
git add src/pages/portal/abas/projeto/Diarias.tsx src/pages/PortalCliente.tsx
git commit -m "refactor(portal): diárias viram componente próprio com o próprio estado

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6: Demais abas, casca e atalho de rota

**Files:**
- Create: `abas/Inicio.tsx`, `abas/Atendimento.tsx`, `abas/BoasVindas.tsx`, `abas/projeto/Geral.tsx`, `abas/projeto/Entregas.tsx`, `abas/projeto/Arquivos.tsx`, `src/pages/portal/PortalCliente.tsx` (casca)
- Modify: `src/pages/PortalCliente.tsx` → só reexporta

**Interfaces:**
- Produces (todas `export default function`, só apresentam, sem estado de rede):
  - `Inicio(props: { dados: Portal; esperando: (Entrega & { projeto: string })[]; capas: Record<string, string | null>; blocos: Record<string, boolean>; token: string; marcarVolta: () => void; irParaAba: (aba: string) => void })`
  - `Geral(props: { projeto: Projeto; blocos: Record<string, boolean> })`
  - `Entregas(props: { projeto: Projeto; capas: Record<string, string | null>; marcarVolta: () => void })`
  - `Arquivos(props: { projeto: Projeto })`
  - `Atendimento(props: { dados: Portal })`
  - `BoasVindas(props: { token: string; nome: string })`

- [ ] **Step 1:** Para cada aba, mover o JSX da seção correspondente (`{aba === 'inicio' && (...)}`, `{abaProj === 'geral' && ...}`, etc.) para o componente, trocando referências a variáveis do componente grande pelas props acima. Onde o JSX chama `setAba(p.id)`, usar `irParaAba(p.id)`.
- [ ] **Step 2:** Mover o restante de `PortalClienteConteudo` (carregar, URL, bilhete, tema, login, nome, cabeçalho, menu, capas) para `src/pages/portal/PortalCliente.tsx` (a casca), importando as abas, e exportar `default function PortalCliente()` já envolvido em `<PortalErro>`.
- [ ] **Step 3:** Substituir `src/pages/PortalCliente.tsx` por:

```tsx
export { default } from './portal/PortalCliente';
```
- [ ] **Step 4: Verificar** — `wc -l src/pages/portal/PortalCliente.tsx` (esperado: abaixo de ~600); `tsc`; roteiro idêntico ao baseline; `npm run build` termina (`tsc && vite build`; se falhar só por módulos ausentes do `node_modules` da worktree, rodar o build no repositório principal ou instalar com `npm ci`).
- [ ] **Step 5: Commit, push, PR**

```bash
git add src/pages/portal src/pages/PortalCliente.tsx
git commit -m "refactor(portal): abas e casca em módulos; PortalCliente.tsx só reexporta

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin refactor/portal-estrutura
gh pr create --repo caiorlacerda/comercial-lumos --base main --head refactor/portal-estrutura --title "refactor(portal): quebra o front do portal em módulos (sem mudança visível)" --body "<corpo: o que foi movido, roteiro de comparação antes/depois, e a única diferença: rascunho de pedido de diária é limpo ao sair da aba Diárias>"
```
Aguardar o OK do Caio para mesclar.

---

# PR 2 — Banco (branch `feat/portal-saude-banco`, a partir de `origin/main`)

Todos os arquivos usam a guarda inicial abaixo (aborta se `is_team()` não existir) e terminam com conferências. Testar **antes** no banco local; só então entregar ao Caio.

### Task 7: Tabelas

**Files:**
- Create: `supabase/migrations/2026102401_portal_clareza_tabelas.sql`

**Interfaces:**
- Produces: `project_portal_saude`, `portal_pendencias`, `project_portal_equipe` com as colunas abaixo.

- [ ] **Step 1: Escrever a migration**

```sql
-- PORTAL DO CLIENTE: tabelas da clareza de status (saúde, pendências do cliente, equipe do projeto).
-- Spec: docs/superpowers/specs/2026-10-24-portal-clareza-status-design.md
DO $$
BEGIN
  IF to_regprocedure('public.is_team()') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102300_somente_equipe.sql (falta is_team()).';
  END IF;
END $$;

-- 1) Saúde: uma linha por projeto
CREATE TABLE IF NOT EXISTS public.project_portal_saude (
  project_id      uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  calculada       text CHECK (calculada IN ('no_prazo', 'atencao', 'atrasado')),
  exibida         text CHECK (exibida   IN ('no_prazo', 'atencao', 'atrasado')),
  motivo          text,
  calculada_desde timestamptz,
  liberar_em      timestamptz,
  liberada_por    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.project_portal_saude ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saude_equipe_le ON public.project_portal_saude;
CREATE POLICY saude_equipe_le ON public.project_portal_saude
  FOR SELECT TO authenticated USING ((SELECT public.is_team()));
-- Escrita só pelas funções do portal (SECURITY DEFINER).
GRANT SELECT ON public.project_portal_saude TO authenticated;
GRANT ALL ON public.project_portal_saude TO service_role;

-- 2) Pendências do cliente (project_id NULL = do cliente inteiro)
CREATE TABLE IF NOT EXISTS public.portal_pendencias (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  texto        text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 200),
  prazo        date,
  concluida_em timestamptz,
  created_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_pendencias_cliente_idx ON public.portal_pendencias (client_id, project_id);
ALTER TABLE public.portal_pendencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pendencias_equipe ON public.portal_pendencias;
CREATE POLICY pendencias_equipe ON public.portal_pendencias
  FOR ALL TO authenticated USING ((SELECT public.is_team())) WITH CHECK ((SELECT public.is_team()));
GRANT ALL ON public.portal_pendencias TO authenticated, service_role;

-- 3) Equipe que aparece no portal, por projeto
CREATE TABLE IF NOT EXISTS public.project_portal_equipe (
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  ordem       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, app_user_id)
);
ALTER TABLE public.project_portal_equipe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipe_portal_equipe ON public.project_portal_equipe;
CREATE POLICY equipe_portal_equipe ON public.project_portal_equipe
  FOR ALL TO authenticated USING ((SELECT public.is_team())) WITH CHECK ((SELECT public.is_team()));
GRANT ALL ON public.project_portal_equipe TO authenticated, service_role;

-- CONFERÊNCIA: as três tabelas existem, com RLS ligada, e o visitante não tem acesso direto.
SELECT c.relname, c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_le
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('project_portal_saude', 'portal_pendencias', 'project_portal_equipe')
ORDER BY 1;
-- Esperado: rls = true e anon_le = false nas três.

-- ROLLBACK (comentado)
-- DROP TABLE IF EXISTS public.project_portal_equipe, public.portal_pendencias, public.project_portal_saude;
```

- [ ] **Step 2: Rodar no banco local** — `docker exec -i supabase_db_proposta-lumos psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/2026102401_portal_clareza_tabelas.sql`
Expected: sem erro; conferência com `rls = t` e `anon_le = f` nas três linhas.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026102401_portal_clareza_tabelas.sql
git commit -m "feat(portal): tabelas de saúde, pendências do cliente e equipe do projeto

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 8: Funções da saúde

**Files:**
- Create: `supabase/migrations/2026102402_portal_saude_funcoes.sql`

**Interfaces:**
- Consumes: tabelas do Task 7; `public.is_team()`, `public.current_app_user_id()`, `public.automacao_ativa(text)`; tabelas `projects`, `project_tasks`, `client_portals`, `app_users`, `notifications`.
- Produces: `portal_saude_ordem(text) → int`, `portal_saude_calcular(uuid, OUT estado text, OUT motivo text)`, `portal_recalcular_saude(uuid DEFAULT NULL) → void`, `portal_saude_liberar(uuid) → void`.

- [ ] **Step 1: Escrever o teste primeiro (SQL de verificação), antes da migration**

Salvar em `/private/tmp/claude-501/-Users-caiorizzuttl-Documents-LUMOS-proposta-lumos/b1b45fad-8ff5-4369-9169-da8f1a7cda8e/scratchpad/teste-saude.sql`:

```sql
BEGIN;
-- Cenário: um cliente, um portal ativo, um usuário admin ativo, 6 projetos.
INSERT INTO clients (id, name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'Cliente Teste');
INSERT INTO client_portals (client_id, token, active) VALUES ('00000000-0000-0000-0000-0000000000c1', 'tok-teste-saude', true);
INSERT INTO app_users (id, full_name, email, role, status)
  VALUES ('00000000-0000-0000-0000-0000000000a1', 'Admin Teste', 'admin-teste@x.com', 'admin', 'ativo')
  ON CONFLICT DO NOTHING;
INSERT INTO projects (id, name, client_id, status, data_fim, portal_visivel) VALUES
  ('00000000-0000-0000-0000-0000000000b1'::uuid, 'P1 sem datas', '00000000-0000-0000-0000-0000000000c1', 'em_andamento', NULL, true),
  ('00000000-0000-0000-0000-0000000000b2'::uuid, 'P2 fim passou', '00000000-0000-0000-0000-0000000000c1', 'em_andamento', current_date - 2, true),
  ('00000000-0000-0000-0000-0000000000b3'::uuid, 'P3 fim em 2 dias com tarefa nossa', '00000000-0000-0000-0000-0000000000c1', 'em_andamento', current_date + 2, true),
  ('00000000-0000-0000-0000-0000000000b4'::uuid, 'P4 folgado', '00000000-0000-0000-0000-0000000000c1', 'em_andamento', current_date + 30, true),
  ('00000000-0000-0000-0000-0000000000b5'::uuid, 'P5 concluido', '00000000-0000-0000-0000-0000000000c1', 'concluido', current_date - 9, true),
  ('00000000-0000-0000-0000-0000000000b6'::uuid, 'P6 so espera cliente', '00000000-0000-0000-0000-0000000000c1', 'em_andamento', current_date + 30, true);
INSERT INTO project_tasks (project_id, titulo, status, data_fim, data_entrega_cliente) VALUES
  ('00000000-0000-0000-0000-0000000000b3', 't3', 'em_progresso', current_date + 1, NULL),
  ('00000000-0000-0000-0000-0000000000b4', 't4', 'em_progresso', current_date + 20, NULL),
  ('00000000-0000-0000-0000-0000000000b6', 't6', 'revisao_cliente', current_date - 5, current_date - 5);

SELECT p.name, (portal_saude_calcular(p.id)).estado AS estado
FROM projects p WHERE p.client_id = '00000000-0000-0000-0000-0000000000c1' ORDER BY p.name;
ROLLBACK;
```

- [ ] **Step 2: Escrever a migration**

```sql
-- PORTAL DO CLIENTE: cálculo da saúde do projeto, aviso à equipe e liberação para o cliente.
-- Piora é segurada por 24 h e avisa a equipe; melhora aparece na hora.
-- Spec: docs/superpowers/specs/2026-10-24-portal-clareza-status-design.md (seções 2 e 3)
DO $$
BEGIN
  IF to_regclass('public.project_portal_saude') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102401_portal_clareza_tabelas.sql.';
  END IF;
  IF to_regprocedure('public.automacao_ativa(text)') IS NULL
     OR to_regprocedure('public.current_app_user_id()') IS NULL THEN
    RAISE EXCEPTION 'Abortado: faltam automacao_ativa() ou current_app_user_id().';
  END IF;
END $$;

-- Ordem dos estados: sem indicador < no prazo < atenção < atrasado.
CREATE OR REPLACE FUNCTION public.portal_saude_ordem(p_estado text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_estado WHEN 'no_prazo' THEN 1 WHEN 'atencao' THEN 2 WHEN 'atrasado' THEN 3 ELSE 0 END
$$;

-- As regras, num lugar só. Para ajustar a calibragem, mexa aqui e em mais nenhum lugar.
CREATE OR REPLACE FUNCTION public.portal_saude_calcular(p_project_id uuid, OUT estado text, OUT motivo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hoje   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_fim    date;
  v_status text;
  v_nossas text[] := ARRAY['roteiro', 'captacao', 'em_progresso', 'revisao_interna', 'alteracoes'];
  v_n      integer;
BEGIN
  SELECT p.data_fim::date, p.status INTO v_fim, v_status FROM projects p WHERE p.id = p_project_id;
  IF NOT FOUND OR v_status IN ('concluido', 'cancelado', 'arquivado') THEN
    estado := NULL; motivo := 'Projeto encerrado ou inexistente'; RETURN;
  END IF;

  -- Atrasado: o fim do projeto passou, ou há entrega ao cliente vencida em etapa nossa.
  IF v_fim IS NOT NULL AND v_fim < v_hoje THEN
    estado := 'atrasado'; motivo := 'Data de fim do projeto (' || to_char(v_fim, 'DD/MM') || ') já passou'; RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM project_tasks t
  WHERE t.project_id = p_project_id AND t.deleted_at IS NULL AND t.status = ANY (v_nossas)
    AND t.data_entrega_cliente IS NOT NULL AND t.data_entrega_cliente::date < v_hoje;
  IF v_n > 0 THEN
    estado := 'atrasado'; motivo := v_n || ' tarefa(s) com prazo de entrega ao cliente vencido'; RETURN;
  END IF;

  -- Atenção: fim em até 3 dias com trabalho em etapa nossa, ou tarefa nossa com prazo estourado.
  IF v_fim IS NOT NULL AND v_fim <= v_hoje + 3 AND EXISTS (
       SELECT 1 FROM project_tasks t
       WHERE t.project_id = p_project_id AND t.deleted_at IS NULL AND t.status = ANY (v_nossas)) THEN
    estado := 'atencao'; motivo := 'Fim do projeto em ' || to_char(v_fim, 'DD/MM') || ' com trabalho ainda em etapa interna'; RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM project_tasks t
  WHERE t.project_id = p_project_id AND t.deleted_at IS NULL AND t.status = ANY (v_nossas)
    AND t.data_fim IS NOT NULL AND t.data_fim::date < v_hoje;
  IF v_n > 0 THEN
    estado := 'atencao'; motivo := v_n || ' tarefa(s) interna(s) com prazo estourado'; RETURN;
  END IF;

  -- No prazo: só quando há alguma data para sustentar a afirmação.
  IF v_fim IS NOT NULL OR EXISTS (
       SELECT 1 FROM project_tasks t
       WHERE t.project_id = p_project_id AND t.deleted_at IS NULL
         AND (t.data_fim IS NOT NULL OR t.data_entrega_cliente IS NOT NULL)) THEN
    estado := 'no_prazo'; motivo := 'Sem sinais de atraso'; RETURN;
  END IF;

  estado := NULL; motivo := 'Sem datas para avaliar';
END; $$;

-- Recalcula e aplica a regra das 24 h. Sem argumento, passa por todos os projetos do portal.
CREATE OR REPLACE FUNCTION public.portal_recalcular_saude(p_project_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r          RECORD;
  v_calc     RECORD;
  v_atual    project_portal_saude%ROWTYPE;
  v_piora    boolean;
  v_tem_portal boolean;
  v_avisar   boolean;
  v_rotulo   text;
  u          RECORD;
BEGIN
  -- O agendador roda sem usuário; quem estiver logado precisa ser da equipe.
  IF auth.uid() IS NOT NULL AND NOT public.is_team() THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;
  v_avisar := public.automacao_ativa('portal_saude_avisa');

  FOR r IN
    SELECT p.id, p.name, p.client_id, p.portal_visivel
    FROM projects p
    WHERE (p_project_id IS NULL OR p.id = p_project_id)
      AND (p.portal_visivel OR EXISTS (SELECT 1 FROM project_portal_saude s WHERE s.project_id = p.id))
  LOOP
    SELECT * INTO v_calc FROM public.portal_saude_calcular(r.id);
    INSERT INTO project_portal_saude (project_id) VALUES (r.id) ON CONFLICT DO NOTHING;
    SELECT * INTO v_atual FROM project_portal_saude WHERE project_id = r.id;

    v_piora := v_calc.estado IN ('atencao', 'atrasado')
               AND public.portal_saude_ordem(v_calc.estado) > public.portal_saude_ordem(v_atual.exibida);
    v_tem_portal := r.portal_visivel
                    AND EXISTS (SELECT 1 FROM client_portals cp WHERE cp.client_id = r.client_id AND cp.active);

    IF NOT v_piora OR NOT v_tem_portal THEN
      -- Igual, melhora, ou ninguém está olhando: o que o cliente vê acompanha o calculado.
      UPDATE project_portal_saude SET
        calculada = v_calc.estado, exibida = v_calc.estado, motivo = v_calc.motivo,
        calculada_desde = CASE WHEN calculada IS DISTINCT FROM v_calc.estado THEN now() ELSE calculada_desde END,
        liberar_em = NULL, updated_at = now()
      WHERE project_id = r.id;

    ELSIF v_atual.calculada IS DISTINCT FROM v_calc.estado OR v_atual.liberar_em IS NULL THEN
      -- Piora nova: segura por 24 h e avisa a equipe.
      UPDATE project_portal_saude SET
        calculada = v_calc.estado, motivo = v_calc.motivo, calculada_desde = now(),
        liberar_em = now() + interval '24 hours', liberada_por = NULL, updated_at = now()
      WHERE project_id = r.id;

      IF v_avisar THEN
        v_rotulo := CASE v_calc.estado WHEN 'atrasado' THEN 'Atrasado' ELSE 'Atenção' END;
        FOR u IN
          SELECT DISTINCT a.id FROM app_users a
          WHERE a.status = 'ativo'
            AND (a.role IN ('admin', 'atendimento')
                 OR a.id IN (SELECT unnest(cp.contact_user_ids) FROM client_portals cp
                             WHERE cp.client_id = r.client_id AND cp.active))
        LOOP
          INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
          VALUES (
            u.id, 'portal_saude_piora', 'producao', 'high',
            r.name || ' vai aparecer como ' || v_rotulo || ' para o cliente',
            'Em 24 horas o portal do cliente passa a mostrar "' || v_rotulo || '". Corrija a causa ou abra o projeto e clique em Mostrar agora.',
            '/producao/projetos?projectId=' || r.id::text,
            jsonb_build_object('project_id', r.id, 'estado', v_calc.estado)
          );
        END LOOP;
      END IF;

    ELSIF v_atual.liberar_em <= now() THEN
      -- Passaram as 24 h: o cliente passa a ver.
      UPDATE project_portal_saude SET
        exibida = v_calc.estado, motivo = v_calc.motivo, liberar_em = NULL, updated_at = now()
      WHERE project_id = r.id;

    ELSE
      UPDATE project_portal_saude SET motivo = v_calc.motivo, updated_at = now() WHERE project_id = r.id;
    END IF;
  END LOOP;
END; $$;

-- "Mostrar agora": a equipe libera já o que está segurado.
CREATE OR REPLACE FUNCTION public.portal_saude_liberar(p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_team() THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  UPDATE project_portal_saude
  SET exibida = calculada, liberar_em = NULL, liberada_por = public.current_app_user_id(), updated_at = now()
  WHERE project_id = p_project_id;
END; $$;

-- Permissões: nada para visitante; a equipe logada e o servidor executam.
REVOKE ALL ON FUNCTION public.portal_saude_ordem(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_saude_calcular(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_recalcular_saude(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.portal_saude_liberar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_saude_ordem(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_saude_calcular(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_recalcular_saude(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_saude_liberar(uuid) TO authenticated, service_role;

-- CONFERÊNCIA: nenhuma das quatro executa como visitante (anon_executa = false nas quatro).
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('portal_saude_ordem', 'portal_saude_calcular', 'portal_recalcular_saude', 'portal_saude_liberar')
ORDER BY 1;

-- ROLLBACK (comentado)
-- DROP FUNCTION IF EXISTS public.portal_saude_liberar(uuid), public.portal_recalcular_saude(uuid),
--   public.portal_saude_calcular(uuid), public.portal_saude_ordem(text);
```

- [ ] **Step 3: Rodar no local e rodar o teste do Step 1**

Run: `docker exec -i supabase_db_proposta-lumos psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/2026102402_portal_saude_funcoes.sql` e depois `docker exec -i supabase_db_proposta-lumos psql -U postgres < .../teste-saude.sql`.
Expected (estado por projeto): P1 sem datas = vazio; P2 fim passou = `atrasado`; P3 = `atencao`; P4 folgado = `no_prazo`; P5 concluído = vazio; P6 só espera do cliente = `no_prazo`.

- [ ] **Step 4: Testar as transições** (script no scratchpad, dentro de `BEGIN ... ROLLBACK`), com o mesmo cenário do Step 1:

```sql
-- piora segurada
SELECT portal_recalcular_saude('00000000-0000-0000-0000-0000000000b2');
SELECT exibida, calculada, liberar_em IS NOT NULL AS segurada FROM project_portal_saude WHERE project_id = '00000000-0000-0000-0000-0000000000b2';
-- Esperado: exibida NULL, calculada 'atrasado', segurada true; 1+ linha em notifications com event_type 'portal_saude_piora'
SELECT count(*) FROM notifications WHERE event_type = 'portal_saude_piora';
-- liberar agora (simulando equipe)
SET LOCAL ROLE postgres;
UPDATE project_portal_saude SET exibida = calculada, liberar_em = NULL WHERE project_id = '00000000-0000-0000-0000-0000000000b2';
-- expiração pelo prazo
UPDATE project_portal_saude SET exibida = NULL, liberar_em = now() - interval '1 minute' WHERE project_id = '00000000-0000-0000-0000-0000000000b2';
SELECT portal_recalcular_saude('00000000-0000-0000-0000-0000000000b2');
SELECT exibida FROM project_portal_saude WHERE project_id = '00000000-0000-0000-0000-0000000000b2';  -- 'atrasado'
-- melhora imediata
UPDATE projects SET data_fim = current_date + 30 WHERE id = '00000000-0000-0000-0000-0000000000b2';
SELECT portal_recalcular_saude('00000000-0000-0000-0000-0000000000b2');
SELECT exibida FROM project_portal_saude WHERE project_id = '00000000-0000-0000-0000-0000000000b2';  -- 'no_prazo' (sem tarefas = no_prazo pela data de fim)
-- visitante não executa
SET LOCAL ROLE anon;
SELECT portal_recalcular_saude();   -- Esperado: ERROR permission denied for function
```
Expected: cada comentário "Esperado" se confirma.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026102402_portal_saude_funcoes.sql
git commit -m "feat(portal): cálculo da saúde do projeto, aviso à equipe e liberação em 24h

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 9: Contexto de acesso e `portal_visao_projetos`

**Files:**
- Create: `supabase/migrations/2026102403_portal_visao_projetos.sql`

**Interfaces:**
- Consumes: tabelas do Task 7; `client_portals`, `client_users`, `client_user_projects`, `client_boas_vindas_itens`, `app_users`, `team_members`.
- Produces: `portal_contexto(p_token text, OUT o_erro text, OUT o_client_id uuid, OUT o_pessoa_id uuid, OUT o_restrito boolean, OUT o_mostrar_equipe boolean)` (interna) e `portal_visao_projetos(p_token text) → jsonb` com o formato:

```json
{
  "projetos": [{ "id": "uuid", "saude": { "estado": "no_prazo|atencao|atrasado" } , "pendencias": [{ "id": "uuid", "texto": "…", "prazo": "AAAA-MM-DD|null" }], "equipe": [{ "nome": "…", "funcao": "…|null", "foto": "…|null" }] }],
  "pendencias_cliente": [{ "id": "uuid", "texto": "…", "prazo": "…|null" }],
  "boas_vindas_pendentes": ["logo", "brand_book"]
}
```
Com erro, devolve `{ "error": "invalid" | "precisa_login" | "sem_acesso" }`. `saude` é `null` quando não há indicador.

- [ ] **Step 1: Escrever a migration**

```sql
-- PORTAL DO CLIENTE: o que o portal mostra de novo (saúde, pendências, equipe), separado de get_client_portal_v2.
-- Mesmas regras de acesso do portal: token ativo, login quando exigido, projetos restritos por pessoa.
DO $$
BEGIN
  IF to_regclass('public.portal_pendencias') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102401_portal_clareza_tabelas.sql.';
  END IF;
END $$;

-- Interna: resolve quem está olhando. Nunca exposta a visitante.
CREATE OR REPLACE FUNCTION public.portal_contexto(
  p_token text,
  OUT o_erro text, OUT o_client_id uuid, OUT o_pessoa_id uuid, OUT o_restrito boolean, OUT o_mostrar_equipe boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_email  text;
BEGIN
  o_restrito := false; o_mostrar_equipe := false;
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF NOT FOUND THEN o_erro := 'invalid'; RETURN; END IF;
  o_client_id := v_portal.client_id;
  o_mostrar_equipe := COALESCE(v_portal.mostrar_equipe, false);

  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_email = '' THEN o_erro := 'precisa_login'; RETURN; END IF;
    SELECT cu.id INTO o_pessoa_id FROM client_users cu
    WHERE cu.client_id = v_portal.client_id AND lower(cu.email) = v_email AND cu.ativo;
    IF o_pessoa_id IS NULL THEN o_erro := 'sem_acesso'; RETURN; END IF;
    o_restrito := EXISTS (SELECT 1 FROM client_user_projects cup WHERE cup.client_user_id = o_pessoa_id);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.portal_visao_projetos(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ctx RECORD;
  v_res jsonb;
BEGIN
  SELECT * INTO v_ctx FROM public.portal_contexto(p_token);
  IF v_ctx.o_erro IS NOT NULL THEN RETURN jsonb_build_object('error', v_ctx.o_erro); END IF;

  SELECT jsonb_build_object(
    'projetos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'saude', CASE WHEN s.exibida IS NULL THEN NULL ELSE jsonb_build_object('estado', s.exibida) END,
        'pendencias', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', pe.id, 'texto', pe.texto, 'prazo', pe.prazo)
                           ORDER BY pe.prazo NULLS LAST, pe.created_at)
          FROM portal_pendencias pe WHERE pe.project_id = p.id AND pe.concluida_em IS NULL
        ), '[]'::jsonb),
        'equipe', CASE WHEN NOT v_ctx.o_mostrar_equipe THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'nome', a.full_name,
            'funcao', COALESCE(NULLIF(a.job_title, ''), tm.role_title),
            'foto', COALESCE(NULLIF(a.avatar_url, ''), tm.photo_url)
          ) ORDER BY e.ordem)
          FROM project_portal_equipe e
          JOIN app_users a ON a.id = e.app_user_id AND a.status = 'ativo'
          LEFT JOIN team_members tm ON tm.app_user_id = a.id
          WHERE e.project_id = p.id
        ), '[]'::jsonb) END
      ) ORDER BY (p.status = 'concluido'), p.created_at DESC)
      FROM projects p
      LEFT JOIN project_portal_saude s ON s.project_id = p.id
      WHERE p.client_id = v_ctx.o_client_id
        AND p.portal_visivel
        AND (p.status <> 'concluido' OR p.updated_at > now() - interval '90 days')
        AND (NOT v_ctx.o_restrito OR p.id IN (
              SELECT cup.project_id FROM client_user_projects cup WHERE cup.client_user_id = v_ctx.o_pessoa_id))
    ), '[]'::jsonb),
    'pendencias_cliente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', pe.id, 'texto', pe.texto, 'prazo', pe.prazo)
                       ORDER BY pe.prazo NULLS LAST, pe.created_at)
      FROM portal_pendencias pe
      WHERE pe.client_id = v_ctx.o_client_id AND pe.project_id IS NULL AND pe.concluida_em IS NULL
    ), '[]'::jsonb),
    'boas_vindas_pendentes', COALESCE((
      SELECT jsonb_agg(k.chave ORDER BY k.ord)
      FROM (VALUES ('logo', 1), ('brand_book', 2), ('guidelines', 3), ('acessos', 4)) AS k(chave, ord)
      WHERE NOT EXISTS (
        SELECT 1 FROM client_boas_vindas_itens b
        WHERE b.client_id = v_ctx.o_client_id AND b.item_key = k.chave)
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END; $$;

-- Permissões: o contexto é interno; só a visão é pública, como o resto do portal.
REVOKE ALL ON FUNCTION public.portal_contexto(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_contexto(text) TO service_role;
REVOKE ALL ON FUNCTION public.portal_visao_projetos(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_visao_projetos(text) TO anon, authenticated, service_role;

-- CONFERÊNCIA: portal_contexto fecha (false); portal_visao_projetos abre (true).
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('portal_contexto', 'portal_visao_projetos') ORDER BY 1;

-- ROLLBACK (comentado)
-- DROP FUNCTION IF EXISTS public.portal_visao_projetos(text), public.portal_contexto(text);
```

- [ ] **Step 2: Teste local** (reusar o cenário do Task 8; incluir 1 pendência do projeto, 1 do cliente, 1 pessoa na equipe com `mostrar_equipe = true`):

```sql
SET LOCAL ROLE anon;
SELECT portal_visao_projetos('tok-teste-saude');          -- esperado: JSON com os projetos, pendências e boas_vindas_pendentes com 4 itens
SELECT portal_visao_projetos('token-que-nao-existe');     -- esperado: {"error": "invalid"}
SELECT portal_contexto('tok-teste-saude');                -- esperado: ERROR permission denied
```
Com `UPDATE client_portals SET exige_login = true` e sem JWT: `{"error": "precisa_login"}`. Com `mostrar_equipe = false`: `equipe` vazia mesmo com linhas em `project_portal_equipe`.

- [ ] **Step 3: Commit, push, PR**

```bash
git add supabase/migrations/2026102403_portal_visao_projetos.sql
git commit -m "feat(portal): visão de saúde, pendências e equipe por projeto (função pública separada)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin feat/portal-saude-banco
gh pr create --repo caiorlacerda/comercial-lumos --base main --head feat/portal-saude-banco --title "feat(portal): banco da clareza de status (saúde, pendências, equipe)" --body "<ordem de execução do SQL (3 arquivos, nesta ordem), consulta de ensaio e conferências esperadas>"
```
O corpo do PR **deve** trazer o SQL dos 3 arquivos em ordem e a consulta de ensaio abaixo.

### Task 10: Consulta de ensaio (entregue ao Caio, não vira migration)

- [ ] **Step 1:** Incluir no PR e na resposta ao Caio, para rodar **depois** das 3 migrations e **antes** do cron:

```sql
-- ENSAIO: o que a regra dizia hoje para cada projeto que aparece no portal. Só lê.
SELECT c.name  AS cliente,
       p.name  AS projeto,
       p.status,
       p.data_fim,
       (public.portal_saude_calcular(p.id)).estado AS estado_calculado,
       (public.portal_saude_calcular(p.id)).motivo AS por_que
FROM projects p
JOIN clients c ON c.id = p.client_id
WHERE p.portal_visivel
  AND p.status NOT IN ('concluido', 'cancelado', 'arquivado')
ORDER BY (public.portal_saude_calcular(p.id)).estado DESC NULLS LAST, c.name, p.name;
```
- [ ] **Step 2:** Se a lista tiver "Atrasado" ou "Atenção" que o Caio considere errados, ajustar **só** `portal_saude_calcular` numa migration `CREATE OR REPLACE` nova e repetir o ensaio. O cron (PR 5) só entra depois.

---

# PR 3 — App interno (branch `feat/portal-saude-interno`, a partir de `origin/main` com o PR 2 mesclado)

### Task 11: Tipo de notificação e automação

**Files:**
- Modify: `src/lib/notifications/events.ts` (bloco PRODUÇÃO, depois de `BOAS_VINDAS_ITEM_ENVIADO`)
- Modify: `src/pages/ConfiguracoesAutomacoes.tsx` (lista, depois de `cliente_abriu_portal_avisa`)

- [ ] **Step 1: events.ts**

```ts
  PORTAL_SAUDE_PIORA: { key: 'portal_saude_piora', category: 'producao', label: 'Projeto vai aparecer como Atenção ou Atrasado no portal do cliente (aviso 24 h antes)', defaultEnabled: true, priority: 'high' },
```
- [ ] **Step 2: ConfiguracoesAutomacoes.tsx**

```ts
  {
    chave: 'portal_saude_avisa',
    titulo: 'Projeto vai ficar "Atenção" ou "Atrasado" no portal',
    faz: 'Quando o cálculo de prazo piora, o time é avisado 24 horas antes de o cliente ver. Desligada, o cliente vê a mudança na hora, sem aviso.',
    quem: null,
  },
```
- [ ] **Step 3: Verificar** `npx tsc --noEmit -p . 2>&1 | grep -E "events|Automacoes"` sem linhas.
- [ ] **Step 4: Commit**

```bash
git add src/lib/notifications/events.ts src/pages/ConfiguracoesAutomacoes.tsx
git commit -m "feat(portal): tipo de notificação e automação do aviso de saúde

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 12: Seção "Portal" na página do projeto

**Files:**
- Create: `src/components/producao/SecaoPortalProjeto.tsx`
- Modify: `src/pages/Projetos.tsx` (importar e montar ao lado de `ProjectNotes`, linha ~10 e onde `<ProjectNotes` é renderizado)

**Interfaces:**
- Produces: `export default function SecaoPortalProjeto(props: { projectId: string; clientId: string | null })`.

- [ ] **Step 1: Achar o ponto de montagem** — `grep -n "<ProjectNotes\|<ProjectEquipe\|<ProjectEscopo" src/pages/Projetos.tsx`. Montar `<SecaoPortalProjeto projectId={...} clientId={...} />` junto das outras seções do painel do projeto (mesmo contêiner e espaçamento delas), usando as variáveis que as vizinhas usam para o id do projeto e do cliente.

- [ ] **Step 2: Criar o componente**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Loader2, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';

type Estado = 'no_prazo' | 'atencao' | 'atrasado' | null;
interface Saude { calculada: Estado; exibida: Estado; motivo: string | null; liberar_em: string | null }
interface Pendencia { id: string; texto: string; prazo: string | null; concluida_em: string | null }
interface Membro { app_user_id: string; ordem: number }

const ROTULO: Record<string, string> = { no_prazo: 'No prazo', atencao: 'Atenção', atrasado: 'Atrasado' };
const rotulo = (e: Estado) => (e ? ROTULO[e] : 'Sem indicador');

/** Horas que faltam para o cliente ver o estado segurado. */
const horasAte = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 3600000));

/**
 * O que o cliente vê deste projeto no portal: saúde (com o aviso das 24 h),
 * pendências do cliente e quem aparece na equipe. A equipe enxerga o motivo
 * interno do cálculo; o cliente nunca.
 */
export default function SecaoPortalProjeto({ projectId, clientId }: { projectId: string; clientId: string | null }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [saude, setSaude] = useState<Saude | null>(null);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [usuarios, setUsuarios] = useState<{ id: string; full_name: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [liberando, setLiberando] = useState(false);
  const [texto, setTexto] = useState('');
  const [prazo, setPrazo] = useState('');

  const carregar = useCallback(async () => {
    // Recalcula na hora para a equipe não olhar um número de uma hora atrás.
    await supabase.rpc('portal_recalcular_saude', { p_project_id: projectId });
    const [s, p, m, u] = await Promise.all([
      supabase.from('project_portal_saude').select('calculada, exibida, motivo, liberar_em').eq('project_id', projectId).maybeSingle(),
      supabase.from('portal_pendencias').select('id, texto, prazo, concluida_em').eq('project_id', projectId).order('created_at'),
      supabase.from('project_portal_equipe').select('app_user_id, ordem').eq('project_id', projectId).order('ordem'),
      supabase.from('app_users').select('id, full_name, hidden').eq('status', 'ativo').order('full_name'),
    ]);
    setSaude((s.data as Saude) || null);
    setPendencias((p.data as Pendencia[]) || []);
    setMembros((m.data as Membro[]) || []);
    setUsuarios(((u.data as any[]) || []).filter(x => !x.hidden));
    setCarregando(false);
  }, [projectId]);
  useEffect(() => { carregar(); }, [carregar]);

  const segurada = !!saude?.liberar_em && saude.calculada !== saude.exibida;

  const liberar = async () => {
    setLiberando(true);
    const { error } = await supabase.rpc('portal_saude_liberar', { p_project_id: projectId });
    setLiberando(false);
    if (error) { toast.error('Não foi possível liberar agora.'); return; }
    toast.success('O cliente já vê o novo estado.');
    carregar();
  };

  const adicionar = async () => {
    if (!texto.trim() || !clientId) return;
    const { error } = await supabase.from('portal_pendencias').insert({
      client_id: clientId, project_id: projectId, texto: texto.trim().slice(0, 200),
      prazo: prazo || null, created_by: profile?.id ?? null,
    });
    if (error) { toast.error('Não foi possível salvar.'); return; }
    setTexto(''); setPrazo('');
    carregar();
  };
  const concluir = async (id: string) => {
    const { error } = await supabase.from('portal_pendencias').update({ concluida_em: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Não foi possível salvar.'); return; }
    carregar();
  };
  const apagar = async (id: string) => {
    const { error } = await supabase.from('portal_pendencias').delete().eq('id', id);
    if (error) { toast.error('Não foi possível apagar.'); return; }
    carregar();
  };

  const alternarMembro = async (userId: string) => {
    const ja = membros.find(m => m.app_user_id === userId);
    const { error } = ja
      ? await supabase.from('project_portal_equipe').delete().eq('project_id', projectId).eq('app_user_id', userId)
      : await supabase.from('project_portal_equipe').insert({
          project_id: projectId, app_user_id: userId,
          ordem: (membros.reduce((mx, m) => Math.max(mx, m.ordem), 0)) + 1,
        });
    if (error) { toast.error('Não foi possível salvar.'); return; }
    carregar();
  };
  const mover = async (userId: string, dir: -1 | 1) => {
    const i = membros.findIndex(m => m.app_user_id === userId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= membros.length) return;
    const a = membros[i], b = membros[j];
    const r1 = await supabase.from('project_portal_equipe').update({ ordem: b.ordem }).eq('project_id', projectId).eq('app_user_id', a.app_user_id);
    const r2 = await supabase.from('project_portal_equipe').update({ ordem: a.ordem }).eq('project_id', projectId).eq('app_user_id', b.app_user_id);
    if (r1.error || r2.error) { toast.error('Não foi possível reordenar.'); }
    carregar();
  };

  if (carregando) {
    return <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-lumos-text-secondary" /></div>;
  }

  const nomeDe = (id: string) => usuarios.find(u => u.id === id)?.full_name || 'Pessoa';

  return (
    <section className="space-y-5">
      <header>
        <h3 className="text-sm font-semibold text-lumos-text-primary">Portal do cliente</h3>
        <p className="text-xs text-lumos-text-secondary mt-0.5">O que o cliente vê deste projeto no portal.</p>
      </header>

      <div className="rounded-lumos border border-lumos-border bg-lumos-surface/40 p-3 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-lumos-text-secondary">Saúde do projeto</p>
        <p className="text-sm text-lumos-text-primary">
          O cliente vê: <b>{rotulo(saude?.exibida ?? null)}</b>
          {saude?.calculada !== saude?.exibida && <> · Calculado agora: <b>{rotulo(saude?.calculada ?? null)}</b></>}
        </p>
        {saude?.motivo && <p className="text-xs text-lumos-text-secondary">Motivo (só a equipe vê): {saude.motivo}</p>}
        {segurada && saude?.liberar_em && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-lumos-text-primary">
              O cliente passa a ver "{rotulo(saude.calculada)}" em cerca de {horasAte(saude.liberar_em)} h.
              Corrija a causa e isso se desfaz sozinho.
            </p>
            <button type="button" onClick={liberar} disabled={liberando} className="btn-secondary h-9 px-3 text-xs">
              {liberando ? 'Liberando…' : 'Mostrar agora'}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-lumos-text-secondary">O que precisamos do cliente</p>
        {pendencias.filter(p => !p.concluida_em).length === 0 && (
          <p className="text-xs text-lumos-text-secondary">Nenhuma pendência em aberto.</p>
        )}
        {pendencias.filter(p => !p.concluida_em).map(p => (
          <div key={p.id} className="flex items-center gap-2 rounded-lumos border border-lumos-border px-3 py-2">
            <span className="flex-1 min-w-0 text-sm text-lumos-text-primary">
              {p.texto}{p.prazo && <span className="text-xs text-lumos-text-secondary"> · até {p.prazo.split('-').reverse().join('/')}</span>}
            </span>
            <button type="button" onClick={() => concluir(p.id)} aria-label="Marcar como feita" title="Marcar como feita"
              className="h-8 w-8 flex items-center justify-center rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary">
              <Check className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => apagar(p.id)} aria-label="Apagar" title="Apagar"
              className="h-8 w-8 flex items-center justify-center rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-danger-fg">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <input value={texto} onChange={e => setTexto(e.target.value)} maxLength={200}
            placeholder="Ex.: enviar logo em vetor" aria-label="Nova pendência do cliente"
            className="flex-1 min-w-[12rem] h-10 rounded-lumos border border-lumos-border bg-lumos-bg px-3 text-sm" />
          <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} aria-label="Prazo (opcional)"
            className="h-10 rounded-lumos border border-lumos-border bg-lumos-bg px-3 text-sm" />
          <button type="button" onClick={adicionar} disabled={!texto.trim() || !clientId} className="btn-primary h-10 px-4 text-xs font-bold">Adicionar</button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-lumos-text-secondary">Equipe que aparece no portal</p>
        <p className="text-xs text-lumos-text-secondary">Só aparece para clientes com "mostrar equipe" ligado no portal deles.</p>
        {membros.map((m, i) => (
          <div key={m.app_user_id} className="flex items-center gap-2 rounded-lumos border border-lumos-border px-3 py-2">
            <span className="flex-1 text-sm text-lumos-text-primary">{nomeDe(m.app_user_id)}</span>
            <button type="button" disabled={i === 0} onClick={() => mover(m.app_user_id, -1)} aria-label={`Subir ${nomeDe(m.app_user_id)}`}
              className="h-8 w-8 flex items-center justify-center rounded-lumos border border-lumos-border disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
            <button type="button" disabled={i === membros.length - 1} onClick={() => mover(m.app_user_id, 1)} aria-label={`Descer ${nomeDe(m.app_user_id)}`}
              className="h-8 w-8 flex items-center justify-center rounded-lumos border border-lumos-border disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
            <button type="button" onClick={() => alternarMembro(m.app_user_id)} aria-label={`Tirar ${nomeDe(m.app_user_id)}`}
              className="h-8 w-8 flex items-center justify-center rounded-lumos border border-lumos-border hover:text-danger-fg"><X className="w-4 h-4" /></button>
          </div>
        ))}
        <select value="" onChange={e => { if (e.target.value) alternarMembro(e.target.value); }} aria-label="Adicionar pessoa à equipe do portal"
          className="h-10 rounded-lumos border border-lumos-border bg-lumos-bg px-3 text-sm">
          <option value="">Adicionar pessoa…</option>
          {usuarios.filter(u => !membros.some(m => m.app_user_id === u.id)).map(u => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>
      </div>
    </section>
  );
}
```

- [ ] **Step 2b: Degradar sem o banco novo.** Este PR pode ser mesclado **antes** de o Caio rodar o SQL do PR 2. Se as tabelas não existirem (código de erro `42P01` do Postgres ou `PGRST205` do PostgREST), a seção **não** pode estourar toast nem quebrar a página do projeto: mostra só um aviso discreto. No componente:

```tsx
const [semBanco, setSemBanco] = useState(false);
const faltaTabela = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205';
// em carregar(), logo depois do Promise.all:
if (faltaTabela(s.error) || faltaTabela(p.error) || faltaTabela(m.error)) { setSemBanco(true); setCarregando(false); return; }
// no render, logo depois do bloco `if (carregando)`:
if (semBanco) {
  return <p className="text-xs text-lumos-text-secondary py-4">O portal ainda não tem as tabelas desta seção. Ela aparece depois que o banco for atualizado.</p>;
}
```
A chamada `supabase.rpc('portal_recalcular_saude', ...)` já não lança erro quando a função não existe (devolve `{ error }`); manter assim. A mesma regra vale no Task 13: se a consulta de `portal_pendencias` falhar com esses códigos, a seção de pendências do cliente nem é renderizada.

- [ ] **Step 3: Verificar** — `tsc` sem linhas de `SecaoPortalProjeto`; no app (servidor de dev apontando para o banco **local**, com a migration aplicada), abrir um projeto de teste, conferir: saúde mostrada, "Mostrar agora" aparece só com piora segurada, adicionar/concluir/apagar pendência, adicionar/reordenar/tirar pessoa. Conferir em tela estreita (375 px) sem rolagem horizontal.

- [ ] **Step 4: Commit**

```bash
git add src/components/producao/SecaoPortalProjeto.tsx src/pages/Projetos.tsx
git commit -m "feat(portal): seção Portal na página do projeto (saúde, pendências, equipe)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 13: Pendências do cliente inteiro no `PortalModal`

**Files:**
- Modify: `src/components/producao/PortalModal.tsx` (nova seção depois dos blocos, antes das pessoas do cliente)

**Interfaces:**
- Consumes: tabela `portal_pendencias` (linhas com `project_id IS NULL`).

- [ ] **Step 1:** Adicionar estado `pendCliente`, `novaPendTexto`, `novaPendPrazo` e `carregarPendCliente` (`supabase.from('portal_pendencias').select('id, texto, prazo, concluida_em').eq('client_id', clientId).is('project_id', null).order('created_at')`), chamado junto de `carregarPessoas` quando `open`. Renderizar a mesma lista com adicionar, concluir e apagar do Task 12, com o título "O que precisamos do cliente (vale para todos os projetos)". Inserção: `{ client_id: clientId, project_id: null, texto, prazo: prazo || null, created_by: profile?.id ?? null }`.
- [ ] **Step 2: Verificar** — `tsc`; abrir o modal de um cliente de teste, criar uma pendência, conferir que **não** aparece na seção do projeto e que aparece em `portal_visao_projetos(...)->'pendencias_cliente'`.
- [ ] **Step 3: Commit, push, PR**

```bash
git add src/components/producao/PortalModal.tsx
git commit -m "feat(portal): pendências do cliente inteiro no modal do portal

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin feat/portal-saude-interno
gh pr create --repo caiorlacerda/comercial-lumos --base main --head feat/portal-saude-interno --title "feat(portal): seção Portal no projeto e aviso de saúde (app interno)" --body "<o que a equipe passa a ver, como testar, prints>"
```

---

# PR 4 — Front do cliente (branch `feat/portal-clareza-front`, depois dos PRs 1 e 2 mesclados)

### Task 14: Dados, tipos e regra do próximo marco

**Files:**
- Modify: `src/pages/portal/tipos.ts`
- Create: `src/pages/portal/useVisaoProjetos.ts`, `src/pages/portal/marcos.ts`

**Interfaces:**
- Produces:

```ts
// tipos.ts (acrescentar)
export type EstadoSaude = 'no_prazo' | 'atencao' | 'atrasado';
export interface ItemPendencia { id: string; texto: string; prazo: string | null }
export interface VisaoProjeto {
  id: string;
  saude: { estado: EstadoSaude } | null;
  pendencias: ItemPendencia[];
  equipe: { nome: string; funcao: string | null; foto: string | null }[];
}
export interface VisaoProjetos {
  projetos: VisaoProjeto[];
  pendencias_cliente: ItemPendencia[];
  boas_vindas_pendentes: string[];
}
```
- `export function useVisaoProjetos(token: string, ativo: boolean): VisaoProjetos | null`
- `export function proximoMarco(p: Projeto): { rotulo: string; data: string | null } | null`

- [ ] **Step 1: `useVisaoProjetos.ts`**

```ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { VisaoProjetos } from './tipos';

/** Busca saúde, pendências e equipe. Qualquer falha (função ainda não criada,
 *  rede, erro de acesso) devolve null e os blocos novos simplesmente não aparecem:
 *  o resto do portal nunca depende desta chamada. */
export function useVisaoProjetos(token: string, ativo: boolean): VisaoProjetos | null {
  const [visao, setVisao] = useState<VisaoProjetos | null>(null);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    supabase.rpc('portal_visao_projetos', { p_token: token }).then(({ data, error }) => {
      if (!vivo) return;
      if (error || !data || (data as { error?: string }).error) { setVisao(null); return; }
      setVisao(data as VisaoProjetos);
    });
    return () => { vivo = false; };
  }, [token, ativo]);
  return visao;
}
```

- [ ] **Step 2: `marcos.ts`**

```ts
import { MARCOS } from './motivos';
import type { Projeto } from './tipos';

/** A etapa que vem depois da atual, com a data que já temos. Sem etapa atual
 *  (nada em andamento) ou já na última, não há próximo marco para mostrar. */
export function proximoMarco(p: Projeto): { rotulo: string; data: string | null } | null {
  const st = p.stages || {};
  const iAtual = MARCOS.findIndex(m => m.status.some(s => (st[s] || 0) > 0));
  if (iAtual === -1 || iAtual >= MARCOS.length - 1) return null;
  const prox = MARCOS[iAtual + 1];
  const fase = p.cronograma.find(c => prox.status.includes(c.etapa));
  return { rotulo: prox.label, data: fase?.prazo_cliente || fase?.fim || null };
}
```

- [ ] **Step 3: Verificar** `tsc`. Teste rápido do `proximoMarco` no console do navegador com o projeto `p1` do harness (stages `{ em_progresso: 2, revisao_cliente: 1 }`): a etapa atual é "Edição" (índice 2), o próximo é "Sua revisão" com data `2026-11-05`.
- [ ] **Step 4: Commit**

```bash
git add src/pages/portal/tipos.ts src/pages/portal/useVisaoProjetos.ts src/pages/portal/marcos.ts
git commit -m "feat(portal): tipos, hook da visão por projeto e regra do próximo marco

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 15: Blocos da Visão geral

**Files:**
- Create: `src/pages/portal/projeto/Saude.tsx`, `ProximoMarco.tsx`, `Pendencias.tsx`, `EquipeProjeto.tsx`
- Modify: `src/pages/portal/abas/projeto/Geral.tsx`, `src/pages/portal/PortalCliente.tsx` (chamar o hook e repassar), `src/pages/portalCliente.css.ts`

**Interfaces:**
- Consumes: `VisaoProjeto`, `ItemPendencia`, `EstadoSaude`, `Entrega`, `proximoMarco`, `dia`, `nomeBonito`.
- Produces:
  - `Saude({ estado }: { estado: EstadoSaude })`
  - `ProximoMarco({ marco }: { marco: { rotulo: string; data: string | null } })`
  - `Pendencias({ itens }: { itens: { chave: string; texto: string; prazo?: string | null; href?: string }[] })`
  - `EquipeProjeto({ equipe }: { equipe: VisaoProjeto['equipe'] })`
  - `Geral` ganha as props opcionais `visao?: VisaoProjeto | null` e `esperando: Entrega[]`.

- [ ] **Step 1: Componentes**

```tsx
// projeto/Saude.tsx
import type { EstadoSaude } from '../tipos';

const TEXTO: Record<EstadoSaude, { titulo: string; frase: string }> = {
  no_prazo: { titulo: 'No prazo', frase: 'Tudo andando como combinado.' },
  atencao: { titulo: 'Atenção', frase: 'Estamos acompanhando o prazo de perto.' },
  atrasado: { titulo: 'Atrasado', frase: 'O prazo combinado passou. Fale com seu atendimento para o novo cronograma.' },
};

export default function Saude({ estado }: { estado: EstadoSaude }) {
  const t = TEXTO[estado];
  return (
    <section className={`secao saude saude-${estado}`} aria-label="Situação do projeto">
      <span className="rotulo">Situação</span>
      <p className="saude-linha"><i className="saude-ponto" aria-hidden /> <b>{t.titulo}</b></p>
      <p className="nota">{t.frase}</p>
    </section>
  );
}
```

```tsx
// projeto/ProximoMarco.tsx
import { dia } from '../formatacao';

export default function ProximoMarco({ marco }: { marco: { rotulo: string; data: string | null } }) {
  return (
    <section className="secao">
      <span className="rotulo">Próximo passo</span>
      <p className="marco-linha"><b>{marco.rotulo}</b>{marco.data && <span className="mono"> · {dia(marco.data)}</span>}</p>
    </section>
  );
}
```

```tsx
// projeto/Pendencias.tsx
import { dia } from '../formatacao';

export interface ItemPendente {
  chave: string; texto: string; prazo?: string | null; href?: string;
  /** Clique simples faz isto em vez de seguir o link; Ctrl/Cmd/botão do meio seguem o `href`. */
  aoClicar?: () => void;
  /** Roda antes de a navegação normal acontecer (o link segue seu caminho). Usado para deixar o bilhete de volta. */
  aoNavegar?: () => void;
}

export default function Pendencias({ itens }: { itens: ItemPendente[] }) {
  return (
    <section className="secao">
      <span className="rotulo">O que precisamos de você</span>
      <ul className="pendencias">
        {itens.map(i => (
          <li key={i.chave}>
            {i.href ? (
              <a href={i.href} onClick={e => {
                i.aoNavegar?.();
                if (!i.aoClicar || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                i.aoClicar();
              }}>{i.texto}</a>
            ) : <span>{i.texto}</span>}
            {i.prazo && <span className="mono"> · até {dia(i.prazo)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// projeto/EquipeProjeto.tsx
import type { VisaoProjeto } from '../tipos';

export default function EquipeProjeto({ equipe }: { equipe: VisaoProjeto['equipe'] }) {
  return (
    <section className="secao">
      <span className="rotulo">Equipe do projeto</span>
      {equipe.map((p, i) => (
        <div key={i} className="pessoa">
          {p.foto
            ? <img className="foto" src={p.foto} alt="" loading="lazy" />
            : <span className="rosto" style={{ width: 44, height: 44, fontSize: 16 }}>{p.nome.charAt(0)}</span>}
          <span><span className="nm">{p.nome}</span><span className="fn">{p.funcao || 'Produtora Lumos'}</span></span>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Montar em `Geral.tsx`**, **antes** dos blocos de pacote e cronograma, nesta ordem:

```tsx
{visao?.saude && <Saude estado={visao.saude.estado} />}
{(() => { const m = proximoMarco(projeto); return m ? <ProximoMarco marco={m} /> : null; })()}
{(() => {
  const itens = [
    ...esperando.map(e => ({ chave: `v-${e.file_name}-${e.versao}`, texto: `Aprovar ou pedir ajuste: ${nomeBonito(e.file_name)} (v${String(e.versao).padStart(2, '0')})`, href: e.review_token ? `/revisao/${e.review_token}` : undefined })),
    ...(visao?.pendencias || []).map(p => ({ chave: p.id, texto: p.texto, prazo: p.prazo })),
  ];
  return itens.length ? <Pendencias itens={itens} /> : null;
})()}
{visao && visao.equipe.length > 0 && <EquipeProjeto equipe={visao.equipe} />}
```
O link do vídeo precisa do bilhete de volta: passar `marcarVolta` como prop de `Geral` e, em cada item de vídeo, `aoNavegar: marcarVolta` (o link segue normalmente para `/revisao/...`).

- [ ] **Step 3: CSS** (em `portalCliente.css.ts`, junto dos outros blocos; usar as variáveis existentes):

```css
  .saude-linha { display: flex; align-items: center; gap: 10px; font-size: 18px; margin: 6px 0 2px; }
  .saude-ponto { width: 11px; height: 11px; border-radius: 50%; background: var(--aprovado); flex: 0 0 auto; }
  .saude-atencao .saude-ponto { background: var(--luz); }
  .saude-atrasado .saude-ponto { background: #E0624B; }
  .marco-linha { font-size: 16px; margin: 6px 0 0; }
  .pendencias { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
  .pendencias li { padding: 12px 0; border-bottom: 1px solid var(--fio); font-size: 14px; }
  .pendencias li:last-child { border-bottom: 0; }
  .pendencias a { color: var(--luz); text-decoration: none; }
  .pendencias a:hover, .pendencias a:focus-visible { text-decoration: underline; }
```

- [ ] **Step 4: Casca** — em `PortalCliente.tsx` (a da pasta `portal/`), `const visao = useVisaoProjetos(token, !!dados && !porta);` e repassar `visao={visao?.projetos.find(v => v.id === projetoAberto.id) || null}` e `esperando={projetoAberto.entregas.filter(e => e.status === 'EM_REVISAO_CLIENTE')}` para `Geral`.

- [ ] **Step 5: Verificar** — `tsc`; harness com `window.__visao` definido **antes** de colar o roteiro (portal `p1` com `saude: { estado: 'atrasado' }`, 1 pendência, equipe com 2 pessoas), abrir Visão geral e conferir: Situação "Atrasado" com a frase, Próximo passo "Sua revisão · 05/11", pendências (o vídeo esperando + a manual), equipe. Repetir com `window.__visao = null`: **nenhum** bloco novo aparece e o resto da tela é idêntico ao baseline. Conferir em 375 px e nos dois temas (claro/escuro), sem rolagem horizontal.

- [ ] **Step 6: Commit**

```bash
git add src/pages/portal/projeto src/pages/portal/abas/projeto/Geral.tsx src/pages/portal/PortalCliente.tsx src/pages/portalCliente.css.ts
git commit -m "feat(portal): situação, próximo passo, pendências e equipe na visão geral do projeto

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 16: Seção no Início

**Files:**
- Modify: `src/pages/portal/abas/Inicio.tsx`, `src/pages/portal/PortalCliente.tsx`

**Interfaces:**
- Consumes: `VisaoProjetos`, `Pendencias`.
- Produces: `Inicio` ganha a prop opcional `visao?: VisaoProjetos | null`.

- [ ] **Step 1:** Em `Inicio.tsx`, entre o destaque "Esperando você" e o bloco `duas`, montar, quando houver itens:

```tsx
{(() => {
  const ROT: Record<string, string> = { logo: 'Enviar a logo da marca', brand_book: 'Enviar o brand book', guidelines: 'Enviar as guidelines', acessos: 'Informar os acessos' };
  const itens = [
    ...(visao?.pendencias_cliente || []).map(p => ({ chave: p.id, texto: p.texto, prazo: p.prazo })),
    ...(visao?.boas_vindas_pendentes || []).map(k => ({ chave: `bv-${k}`, texto: ROT[k] || k, aoClicar: () => irParaAba('boas_vindas'), href: `/portal/${token}?aba=boas_vindas` })),
  ];
  return itens.length ? <Pendencias itens={itens} /> : null;
})()}
```
Para o clique no item do Bem-vindo, o `Pendencias` chama `aoClicar` com `preventDefault` quando houver `aoClicar` (clique simples) e deixa o `href` valer para Ctrl/Cmd.

- [ ] **Step 2: Verificar** — harness com `window.__visao` contendo `pendencias_cliente` e `boas_vindas_pendentes`; conferir que a seção aparece no Início e que o clique em "Enviar a logo da marca" abre a aba Bem-vindo. Com `__visao = null`, o Início fica idêntico ao baseline.
- [ ] **Step 3: Commit, push, PR**

```bash
git add src/pages/portal/abas/Inicio.tsx src/pages/portal/PortalCliente.tsx src/pages/portal/projeto/Pendencias.tsx
git commit -m "feat(portal): pendências do cliente na aba Início

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin feat/portal-clareza-front
gh pr create --repo caiorlacerda/comercial-lumos --base main --head feat/portal-clareza-front --title "feat(portal): situação, próximo passo, pendências e equipe no portal do cliente" --body "<prints, roteiro com e sem dados, comportamento quando a função do banco não existe>"
```

---

# PR 5 — Rotina automática (só depois do ensaio aprovado)

### Task 17: Agendamento de hora em hora

**Files:**
- Create: `supabase/migrations/2026102404_portal_saude_cron.sql`

- [ ] **Step 1:** Confirmar com o Caio que o ensaio (Task 10) está aprovado e que as migrations dos PRs 2 e 3 já rodaram.
- [ ] **Step 2: Escrever a migration**

```sql
-- PORTAL DO CLIENTE: liga o recálculo da saúde dos projetos, de hora em hora.
-- Só rode depois de revisar o ensaio (a regra de portal_saude_calcular) e de aplicar 2026102402.
DO $$
BEGIN
  IF to_regprocedure('public.portal_recalcular_saude(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102402_portal_saude_funcoes.sql.';
  END IF;
END $$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'portal-saude-recalcular';

SELECT cron.schedule(
  'portal-saude-recalcular',
  '7 * * * *',                                   -- minuto 7 de cada hora
  $$SELECT public.portal_recalcular_saude()$$
);

-- CONFERÊNCIA
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'portal-saude-recalcular';
-- Esperado: 1 linha, active = true.

-- PARA DESLIGAR (comentado)
-- SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'portal-saude-recalcular';
```
- [ ] **Step 3: Testar no local** (a extensão `pg_cron` existe no container): rodar o arquivo; `SELECT public.portal_recalcular_saude();` manualmente e conferir as linhas em `project_portal_saude`.
- [ ] **Step 4: Commit, push, PR**

```bash
git add supabase/migrations/2026102404_portal_saude_cron.sql
git commit -m "feat(portal): recálculo horário da saúde dos projetos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin feat/portal-saude-cron
gh pr create --repo caiorlacerda/comercial-lumos --base main --head feat/portal-saude-cron --title "feat(portal): liga o recálculo horário da saúde" --body "<SQL, como conferir, como desligar>"
```
- [ ] **Step 5: Acompanhamento (depois que o Caio rodar):** na hora seguinte, conferir `SELECT count(*), count(*) FILTER (WHERE liberar_em IS NOT NULL) FROM project_portal_saude;` e as notificações geradas; combinar com o Caio o que fazer com avisos de projetos que ele considere errados (ajuste da regra, Task 10 Step 2).

---

## Autoconferência do plano contra o desenho

- Seção 1 (blocos): Tasks 14–16. Frases editáveis: ficam em `Saude.tsx`.
- Seção 2 (regras): Task 8, função `portal_saude_calcular`; ensaio no Task 10.
- Seção 3 (piora segurada e aviso): Task 8 (`portal_recalcular_saude`, `portal_saude_liberar`); tipo de notificação e automação no Task 11; sem `notify()` no cliente.
- Seção 4 (banco): Tasks 7, 8, 9; cron no Task 17.
- Seção 5 (app interno): Tasks 12 e 13.
- Seção 6 (front F e A): Tasks 1–6 e 14–16.
- Seção 7 (testes e ordem dos PRs): roteiro no Task 1; testes de banco nos Tasks 7–9; ordem dos 5 PRs conforme o desenho.
