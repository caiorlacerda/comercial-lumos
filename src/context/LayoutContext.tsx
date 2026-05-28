import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export type SectionType = 'comercial' | 'producao' | 'financeiro' | 'sistema' | 'conta';

interface LayoutContextType {
  activeSection: SectionType;
  setActiveSection: (section: SectionType) => void;
  navigateToSection: (section: SectionType) => void;
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
  const navigate = useNavigate();
  const { isAdmin, can } = useAuth();
  
  const [activeSection, setActiveSection] = useState<SectionType>(() => 
    getSectionFromPath(location.pathname)
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Sincroniza a seção ativa ao navegar por links ou URL direta
  useEffect(() => {
    setActiveSection(getSectionFromPath(location.pathname));
    setMobileSidebarOpen(false); // Fecha o drawer mobile ao navegar
  }, [location.pathname]);

  const navigateToSection = (sectionId: SectionType) => {
    let targetPath = '/';

    if (sectionId === 'comercial') {
      if (isAdmin) targetPath = '/';
      else return;
    } else if (sectionId === 'producao') {
      if (can('ordem_do_dia')) targetPath = '/producao/dashboard';
      else if (can('fornecedores')) targetPath = '/producao/fornecedores';
      else return;
    } else if (sectionId === 'financeiro') {
      if (isAdmin) targetPath = '/financeiro';
      else if (can('custos_projeto')) targetPath = '/financeiro/custos-projeto';
      else if (can('reembolso')) targetPath = '/financeiro/reembolso';
      else return;
    } else if (sectionId === 'sistema') {
      if (isAdmin) targetPath = '/usuarios';
      else return;
    } else if (sectionId === 'conta') {
      targetPath = '/equipe';
    }

    setActiveSection(sectionId);
    navigate(targetPath);
  };

  return (
    <LayoutContext.Provider value={{
      activeSection,
      setActiveSection,
      navigateToSection,
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
