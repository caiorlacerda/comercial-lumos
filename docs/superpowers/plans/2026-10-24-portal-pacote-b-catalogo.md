# Portal do cliente, Pacote B (catálogo + prazo de revisão) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao portal do cliente um catálogo de vídeos estilo Netflix (aba "Catálogo") e um prazo de revisão visível ao cliente, com lembrete interno diário à equipe quando um vídeo fica parado com o cliente.

**Architecture:** O catálogo (B1) é só front: monta fileiras a partir de `dados.projetos[].entregas` (já carregadas) e pede as capas sob demanda pela visibilidade do card, reutilizando `portal_capas`. O prazo (B2) estende a função pública `portal_visao_projetos` com `revisoes[]`, acrescenta uma coluna de configuração por cliente e uma rotina diária de lembrete no banco.

**Tech Stack:** React 19 + Vite + TypeScript, CSS do portal em string (`portalCliente.css.ts`), Supabase (Postgres, RLS, pg_cron).

**Spec:** `docs/superpowers/specs/2026-10-24-portal-pacote-b-catalogo-design.md`

## Global Constraints

- **Não regredir o desktop (≥1024px) do app interno.** Mudanças do portal público são mobile-first; o portal é PÚBLICO e **nunca pode ficar em tela branca**: qualquer dado ausente ou incompleto some do catálogo/cartão, sem erro.
- **SQL é rodado manualmente pelo Caio no Supabase.** A IA nunca roda SQL em produção, nunca toca `service_role`/`.env`. SQL de teste só no banco **local** (`docker exec -i supabase_db_proposta-lumos psql -U postgres -v ON_ERROR_STOP=1 < arquivo.sql`).
- **Segurança de teste local (lições já pagas):** inserir em `public.notifications` dispara `trg_notify_push`, que chama uma URL de PRODUÇÃO; inserir em `public.projects` dispara webhook de produção. Todo teste que cria dados roda em `BEGIN; ... ROLLBACK;` com `ALTER TABLE notifications DISABLE TRIGGER trg_notify_push;` e `SET LOCAL session_replication_role = replica;` no começo. **Nunca** deixar job de pg_cron agendado no banco local. **Nunca** reiniciar Docker/OrbStack (`orbctl`); se travar, parar e reportar.
- **Funções e tabelas novas:** `REVOKE ALL ... FROM PUBLIC, anon` (e `authenticated`, salvo quando precisa) logo após criar; conferir com `has_function_privilege`/`has_table_privilege`. Só `portal_visao_projetos` é aberta a visitantes.
- **Notificações:** eventos com origem no banco são criados só pelo banco (sem `notify()` no cliente). O tipo entra em `src/lib/notifications/events.ts`.
- **Tokens do design:** variáveis do próprio portal (`--luz`, `--fio`, `--meia-luz`, `--aprovado`, `--producao`, `--ajuste`) no portal; `lumos-*` no app interno. Nada de cor crua nova sem variante para o tema claro.
- **Páginas continuam lazy:** `App.tsx` não muda.
- **`git add` sempre com caminhos explícitos.** Nunca `git add -A`, `node_modules`, `supabase/.temp`, `.superpowers`, `.claude`. Rodar `git checkout -- node_modules` antes de commitar se o vite tiver mexido.
- **Teste de navegador do portal:** servidor de dev com URL de banco MORTA (o `.env` aponta para produção): `VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=teste nohup npx vite --port 5199 --strictPort > /dev/null 2>&1 &`, abrir `http://localhost:5199/portal/teste123` (a 1ª carga pode dar 504 "Outdated Optimize Dep": recarregar uma vez), colar `scripts/portal-harness.js` (o resultado sem dados deve ser **idêntico** a `/private/tmp/claude-501/-Users-caiorizzuttl-Documents-LUMOS-proposta-lumos/b1b45fad-8ff5-4369-9169-da8f1a7cda8e/scratchpad/baseline-portal.json`, exceto o que a tarefa disser que muda), recarregar a página antes de colar de novo. Parar com `pkill -f "vite --port 5199"`.
- **Antes de dar um PR por pronto:** `npx tsc --noEmit -p . 2>&1 | grep -iE "portal|Portal"` sem linhas (erros de pacotes ausentes no `node_modules` da worktree, como hls.js/pdfjs-dist, são conhecidos e ignorados).
- **Merge só depois do OK do Caio.** Textos em português do Brasil.

## Mapa de arquivos

**B1 (branch `feat/portal-catalogo`, sem SQL)**
- Create `src/pages/portal/catalogo.ts` — `ItemCatalogo`, `Fileira`, `montarFileiras(dados)`.
- Create `src/pages/portal/useCapasPorVisibilidade.ts` — pede capas só dos cards visíveis.
- Create `src/pages/portal/catalogo/CardCatalogo.tsx`, `src/pages/portal/catalogo/FileiraCatalogo.tsx`, `src/pages/portal/abas/Catalogo.tsx`.
- Modify `src/pages/portal/PortalCliente.tsx` (menu, aba, bilhete, URL), `src/pages/portalCliente.css.ts`.

**B2 (branch `feat/portal-prazo-revisao`)**
- Create `supabase/migrations/2026102406_portal_prazo_revisao.sql`, `2026102407_portal_lembrete_revisao.sql`, `2026102408_portal_lembrete_cron.sql`.
- Modify `src/lib/notifications/events.ts`, `src/pages/ConfiguracoesAutomacoes.tsx`, `src/components/producao/PortalModal.tsx`.
- Modify `src/pages/portal/tipos.ts`, `src/pages/portal/formatacao.ts`, `src/pages/portal/abas/projeto/Geral.tsx`, `src/pages/portal/catalogo/CardCatalogo.tsx`, `src/pages/portal/abas/Catalogo.tsx`, `src/pages/portal/PortalCliente.tsx`, `src/pages/portalCliente.css.ts`.

---

# B1 — Catálogo (branch `feat/portal-catalogo`, a partir de `origin/main`)

### Task 1: Montar as fileiras (função pura)

**Files:**
- Create: `src/pages/portal/catalogo.ts`

**Interfaces:**
- Consumes: `Portal`, `Entrega` de `./tipos`.
- Produces:

```ts
export interface ItemCatalogo {
  chave: string;            // única na fileira
  projetoId: string;
  projeto: string;
  nome: string;             // título bonito (nomeBonito do arquivo)
  versao: number;
  status: string;           // EM_REVISAO_CLIENTE | ALTERACOES_CLIENTE | APROVADO
  largura: number | null;
  altura: number | null;
  reviewToken: string | null;
  entregueEm: string | null;
}
export interface Fileira { id: string; titulo: string; itens: ItemCatalogo[] }
export function montarFileiras(dados: Portal): Fileira[]
```

- [ ] **Step 1: Escrever o arquivo**

