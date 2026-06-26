import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

export type SectionType = 'comercial' | 'producao' | 'financeiro' | 'configuracoes';

interface LayoutContextType {
  activeSection: SectionType;
  setActiveSection: (section: SectionType) => void;
  navigateToSection: (section: SectionType) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  onlineUsers: Record<string, any>;
  getLiveStatus: (profileId: string) => string;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export function getSectionFromPath(path: string): SectionType {
  if (path.startsWith('/financeiro')) return 'financeiro';
  if (path.startsWith('/ordem-do-dia') || path.startsWith('/producao')) return 'producao';
  if (
    path === '/usuarios' || 
    path === '/auditoria' || 
    path === '/configuracoes' || 
    path === '/equipe'
  ) {
    return 'configuracoes';
  }
  return 'comercial';
}

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, isAdmin, can } = useAuth();
  
  const [activeSection, setActiveSection] = useState<SectionType>(() => 
    getSectionFromPath(location.pathname)
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Record<string, any>>({});
  const channelRef = useRef<any>(null);

  // Sincroniza a seção ativa ao navegar por links ou URL direta
  useEffect(() => {
    setActiveSection(getSectionFromPath(location.pathname));
    setMobileSidebarOpen(false); // Fecha o drawer mobile ao navegar
  }, [location.pathname]);

  // Sincroniza Presença em Tempo Real (Supabase Realtime Presence)
  useEffect(() => {
    if (!user || !profile) {
      setOnlineUsers({});
      return;
    }

    // Usar um único canal compartilhado de presença 'online-users'
    const channel = supabase.channel('online-users', {
      config: {
        presence: {
          key: profile.id,
        },
      },
    });

    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineUsers(channel.presenceState());
      })
      .on('presence', { event: 'join' }, ({ key, currentPresences }) => {
        // Evento de entrada
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        // Evento de saída
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              user_id: profile.id,
              status: profile.presence_status || 'online',
              last_seen: new Date().toISOString(),
              full_name: profile.full_name,
            });
          } catch (err) {
            console.error('Error tracking presence initially:', err);
          }
        }
      });

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [user, profile?.id]);

  // Atualiza o estado da presença local no canal se o status mudar no perfil do useAuth
  useEffect(() => {
    if (channelRef.current && profile) {
      try {
        channelRef.current.track({
          user_id: profile.id,
          status: profile.presence_status || 'online',
          last_seen: new Date().toISOString(),
          full_name: profile.full_name,
        });
      } catch (err) {
        console.error('Error tracking presence update:', err);
      }
    }
  }, [profile?.presence_status]);

  const getLiveStatus = (profileId: string): string => {
    const presenceInstances = onlineUsers[profileId];
    if (presenceInstances && presenceInstances.length > 0) {
      return presenceInstances[0].status || 'online';
    }
    return 'offline';
  };

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
    } else if (sectionId === 'configuracoes') {
      if (isAdmin) targetPath = '/usuarios';
      else targetPath = '/configuracoes';
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
      setMobileSidebarOpen,
      onlineUsers,
      getLiveStatus
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
