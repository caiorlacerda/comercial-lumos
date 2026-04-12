import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  Users, 
  PlusCircle, 
  BookOpen, 
  LogOut,
  LayoutDashboard,
  Settings,
  FileText,
  Copy,
  FileStack
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/context/ThemeContext';
import ThemeToggle from '@/components/common/ThemeToggle';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: Users, label: 'Clientes', path: '/clientes' },
  { icon: BookOpen, label: 'Orçamentos', path: '/orcamentos' },
  { icon: FileText, label: 'Catálogo', path: '/catalogo' },
  { icon: FileStack, label: 'Templates', path: '/templates' },
  { icon: Settings, label: 'Configurações', path: '/configuracoes' },
];

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const { signOut, user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-lumos-bg overflow-hidden transition-colors duration-300">
      {/* Sidebar */}
      <aside className="w-64 bg-lumos-surface border-r border-lumos-border flex flex-col fixed inset-y-0 shadow-sm z-30 transition-colors duration-300">
        <div className="p-6">
          <img 
            src={theme === 'dark' ? "/logo/Logotipo-Branco-Alpha.svg" : "/logo/Logotipo-Preto-Alpha.svg"} 
            alt="Lumos Logo" 
            className="h-8 mb-2 transition-all duration-300" 
          />
          <p className="text-[10px] text-lumos-text-secondary uppercase tracking-widest font-black">
            Proposta
          </p>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lumos text-sm font-bold transition-all group",
                isActive 
                  ? "bg-lumos-yellow/10 text-lumos-yellow" 
                  : "text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5"
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-lumos-border space-y-2">
          {/* Theme Toggle */}
          <ThemeToggle />

          <div className="flex items-center gap-3 px-3 py-4 border-t border-lumos-border/50">
            <div className="w-8 h-8 rounded-full bg-lumos-yellow flex items-center justify-center text-black font-black text-xs shadow-sm overflow-hidden">
              {user?.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span>
                  {user?.user_metadata?.full_name 
                    ? user.user_metadata.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                    : user?.email?.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-bold text-lumos-text-primary truncate">
                {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
              </span>
              <span className="text-[10px] text-lumos-text-secondary truncate font-medium">
                Produtora Lumos
              </span>
            </div>
          </div>
          
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lumos text-sm font-bold text-red-500 hover:bg-red-500/10 w-full transition-all group"
          >
            <LogOut className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-64 min-h-screen overflow-auto bg-lumos-bg transition-colors duration-300">
        <div className="max-w-7xl mx-auto p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          {children}
        </div>
      </main>
    </div>
  );
}
