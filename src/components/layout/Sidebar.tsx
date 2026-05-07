import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Users,
  BookOpen,
  LogOut,
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
  Menu,
  X,
  TrendingUp,
  Landmark,
  CalendarDays
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/context/ThemeContext';
import ThemeToggle from '@/components/common/ThemeToggle';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const { signOut, user, profile, can, isAdmin } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Fecha o drawer ao navegar
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Bloqueia scroll do body quando drawer aberto
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

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
      visible: can('ordem_do_dia'),
      items: [
        { icon: CalendarDays, label: 'Ordem do Dia', path: '/ordem-do-dia', permission: 'ordem_do_dia' },
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
        { icon: Settings, label: 'Configurações', path: '/configuracoes' },
      ]
    }
  ];

  const sidebarContent = (
    <>
      <div className="p-6 flex items-center justify-between">
        <img
          src={theme === 'dark' ? "/logo/Logotipo-Branco-Alpha.svg" : "/logo/Logotipo-Preto-Alpha.svg"}
          alt="Lumos Logo"
          className="h-8 transition-all duration-300"
        />
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1 rounded-lg text-lumos-text-secondary hover:text-lumos-text-primary"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-4 space-y-6 mt-4 overflow-y-auto custom-scrollbar">
        {navigation.map((section) => section.visible && section.items.length > 0 && (
          <div key={section.title} className="space-y-1">
            <h3 className="px-3 text-[10px] font-bold tracking-widest text-lumos-text-secondary mb-2 opacity-50">
              {section.title}
            </h3>
            {section.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={(item as any).end}
                className={({ isActive }) => cn(
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
        ))}
      </nav>

      <div className="p-4 border-t border-lumos-border space-y-2">
        <ThemeToggle />
        <div className="flex items-center gap-3 px-3 py-4 border-t border-lumos-border/50">
          <div className="w-8 h-8 rounded-full bg-lumos-yellow flex items-center justify-center text-black font-black text-xs shadow-sm overflow-hidden ring-2 ring-lumos-yellow/20 flex-shrink-0">
            {user?.user_metadata?.avatar_url ? (
              <img src={user.user_metadata.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span>
                {profile?.full_name
                  ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                  : user?.email?.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex flex-col overflow-hidden min-w-0">
            <span className="text-sm font-bold text-lumos-text-primary truncate">
              {profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0]}
            </span>
            <span className="text-[10px] text-lumos-text-secondary truncate font-medium uppercase tracking-wider">
              {profile?.role === 'admin' ? 'Administrador' : profile?.role === 'producao' ? 'Produção' : 'Colaborador'}
            </span>
          </div>
        </div>

        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lumos text-sm font-bold text-red-500 hover:bg-red-500/10 w-full transition-all group"
        >
          <LogOut className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
          Sair
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-lumos-bg transition-colors duration-300 font-work-sans">
      {/* Sidebar desktop — sempre visível em lg+ */}
      <aside className="hidden lg:flex w-64 bg-lumos-surface border-r border-lumos-border flex-col fixed inset-y-0 shadow-sm z-30 transition-colors duration-300">
        {sidebarContent}
      </aside>

      {/* Sidebar mobile — drawer sobreposto */}
      <>
        {/* Overlay */}
        <div
          className={cn(
            "lg:hidden fixed inset-0 bg-black/60 z-40 transition-opacity duration-300",
            mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          )}
          onClick={() => setMobileOpen(false)}
        />
        {/* Drawer */}
        <aside
          className={cn(
            "lg:hidden fixed inset-y-0 left-0 w-72 bg-lumos-surface border-r border-lumos-border flex flex-col z-50 shadow-xl transition-transform duration-300",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {sidebarContent}
        </aside>
      </>

      {/* Top bar mobile */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 h-14 bg-lumos-surface border-b border-lumos-border flex items-center px-4 gap-3 shadow-sm">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-lg text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 transition-colors"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <img
          src={theme === 'dark' ? "/logo/Logotipo-Branco-Alpha.svg" : "/logo/Logotipo-Preto-Alpha.svg"}
          alt="Lumos Logo"
          className="h-6"
        />
      </div>

      {/* Conteúdo principal */}
      <main className="flex-1 lg:ml-64 min-h-screen overflow-auto bg-lumos-bg transition-colors duration-300">
        <div className="w-full pt-14 p-4 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          {children}
        </div>
      </main>
    </div>
  );
}
