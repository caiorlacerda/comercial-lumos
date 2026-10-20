import React from 'react';
import { clsx } from 'clsx';

// Cabeçalho de página único: título, subtítulo, ações à direita e (opcional) abas embaixo.
// Com o visual novo ligado o título sai em Instrument Serif (regra `h1.text-2xl` no CSS).
export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  tabs,
  flush,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
  /** Sem a margem de baixo (quando o cabeçalho está dentro de um painel). */
  flush?: boolean;
  className?: string;
}) {
  return (
    <header className={clsx(!flush && 'mb-6', className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-lumos-text-primary md:text-3xl">
            {icon}
            <span className="min-w-0">{title}</span>
          </h1>
          {subtitle && <p className="mt-1 text-sm text-lumos-text-secondary">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2 md:justify-end">{actions}</div>}
      </div>
      {tabs && <div className="mt-5">{tabs}</div>}
    </header>
  );
}
