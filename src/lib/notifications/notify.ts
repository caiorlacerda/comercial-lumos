import { supabase } from '@/lib/supabase';
import { NOTIFICATION_EVENTS, NotificationEventDef } from './events';

// Resolve o app_user do usuário logado (o "ator" da ação), pra mostrar o avatar
// de quem disparou a notificação. Best-effort: se não achar, fica sem ator.
async function currentActorId(): Promise<string | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const authId = auth?.user?.id;
    if (!authId) return null;
    const { data } = await supabase.from('app_users').select('id').eq('auth_user_id', authId).maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

export async function notify(opts: {
  userIds: string[];
  event: NotificationEventDef;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
  /** Quem disparou (default: usuário logado). Passe null pra não ter ator. */
  actorId?: string | null;
  /** 'personal' (default) ou 'team' (marco visível pra todo mundo). */
  scope?: 'personal' | 'team';
}) {
  const activeUserIds = opts.userIds.filter(Boolean);
  if (!activeUserIds.length) return;

  const actor_id = opts.actorId === undefined ? await currentActorId() : opts.actorId;
  const scope = opts.scope ?? 'personal';

  const rows = activeUserIds.map(user_id => ({
    user_id,
    event_type: opts.event.key,
    category: opts.event.category,
    priority: (opts.event as any).priority ?? 'normal',
    title: opts.title,
    body: opts.body ?? null,
    link: opts.link ?? null,
    data: opts.data ?? {},
    actor_id,
    scope,
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

// Todos os usuários ativos — usado no fan-out dos "marcos do time" (scope='team').
export async function getAllActiveUserIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id')
    .eq('status', 'ativo');
  if (error) {
    console.error('Error fetching active user ids:', error);
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
      producao: ['reembolso', 'custos_projeto', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipe_dados', 'equipamentos', 'revisao_interna'],
      time: ['reembolso', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipamentos'],
      // legado (unificados em 'time'):
      atendimento: ['reembolso', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipamentos'],
      editor: ['reembolso', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipamentos'],
      social_media: ['reembolso', 'ordem_do_dia', 'fornecedores', 'cronograma_edicao', 'acessos', 'equipamentos'],
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
