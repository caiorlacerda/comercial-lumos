import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';

export function usePresence() {
  const { user, profile } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<Record<string, any>>({});
  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (!user || !profile) return;

    const channel = supabase.channel('room:presence', {
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
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              user_id: profile.id,
              status: profile.presence_status || 'online',
              last_seen: new Date().toISOString(),
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

  // Atualiza o estado da presença local no canal se o status mudar no perfil
  useEffect(() => {
    if (channelRef.current && profile) {
      try {
        channelRef.current.track({
          user_id: profile.id,
          status: profile.presence_status || 'online',
          last_seen: new Date().toISOString(),
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

  return { onlineUsers, getLiveStatus };
}
