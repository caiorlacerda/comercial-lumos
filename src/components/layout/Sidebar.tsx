import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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
  ShieldCheck
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
      title: 'FINANCEIRO',
      visible: true,
      items: [
        { icon: BarChart3, label: 'Dashboard Fin.', path: '/financeiro', permission: 'financeiro_dashboard', end: true },
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
        { icon: Settings, label: 'Configurações', path: '/configuracoes' },
      ]
    }
  ];

  return (
    <div className="flex min-h-screen bg-lumos-bg overflow-visible transition-colors duration-300 font-work-sans">
      <aside className="w-64 bg-lumos-surface border-r border-lumos-border flex flex-col fixed inset-y-0 shadow-sm z-30 transition-colors duration-300">
        <div className="p-6">
          <img 
            src={theme === 'dark' ? "/logo/Logotipo-Branco-Alpha.svg" : "/logo/Logotipo-Preto-Alpha.svg"} 
            alt="Lumos Logo" 
            className="h-8 transition-all duration-300" 
          />
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
                  end={item.end}
                  className={({ isActive }) => cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lumos text-sm font-bold transition-all group",
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
            <div className="w-8 h-8 rounded-full bg-lumos-yellow flex items-center justify-center text-black font-black text-xs shadow-sm overflow-hidden ring-2 ring-lumos-yellow/20">
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
            <div className="flex flex-col overflow-hidden">
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
      </aside>

      <main className="flex-1 ml-64 min-h-screen overflow-auto bg-lumos-bg transition-colors duration-300">
        <div className="max-w-7xl mx-auto p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          {children}
        </div>
      </main>
    </div>
  );
}
