import { useEffect, useState, createContext, useContext } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';

// Níveis de acesso oferecidos hoje: admin, producao (Gestão de Produção) e time
// (Time de Produção). Os valores legados continuam no tipo só pra não quebrar
// comparações antigas — não são mais oferecidos e são migrados pra 'time'.
export type UserRole = 'admin' | 'producao' | 'time' | 'atendimento' | 'editor' | 'social_media' | 'basico';

// Login diário obrigatório: toda sessão anterior às 6h (horário de São Paulo)
// expira, forçando reautenticação de senha (e recarregando o app com as novidades).
// "Dia" do corte = data (em SP) de (instante - 6h): antes das 6h pertence ao dia
// anterior, depois das 6h ao dia atual.
function relogDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms - 6 * 60 * 60 * 1000));
}
function isSessionStale(u?: User | null): boolean {
  if (!u?.last_sign_in_at) return false;
  return relogDay(Date.now()) !== relogDay(new Date(u.last_sign_in_at).getTime());
}

// Permissões padrão por cargo. custom_permissions (por usuário) sobrescreve.
// Editor e Atendimento veem toda a Produção; Início e Configurações não têm
// gate de permissão (visíveis a qualquer logado). O cofre de senhas fica em
// 'acessos' (só produção/admin) por ser sensível.
export const ROLE_DEFAULTS: Record<string, string[]> = {
  admin: ['*'],
  // Gestão de Produção: produção completa + custos de projeto + RH + reembolso + cofre.
  producao: ['reembolso', 'custos_projeto', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipe_dados', 'equipamentos', 'revisao_interna'],
  // Time de Produção: produção do dia a dia + reembolso (todo mundo pede reembolso).
  time: ['reembolso', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipamentos'],
  // Legado — Atendimento/Editor/Social/Básico foram unificados em 'time' (migração
  // por SQL). Mantidos como fallback pra ninguém ficar sem acesso se algum registro
  // ainda não tiver sido migrado. IMPORTANTE: manter em sincronia com notify.ts.
  atendimento: ['reembolso', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipamentos'],
  editor: ['reembolso', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipamentos'],
  social_media: ['reembolso', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipamentos'],
  basico: ['reembolso'],
};

export interface AppUserProfile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  job_title: string | null;
  status: 'ativo' | 'inativo';
  custom_permissions: Record<string, boolean>;
  phone: string | null;
  joined_at: string;
  avatar_url?: string | null;
  presence_status?: 'online' | 'busy' | 'away' | 'offline';
  last_seen?: string;
  tour_seen?: boolean;
}

const AuthContext = createContext<{
  user: User | null;
  profile: AppUserProfile | null;
  loading: boolean;
  profileChecked: boolean;
  error: string | null;
  isAdmin: boolean;
  isProducao: boolean;
  signOut: () => Promise<void>;
  updateProfile: (fullName: string) => Promise<void>;
  updateAvatar: (url: string) => Promise<void>;
  updatePresenceStatus: (status: 'online' | 'busy' | 'away') => Promise<void>;
  markTourSeen: () => Promise<void>;
  can: (permission: string) => boolean;
}>({
  user: null,
  profile: null,
  loading: true,
  profileChecked: false,
  error: null,
  isAdmin: false,
  isProducao: false,
  signOut: async () => {},
  updateProfile: async () => {},
  updateAvatar: async () => {},
  updatePresenceStatus: async () => {},
  markTourSeen: async () => {},
  can: () => false,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileChecked, setProfileChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async (userId: string, attempt = 0) => {
    try {
      const { data } = await supabase
        .from('app_users')
        .select('*')
        .eq('auth_user_id', userId)
        .maybeSingle();

      // Logo após o login o token de auth pode ainda não ter propagado, e o RLS
      // devolve 0 linhas por um instante — o que fazia piscar "Acesso Pendente".
      // Enquanto não confirmamos, tentamos de novo (sem marcar profileChecked,
      // então a tela mostra o loader, não o "pendente").
      if (!data && attempt < 6) {
        await new Promise(r => setTimeout(r, 500));
        return fetchProfile(userId, attempt + 1);
      }

      // Ainda sem perfil por auth_user_id: pode ser descasamento (conta
      // pré-cadastrada ou reconvidada com outro auth id). Como o e-mail é UNIQUE,
      // religamos com segurança pela edge function link-profile (self-heal), que
      // aponta o auth_user_id da linha do MEU e-mail para o meu id atual. Assim o
      // "Acesso Pendente" some de vez para quem tem cadastro.
      if (!data) {
        try {
          const { data: healed } = await supabase.functions.invoke('link-profile');
          if (healed?.profile) {
            setProfile(healed.profile);
            setProfileChecked(true);
            return;
          }
        } catch (healErr) {
          console.error('link-profile falhou:', healErr);
        }
      }

      setProfile(data ?? null);
      // Espelha a foto do Auth (user_metadata) na coluna app_users.avatar_url,
      // para que OUTROS usuários consigam ver a foto (metadata só é legível pelo
      // dono). Self-heal: acontece no login de cada um.
      if (data) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const metaAvatar = authUser?.user_metadata?.avatar_url ?? null;
        if (metaAvatar && metaAvatar !== data.avatar_url) {
          await supabase.from('app_users').update({ avatar_url: metaAvatar }).eq('id', data.id);
          setProfile({ ...data, avatar_url: metaAvatar });
        }
      }
      setProfileChecked(true);
    } catch (err) {
      if (attempt < 8) {
        await new Promise(r => setTimeout(r, 500));
        return fetchProfile(userId, attempt + 1);
      }
      console.error('Error fetching profile:', err);
      setProfile(null);
      setProfileChecked(true);
    }
  };

  useEffect(() => {
    // Se a sessão é de antes do corte diário (6h SP), desloga e força novo login.
    const forceReloginIfStale = (u?: User | null): boolean => {
      if (u && isSessionStale(u)) {
        supabase.auth.signOut();
        setUser(null); setProfile(null); setProfileChecked(true); setLoading(false);
        return true;
      }
      return false;
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (forceReloginIfStale(session?.user)) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setProfileChecked(true);
        setLoading(false);
      }
    }).catch(() => {
      setProfileChecked(true);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (forceReloginIfStale(session?.user)) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setProfile(null);
        setProfileChecked(true);
        setLoading(false);
      }
    });

    // Verifica periodicamente (pega quem está com a aba aberta às 6h em ponto).
    const relogTimer = setInterval(() => {
      supabase.auth.getSession().then(({ data: { session } }) => forceReloginIfStale(session?.user));
    }, 5 * 60 * 1000);

    return () => { subscription.unsubscribe(); clearInterval(relogTimer); };
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); };

  const updateProfile = async (fullName: string) => {
    const { error: updateError } = await supabase.auth.updateUser({ data: { full_name: fullName } });
    if (updateError) throw updateError;
    const { data: { user: updatedUser } } = await supabase.auth.getUser();
    setUser(updatedUser);
    if (updatedUser) {
      await supabase.from('app_users').update({ full_name: fullName }).eq('auth_user_id', updatedUser.id);
      await fetchProfile(updatedUser.id);
    }
  };

  const updateAvatar = async (url: string) => {
    const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: url } });
    if (updateError) throw updateError;
    const { data: { user: updatedUser } } = await supabase.auth.getUser();
    setUser(updatedUser);
    // Espelha na tabela para que os outros usuários vejam a nova foto
    if (profile?.id) {
      await supabase.from('app_users').update({ avatar_url: url }).eq('id', profile.id);
      setProfile(p => (p ? { ...p, avatar_url: url } : p));
    }
  };

  const updatePresenceStatus = async (status: 'online' | 'busy' | 'away') => {
    if (!user) return;
    try {
      const { error: updateError } = await supabase
        .from('app_users')
        .update({ presence_status: status, last_seen: new Date().toISOString() })
        .eq('auth_user_id', user.id);
      if (updateError) throw updateError;
      setProfile(prev => prev ? { ...prev, presence_status: status } : null);
    } catch (err) {
      console.error('Error updating presence status:', err);
    }
  };

  // Marca o tour de boas-vindas como visto (não reaparece até um admin reenviar)
  const markTourSeen = async () => {
    if (!profile?.id || profile.tour_seen) return;
    setProfile(prev => (prev ? { ...prev, tour_seen: true } : prev));
    await supabase.from('app_users').update({ tour_seen: true }).eq('id', profile.id);
  };

  const can = (permission: string): boolean => {
    if (!profile) return false;
    if (profile.custom_permissions && permission in profile.custom_permissions) {
      return profile.custom_permissions[permission];
    }
    const rolePermissions = ROLE_DEFAULTS[profile.role] || [];
    return rolePermissions.includes('*') || rolePermissions.includes(permission);
  };

  return (
    <AuthContext.Provider value={{
      user, profile, loading, profileChecked, error,
      isAdmin: profile?.role === 'admin',
      isProducao: profile?.role === 'producao',
      signOut, updateProfile, updateAvatar, updatePresenceStatus, markTourSeen, can
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
