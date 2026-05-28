import React, { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Users,
  BookOpen,
  LayoutDashboard,
  Settings,
  FileText,
  FileStack,
  BarChart3,
  ArrowUpCircle,
  ArrowDownCircle,
  Receipt,
  Briefcase,
  ShieldCheck,
  ClipboardList,
  X,
  TrendingUp,
  Landmark,
  CalendarDays,
  Truck,
  Users2
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/context/ThemeContext';
import { useLayout, SectionType } from '@/context/LayoutContext';
import Topbar from '@/components/layout/Topbar';
import { clsx } from 'clsx';

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const { can, isAdmin } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const { activeSection, setActiveSection, mobileSidebarOpen, setMobileSidebarOpen } = useLayout();

  // Bloqueia scroll do body quando drawer aberto
  useEffect(() => {
    if (mobileSidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileSidebarOpen]);

  const navigation = [
    {
      title: 'COMERCIAL',
      visible: isAdmin,
      items: [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/', end: true },
        { icon: Users, label: 'Clientes', path: '/clientes' },
        { icon: BookOpen, label: 'Orçamentos', path: '/orcamentos' },
        { icon: FileText, label: 'Catálogo', path: '/catalogo' },
        { icon: FileStack, label: 'Templates', path: '/templates' },
      ]
    },
    {
      title: 'PRODUÇÃO',
      visible: can('ordem_do_dia') || can('fornecedores'),
      items: [
        { icon: CalendarDays, label: 'Ordem do Dia', path: '/ordem-do-dia', permission: 'ordem_do_dia' },
        { icon: Truck, label: 'Fornecedores', path: '/producao/fornecedores', permission: 'fornecedores' },
      ].filter(item => can(item.permission))
    },
    {
      title: 'FINANCEIRO',
      visible: true,
      items: [
        { icon: BarChart3, label: 'Dashboard Fin.', path: '/financeiro', permission: 'financeiro_dashboard', end: true },
        { icon: TrendingUp, label: 'Fluxo de Caixa', path: '/financeiro/fluxo-de-caixa', permission: 'financeiro_admin' },
        { icon: Landmark, label: 'Custos Fixos', path: '/financeiro/custos-fixos', permission: 'financeiro_admin' },
        { icon: ArrowUpCircle, label: 'Contas a Pagar', path: '/financeiro/contas-pagar', permission: 'financeiro_admin' },
        { icon: ArrowDownCircle, label: 'Contas a Receber', path: '/financeiro/contas-receber', permission: 'financeiro_admin' },
        { icon: Briefcase, label: 'Custos de Projeto', path: '/financeiro/custos-projeto', permission: 'custos_projeto' },
        { icon: Receipt, label: 'Reembolso', path: '/financeiro/reembolso', permission: 'reembolso' },
      ].filter(item => {
        if (item.permission === 'financeiro_admin') return isAdmin;
        if (item.permission === 'financeiro_dashboard') return isAdmin;
        return can(item.permission);
      })
    },
    {
      title: 'SISTEMA',
      visible: isAdmin,
      items: [
        { icon: ShieldCheck, label: 'Usuários', path: '/usuarios' },
        { icon: ClipboardList, label: 'Auditoria', path: '/auditoria' },
      ]
    },
    {
      title: 'CONTA',
      visible: true,
      items: [
        { icon: Users2, label: 'Equipe', path: '/equipe' }, // Nova rota /equipe (Tarefa 3)
        { icon: Settings, label: 'Configurações', path: '/configuracoes' },
      ]
    }
  ];

  const sections = [
    { id: 'comercial' as SectionType, label: 'Comercial', visible: isAdmin },
    { id: 'producao' as SectionType, label: 'Produção', visible: can('ordem_do_dia') || can('fornecedores') },
    { id: 'financeiro' as SectionType, label: 'Financeiro', visible: true },
    { id: 'sistema' as SectionType, label: 'Sistema', visible: isAdmin },
    { id: 'conta' as SectionType, label: 'Conta', visible: true },
  ];

  const sectionKeyMap: Record<string, string> = {
    comercial: 'COMERCIAL',
    producao: 'PRODUÇÃO',
    financeiro: 'FINANCEIRO',
    sistema: 'SISTEMA',
    conta: 'CONTA'
  };

  const activeSectionTitle = sectionKeyMap[activeSection];
  const visibleSections = navigation.filter(sec => sec.visible && sec.items.length > 0);
  const activeSectionData = visibleSections.find(sec => sec.title === activeSectionTitle);
  const currentSection = activeSectionData || visibleSections[0];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-lumos-surface">
      {/* Header */}
      <div className="p-6 flex items-center justify-between flex-shrink-0">
        <img
          src={theme === 'dark' ? "/logo/Logotipo-Branco-Alpha.svg" : "/logo/Logotipo-Preto-Alpha.svg"}
          alt="Lumos Logo"
          className="h-8 transition-all duration-300"
        />
        <button
          onClick={() => setMobileSidebarOpen(false)}
          className="lg:hidden p-1 rounded-lg text-lumos-text-secondary hover:text-lumos-text-primary flex items-center justify-center hover:bg-lumos-text-secondary/10 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile Section Selector */}
      <div className="lg:hidden px-6 pb-4 border-b border-lumos-border flex gap-2 overflow-x-auto custom-scrollbar flex-shrink-0">
        {sections.map(sec => sec.visible && (
          <button
            key={sec.id}
            onClick={() => setActiveSection(sec.id)}
            className={clsx(
              "px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all",
              activeSection === sec.id
                ? "bg-lumos-yellow/15 text-lumos-yellow border border-lumos-yellow/20"
                : "text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 border border-transparent"
            )}
          >
            {sec.label}
          </button>
        ))}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 overflow-y-auto custom-scrollbar">
        {currentSection && (
          <div className="space-y-1">
            <h3 className="px-3 text-[10px] font-bold tracking-widest text-lumos-text-secondary mb-3 opacity-50 uppercase">
              {currentSection.title}
            </h3>
            <div className="space-y-1">
              {currentSection.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={(item as any).end}
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

  return (
    <div className="flex flex-col min-h-screen bg-lumos-bg transition-colors duration-300 font-work-sans">
      {/* Fixed Topbar */}
      <Topbar />

      <div className="flex flex-1 relative">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex w-64 bg-lumos-surface border-r border-lumos-border flex-col fixed inset-y-0 top-16 shadow-sm z-30 transition-colors duration-300">
          {sidebarContent}
        </aside>

        {/* Mobile Sidebar overlay and drawer */}
        <>
          <div
            className={clsx(
              "lg:hidden fixed inset-0 bg-black/60 z-40 transition-opacity duration-300",
              mobileSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )}
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside
            className={clsx(
              "lg:hidden fixed inset-y-0 left-0 w-72 bg-lumos-surface border-r border-lumos-border flex flex-col z-50 shadow-xl transition-transform duration-300",
              mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            {sidebarContent}
          </aside>
        </>

        {/* Main Content */}
        <main className="flex-1 lg:ml-64 min-h-screen bg-lumos-bg transition-colors duration-300">
          <div className="w-full p-4 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