```ts
import type { Entrega, Portal } from './tipos';
import { nomeBonito } from './formatacao';

export interface ItemCatalogo {
  chave: string;
  projetoId: string;
  projeto: string;
  nome: string;
  versao: number;
  status: string;
  largura: number | null;
  altura: number | null;
  reviewToken: string | null;
  entregueEm: string | null;
}
export interface Fileira { id: string; titulo: string; itens: ItemCatalogo[] }

/** Dentro de um projeto: esperando o cliente primeiro, depois ajustes, depois aprovados. */
const ORDEM_ESTADO: Record<string, number> = { EM_REVISAO_CLIENTE: 0, ALTERACOES_CLIENTE: 1, APROVADO: 2 };

const tempo = (s: string | null) => (s ? new Date(s).getTime() || 0 : 0);

function item(projetoId: string, projeto: string, e: Entrega, i: number): ItemCatalogo {
  return {
    chave: `${projetoId}-${e.review_token ?? e.file_name}-${e.versao}-${i}`,
    projetoId, projeto,
    nome: nomeBonito(e.file_name),
    versao: e.versao,
    status: e.status,
    largura: e.largura, altura: e.altura,
    reviewToken: e.review_token,
    entregueEm: e.entregue_em,
  };
}

/**
 * O catálogo do cliente: a fileira "Esperando você" (o mais antigo primeiro,
 * porque é o que está esperando há mais tempo) e uma fileira por projeto.
 * Só entra o que o portal já mostra (o banco só manda estados visíveis);
 * projeto sem vídeo não vira fileira. Um vídeo pode estar nas duas.
 */
export function montarFileiras(dados: Portal): Fileira[] {
  const projetos = dados?.projetos ?? [];
  const espera: ItemCatalogo[] = [];
  const porProjeto: Fileira[] = [];

  projetos.forEach(p => {
    const entregas = (p.entregas ?? []).filter(e => e.status in ORDEM_ESTADO);
    if (!entregas.length) return;
    const itens = entregas
      .map((e, i) => item(p.id, p.nome.trim(), e, i))
      .sort((a, b) =>
        (ORDEM_ESTADO[a.status] - ORDEM_ESTADO[b.status]) || (tempo(b.entregueEm) - tempo(a.entregueEm)));
    itens.filter(x => x.status === 'EM_REVISAO_CLIENTE').forEach(x => espera.push(x));
    porProjeto.push({ id: p.id, titulo: p.nome.trim(), itens });
  });

  espera.sort((a, b) => tempo(a.entregueEm) - tempo(b.entregueEm));
  const fileiras: Fileira[] = [];
  if (espera.length) fileiras.push({ id: 'espera', titulo: 'Esperando você', itens: espera });
  return fileiras.concat(porProjeto);
}
```

- [ ] **Step 2: Verificar com uma checagem descartável** (sem criar framework nem commitar teste): transpilar com a API do TypeScript e rodar no Node, com um `dados` de exemplo contendo 2 projetos (um sem vídeos), 3 vídeos esperando em datas diferentes e 1 aprovado:

```bash
node -e "
const ts=require('typescript'),fs=require('fs');
const src=fs.readFileSync('src/pages/portal/catalogo.ts','utf8')
  .replace(/import .*formatacao.*;/,'const nomeBonito=f=>f.replace(/\\\\.[^.]+\$/,\"\").replace(/[_-]+/g,\" \").trim();')
  .replace(/import type .*;/,'');
const js=ts.transpileModule(src,{compilerOptions:{module:'commonjs',target:'es2020'}}).outputText;
const m={exports:{}};new Function('module','exports',js)(m,m.exports);
const e=(n,s,d,t)=>({file_name:n,versao:1,status:s,largura:1920,altura:1080,client_decision:null,client_decided_by:null,client_decided_at:null,entregue_em:d,review_token:t,allow_download:false});
const dados={projetos:[{id:'p1',nome:'Alfa ',entregas:[e('a_um.mp4','APROVADO','2026-10-01','t1'),e('a_dois.mp4','EM_REVISAO_CLIENTE','2026-10-10','t2'),e('a_tres.mp4','EM_REVISAO_CLIENTE','2026-10-05','t3')]},{id:'p2',nome:'Beta',entregas:[]},{id:'p3',nome:'Gama',entregas:[e('g_um.mp4','EM_REVISAO_CLIENTE','2026-10-02','t4'),e('g_x.mp4','EM_EDICAO','2026-10-02','t5')]}]};
console.log(JSON.stringify(m.exports.montarFileiras(dados).map(f=>[f.id,f.titulo,f.itens.map(i=>i.nome+':'+i.status)]),null,1));
"
```
Expected: três fileiras na ordem `espera` (itens: g um [10-02], a tres [10-05], a dois [10-10]), `p1` (a dois e a tres esperando, mais novo primeiro: a dois, a tres; depois a um aprovado) e `p3` (só g um; o `EM_EDICAO` fora). Projeto `p2` sem fileira.

- [ ] **Step 3: tsc** e commit

```bash
git add src/pages/portal/catalogo.ts
git commit -m "feat(portal): monta as fileiras do catálogo de vídeos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: Capas sob demanda pela visibilidade

**Files:**
- Create: `src/pages/portal/useCapasPorVisibilidade.ts`

**Interfaces:**
- Consumes: `pedirCapas(tokens: string[]) => Promise<void>` do shell (dedupa tokens já pedidos e envia em lotes de 6).
- Produces: `export function useCapasPorVisibilidade(pedirCapas: (tokens: string[]) => Promise<void>): (el: Element | null, reviewToken: string | null) => void` — função para usar como `ref` de cada card.

- [ ] **Step 1: Escrever o hook**

```ts
import { useCallback, useEffect, useRef } from 'react';

/**
 * Pede a capa de um card só quando ele chega perto da tela. O `pedirCapas` do
 * shell muda a cada capa que chega (depende do estado), então ele entra por
 * ref: o observador não é refeito. Os pedidos de um instante são juntados e
 * enviados de uma vez (o shell já parte em lotes de 6).
 */
