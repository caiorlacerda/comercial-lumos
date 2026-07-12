import { useEffect, useState, createContext, useContext } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'producao' | 'atendimento' | 'editor' | 'social_media' | 'basico';

// Permissões padrão por cargo. custom_permissions (por usuário) sobrescreve.
// Editor e Atendimento veem toda a Produção; Início e Configurações não têm
// gate de permissão (visíveis a qualquer logado). O cofre de senhas fica em
// 'acessos' (só produção/admin) por ser sensível.
export const ROLE_DEFAULTS: Record<string, string[]> = {
  admin: ['*'],
  producao: ['reembolso', 'custos_projeto', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipe_dados'],
  atendimento: ['ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos'],
  editor: ['ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos'],
  social_media: ['ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos'],
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

  const fetchProfile = async (userId: string) => {
    try {
      const { data } = await supabase
        .from('app_users')
        .select('*')
        .eq('auth_user_id', userId)
        .single();
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
    } catch (err) {
      console.error('Error fetching profile:', err);
      setProfile(null);
    } finally {
      setProfileChecked(true);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
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
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setProfile(null);
        setProfileChecked(true);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
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
