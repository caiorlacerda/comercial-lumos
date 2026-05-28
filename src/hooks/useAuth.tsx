import { useEffect, useState, createContext, useContext } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';

export interface AppUserProfile {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'producao' | 'basico';
  job_title: string | null;
  status: 'ativo' | 'inativo';
  custom_permissions: Record<string, boolean>;
  phone: string | null;
  joined_at: string;
}

const AuthContext = createContext<{
  user: User | null;
  profile: AppUserProfile | null;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  isProducao: boolean;
  signOut: () => Promise<void>;
  updateProfile: (fullName: string) => Promise<void>;
  updateAvatar: (url: string) => Promise<void>;
  can: (permission: string) => boolean;
}>({
  user: null,
  profile: null,
  loading: true,
  error: null,
  isAdmin: false,
  isProducao: false,
  signOut: async () => {},
  updateProfile: async () => {},
  updateAvatar: async () => {},
  can: () => false,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('app_users')
      .select('*')
      .eq('auth_user_id', userId)
      .single();
    setProfile(data ?? null);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setProfile(null);
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
  };

  const can = (permission: string): boolean => {
    if (!profile) return false;
    if (profile.custom_permissions && permission in profile.custom_permissions) {
      return profile.custom_permissions[permission];
    }
    const defaults: Record<string, string[]> = {
      admin: ['*'],
      producao: ['reembolso', 'custos_projeto', 'ordem_do_dia', 'fornecedores'],
      basico: ['reembolso'],
    };
    const rolePermissions = defaults[profile.role] || [];
    return rolePermissions.includes('*') || rolePermissions.includes(permission);
  };

  return (
    <AuthContext.Provider value={{
      user, profile, loading, error,
      isAdmin: profile?.role === 'admin',
      isProducao: profile?.role === 'producao',
      signOut, updateProfile, updateAvatar, can
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