export function useCapasPorVisibilidade(pedirCapas: (tokens: string[]) => Promise<void>) {
  const pedirRef = useRef(pedirCapas);
  pedirRef.current = pedirCapas;

  const observador = useRef<IntersectionObserver | null>(null);
  const tokenDe = useRef(new Map<Element, string>());
  const pendentes = useRef(new Set<string>());
  const temporizador = useRef<number | null>(null);

  const despachar = useCallback(() => {
    temporizador.current = null;
    if (!pendentes.current.size) return;
    const lista = [...pendentes.current];
    pendentes.current.clear();
    void pedirRef.current(lista);
  }, []);

  useEffect(() => {
    // Sem IntersectionObserver (navegador antigo): pede tudo de uma vez, como o portal já fazia.
    if (typeof IntersectionObserver === 'undefined') {
      const todos = [...tokenDe.current.values()];
      if (todos.length) void pedirRef.current(todos);
      return;
    }
    observador.current = new IntersectionObserver(entradas => {
      entradas.forEach(en => {
        if (!en.isIntersecting) return;
        const t = tokenDe.current.get(en.target);
        if (!t) return;
        pendentes.current.add(t);
        observador.current?.unobserve(en.target);
      });
      if (pendentes.current.size && temporizador.current === null) {
        temporizador.current = window.setTimeout(despachar, 120);
      }
    }, { rootMargin: '0px 300px 0px 300px' });
    // Cards que registraram antes do observador existir.
    tokenDe.current.forEach((_t, el) => observador.current?.observe(el));
    return () => {
      observador.current?.disconnect();
      observador.current = null;
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
      temporizador.current = null;
    };
  }, [despachar]);

  return useCallback((el: Element | null, reviewToken: string | null) => {
    if (!el) return;
    if (!reviewToken) return;
    if (tokenDe.current.get(el) === reviewToken) return;
    tokenDe.current.set(el, reviewToken);
    observador.current?.observe(el);
  }, []);
}
```

- [ ] **Step 2: tsc** (sem erro em `useCapasPorVisibilidade`), commit

```bash
git add src/pages/portal/useCapasPorVisibilidade.ts
git commit -m "feat(portal): hook que pede capas só dos cards perto da tela

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: Card, fileira e aba Catálogo

**Files:**
- Create: `src/pages/portal/catalogo/CardCatalogo.tsx`, `src/pages/portal/catalogo/FileiraCatalogo.tsx`, `src/pages/portal/abas/Catalogo.tsx`
- Modify: `src/pages/portalCliente.css.ts`

**Interfaces:**
- Consumes: `montarFileiras`, `ItemCatalogo`, `Fileira` (Task 1); `useCapasPorVisibilidade` (Task 2); `ESTADO` (`../motivos`); `formato` (`../formatacao`).
- Produces:
  - `CardCatalogo({ item, capa, observar, aoAbrir }: { item: ItemCatalogo; capa: string | null | undefined; observar: (el: Element | null, token: string | null) => void; aoAbrir: () => void })`
  - `FileiraCatalogo({ fileira, capas, observar, aoAbrir, mostrarProjeto }: { fileira: Fileira; capas: Record<string, string | null>; observar: ...; aoAbrir: () => void; mostrarProjeto: boolean })`
  - `Catalogo({ dados, capas, pedirCapas, marcarVolta }: { dados: Portal; capas: Record<string, string | null>; pedirCapas: (tokens: string[]) => Promise<void>; marcarVolta: () => void })` (default export, em `abas/Catalogo.tsx`).

- [ ] **Step 1: `CardCatalogo.tsx`**

```tsx
import { useCallback } from 'react';
import type { ItemCatalogo } from '../catalogo';
import { ESTADO } from '../motivos';
import { formato } from '../formatacao';

/** Um vídeo do catálogo: capa no formato real, título embaixo, selo do estado. */
export default function CardCatalogo({ item, capa, observar, aoAbrir, mostrarProjeto }: {
  item: ItemCatalogo;
  capa: string | null | undefined;
  observar: (el: Element | null, token: string | null) => void;
  aoAbrir: () => void;
  mostrarProjeto: boolean;
}) {
  const f = formato(item.largura, item.altura);
  const estado = ESTADO[item.status];
  const ref = useCallback((el: HTMLAnchorElement | null) => observar(el, item.reviewToken), [observar, item.reviewToken]);
  const meta = `v${String(item.versao).padStart(2, '0')}${mostrarProjeto ? ` · ${item.projeto}` : ''}`;
  return (
    <a ref={ref} className={`cat-card ${f.classe}`}
      href={item.reviewToken ? `/revisao/${item.reviewToken}` : undefined}
      onClick={() => aoAbrir()}
      aria-label={`${item.nome}, ${meta}${estado ? `, ${estado.label}` : ''}`}>
      <span className="cat-capa">
        {capa && <img className="foto" src={capa} alt="" loading="lazy" draggable={false} />}
        <span className="fmt">{f.rotulo}</span>
        {estado && <span className={`cat-selo ${estado.classe}`}>{estado.label}</span>}
      </span>
      <span className="cat-titulo">{item.nome}</span>
      <span className="cat-meta">{meta}</span>
    </a>
  );
}
```

- [ ] **Step 2: `FileiraCatalogo.tsx`** (rolagem com encaixe, setas, restauração de posição)

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fileira } from '../catalogo';
import CardCatalogo from './CardCatalogo';
import { SetaMes } from '../icones';

/**
 * Uma fileira que rola de lado. Setas só aparecem quando há mais conteúdo
 * daquele lado e não aparecem em tela de toque (lá o dedo rola). A posição
 * entra e sai por `lerPosicao`/`registrar`, para o Catálogo restaurá-la quando
 * a pessoa volta do vídeo.
 */
export default function FileiraCatalogo({ fileira, capas, observar, aoAbrir, mostrarProjeto, registrar }: {
  fileira: Fileira;
  capas: Record<string, string | null>;
  observar: (el: Element | null, token: string | null) => void;
  aoAbrir: () => void;
  mostrarProjeto: boolean;
  /** Entrega o elemento rolável para quem precisa ler/escrever o scrollLeft. */
  registrar: (id: string, el: HTMLDivElement | null) => void;
}) {
  const faixa = useRef<HTMLDivElement | null>(null);
  const [podeEsq, setPodeEsq] = useState(false);
  const [podeDir, setPodeDir] = useState(false);
  const quadro = useRef<number | null>(null);

  const medir = useCallback(() => {
    const el = faixa.current;
    if (!el) return;
    setPodeEsq(el.scrollLeft > 4);
    setPodeDir(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    medir();
    const el = faixa.current;
    if (!el) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); if (quadro.current !== null) cancelAnimationFrame(quadro.current); };
  }, [medir, fileira.itens.length]);

  const rolar = (dir: -1 | 1) => {
    const el = faixa.current;
    if (!el) return;
    const reduzido = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: reduzido ? 'auto' : 'smooth' });
  };

  const titulo = `fileira-${fileira.id}`;
  return (
    <section className="fileira" aria-labelledby={titulo}>
      <h3 id={titulo} className="fileira-titulo">
        {fileira.titulo}
        <span className="fileira-n">{fileira.itens.length} {fileira.itens.length === 1 ? 'vídeo' : 'vídeos'}</span>
      </h3>
      <div className="fileira-moldura">
        {podeEsq && (
          <button type="button" className="fileira-seta esq" aria-label={`Rolar ${fileira.titulo} para a esquerda`} onClick={() => rolar(-1)}>
            <SetaMes dir="esq" />
          </button>
        )}
        <div className="fileira-faixa" ref={el => { faixa.current = el; registrar(fileira.id, el); }}
          onScroll={() => { if (quadro.current === null) quadro.current = requestAnimationFrame(() => { quadro.current = null; medir(); }); }}>
          {fileira.itens.map(it => (
            <CardCatalogo key={it.chave} item={it} capa={it.reviewToken ? capas[it.reviewToken] : null}
              observar={observar} aoAbrir={aoAbrir} mostrarProjeto={mostrarProjeto} />
          ))}
        </div>
        {podeDir && (
          <button type="button" className="fileira-seta dir" aria-label={`Rolar ${fileira.titulo} para a direita`} onClick={() => rolar(1)}>
            <SetaMes dir="dir" />
          </button>
        )}
      </div>
    </section>
  );
}
```
Nota: `SetaMes` é o chevron do portal (`src/pages/portal/icones.tsx`); `dir="esq"` aponta para a esquerda e `dir="dir"` para a direita. Confirmar o import.

- [ ] **Step 2b: o ref `{el => {...}}` inline roda a cada render**; para não registrar o mesmo elemento sem necessidade, `registrar` deve ser idempotente (apenas `map.set/delete`). Garantido no `Catalogo`.

- [ ] **Step 3: `abas/Catalogo.tsx`** (lê `sessionStorage` e restaura uma vez)

```tsx
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Portal } from '../tipos';
import { montarFileiras } from '../catalogo';
import { useCapasPorVisibilidade } from '../useCapasPorVisibilidade';
import FileiraCatalogo from '../catalogo/FileiraCatalogo';

