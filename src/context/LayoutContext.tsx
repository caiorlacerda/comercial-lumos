import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export type SectionType = 'comercial' | 'producao' | 'financeiro' | 'sistema' | 'conta';

interface LayoutContextType {
  activeSection: SectionType;
  setActiveSection: (section: SectionType) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export function getSectionFromPath(path: string): SectionType {
  if (path.startsWith('/financeiro')) return 'financeiro';
  if (path.startsWith('/ordem-do-dia') || path.startsWith('/producao')) return 'producao';
  if (path === '/usuarios' || path === '/auditoria') return 'sistema';
  if (path === '/configuracoes' || path === '/equipe') return 'conta';
  return 'comercial';
}

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [activeSection, setActiveSection] = useState<SectionType>(() => 
    getSectionFromPath(location.pathname)
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Sincroniza a seção ativa ao navegar por links ou URL direta
  useEffect(() => {
    setActiveSection(getSectionFromPath(location.pathname));
    setMobileSidebarOpen(false); // Fecha o drawer mobile ao navegar
  }, [location.pathname]);

  return (
    <LayoutContext.Provider value={{
      activeSection,
      setActiveSection,
      mobileSidebarOpen,
      setMobileSidebarOpen
    }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (context === undefined) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
}
