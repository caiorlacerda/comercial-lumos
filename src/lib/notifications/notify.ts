import { supabase } from '@/lib/supabase';
import { NOTIFICATION_EVENTS, NotificationEventDef } from './events';

export async function notify(opts: {
  userIds: string[];
  event: NotificationEventDef;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
}) {
  const activeUserIds = opts.userIds.filter(Boolean);
  if (!activeUserIds.length) return;

  const rows = activeUserIds.map(user_id => ({
    user_id,
    event_type: opts.event.key,
    category: opts.event.category,
    priority: (opts.event as any).priority ?? 'normal',
    title: opts.title,
    body: opts.body ?? null,
    link: opts.link ?? null,
    data: opts.data ?? {},
  }));

  const { error } = await supabase.from('notifications').insert(rows);
  if (error) {
    console.error('notify failed', error);
  }
}

export async function getAdminUserIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id')
    .eq('role', 'admin')
    .eq('status', 'ativo');
  if (error) {
    console.error('Error fetching admin user ids:', error);
    return [];
  }
  return (data ?? []).map(u => u.id);
}

export async function getUserIdsWithPermission(permission: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, role, custom_permissions')
    .eq('status', 'ativo');
  
  if (error) {
    console.error('Error fetching users with permission:', error);
    return [];
  }

  return (data ?? []).filter(u => {
    // Admins automatically bypass any permission restrictions
    if (u.role === 'admin') return true;
    
    // Check custom permissions first if configured
    if (u.custom_permissions && typeof u.custom_permissions === 'object') {
      const custom = u.custom_permissions as Record<string, boolean>;
      if (permission in custom) {
        return custom[permission];
      }
    }
    
    // Check default role fallbacks (mantido em sincronia com ROLE_DEFAULTS em useAuth.tsx)
    const defaults: Record<string, string[]> = {
      producao: ['reembolso', 'custos_projeto', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipe_dados'],
      atendimento: ['ordem_do_dia', 'fornecedores', 'cronograma_edicao'],
      editor: ['ordem_do_dia', 'fornecedores', 'cronograma_edicao'],
      social_media: ['ordem_do_dia', 'fornecedores', 'cronograma_edicao'],
      basico: ['reembolso'],
    };
    const rolePermissions = defaults[u.role as string] || [];
    return rolePermissions.includes(permission);
  }).map(u => u.id);
}

export async function getProfileIdByAuthUserId(authUserId: string | null | undefined): Promise<string | null> {
  if (!authUserId) return null;
  const { data, error } = await supabase
    .from('app_users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) {
    console.error('Error resolving profile ID from auth user ID:', error);
    return null;
  }
  return data?.id || null;
}
