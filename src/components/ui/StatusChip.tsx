import React from 'react';
import { clsx } from 'clsx';

// Etiqueta de status. Uma só receita para "Aprovado", "Atrasado", "Em revisão"... em todas as
// telas. A cor vem do SIGNIFICADO (tom), não do matiz: ok = sucesso/pago, danger = erro/atraso,
// warn = atenção/pendente, info = informação, review = revisão, brand = destaque da marca.
export type StatusTone = 'ok' | 'danger' | 'warn' | 'info' | 'review' | 'brand' | 'neutral';

const TONES: Record<StatusTone, string> = {
  ok: 'bg-ok/10 text-ok-fg border-ok/25',
  danger: 'bg-danger/10 text-danger-fg border-danger/25',
  warn: 'bg-warn/10 text-warn-fg border-warn/25',
  info: 'bg-info/10 text-info-fg border-info/25',
  review: 'bg-review/10 text-review-fg border-review/25',
  brand: 'bg-lumos-yellow/15 text-lumos-gold border-lumos-yellow/40',
  neutral: 'bg-lumos-text-secondary/10 text-lumos-text-secondary border-lumos-border',
};

export default function StatusChip({
  tone = 'neutral',
  dot = false,
  icon,
  className,
  children,
}: {
  tone?: StatusTone;
  /** Bolinha colorida antes do texto. */
  dot?: boolean;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {icon}
      {children}
    </span>
  );
}
