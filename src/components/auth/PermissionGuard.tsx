import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface PermissionGuardProps {
  permission: string;
  children: React.ReactNode;
}

/**
 * Tela exibida quando o usuário está logado mas sua conta foi desativada
 */
export const AcessoBloqueado = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] text-lumos-text-primary p-6 text-center animate-in fade-in duration-500">
    <div className="bg-red-500/10 border border-red-500/20 p-8 rounded-lumos max-w-md backdrop-blur-sm">
      <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold mb-2">Acesso Bloqueado</h2>
      <p className="text-lumos-text-secondary text-sm">
        Sua conta está inativa no sistema. Entre em contato com a administração para reativar seu acesso.
      </p>
    </div>
  </div>
);

/**
 * Tela exibida quando o usuário tenta acessar uma rota sem a permissão necessária
 */
export const SemPermissao = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] text-lumos-text-primary p-6 text-center animate-in fade-in duration-500">
    <div className="bg-yellow-500/10 border border-yellow-500/20 p-8 rounded-lumos max-w-md backdrop-blur-sm">
      <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold mb-2">Sem Permissão</h2>
      <p className="text-lumos-text-secondary text-sm">
        Você não possui o nível de acesso necessário para visualizar esta página.
      </p>
    </div>
  </div>
);

/**
 * Componente Guardião: Protege rotas baseadas em permissões dinâmicas
 */
export function PermissionGuard({ permission, children }: PermissionGuardProps) {
  const { can, profile, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-lumos-yellow"></div>
      </div>
    );
  }

  // Se não houver perfil carregado, redireciona para o login
  if (!profile) return <Navigate to="/login" />;

  // Se o usuário estiver inativo
  if (profile.status === 'inativo') return <AcessoBloqueado />;

  // Se o usuário não tiver a permissão solicitada
  if (!can(permission)) return <SemPermissao />;
  
  return <>{children}</>;
}
