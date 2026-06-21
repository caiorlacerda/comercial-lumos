import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export type Notification = {
  id: string;
  event_type: string;
  category: 'financeiro' | 'producao' | 'comercial' | 'sistema';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export function useNotifications() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const userId = profile?.id;

  const fetchAll = useCallback(async () => {
    if (!userId) return;

    try {
      // 1. Fetch user disabled notification preferences
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('event_type, in_app')
        .eq('user_id', userId)
        .eq('in_app', false);

      const disabled = new Set((prefs ?? []).map(p => p.event_type));

      // 2. Fetch recent notifications
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // 3. Filter client-side based on disabled settings
      setItems((data ?? []).filter(n => !disabled.has(n.event_type)));
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchAll();
    if (!userId) return;

    // Supabase Realtime postgres listener
    const uniqueChannelName = `notifications:${userId}-${Math.random().toString(36).substring(2, 11)}`;
    const channel = supabase
      .channel(uniqueChannelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`
      }, () => {
        fetchAll();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchAll]);

  const unreadCount = items.filter(n => !n.read_at).length;

  const markAsRead = async (id: string) => {
    // Optimistic UI update
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Error marking notification as read:', error);
      fetchAll(); // rollback
    }
  };

  const markAllAsRead = async () => {
    if (!userId) return;
    // Optimistic UI update
    setItems(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) {
      console.error('Error marking all notifications as read:', error);
      fetchAll();
    }
  };

  const removeOne = async (id: string) => {
    // Optimistic UI update
    setItems(prev => prev.filter(n => n.id !== id));
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id);
    if (error) {
      console.error('Error deleting notification:', error);
      fetchAll();
    }
  };

  return { 
    items, 
    loading, 
    unreadCount, 
    markAsRead, 
    markAllAsRead, 
    removeOne, 
    refresh: fetchAll 
  };
}