const CHAVE_ROLAGEM = 'lumos_catalogo_rolagem';
const VALIDADE_MS = 30 * 60 * 1000;

interface Posicao { quando: number; y: number; fileiras: Record<string, number> }

export default function Catalogo({ dados, capas, pedirCapas, marcarVolta }: {
  dados: Portal;
  capas: Record<string, string | null>;
  pedirCapas: (tokens: string[]) => Promise<void>;
  marcarVolta: () => void;
}) {
  const fileiras = useMemo(() => montarFileiras(dados), [dados]);
  const observar = useCapasPorVisibilidade(pedirCapas);
  const faixas = useRef(new Map<string, HTMLDivElement>());

  const registrar = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) faixas.current.set(id, el); else faixas.current.delete(id);
  }, []);

  // Ao sair para o vídeo: guarda a rolagem vertical e a de cada fileira, e deixa o bilhete de volta.
  const aoAbrir = useCallback(() => {
    try {
      const fileirasPos: Record<string, number> = {};
      faixas.current.forEach((el, id) => { fileirasPos[id] = el.scrollLeft; });
      const p: Posicao = { quando: Date.now(), y: window.scrollY, fileiras: fileirasPos };
      sessionStorage.setItem(CHAVE_ROLAGEM, JSON.stringify(p));
    } catch { /* sem sessionStorage: só não restaura */ }
    marcarVolta();
  }, [marcarVolta]);

  // Ao voltar: restaura UMA vez, depois que o shell termina de rolar para o topo.
  useEffect(() => {
    let p: Posicao | null = null;
    try {
      const bruto = sessionStorage.getItem(CHAVE_ROLAGEM);
      sessionStorage.removeItem(CHAVE_ROLAGEM);
      p = bruto ? (JSON.parse(bruto) as Posicao) : null;
    } catch { p = null; }
    if (!p || !Number.isFinite(p.quando) || Date.now() - p.quando > VALIDADE_MS) return;
    const alvo = p;
    const t = window.setTimeout(() => {
      faixas.current.forEach((el, id) => { const x = alvo.fileiras?.[id]; if (typeof x === 'number') el.scrollLeft = x; });
      if (typeof alvo.y === 'number') window.scrollTo({ top: alvo.y, behavior: 'auto' });
    }, 160);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <main className="painel">
      <div className="folha">
        <div className="cabeca-proj">
          <p className="rotulo">Catálogo</p>
          <h2>Todos os vídeos<br />em um só lugar</h2>
        </div>
        {fileiras.length === 0 ? (
          <p className="nota">Nada para ver ainda. Quando um vídeo estiver pronto para você, ele aparece aqui.</p>
        ) : fileiras.map(f => (
          <FileiraCatalogo key={f.id} fileira={f} capas={capas} observar={observar} aoAbrir={aoAbrir}
            mostrarProjeto={f.id === 'espera'} registrar={registrar} />
        ))}
      </div>
    </main>
  );
}
```
Nota: se `sessionStorage` tiver o bilhete antigo de outra aba, o `try/catch` evita erro; a chave é só do catálogo e é consumida uma vez.

- [ ] **Step 4: CSS** (acrescentar ao fim do bloco de estilos do portal em `portalCliente.css.ts`, junto dos blocos de quadros; usa as classes de formato `f169/f916/f11` já existentes, mas definidas para `.still`, então aqui são regras próprias):

```css
  /* ── CATÁLOGO: fileiras que rolam de lado, estilo Netflix ───────────── */
  .fileira { margin-top: 34px; }
  .fileira-titulo { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 26px; margin: 0 0 12px; display: flex; align-items: baseline; gap: 12px; }
  .fileira-n { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--meia-luz); letter-spacing: .04em; }
  .fileira-moldura { position: relative; }
  .fileira-faixa {
    --h: 168px;
    display: flex; gap: 14px; align-items: flex-start;
    overflow-x: auto; overscroll-behavior-x: contain;
    scroll-snap-type: x proximity; padding: 8px 2px 14px; margin: 0 -2px;
    scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .fileira-faixa::-webkit-scrollbar { display: none; }
  .cat-card { flex: 0 0 auto; scroll-snap-align: start; display: block; text-decoration: none; color: inherit; width: max-content; max-width: 70vw; }
  .cat-capa {
    display: block; position: relative; overflow: hidden; border-radius: 10px; height: var(--h);
    background: linear-gradient(160deg, #4b4239, #211e1c 70%);
    box-shadow: 0 12px 30px -14px rgba(0,0,0,.8), inset 0 0 0 1px rgba(255,247,230,.09);
    transition: transform .22s cubic-bezier(.2,.7,.3,1), box-shadow .22s;
  }
  .cat-card.f169 .cat-capa { width: calc(var(--h) * 16 / 9); }
  .cat-card.f916 .cat-capa { width: calc(var(--h) * 9 / 16); }
  .cat-card.f11  .cat-capa { width: var(--h); }
  .cat-capa .foto { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .cat-capa::after { content: "▶"; position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255,247,230,.55); font-size: 15px; transition: color .2s; }
  .cat-card:hover .cat-capa, .cat-card:focus-visible .cat-capa { transform: translateY(-4px); box-shadow: 0 20px 40px -16px rgba(0,0,0,.85), 0 0 0 1px rgba(239,199,0,.5), 0 0 28px -6px rgba(239,199,0,.35); }
  .cat-card:hover .cat-capa::after, .cat-card:focus-visible .cat-capa::after { color: var(--luz); }
  .cat-capa .fmt, .cat-capa .cat-selo { z-index: 2; position: absolute; }
  .cat-capa .fmt { top: 7px; right: 7px; left: auto; font-family: "JetBrains Mono", monospace; font-size: 9.5px; letter-spacing: .06em; background: rgba(10,9,8,.7); color: var(--gesso); padding: 2px 6px; border-radius: 3px; }
  .cat-selo { left: 7px; bottom: 7px; font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 99px; background: rgba(10,9,8,.78); color: var(--gesso); border: 1px solid rgba(255,247,230,.18); }
  .cat-selo.s-voce { color: var(--luz); border-color: rgba(239,199,0,.5); }
  .cat-selo.s-ok { color: var(--aprovado); border-color: color-mix(in srgb, var(--aprovado) 50%, transparent); }
  .cat-selo.s-aj { color: var(--ajuste); border-color: color-mix(in srgb, var(--ajuste) 50%, transparent); }
  .cat-titulo { display: block; margin-top: 9px; font-size: 13.5px; font-weight: 600; line-height: 1.25; max-width: calc(var(--h) * 16 / 9); overflow-wrap: anywhere; }
  .cat-card.f916 .cat-titulo { max-width: calc(var(--h) * 9 / 16 + 30px); }
  .cat-meta { display: block; margin-top: 2px; font-family: "JetBrains Mono", monospace; font-size: 10.5px; color: var(--meia-luz); }
  .fileira-seta {
    position: absolute; top: calc(var(--h, 168px) / 2 - 4px); z-index: 5; width: 40px; height: 40px;
    display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--fio);
    background: rgba(10,9,8,.82); color: var(--gesso); cursor: pointer; backdrop-filter: blur(6px);
  }
  .fileira-seta svg { width: 16px; height: 16px; }
  .fileira-seta.esq { left: -14px; } .fileira-seta.dir { right: -14px; }
  .fileira-seta:hover { color: var(--luz); border-color: rgba(239,199,0,.5); }
  @media (hover: none) { .fileira-seta { display: none; } }
  @media (prefers-reduced-motion: reduce) { .cat-capa, .cat-capa::after { transition: none; } .cat-card:hover .cat-capa { transform: none; } }
  @media (max-width: 619px) { .fileira-faixa { --h: 148px; } .fileira-titulo { font-size: 22px; } }
```
Antes de fixar: conferir no CSS existente os nomes das variáveis (`--gesso`, `--luz`, `--aprovado`, `--ajuste`, `--fio`, `--meia-luz`) e a regra global de `:focus-visible`; acrescentar o override do tema claro para o fundo dos selos e da seta (`.portal-lumos.claro .cat-selo, .portal-lumos.claro .fileira-seta`) com fundo claro e texto escuro e checar contraste (≥ 4,5:1 para texto, ≥ 3:1 para borda).

- [ ] **Step 5: tsc**, commit

```bash
git add src/pages/portal/catalogo src/pages/portal/abas/Catalogo.tsx src/pages/portalCliente.css.ts
git commit -m "feat(portal): card, fileira e aba Catálogo (rolagem lateral, capas sob demanda)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: Ligar no shell e verificar no navegador

**Files:**
- Modify: `src/pages/portal/PortalCliente.tsx`

**Interfaces:**
- Consumes: `Catalogo` (Task 3), `montarFileiras` (Task 1), `pedirCapas`, `marcarVolta`, `dados` do shell.

- [ ] **Step 1: Edições no shell**
  1. `import Catalogo from './abas/Catalogo';` e `import { montarFileiras } from './catalogo';`.
  2. Um `useMemo` `temCatalogo = useMemo(() => !!dados && montarFileiras(dados).length > 0, [dados])`, ao lado de `esperando` (antes dos retornos antecipados).
  3. Na URL de retorno (`carregar`): aceitar `catalogo`: `pedida === 'catalogo'` na lista `if (pedida && (pedida === 'inicio' || ...))`.
  4. Menu: depois do botão "Início", um botão "Catálogo" (somente se `temCatalogo`) com `aria-current={aba === 'catalogo'}` e `onClick={() => setAba('catalogo')}`.
  5. Render: `{aba === 'catalogo' && temCatalogo && <Catalogo dados={dados} capas={capas} pedirCapas={pedirCapas} marcarVolta={marcarVolta} />}` junto dos outros blocos de aba.
  6. O efeito que pede capas ao trocar de aba **não** muda: o catálogo pede sozinho pela visibilidade.
- [ ] **Step 2: Verificar** (`tsc`, harness sem catálogo idêntico ao baseline mais um botão novo no menu: o harness lê `nav()[n]` por índice, então a posição de "Atendimento" muda de 3 para 4; **atualize o harness** `scripts/portal-harness.js` trocando os índices que mudam e o texto esperado, e regere o baseline `baseline-portal.json` dizendo no relatório exatamente o que mudou).
- [ ] **Step 3: Teste de navegador com dados** (dead DB; sobrescrever o `fake` do harness com pelo menos 3 projetos e 14 vídeos, 6 esperando, formatos 16:9/9:16/1:1 e capas simuladas por `data:image/svg+xml` em `portal_capas`): fileira "Esperando você" primeiro (mais antigo à esquerda), fileira por projeto; capas pedidas só para o que está perto da tela (contar chamadas a `rpc/portal_capas` e tokens: na abertura no máximo 6–12, e mais quando rola); setas aparecem/somem; `ArrowRight` não é necessário; clique num card abre `/revisao/<token>` (interceptar a navegação) e grava `lumos_voltar` com `?aba=catalogo` e `lumos_catalogo_rolagem`; recarregar com `?aba=catalogo` abre o catálogo e restaura rolagem (vertical e de cada fileira) uma única vez; sem vídeos: a aba não aparece; 375 px sem rolagem horizontal da página (`document.documentElement.scrollWidth <= innerWidth`), tema escuro e claro (screenshots), foco por teclado visível, `prefers-reduced-motion` sem transição.
- [ ] **Step 4: Commit, push, PR**

```bash
git add src/pages/portal/PortalCliente.tsx scripts/portal-harness.js
git commit -m "feat(portal): aba Catálogo no menu, com volta do vídeo na mesma posição

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin feat/portal-catalogo
gh pr create --repo caiorlacerda/comercial-lumos --base main --head feat/portal-catalogo --title "feat(portal): catálogo de vídeos estilo Netflix" --body "<o que o cliente vê, como testar, tráfego de capas, prints>"
```

---

# B2 — Prazo de revisão e lembrete (branch `feat/portal-prazo-revisao`, a partir de `origin/main`; pode ser feito depois do B1 mesclado)

### Task 5: Coluna, dias úteis e `revisoes[]` na visão pública

**Files:**
- Create: `supabase/migrations/2026102406_portal_prazo_revisao.sql`

**Interfaces:**
- Produces: coluna `client_portals.prazo_revisao_dias`; função interna `portal_somar_dias_uteis(date, integer) → date`; `portal_visao_projetos(text)` estendida, cada projeto ganha `"revisoes": [{ "review_token": "…", "n_versoes": 3, "prazo": "2026-10-30" | null }]`.

- [ ] **Step 1: Escrever o teste primeiro** em `/private/tmp/claude-501/-Users-caiorizzuttl-Documents-LUMOS-proposta-lumos/b1b45fad-8ff5-4369-9169-da8f1a7cda8e/scratchpad/teste-revisoes.sql` (RED sem a migration): cenário em `BEGIN … ROLLBACK` (com `ALTER TABLE notifications DISABLE TRIGGER trg_notify_push;` e `SET LOCAL session_replication_role = replica;`) com 1 cliente, 1 portal ativo (token `tok-rev`), 1 projeto `portal_visivel`, vídeos com `video_versions` (agrupe por `group_id`; 3 versões do mesmo grupo, a mais nova `EM_REVISAO_CLIENTE` com `entregue_em` numa quinta-feira; outro grupo `APROVADO`; outro grupo `EM_EDICAO`/status interno) e `review_links` ativos. Casos: (a) `prazo_revisao_dias = 3` e entrega na quinta => prazo na terça seguinte (pula sábado e domingo); (b) entrega na sexta => quarta; (c) `prazo_revisao_dias` NULL => `prazo` null; (d) vídeo `APROVADO` => `prazo` null e `n_versoes` correto; (e) vídeo interno não aparece; (f) vídeo sem link de revisão não aparece; (g) `n_versoes` = 3 no grupo de 3 versões; (h) portal sem a coluna preenchida continua devolvendo o JSON antigo (`projetos`, `pendencias_cliente`, `boas_vindas_pendentes`) intacto.
- [ ] **Step 2: Migration**

```sql
-- PORTAL DO CLIENTE (Pacote B): prazo de revisão visível ao cliente e contagem de versões.
-- 1) Coluna de configuração por cliente (dias ÚTEIS; vazio = sem prazo). Padrão 3.
-- 2) portal_somar_dias_uteis: soma dias úteis (sábado e domingo não contam; feriados NÃO entram).
-- 3) portal_visao_projetos passa a devolver, por projeto, revisoes[{review_token, n_versoes, prazo}].
-- Pré-requisitos: 2026102403_portal_visao_projetos.sql.
DO $$
BEGIN
  IF to_regprocedure('public.portal_visao_projetos(text)') IS NULL OR to_regprocedure('public.portal_contexto(text)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102403_portal_visao_projetos.sql.';
  END IF;
END $$;

SET lock_timeout = '15s';

ALTER TABLE public.client_portals
  ADD COLUMN IF NOT EXISTS prazo_revisao_dias integer DEFAULT 3;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_portals_prazo_revisao_dias_check') THEN
    ALTER TABLE public.client_portals
      ADD CONSTRAINT client_portals_prazo_revisao_dias_check
      CHECK (prazo_revisao_dias IS NULL OR prazo_revisao_dias BETWEEN 1 AND 30);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.portal_somar_dias_uteis(p_data date, p_dias integer)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v date := p_data; n integer := 0;
BEGIN
  IF p_data IS NULL OR p_dias IS NULL THEN RETURN NULL; END IF;
  WHILE n < p_dias LOOP
    v := v + 1;
    IF extract(isodow FROM v) < 6 THEN n := n + 1; END IF;
  END LOOP;
  RETURN v;
END; $$;
REVOKE ALL ON FUNCTION public.portal_somar_dias_uteis(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_somar_dias_uteis(date, integer) TO service_role;
```
Em seguida, **a função inteira** `portal_visao_projetos` copiada de `supabase/migrations/2026102403_portal_visao_projetos.sql` (versão atual em `main`), com estas duas mudanças: (i) declarar `v_prazo integer;` e, logo depois de obter `v_ctx` e tratar o erro, `SELECT cp.prazo_revisao_dias INTO v_prazo FROM client_portals cp WHERE cp.token = p_token AND cp.active;`; (ii) dentro de `jsonb_build_object(...)` de cada projeto, depois de `'equipe', ...`, acrescentar:

```sql
        'revisoes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'review_token', rt.token,
                   'n_versoes', nv.n,
                   'prazo', CASE WHEN e.status = 'EM_REVISAO_CLIENTE' AND v_prazo IS NOT NULL
                                 THEN public.portal_somar_dias_uteis(
                                        (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date,
                                        v_prazo)
                            END))
          FROM (
            SELECT DISTINCT ON (COALESCE(vv.group_id, vv.id)) vv.*
            FROM video_versions vv
            WHERE vv.project_id = p.id
              AND vv.status IN ('EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO')
            ORDER BY COALESCE(vv.group_id, vv.id), vv.versao DESC
          ) e
          JOIN LATERAL (
            SELECT rl.token FROM review_links rl
            WHERE rl.group_id = e.group_id AND rl.active
            ORDER BY rl.created_at DESC LIMIT 1
          ) rt ON true
          JOIN LATERAL (
            SELECT count(*)::int AS n FROM video_versions x
            WHERE COALESCE(x.group_id, x.id) = COALESCE(e.group_id, e.id)
          ) nv ON true
        ), '[]'::jsonb)
```
Mesmas permissões de antes ao final (`REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO anon, authenticated, service_role;`), guarda inicial (acima), e uma CONFERÊNCIA como **último** statement: `portal_visao_projetos` anon/authenticated = true/true; `portal_somar_dias_uteis` anon/authenticated = false/false; e `SELECT count(*) AS portais, count(*) FILTER (WHERE prazo_revisao_dias IS NOT NULL) AS com_prazo FROM client_portals` (informa quantos portais ganham o padrão de 3 dias). Comentário final de rollback.
- [ ] **Step 3: Aplicar no banco local duas vezes e rodar o teste** (GREEN); conferir que os campos antigos do JSON não mudaram (comparar chaves de `jsonb_object_keys` do projeto antes e depois, só `revisoes` a mais).
- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026102406_portal_prazo_revisao.sql
git commit -m "feat(portal): prazo de revisão por cliente e contagem de versões na visão pública

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6: Lembrete interno e rotina diária

**Files:**
- Create: `supabase/migrations/2026102407_portal_lembrete_revisao.sql`, `supabase/migrations/2026102408_portal_lembrete_cron.sql`

**Interfaces:**
- Produces: tabela `portal_lembretes_revisao(group_id uuid PK, ultimo_em timestamptz, vezes int)`; função `portal_lembrar_revisoes() → integer` (quantidade de lembretes criados); job de cron `portal-lembrar-revisoes` (`0 12 * * *`).

- [ ] **Step 1: Teste primeiro** (RED/GREEN, `BEGIN…ROLLBACK`, gatilho de push desligado): `teste-lembrete.sql` com: (a) vídeo esperando, prazo vencido há 2 dias => 1 notificação por destinatário (admin ativo não oculto + contato do portal), `event_type = 'cliente_atrasado_revisao'`, link `/producao/projetos?projectId=<id>&tab=entregas`, título com nome do cliente, dias de espera e nome do vídeo; (b) segunda execução imediata => 0 novas (dentro de 3 dias); (c) forçando `ultimo_em` para 4 dias atrás => nova rodada e `vezes = 2`; (d) automação `portal_revisao_lembra` desligada (linha em `automacoes` com `ativa = false`) => 0 notificações e NENHUMA linha em `portal_lembretes_revisao`; (e) cliente com `prazo_revisao_dias` NULL => nada; (f) prazo ainda não vencido => nada; (g) vídeo `APROVADO`/`ALTERACOES_CLIENTE` => nada; (h) projeto com `portal_visivel = false` ou portal inativo => nada; (i) usuário logado fora da equipe chamando a função => `sem_acesso`; visitante => `permission denied`.
- [ ] **Step 2: `2026102407_portal_lembrete_revisao.sql`**

```sql
-- PORTAL DO CLIENTE (Pacote B): lembrete interno quando um vídeo fica parado com o cliente além do prazo.
-- Pré-requisito: 2026102406_portal_prazo_revisao.sql. A rotina diária é um arquivo à parte (…408).
DO $$
BEGIN
  IF to_regprocedure('public.portal_somar_dias_uteis(date,integer)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102406_portal_prazo_revisao.sql.';
  END IF;
  IF to_regprocedure('public.automacao_ativa(text)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: falta automacao_ativa().';
  END IF;
END $$;

SET lock_timeout = '15s';

CREATE TABLE IF NOT EXISTS public.portal_lembretes_revisao (
  group_id  uuid PRIMARY KEY,
  ultimo_em timestamptz NOT NULL DEFAULT now(),
  vezes     integer NOT NULL DEFAULT 1
);
ALTER TABLE public.portal_lembretes_revisao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_lembretes_revisao FROM anon, authenticated;
GRANT ALL ON public.portal_lembretes_revisao TO service_role;

CREATE OR REPLACE FUNCTION public.portal_lembrar_revisoes()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hoje   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_avisar boolean;
  v_total  integer := 0;
  r        RECORD;
  u        RECORD;
  v_nome   text;
BEGIN
  -- O agendador roda sem usuário; quem estiver logado precisa ser da equipe.
  IF auth.uid() IS NOT NULL AND NOT public.is_team() THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  v_avisar := public.automacao_ativa('portal_revisao_lembra');
  IF NOT v_avisar THEN RETURN 0; END IF;

  FOR r IN
    SELECT COALESCE(e.group_id, e.id) AS grupo, e.versao, e.file_name,
           p.id AS project_id, p.client_id, c.name AS cliente,
           (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS entregue,
           cp.contact_user_ids,
           public.portal_somar_dias_uteis(
             (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date,
             cp.prazo_revisao_dias) AS prazo
    FROM (
      SELECT DISTINCT ON (COALESCE(vv.group_id, vv.id)) vv.*
      FROM video_versions vv
      ORDER BY COALESCE(vv.group_id, vv.id), vv.versao DESC
    ) e
    JOIN projects p ON p.id = e.project_id AND p.portal_visivel
    JOIN clients c ON c.id = p.client_id
    JOIN client_portals cp ON cp.client_id = p.client_id AND cp.active AND cp.prazo_revisao_dias IS NOT NULL
    WHERE e.status = 'EM_REVISAO_CLIENTE'
      AND EXISTS (SELECT 1 FROM review_links rl WHERE rl.group_id = e.group_id AND rl.active)
      AND public.portal_somar_dias_uteis(
            (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date,
            cp.prazo_revisao_dias) < v_hoje
      AND NOT EXISTS (
            SELECT 1 FROM portal_lembretes_revisao l
            WHERE l.group_id = COALESCE(e.group_id, e.id) AND l.ultimo_em > now() - interval '3 days')
    ORDER BY COALESCE(e.group_id, e.id)
  LOOP
    v_nome := regexp_replace(r.file_name, '\.[^.]+$', '');
    FOR u IN
      SELECT DISTINCT a.id FROM app_users a
      WHERE a.status = 'ativo' AND NOT a.hidden
        AND (a.role IN ('admin', 'atendimento') OR a.id = ANY (COALESCE(r.contact_user_ids, ARRAY[]::uuid[])))
    LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (
        u.id, 'cliente_atrasado_revisao', 'producao', 'normal',
        r.cliente || ' está há ' || (v_hoje - r.entregue) || ' dias sem responder: ' || v_nome || ' v' || lpad(r.versao::text, 2, '0'),
        'O prazo de revisão (' || to_char(r.prazo, 'DD/MM') || ') passou. Vale cobrar o retorno do cliente.',
        '/producao/projetos?projectId=' || r.project_id::text || '&tab=entregas',
        jsonb_build_object('project_id', r.project_id, 'group_id', r.grupo)
      );
    END LOOP;
    INSERT INTO portal_lembretes_revisao (group_id, ultimo_em, vezes) VALUES (r.grupo, now(), 1)
    ON CONFLICT (group_id) DO UPDATE SET ultimo_em = now(), vezes = portal_lembretes_revisao.vezes + 1;
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END; $$;

REVOKE ALL ON FUNCTION public.portal_lembrar_revisoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_lembrar_revisoes() TO authenticated, service_role;
```
Fim do arquivo: CONFERÊNCIA (último statement) com `has_function_privilege` de anon/authenticated para a função (esperado false/true; a trava de equipe está no corpo) e `has_table_privilege` da tabela (false), e comentário de rollback. **Atenção** (colocar no cabeçalho): ao rodar o cron do arquivo 408, todo vídeo que já esteja esperando o cliente além de 3 dias úteis recebe um lembrete na primeira rodada; para ver quantos, rodar antes a consulta de ensaio abaixo.

Consulta de ensaio (só lê; vai no cabeçalho do arquivo 408 e na descrição do PR):

```sql
SELECT c.name AS cliente, p.name AS projeto, e.file_name, e.versao,
       (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS entregue,
       public.portal_somar_dias_uteis((COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date, cp.prazo_revisao_dias) AS prazo
FROM (SELECT DISTINCT ON (COALESCE(vv.group_id, vv.id)) vv.* FROM video_versions vv ORDER BY COALESCE(vv.group_id, vv.id), vv.versao DESC) e
JOIN projects p ON p.id = e.project_id AND p.portal_visivel
JOIN clients c ON c.id = p.client_id
JOIN client_portals cp ON cp.client_id = p.client_id AND cp.active AND cp.prazo_revisao_dias IS NOT NULL
WHERE e.status = 'EM_REVISAO_CLIENTE'
  AND public.portal_somar_dias_uteis((COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date, cp.prazo_revisao_dias) < (now() AT TIME ZONE 'America/Sao_Paulo')::date
ORDER BY prazo;
```
- [ ] **Step 3: `2026102408_portal_lembrete_cron.sql`** no mesmo estilo do `2026102405_portal_saude_cron.sql` (ler o arquivo em `main`): guarda (schema `cron`, função `portal_lembrar_revisoes()`), `cron.unschedule` idempotente, `cron.schedule('portal-lembrar-revisoes', '0 12 * * *', $$SELECT public.portal_lembrar_revisoes()$$)`, conferência como último statement (`jobname, schedule, active, command, automacao_ativa('portal_revisao_lembra') AS lembretes_ligados`), cabeçalho em português com: ordem (só depois de 406 e 407 e da consulta de ensaio), o que acontece na primeira rodada (9h de Brasília do dia seguinte, ou 12h UTC), que desligar a automação **não** reenvia depois (a função nem anota quando está desligada, então ao religar sai tudo o que ainda estiver vencido), e como desligar o cron (comentado).
- [ ] **Step 4: Testar no banco local** (RED/GREEN), aplicar 406, 407 duas vezes; o 408 **somente** em `BEGIN…ROLLBACK` (confirmar `SELECT count(*) FROM cron.job WHERE jobname = 'portal-lembrar-revisoes'` = 0 no fim).
- [ ] **Step 5: Commits** (um por arquivo, `git add` explícito).

### Task 7: App interno — evento, automação e campo do prazo

**Files:**
- Modify: `src/lib/notifications/events.ts`, `src/pages/ConfiguracoesAutomacoes.tsx`, `src/components/producao/PortalModal.tsx`

- [ ] **Step 1: events.ts** (bloco PRODUÇÃO, depois de `PORTAL_SAUDE_PIORA`):

```ts
  CLIENTE_ATRASADO_REVISAO: { key: 'cliente_atrasado_revisao', category: 'producao', label: 'Cliente está há dias sem responder a revisão de um vídeo', defaultEnabled: true, priority: 'normal' },
```
- [ ] **Step 2: ConfiguracoesAutomacoes.tsx** (depois da entrada `portal_saude_avisa`):

```ts
  {
    chave: 'portal_revisao_lembra',
    titulo: 'Cliente atrasado na revisão de um vídeo',
    faz: 'Todo dia às 9h, a equipe é avisada dos vídeos que passaram do prazo de revisão sem resposta do cliente (de novo a cada 3 dias enquanto continuar parado). Desligada, ninguém é avisado; ao religar, os vencidos são avisados na rodada seguinte.',
    quem: null,
  },
```
- [ ] **Step 3: PortalModal.tsx** — campo "Prazo para o cliente revisar (dias úteis)" ao lado da antecedência das diárias, seguindo exatamente o padrão do campo `antecedencia_dias` (estado de input, `patch({ prazo_revisao_dias: n } as any, 'Prazo salvo.')`, valor vazio => `null` = sem prazo, 1 a 30, texto de ajuda: "Vídeos esperando o cliente mostram 'Responder até…'. Em branco = sem prazo."); incluir `prazo_revisao_dias: number | null` na interface `Portal` do modal. **Degradação:** se a coluna ainda não existir em produção, a leitura do portal pelo modal não pode quebrar: ler o campo como opcional (`undefined` => esconder o campo) e só mostrar o campo quando a leitura do portal trouxe a chave `prazo_revisao_dias` (confira como o modal lê `client_portals`; se a consulta lista colunas, não a quebre).
- [ ] **Step 4: Verificar** `tsc` (sem linhas de PortalModal/events/Automacoes) e, se houver como, navegador (best-effort; sem login local, dizer que não foi possível); commit.

### Task 8: Front do portal — prazo, versões e rótulos

**Files:**
- Modify: `src/pages/portal/tipos.ts`, `src/pages/portal/formatacao.ts`, `src/pages/portal/abas/projeto/Geral.tsx`, `src/pages/portal/catalogo/CardCatalogo.tsx`, `src/pages/portal/abas/Catalogo.tsx`, `src/pages/portal/catalogo.ts`, `src/pages/portal/PortalCliente.tsx`, `src/pages/portalCliente.css.ts`

- [ ] **Step 1: tipos.ts**: em `VisaoProjeto` acrescentar `revisoes?: { review_token: string; n_versoes: number; prazo: string | null }[];`.
- [ ] **Step 2: formatacao.ts**:

```ts
/** "Responder até 30/10" enquanto o prazo vale; "Aguardando seu retorno" depois (sem data, sem cobrança). */
export const rotuloPrazo = (prazo?: string | null): { texto: string; vencido: boolean } | null => {
  if (!prazo) return null;
  const d = prazo.slice(0, 10);
  const h = new Date();
  const hoje = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
  return d < hoje
    ? { texto: 'Aguardando seu retorno', vencido: true }
    : { texto: `Responder até ${dia(d)}`, vencido: false };
};
```
- [ ] **Step 3: Juntar `revisoes` ao catálogo e ao cartão de pendência.** Em `catalogo.ts` aceitar um segundo parâmetro opcional `extras?: Record<string, { nVersoes: number; prazo: string | null }>` (chave = review_token) e preencher `ItemCatalogo.nVersoes` e `ItemCatalogo.prazo`; o shell monta `extras` a partir de `visao?.projetos[].revisoes` (com `?? []`) e passa para `Catalogo`, que passa às fileiras. No `CardCatalogo`: meta `v03 · 3 versões` quando `nVersoes > 1`; abaixo, a linha do prazo (`rotuloPrazo`) só para vídeo `EM_REVISAO_CLIENTE`. No `Geral.tsx`, o item de pendência do vídeo ganha o prazo: se `rotuloPrazo` existir e não vencido, `prazo` do item recebe a data (o componente `Pendencias` já escreve "até dd/mm"); se vencido, acrescentar " · aguardando seu retorno" ao texto e não passar `prazo`.
- [ ] **Step 5: Verificar** harness com `window.__visao` contendo `revisoes` (um prazo futuro, um vencido, um null, `n_versoes` 1 e 3) e sem `revisoes` (sem `revisoes` o card mostra só `v03`, sem linha de prazo), `tsc`, tema claro/escuro, 375 px; commit, push, PR (descrição com a consulta de ensaio e a ordem de execução do SQL: 406, 407, ensaio, 408).

---

## Autoconferência contra o desenho
- Catálogo: aba, fileiras (espera + projetos), card, rolagem, capas sob demanda, volta na mesma posição: Tasks 1-4.
- Prazo: coluna + cálculo + `revisoes[]`: Task 5; lembrete + tabela + automação + cron: Tasks 6-7; textos e versões no front: Task 8.
- Segurança: Tasks 5-6 (funções e tabela só do servidor; `portal_visao_projetos` única aberta).
- Fora de escopo respeitado: sem botão de download, sem e-mail, sem janela de detalhe.
