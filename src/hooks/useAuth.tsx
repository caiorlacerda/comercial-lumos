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
  custom_permissions: Record<string, any>;
  joined_at: string;
}

const AuthContext = createContext<{
  user: User | null;
  profile: AppUserProfile | null;
  loading: boolean;
  error: string | null;
  signOut: () => Promise<void>;
  updateProfile: (fullName: string) => Promise<void>;
  updateAvatar: (url: string) => Promise<void>;
  isAdmin: boolean;
  isProducao: boolean;
  can: (permission: string) => boolean;
}>({
  user: null,
  profile: null,
  loading: true,
  error: null,
  signOut: async () => {},
  updateProfile: async () => {},
  updateAvatar: async () => {},
  isAdmin: false,
  isProducao: false,
  can: () => false,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error: profileError } = await supabase
        .from('app_users')
        .select('*')
        .eq('auth_user_id', userId)
        .single();

      if (profileError) {
        if (profileError.code === 'PGRST116') {
          setProfile(null);
        } else {
          throw profileError;
        }
      } else {
        setProfile(data as AppUserProfile);
      }
    } catch (err: any) {
      console.error('Erro ao buscar perfil:', err);
    }
  };

  useEffect(() => {
    async function initAuth() {
      try {
        setLoading(true);
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) throw sessionError;
        
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        
        if (currentUser) {
          await fetchProfile(currentUser.id);
        }
      } catch (err: any) {
        console.error('Erro na inicialização do Auth:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      
      if (currentUser) {
        await fetchProfile(currentUser.id);
      } else {
        setProfile(null);
      }
      
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const updateProfile = async (fullName: string) => {
    const { error: updateError } = await supabase.auth.updateUser({
      data: { full_name: fullName }
    });
    if (updateError) throw updateError;
    
    const { data: { user: updatedUser } } = await supabase.auth.getUser();
    setUser(updatedUser);
    
    if (updatedUser) {
      await supabase
        .from('app_users')
        .update({ full_name: fullName })
        .eq('auth_user_id', updatedUser.id);
      await fetchProfile(updatedUser.id);
    }
  };

  const updateAvatar = async (url: string) => {
    const { error: updateError } = await supabase.auth.updateUser({
      data: { avatar_url: url }
    });
    if (updateError) throw updateError;
    
    const { data: { user: updatedUser } } = await supabase.auth.getUser();
    setUser(updatedUser);
  };

  const isAdmin = profile?.role === 'admin';
  const isProducao = profile?.role === 'producao';

  const can = (permission: string): boolean => {
    if (!profile) return false;
    if (profile.custom_permissions && permission in profile.custom_permissions) {
      return profile.custom_permissions[permission];
    }
    const defaults: Record<string, string[]> = {
      admin: ['*'],
      producao: ['reembolso', 'custos_projeto'],
      basico: ['reembolso'],
    };
    const rolePermissions = defaults[profile.role] || [];
    return rolePermissions.includes('*') || rolePermissions.includes(permission);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      loading, 
      error, 
      signOut, 
      updateProfile, 
      updateAvatar,
      isAdmin,
      isProducao,
      can
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};
