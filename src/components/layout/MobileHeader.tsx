import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import NotificationBell from '@/components/layout/NotificationBell';
import StatusDot from '@/components/common/StatusDot';
import { BottomSheet } from '@/components/ui/BottomSheet';

export default function MobileHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, signOut } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);

  const mainScreens = [
    '/', '/orcamentos', '/clientes', '/catalogo', '/templates', '/configuracoes', '/equipe',
    '/financeiro', '/financeiro/contas-pagar', '/financeiro/contas-receber', '/financeiro/reembolso',
    '/financeiro/custos-projeto', '/financeiro/fluxo-de-caixa', '/financeiro/custos-fixos',
    '/financeiro/configuracao', '/financeiro/relatorios', '/producao/dashboard', '/ordem-do-dia',
    '/producao/fornecedores', '/usuarios', '/auditoria'
  ];

  const isDetailPage = !mainScreens.includes(location.pathname);

  const getPageTitle = (path: string) => {
    if (path === '/') return 'Dashboard';
    if (path === '/orcamentos') return 'Orçamentos';
    if (path === '/clientes') return 'Clientes';
    if (path === '/catalogo') return 'Catálogo';
    if (path === '/templates') return 'Templates';
    if (path === '/configuracoes') return 'Configurações';
    if (path === '/equipe') return 'Equipe';
    if (path === '/financeiro') return 'Painel Financeiro';
    if (path === '/financeiro/contas-pagar') return 'Contas a Pagar';
    if (path === '/financeiro/contas-receber') return 'Contas a Receber';
    if (path === '/financeiro/reembolso') return 'Reembolso';
    if (path === '/financeiro/custos-projeto') return 'Custos de Projeto';
    if (path === '/financeiro/fluxo-de-caixa') return 'Fluxo de Caixa';
    if (path === '/financeiro/custos-fixos') return 'Custos Fixos';
    if (path === '/financeiro/configuracao') return 'Configurações Fin.';
    if (path === '/financeiro/relatorios') return 'Relatórios Fin.';
    if (path === '/producao/dashboard') return 'Dashboard Prod.';
    if (path === '/ordem-do-dia') return 'Ordem do Dia';
    if (path === '/producao/fornecedores') return 'Fornecedores';
    if (path === '/usuarios') return 'Usuários';
    if (path === '/auditoria') return 'Auditoria';
    
    if (path.startsWith('/clientes/')) return 'Perfil do Cliente';
    if (path.startsWith('/orcamentos/')) return 'Editor de Orçamento';
    if (path.startsWith('/financeiro/custos-projeto/')) return 'Detalhes do Custo';
    if (path.startsWith('/ordem-do-dia/')) return 'Ordem do Dia';
    if (path.startsWith('/producao/fornecedores/')) return 'Fornecedor';

    return 'Lumos';
  };

  const handleSignOut = async () => {
    setProfileOpen(false);
    await signOut();
    navigate('/login');
  };

  return (
    <>
      <header className="lg:hidden sticky top-0 z-40 w-full h-12 backdrop-blur-md bg-lumos-surface/80 border-b border-lumos-border flex items-center justify-between px-4 transition-colors duration-300">
        {/* Left Actions: Back Button or Page Title */}
        <div className="flex items-center gap-2">
          {isDetailPage ? (
            <button
              onClick={() => navigate(-1)}
              className="p-1 rounded-lg text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-colors flex items-center justify-center"
              aria-label="Voltar"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : (
            <h1 className="text-sm font-bold text-lumos-text-primary uppercase tracking-wider">
              {getPageTitle(location.pathname)}
            </h1>
          )}
        </div>

        {/* Right Actions: Notification Bell + Avatar */}
        <div className="flex items-center gap-3">
          <NotificationBell />

          <button
            onClick={() => setProfileOpen(true)}
            className="w-7 h-7 rounded-full bg-lumos-yellow flex items-center justify-center text-black font-black text-[10px] relative ring-1 ring-lumos-yellow/20 flex-shrink-0"
          >
            {user?.user_metadata?.avatar_url ? (
              <img src={user.user_metadata.avatar_url} alt="Avatar" className="w-full h-full rounded-full object-cover" />
            ) : (
              <span>
                {profile?.full_name
                  ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                  : user?.email?.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-1 ring-lumos-surface scale-90">
              <StatusDot status={profile?.presence_status || 'online'} />
            </span>
          </button>
        </div>
      </header>

      {/* Profile Bottom Sheet */}
      <BottomSheet open={profileOpen} onOpenChange={setProfileOpen} title="Perfil do Usuário">
        <div className="space-y-6 font-work-sans text-center">
          <div className="flex flex-col items-center">
            {/* Large Avatar */}
            <div className="w-20 h-20 rounded-full bg-lumos-yellow flex items-center justify-center text-black font-black text-2xl relative shadow-md ring-4 ring-lumos-yellow/20 mb-4">
              {user?.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="Avatar" className="w-full h-full rounded-full object-cover" />
              ) : (
                <span>
                  {profile?.full_name
                    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                    : user?.email?.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="absolute bottom-0 right-0 rounded-full ring-4 ring-lumos-surface p-0.5 scale-110">
                <StatusDot status={profile?.presence_status || 'online'} />
              </span>
            </div>

            {/* Profile Info */}
            <h3 className="text-lg font-bold text-lumos-text-primary">
              {profile?.full_name || user?.user_metadata?.full_name || 'Usuário'}
            </h3>
            <p className="text-xs text-lumos-text-secondary mt-0.5">
              {profile?.email || user?.email}
            </p>
            {profile?.job_title && (
              <span className="mt-3 px-3 py-1 bg-lumos-yellow/10 text-lumos-yellow text-[10px] font-black uppercase rounded-full tracking-wider border border-lumos-yellow/25">
                {profile.job_title}
              </span>
            )}
          </div>

          <div className="border-t border-lumos-border pt-4">
            <button
              onClick={handleSignOut}
              className="flex items-center justify-center gap-2.5 w-full h-12 rounded-lumos bg-red-500/10 text-red-500 font-bold hover:bg-red-500/20 transition-colors"
            >
              <LogOut className="w-5 h-5" />
              Sair da Conta
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
