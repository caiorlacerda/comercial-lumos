import React from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import DesktopNav from '@/components/layout/DesktopNav';
import MobileHeader from '@/components/layout/MobileHeader';
import MobileSubNav from '@/components/layout/MobileSubNav';
import MobileTabBar from '@/components/layout/MobileTabBar';
import CommandPalette from '@/components/common/CommandPalette';
import PageTransition from '@/components/layout/PageTransition';
import { WikiProvider } from '@/context/WikiContext';

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  // As views de produção compartilham layout — agrupá-las sob a mesma key evita
  // que o cross-fade global re-monte a nav ao trocar de view.
  const PRODUCAO_VIEWS = ['/producao', '/producao/dashboard', '/producao/board', '/producao/schedule', '/producao/cronograma-edicao'];
  const transitionKey = PRODUCAO_VIEWS.includes(location.pathname) ? '__producao_views__' : location.pathname;

  return (
    <WikiProvider>
    <div className="flex flex-col h-screen overflow-hidden bg-lumos-bg transition-colors duration-300 font-work-sans">
      {/* Header + sub-nav (só mobile) */}
      <MobileHeader />
      <MobileSubNav />

      <div className="flex flex-1 overflow-hidden">
        {/* Navegação desktop: rail fixo de seções + painel expansível.
            relative z-30 garante que o rail fique sempre acima do conteúdo da
            página (ex.: páginas full-bleed como a Wiki) e receba os cliques. */}
        <div className="hidden lg:flex flex-shrink-0 relative z-30">
          <DesktopNav />
        </div>

        {/* Conteúdo */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-lumos-bg transition-colors duration-300 pb-20 lg:pb-0">
          <AnimatePresence mode="wait">
            <PageTransition key={transitionKey}>
              <div className="w-full p-4 lg:p-8">
                <React.Suspense
                  fallback={
                    <div className="flex items-center justify-center py-32">
                      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-lumos-yellow" />
                    </div>
                  }
                >
                  {children}
                </React.Suspense>
              </div>
            </PageTransition>
          </AnimatePresence>
        </main>
      </div>

      {/* Tab bar inferior (só mobile) */}
      <MobileTabBar />

      {/* Busca global (Cmd+K) */}
      <CommandPalette />
    </div>
    </WikiProvider>
  );
}
