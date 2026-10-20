import React from 'react';
import { clsx } from 'clsx';

// Cartão padrão: fundo, borda, canto e espaçamento únicos.
const PADDING = { none: '', sm: 'p-3', md: 'p-5' } as const;

export function Panel({
  title,
  subtitle,
  actions,
  padding = 'md',
  className,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  padding?: keyof typeof PADDING;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={clsx('rounded-lumos border border-lumos-border bg-lumos-surface shadow-sm', PADDING[padding], className)}>
      {(title || actions) && (
        <div className={clsx('flex items-start justify-between gap-3', padding === 'none' ? 'p-5 pb-3' : 'mb-4')}>
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-lumos-text-primary">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-lumos-text-secondary">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type StatTone = 'neutral' | 'ok' | 'danger' | 'warn' | 'info';

const STAT_BORDER: Record<StatTone, string> = {
  neutral: 'border-lumos-border',
  ok: 'border-ok/40',
  danger: 'border-danger/40',
  warn: 'border-warn/40',
  info: 'border-info/40',
};
const STAT_VALUE: Record<StatTone, string> = {
  neutral: 'text-lumos-text-primary',
  ok: 'text-ok-fg',
  danger: 'text-danger-fg',
  warn: 'text-warn-fg',
  info: 'text-info-fg',
};

// Indicador (KPI): rótulo pequeno, valor grande e uma dica. O tom colore só a borda e o valor.
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div className={clsx('rounded-lumos border bg-lumos-surface p-4 shadow-sm', STAT_BORDER[tone], className)}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-lumos-text-secondary">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={clsx('mt-1.5 text-2xl font-semibold tabular-nums', STAT_VALUE[tone])}>{value}</div>
      {hint && <div className="mt-1 text-xs text-lumos-text-secondary">{hint}</div>}
    </div>
  );
}
