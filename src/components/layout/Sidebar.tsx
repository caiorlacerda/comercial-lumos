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
              {getSectionItems(currentSection.id, ctx).map((item) => (
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
              ))}
            </div>

            {/* Árvore de clientes → projetos (só na seção Produção) */}
            {currentSection.id === 'producao' && can('ordem_do_dia') && (
              <SidebarProjectTree />
            )}
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
            <PageTransition key={location.pathname}>
              <div className="w-full p-4 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {children}
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

