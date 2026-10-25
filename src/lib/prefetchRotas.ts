/**
 * Pré-carrega o código das páginas principais para o clique já encontrar tudo pronto.
 * - Ao passar o mouse (ou tocar) num link do menu, carrega aquela página.
 * - Com o app parado, carrega em segundo plano as páginas mais usadas.
 * Os `import()` abaixo são os mesmos do `lazy()` do App: o navegador aproveita o mesmo arquivo.
 */
const ROTAS: Record<string, () => Promise<unknown>> = {
  '/': () => Promise.all([import('@/pages/Home'), import('@/pages/HomeNova')]),
  '/producao': () => import('@/pages/ProducaoOverview'),
  '/producao/projetos': () => import('@/pages/Projetos'),
  '/producao/agenda': () => import('@/pages/Agenda'),
  '/producao/revisao-de-videos': () => import('@/pages/RevisaoDeVideos'),
  '/producao/board': () => import('@/pages/ProducaoBoard'),
  '/producao/fornecedores': () => import('@/pages/Fornecedores'),
  '/producao/equipamentos': () => import('@/pages/Equipamentos'),
  '/comercial': () => import('@/pages/Dashboard'),
  '/orcamentos': () => import('@/pages/Budgets'),
  '/clientes': () => import('@/pages/Clients'),
  '/financeiro': () => import('@/pages/FinanceiroDashboard'),
  '/financeiro/movimentacoes': () => import('@/pages/FinanceiroMovimentacoes'),
  '/financeiro/contas': () => import('@/pages/FinanceiroContas'),
  '/equipe': () => import('@/pages/Equipe'),
  '/wiki': () => import('@/pages/Wiki'),
};

const feitas = new Set<string>();

export function prefetchRota(caminho: string) {
  const chave = caminho.replace(/\/+$/, '') || '/';
  if (feitas.has(chave)) return;
  const carregar = ROTAS[chave];
  if (!carregar) return;
  feitas.add(chave);
  carregar().catch(() => feitas.delete(chave)); // falhou (rede): tenta de novo numa próxima passada
}

// Páginas que mais se abrem, carregadas quando o app fica parado.
const PRINCIPAIS = ['/producao/projetos', '/producao/agenda', '/producao', '/producao/revisao-de-videos', '/orcamentos', '/financeiro', '/'];

export function iniciarPrefetch() {
  if (typeof window === 'undefined') return;
  const conexao = (navigator as any).connection;
  if (conexao?.saveData) return; // quem economiza dados não quer download extra

  // Passou o mouse / tocou num link interno do app: carrega a página dele.
  const aoPassar = (e: Event) => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.origin !== window.location.origin) return;
    prefetchRota(a.pathname);
  };
  document.addEventListener('pointerover', aoPassar, { passive: true });
  document.addEventListener('touchstart', aoPassar, { passive: true });
  document.addEventListener('focusin', aoPassar);

  // Com o app parado, as principais, uma de cada vez.
  const ocioso = (window as any).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1500));
  let i = 0;
  const proxima = () => {
    if (i >= PRINCIPAIS.length) return;
    prefetchRota(PRINCIPAIS[i++]);
    ocioso(proxima, { timeout: 4000 });
  };
  window.setTimeout(() => ocioso(proxima, { timeout: 4000 }), 2500);
}
