import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import DesktopNav from '@/components/layout/DesktopNav';
import MobileHeader from '@/components/layout/MobileHeader';
import MobileSubNav from '@/components/layout/MobileSubNav';
import MobileTabBar from '@/components/layout/MobileTabBar';
import CommandPalette from '@/components/common/CommandPalette';
import PageTransition from '@/components/layout/PageTransition';
import { WikiProvider } from '@/context/WikiContext';
import FundoDeck from '@/components/common/FundoDeck';
import { carregarFontesDeck } from '@/lib/fontesDeck';
import { useVisualNovo } from '@/lib/visualNovo';
import BarraDeCarregamento from '@/components/ui/BarraDeCarregamento';
import { EsqueletoPagina } from '@/components/ui/Esqueleto';
import { useBarraDeCarregamento } from '@/lib/progressoDeCarregamento';

/** Enquanto o código da página chega: esqueleto no lugar do círculo e a barra do topo correndo. */
function FallbackDePagina() {
  useBarraDeCarregamento(true);
  return <EsqueletoPagina />;
}

// Largura do conteúdo por tipo de tela (só com o visual novo): formulário até 768px, painel até 1280px,
// lista/tabela até 1600px. As demais rotas (editor, board, timeline, wiki) ficam livres.
const LARGURA_POR_ROTA: Record<string, 'formulario' | 'painel' | 'lista'> = {
  '/configuracoes': 'formulario', '/configuracoes/notificacoes': 'formulario', '/configuracoes/automacoes': 'formulario',
  '/comunicados': 'formulario', '/mural': 'formulario', '/notificacoes': 'formulario',
  '/': 'painel', '/comercial': 'painel', '/financeiro': 'painel', '/financeiro/relatorios': 'painel',
  '/financeiro/fluxo-de-caixa': 'painel', '/financeiro/configuracao': 'painel', '/producao': 'painel', '/monitoramento': 'painel',
  '/orcamentos': 'lista', '/clientes': 'lista', '/catalogo': 'lista', '/templates': 'lista', '/equipe': 'lista', '/auditoria': 'lista',
  '/financeiro/contas': 'lista', '/financeiro/custos-projeto': 'lista', '/financeiro/movimentacoes': 'lista', '/financeiro/notas': 'lista',
  '/financeiro/reembolso': 'lista', '/financeiro/custos-fixos': 'lista', '/producao/fornecedores': 'lista', '/producao/equipamentos': 'lista',
  '/producao/acessos': 'lista', '/producao/templates-tarefas': 'lista', '/ordem-do-dia': 'lista',
};

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const visualNovo = useVisualNovo();

  // Visual do deck da Lumos (DM Sans + JetBrains Mono): só carrega com o visual novo ligado.
  useEffect(() => { if (visualNovo) carregarFontesDeck(); }, [visualNovo]);

  // As views de produção compartilham layout — agrupá-las sob a mesma key evita
  // que o cross-fade global re-monte a nav ao trocar de view.
  const PRODUCAO_VIEWS = ['/producao', '/producao/dashboard', '/producao/board', '/producao/schedule', '/producao/cronograma-edicao'];
  const transitionKey = PRODUCAO_VIEWS.includes(location.pathname) ? '__producao_views__' : location.pathname;

  return (
    <WikiProvider>
    <div className="flex flex-col h-screen overflow-hidden bg-lumos-bg transition-colors duration-300 font-work-sans">
      {/* Header + sub-nav (só celular, abaixo de 768px; de 768px pra cima entra o menu lateral) */}
      <MobileHeader />
      <MobileSubNav />

      <div className="flex flex-1 overflow-hidden">
        {/* Navegação desktop: rail fixo de seções + painel expansível.
            relative z-30 garante que o rail fique sempre acima do conteúdo da
            página (ex.: páginas full-bleed como a Wiki) e receba os cliques. */}
        <div className="hidden md:flex flex-shrink-0 relative z-30">
          <DesktopNav />
        </div>

        {/* Conteúdo */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-lumos-bg transition-colors duration-300 pb-20 md:pb-0">
          {/* Fundo de luz difusa fixo atrás de todas as telas; o conteúdo (relative z-10) fica acima */}
          {visualNovo && <FundoDeck />}
          <PageTransition key={transitionKey}>
            <div data-largura={visualNovo ? LARGURA_POR_ROTA[location.pathname] : undefined} className={visualNovo ? 'lumos-deck relative z-10 w-full p-4 md:p-6 lg:p-8' : 'w-full p-4 md:p-6 lg:p-8'}>
              <React.Suspense fallback={<FallbackDePagina />}>
                {children}
              </React.Suspense>
            </div>
          </PageTransition>
        </main>
      </div>

      {/* Barra fina de carregamento no topo (aparece só se demorar mais que ~150 ms) */}
      <BarraDeCarregamento />

      {/* Tab bar inferior (só celular) */}
      <MobileTabBar />

      {/* Busca global (Cmd+K) */}
      <CommandPalette />
    </div>
    </WikiProvider>
  );
}
