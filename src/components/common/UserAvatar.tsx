import { useState } from 'react';
import { clsx } from 'clsx';
import { useLayout } from '@/context/LayoutContext';
import StatusDot from '@/components/common/StatusDot';

export interface AvatarUser {
  id?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
}

interface Props {
  user?: AvatarUser | null;
  /** Diâmetro em px (default 28). */
  size?: number;
  /** Mostra a bolinha de presença (online/ocupado/ausente/offline). */
  showStatus?: boolean;
  className?: string;
  title?: string;
}

function initials(name?: string | null) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

/**
 * Avatar único da plataforma: foto cadastrada (app_users.avatar_url) com
 * fallback para iniciais, e uma bolinha de presença ao vivo no canto. O status
 * vem de getLiveStatus (Realtime presence), não da coluna estática.
 */
export default function UserAvatar({ user, size = 28, showStatus = false, className, title }: Props) {
  const { getLiveStatus } = useLayout();
  const [imgOk, setImgOk] = useState(true);
  const status = user?.id ? getLiveStatus(user.id) : 'offline';
  const dot = Math.max(8, Math.round(size * 0.34));

  return (
    <span
      className={clsx('relative inline-flex flex-shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      title={title ?? user?.full_name ?? undefined}
    >
      {user?.avatar_url && imgOk ? (
        <img
          src={user.avatar_url}
          alt={user.full_name ?? ''}
          onError={() => setImgOk(false)}
          className="w-full h-full rounded-full object-cover ring-1 ring-lumos-border"
        />
      ) : (
        <span
          className="w-full h-full rounded-full bg-lumos-yellow/15 border border-lumos-yellow/25 text-lumos-yellow font-black flex items-center justify-center"
          style={{ fontSize: Math.max(9, Math.round(size * 0.4)) }}
        >
          {initials(user?.full_name)}
        </span>
      )}
      {showStatus && user?.id && (
        <span className="absolute -bottom-0.5 -right-0.5">
          <StatusDot status={status} style={{ width: dot, height: dot }} />
        </span>
      )}
    </span>
  );
}
