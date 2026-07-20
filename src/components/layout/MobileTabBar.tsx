import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Briefcase, Hammer, DollarSign, Menu, Users2, Settings, ShieldCheck, ClipboardList, Sun, Moon, LogOut, ChevronRight, Bell, Megaphone, Newspaper, Home as HomeIcon } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/context/ThemeContext';
import { useLayout, SectionType } from '@/context/LayoutContext';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { clsx } from 'clsx';

export default function MobileTabBar() {
  const { isAdmin, can, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { activeSection, navigateToSection } = useLayout();
  const navigate = useNavigate();
  const location = useLocation();
  const [maisOpen, setMaisOpen] = useState(false);

  const handleSignOut = async () => {
    setMaisOpen(false);
    await signOut();
    navigate('/login');
  };

  const handleNavClick = (sectionId: SectionType) => {
    if (activeSection === sectionId) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      navigateToSection(sectionId);
    }
  };


  const showComercial = isAdmin;
  const showProducao = can('ordem_do_dia') || can('fornecedores') || can('cronograma_edicao');

  // Check if current path is in the "Mais" section items
  const isConfigActive = activeSection === 'configuracoes';

  return (
    <>
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-lumos-surface border-t border-lumos-border pb-[env(safe-area-inset-bottom)] transition-colors duration-300">
        <div className="h-14 flex items-center justify-around">
          {/* Home Tab */}
          <button
            onClick={() => handleNavClick('home')}
            className={clsx(
              "flex flex-col items-center justify-center flex-1 h-full relative transition-colors",
              activeSection === 'home' ? "text-lumos-yellow" : "text-lumos-text-secondary"
            )}
          >
            {activeSection === 'home' && (
              <span className="absolute top-0 inset-x-4 h-[2px] bg-lumos-yellow rounded-full" />
            )}
            <HomeIcon className="w-5 h-5 mb-0.5" />
            <span className="text-[9px] font-bold uppercase tracking-wider">Início</span>
          </button>

          {/* Comercial Tab */}
          {showComercial && (
            <button
              onClick={() => handleNavClick('comercial')}
              className={clsx(
                "flex flex-col items-center justify-center flex-1 h-full relative transition-colors",
                activeSection === 'comercial' ? "text-lumos-yellow" : "text-lumos-text-secondary"
              )}
            >
              {activeSection === 'comercial' && (
                <span className="absolute top-0 inset-x-4 h-[2px] bg-lumos-yellow rounded-full" />
              )}
              <Briefcase className="w-5 h-5 mb-0.5" />
              <span className="text-[9px] font-bold uppercase tracking-wider">Comercial</span>
            </button>
          )}

          {/* Produção Tab */}
          {showProducao && (
            <button
              onClick={() => handleNavClick('producao')}
              className={clsx(
                "flex flex-col items-center justify-center flex-1 h-full relative transition-colors",
                activeSection === 'producao' ? "text-lumos-yellow" : "text-lumos-text-secondary"
              )}
            >
              {activeSection === 'producao' && (
                <span className="absolute top-0 inset-x-4 h-[2px] bg-lumos-yellow rounded-full" />
              )}
              <Hammer className="w-5 h-5 mb-0.5" />
              <span className="text-[9px] font-bold uppercase tracking-wider">Produção</span>
            </button>
          )}

          {/* Financeiro Tab */}
          <button
            onClick={() => handleNavClick('financeiro')}
            className={clsx(
              "flex flex-col items-center justify-center flex-1 h-full relative transition-colors",
              activeSection === 'financeiro' ? "text-lumos-yellow" : "text-lumos-text-secondary"
            )}
          >
            {activeSection === 'financeiro' && (
              <span className="absolute top-0 inset-x-4 h-[2px] bg-lumos-yellow rounded-full" />
            )}
            <DollarSign className="w-5 h-5 mb-0.5" />
            <span className="text-[9px] font-bold uppercase tracking-wider">Financeiro</span>
          </button>

          {/* Mais Tab */}
          <button
            onClick={() => setMaisOpen(true)}
            className={clsx(
              "flex flex-col items-center justify-center flex-1 h-full relative transition-colors",
              isConfigActive ? "text-lumos-yellow" : "text-lumos-text-secondary"
            )}
          >
            {isConfigActive && (
              <span className="absolute top-0 inset-x-4 h-[2px] bg-lumos-yellow rounded-full" />
            )}
            <Menu className="w-5 h-5 mb-0.5" />
            <span className="text-[9px] font-bold uppercase tracking-wider">Mais</span>
          </button>
        </div>
      </div>

      {/* Bottom Sheet "Mais" */}
      <BottomSheet open={maisOpen} onOpenChange={setMaisOpen} title="Menu">
        <div className="space-y-1.5 font-work-sans">
          {/* Mural de Recados */}
          <button
            onClick={() => {
              setMaisOpen(false);
              navigate('/mural');
            }}
            className="flex items-center justify-between w-full h-12 px-3 rounded-lumos hover:bg-lumos-text-secondary/5 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <Newspaper className="w-5 h-5 text-lumos-text-secondary" />
              <span className="text-sm font-bold text-lumos-text-primary">Mural de Recados</span>
            </div>
            <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-50" />
          </button>

          {/* Equipe */}
          <button
            onClick={() => {
              setMaisOpen(false);
              navigate('/equipe');
            }}
            className="flex items-center justify-between w-full h-12 px-3 rounded-lumos hover:bg-lumos-text-secondary/5 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <Users2 className="w-5 h-5 text-lumos-text-secondary" />
              <span className="text-sm font-bold text-lumos-text-primary">Equipe</span>
            </div>
            <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-50" />
          </button>

          {/* Configurações */}
          <button
            onClick={() => {
              setMaisOpen(false);
              navigate('/configuracoes');
            }}
            className="flex items-center justify-between w-full h-12 px-3 rounded-lumos hover:bg-lumos-text-secondary/5 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-lumos-text-secondary" />
              <span className="text-sm font-bold text-lumos-text-primary">Configurações</span>
            </div>
            <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-50" />
          </button>

          {/* Notificações */}
          <button
            onClick={() => {
              setMaisOpen(false);
              navigate('/configuracoes/notificacoes');
            }}
            className="flex items-center justify-between w-full h-12 px-3 rounded-lumos hover:bg-lumos-text-secondary/5 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-lumos-text-secondary" />
              <span className="text-sm font-bold text-lumos-text-primary">Notificações</span>
            </div>
            <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-50" />
          </button>


          {/* Comunicados (só admin) */}
          {isAdmin && (
            <button
              onClick={() => {
                setMaisOpen(false);
                navigate('/comunicados');
              }}
              className="flex items-center justify-between w-full h-12 px-3 rounded-lumos hover:bg-lumos-text-secondary/5 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <Megaphone className="w-5 h-5 text-lumos-text-secondary" />
                <span className="text-sm font-bold text-lumos-text-primary">Comunicados</span>
              </div>
              <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-50" />
            </button>
          )}

          {/* Usuários (só admin) */}
          {isAdmin && (
            <button
              onClick={() => {
                setMaisOpen(false);
                navigate('/usuarios');
              }}
              className="flex items-center justify-between w-full h-12 px-3 rounded-lumos hover:bg-lumos-text-secondary/5 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-lumos-text-secondary" />
                <span className="text-sm font-bold text-lumos-text-primary">Usuários</span>
              </div>
              <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-50" />
            </button>
          )}

          {/* Auditoria (só admin) */}
          {isAdmin && (
            <button
              onClick={() => {
                setMaisOpen(false);
                navigate('/auditoria');
              }}
              className="flex items-center justify-between w-full h-12 px-3 rounded-lumos hover:bg-lumos-text-secondary/5 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <ClipboardList className="w-5 h-5 text-lumos-text-secondary" />
                <span className="text-sm font-bold text-lumos-text-primary">Auditoria</span>
              </div>
              <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-50" />
            </button>
          )}

          {/* Divisor */}
          <div className="my-2 border-t border-lumos-border" />

          {/* Alternar Tema */}
          <button
            onClick={() => {
              toggleTheme();
            }}
            className="flex items-center justify-between w-full h-12 px-3 rounded-lumos hover:bg-lumos-text-secondary/5 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              {theme === 'dark' ? (
                <>
                  <Sun className="w-5 h-5 text-lumos-yellow" />
                  <span className="text-sm font-bold text-lumos-text-primary">Modo Claro</span>
                </>
              ) : (
                <>
                  <Moon className="w-5 h-5 text-lumos-text-secondary" />
                  <span className="text-sm font-bold text-lumos-text-primary">Modo Escuro</span>
                </>
              )}
            </div>
            <div className="text-[10px] font-black uppercase text-lumos-text-secondary bg-lumos-text-secondary/10 px-2 py-0.5 rounded">
              {theme === 'dark' ? 'Escuro' : 'Claro'}
            </div>
          </button>

          {/* Sair */}
          <button
            onClick={handleSignOut}
            className="flex items-center justify-between w-full h-12 px-3 rounded-lumos hover:bg-red-500/10 transition-colors text-left text-red-500"
          >
            <div className="flex items-center gap-3">
              <LogOut className="w-5 h-5 text-red-500" />
              <span className="text-sm font-bold">Sair</span>
            </div>
            <ChevronRight className="w-4 h-4 text-red-500 opacity-50" />
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
