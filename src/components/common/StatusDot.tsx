import React from 'react';
import { clsx } from 'clsx';

export type PresenceStatusType = 'online' | 'busy' | 'away' | 'offline';

interface StatusDotProps {
  status: PresenceStatusType | string;
  className?: string;
  style?: React.CSSProperties;
}

export default function StatusDot({ status, className, style }: StatusDotProps) {
  const getStatusColor = (s: string) => {
    switch (s) {
      case 'online':
        return 'bg-green-500';
      case 'busy':
        return 'bg-red-500';
      case 'away':
        return 'bg-yellow-500';
      case 'offline':
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <span className={clsx("relative flex", !style && "h-2.5 w-2.5", className)} style={style}>
      {status === 'online' && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
      )}
      <span className={clsx("relative inline-flex rounded-full h-full w-full border border-lumos-surface", getStatusColor(status))}></span>
    </span>
  );
}
