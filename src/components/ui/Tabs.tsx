import React from 'react';
import { clsx } from 'clsx';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Contador pequeno ao lado do nome (ex.: quantidade de itens). */
  count?: number;
}

// Abas com linha embaixo: para trocar de SEÇÃO dentro da mesma página (A Receber / A Pagar / Bancos).
export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={clsx('flex gap-1 border-b border-lumos-border overflow-x-auto no-scrollbar', className)}>
      {items.map((it) => {
        const ativo = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => onChange(it.id)}
            className={clsx(
              'relative -mb-px inline-flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-lumos-yellow',
              ativo
                ? 'border-lumos-yellow text-lumos-text-primary'
                : 'border-transparent text-lumos-text-secondary hover:text-lumos-text-primary',
            )}
          >
            {it.icon}
            {it.label}
            {it.count !== undefined && (
              <span className="rounded-full bg-lumos-text-secondary/15 px-1.5 text-xs font-semibold text-lumos-text-secondary">{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface SegmentItem {
  id: string;
  label?: string;
  icon?: React.ReactNode;
  title?: string;
}

// Alternador em pílula: para trocar a FORMA de ver os mesmos dados (Lista / Cards, Mês / Semana).
export function SegmentedControl({
  items,
  value,
  onChange,
  className,
}: {
  items: SegmentItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div role="group" className={clsx('inline-flex gap-1 rounded-lumos border border-lumos-border bg-lumos-bg p-1', className)}>
      {items.map((it) => {
        const ativo = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            aria-pressed={ativo}
            title={it.title ?? it.label}
            onClick={() => onChange(it.id)}
            className={clsx(
              'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors duration-150',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lumos-yellow',
              ativo
                ? 'bg-lumos-yellow text-[#161616] shadow-sm'
                : 'text-lumos-text-secondary hover:text-lumos-text-primary',
            )}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
