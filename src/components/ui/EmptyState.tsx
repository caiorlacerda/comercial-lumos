import React from 'react';
import { clsx } from 'clsx';

// Estado vazio único: ícone, título, explicação curta e (opcional) uma ação.
export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-4 py-12 text-center', className)}>
      {icon && <div className="mb-3 text-lumos-text-secondary [&_svg]:size-8">{icon}</div>}
      <p className="text-sm font-semibold text-lumos-text-primary">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-lumos-text-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Esqueleto de carregamento: mostra a forma do conteúdo em vez de um spinner solto.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('animate-pulse rounded-md bg-lumos-text-secondary/15', className)} />;
}
