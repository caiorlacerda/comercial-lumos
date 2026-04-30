import { supabase } from '@/lib/supabase';

export type AuditAction =
  | 'budget_created'
  | 'budget_deleted'
  | 'budget_status_changed'
  | 'client_created'
  | 'client_deleted'
  | 'user_created'
  | 'user_deactivated'
  | 'user_activated';

export async function logAudit(
  action: AuditAction,
  description: string,
  metadata?: Record<string, unknown>
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('activity_log').insert({
      user_id: user.id,
      action,
      description,
      metadata: metadata ?? null,
    });
  } catch {
    // audit log failure is non-fatal
  }
}
