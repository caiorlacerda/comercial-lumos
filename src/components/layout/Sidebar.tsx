import React, { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/context/ThemeContext';
import { useLayout, SectionType } from '@/context/LayoutContext';
import Topbar from '@/components/layout/Topbar';
import MobileTabBar from '@/components/layout/MobileTabBar';
import MobileSubNav from '@/components/layout/MobileSubNav';
import { getVisibleSections, getSectionItems } from '@/lib/navigation';
import SidebarProjectTree from '@/components/layout/SidebarProjectTree';
import CommandPalette from '@/components/common/CommandPalette';
import { clsx } from 'clsx';
import { AnimatePresence } from 'framer-motion';
import PageTransition from '@/components/layout/PageTransition';

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const { can, isAdmin } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const { activeSection, navigateToSection } = useLayout();

  const ctx = { can, isAdmin };
  const visibleSecs = getVisibleSections(ctx);
  const currentSection = visibleSecs.find(s => s.id === activeSection) || visibleSecs[0];

  // As views de produção compartilham um layout (nav de pills fixa) — agrupá-las
  // sob a mesma key evita que o cross-fade global re-monte (e "pisque") a nav ao
  // trocar de view; a transição do conteúdo é feita dentro do ProducaoLayout.
  const PRODUCAO_VIEWS = ['/producao', '/producao/dashboard', '/producao/board', '/producao/schedule', '/producao/cronograma-edicao'];
  const transitionKey = PRODUCAO_VIEWS.includes(location.pathname) ? '__producao_views__' : location.pathname;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-lumos-surface">
      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 overflow-y-auto custom-scrollbar">
        {currentSection && (
          <div className="space-y-1">
            <h3 className="px-3 text-[10px] font-bold tracking-widest text-lumos-text-secondary mb-3 opacity-50 uppercase">
              {currentSection.title}
            </h3>
            <div className="space-y-1">
              {getSectionItems(currentSection.id, ctx).map((item) => {
                // Na Produção, o item "Projetos" é um dropdown com a árvore
                // de clientes → projetos (estilo Momentum)
                if (currentSection.id === 'producao' && item.path === '/producao') {
                  return <SidebarProjectTree key={item.path} />;
                }
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.end}
                    className={({ isActive }) => clsx(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lumos text-sm font-bold transition-all group",
                      isActive
                        ? "bg-lumos-yellow/10 text-lumos-yellow"
                        : "text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5"
                    )}
                  >
                    <item.icon className="w-4 h-4 flex-shrink-0" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-lumos-border/50 flex-shrink-0 text-center">
        <p className="text-[9px] text-lumos-text-secondary font-semibold uppercase tracking-widest opacity-40">
          Lumos Studio © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );

  const isHome = activeSection === 'home';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-lumos-bg transition-colors duration-300 font-work-sans">
      {/* Fixed Topbar */}
      <Topbar />
      <MobileSubNav />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Desktop Sidebar */}
        {!isHome && (
          <aside className="hidden lg:flex w-64 bg-lumos-surface border-r border-lumos-border flex-col fixed inset-y-0 top-16 shadow-sm z-30 transition-colors duration-300 animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </aside>
        )}

        {/* Main Content */}
        <main className={clsx(
          "flex-1 overflow-y-auto bg-lumos-bg transition-colors duration-300 pb-20 lg:pb-0",
          !isHome && "lg:ml-64"
        )}>
          <AnimatePresence mode="wait">
            <PageTransition key={transitionKey}>
              <div className="w-full p-4 lg:p-8">
                {/* Suspense interno: o carregamento de um chunk lazy mostra o
                    loader só na área de conteúdo, mantendo topbar/sidebar
                    estáveis (sem "piscada" de tela inteira) */}
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

      {/* Mobile Bottom Tab Bar */}
      <MobileTabBar />

      {/* Busca global (Cmd+K) */}
      <CommandPalette />
    </div>
  );
}

