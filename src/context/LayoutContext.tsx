import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

export type SectionType = 'home' | 'comercial' | 'producao' | 'financeiro' | 'configuracoes';

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

// Estar no canal de presença já significa "conectado", então nunca publicamos
// 'offline'. Só 'busy'/'away' (presente porém indisponível) são preservados;
// qualquer outro valor salvo (offline/null/legado) vira 'online'. Sem isso, quem
// tinha presence_status='offline' no banco aparecia offline mesmo conectado.
function presentStatus(s?: string | null): 'online' | 'busy' | 'away' {
  return s === 'busy' || s === 'away' ? s : 'online';
}

export function getSectionFromPath(path: string): SectionType {
  if (path === '/' || path === '/home') return 'home';
  if (path.startsWith('/financeiro')) return 'financeiro';
  if (path.startsWith('/ordem-do-dia') || path.startsWith('/producao')) return 'producao';
  if (
    path === '/usuarios' ||
    path === '/auditoria' ||
    path === '/configuracoes' ||
    path === '/equipe' ||
    path === '/monitoramento'
  ) {
    return 'configuracoes';
  }
  return 'comercial';
}

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, isAdmin, can } = useAuth();
  
  const [activeSection, setActiveSection] = useState<SectionType>(() => 
    getSectionFromPath(location.pathname)
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Record<string, any>>({});
  const channelRef = useRef<any>(null);
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);
  useEffect(() => { idleRef.current = idle; }, [idle]);

  // Status efetivo publicado: 'busy'/'away' manuais são respeitados; 'online'
  // vira 'away' automaticamente quando a pessoa está inativa.
  const computeStatus = (): 'online' | 'busy' | 'away' => {
    const base = presentStatus(profile?.presence_status);
    return base === 'online' && idleRef.current ? 'away' : base;
  };

  // Sincroniza a seção ativa ao navegar por links ou URL direta
  useEffect(() => {
    setActiveSection(getSectionFromPath(location.pathname));
    setMobileSidebarOpen(false); // Fecha o drawer mobile ao navegar
  }, [location.pathname]);

  // Sincroniza Presença em Tempo Real (Supabase Realtime Presence)
  //
  // IMPORTANTE: depende só de `profile?.id` (string estável), NÃO do objeto
  // `user`. O `onAuthStateChange` do Supabase dispara em cada token refresh e
  // volta de foco da aba, recriando o objeto `user` a cada vez. Se o efeito
  // dependesse de `user`, o canal 'online-users' era derrubado e recriado nessas
  // horas — e o canal reconstruído parava de receber os eventos de sync dos
  // outros, deixando o status congelado até dar F5. Com a chave estável, o canal
  // vive uma vez por sessão e sobrevive a refresh/foco.
  useEffect(() => {
    if (!profile?.id) {
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
              status: computeStatus(),
              last_seen: new Date().toISOString(),
              full_name: profile.full_name,
            });
          } catch (err) {
            console.error('Error tracking presence initially:', err);
          }
        }
      });

    // Heartbeat: re-publica a presença a cada 30s e ao voltar o foco/aba, e
    // reconecta o canal se ele tiver caído. Sobrevive a quedas/reconexões do
    // WebSocket (tab em background, sleep do notebook, proxy, muitas abas) — sem
    // isso a pessoa podia ficar "offline" pra si mesma até dar F5.
    const heartbeat = () => {
      const active = !document.hidden && !idleRef.current;
      // Fallback por banco: grava last_seen enquanto a pessoa está ativa. Funciona
      // mesmo se o WebSocket de presença não conectar (proxy, muitas abas, etc.),
      // porque as telas consideram "online" quem tem last_seen recente.
      if (active && profile.id) {
        supabase.from('app_users').update({ last_seen: new Date().toISOString() }).eq('id', profile.id)
          .then(undefined, () => { /* ignora */ });
        // Acumula tempo online (o RPC conta no máximo 1 min por batida, então
        // chamar a cada 30s não infla). Alimenta o ranking do Monitoramento.
        supabase.rpc('track_presence').then(undefined, () => { /* ignora */ });
      }
      const ch = channelRef.current;
      if (!ch) return;
      if (ch.state === 'joined') {
        ch.track({
          user_id: profile.id,
          status: computeStatus(),
          last_seen: new Date().toISOString(),
          full_name: profile.full_name,
        }).catch(() => { /* ignora falha pontual; a próxima batida tenta de novo */ });
      } else if (ch.state === 'closed' || ch.state === 'errored') {
        ch.subscribe(); // reconecta; o callback de SUBSCRIBED re-publica a presença
      }
    };
    heartbeat(); // primeira batida imediata (grava last_seen ao entrar)
    const hb = setInterval(heartbeat, 30_000);
    const onFocus = () => heartbeat();
    const onVisible = () => { if (!document.hidden) heartbeat(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(hb);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [profile?.id]);

  // Re-publica a presença quando o status manual muda OU quando entra/sai de inatividade.
  useEffect(() => {
    if (channelRef.current && profile) {
      try {
        channelRef.current.track({
          user_id: profile.id,
          status: computeStatus(),
          last_seen: new Date().toISOString(),
          full_name: profile.full_name,
        });
      } catch (err) {
        console.error('Error tracking presence update:', err);
      }
    }
  }, [profile?.presence_status, idle]);

  // Auto-away: após alguns minutos sem atividade (ou com a aba escondida) a
  // pessoa vira "ausente"; qualquer interação volta pra "online". Só troca o
  // estado na transição (não a cada mousemove), pra não re-renderizar à toa.
  useEffect(() => {
    if (!profile?.id) return;
    const IDLE_MS = 5 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const goActive = () => {
      if (idleRef.current) setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };
    const onVisibility = () => { if (document.hidden) setIdle(true); else goActive(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, goActive, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    goActive();
    return () => {
      events.forEach(e => window.removeEventListener(e, goActive));
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timer);
    };
  }, [profile?.id]);

  const getLiveStatus = (profileId: string): string => {
    const presenceInstances = onlineUsers[profileId];
    if (presenceInstances && presenceInstances.length > 0) {
      return presenceInstances[0].status || 'online';
    }
    return 'offline';
  };

  const navigateToSection = (sectionId: SectionType) => {
    let targetPath = '/';

    if (sectionId === 'home') {
      targetPath = '/';
    } else if (sectionId === 'comercial') {
      if (isAdmin) targetPath = '/comercial';
      else return;
    } else if (sectionId === 'producao') {
      if (can('ordem_do_dia')) targetPath = '/producao';
      else if (can('fornecedores')) targetPath = '/producao/fornecedores';
      else if (can('cronograma_edicao')) targetPath = '/producao/cronograma-edicao';
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
