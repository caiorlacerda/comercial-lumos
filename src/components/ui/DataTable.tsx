import React from 'react';
import { clsx } from 'clsx';
import EmptyState, { Skeleton } from '@/components/ui/EmptyState';
import { MobileCard, MobileCardList } from '@/components/ui/MobileCards';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Largura fixa opcional (ex.: 'w-10', 'w-32'). */
  width?: string;
  /** Classe extra da célula (ex.: 'font-semibold tabular-nums'). */
  className?: string;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

// Tabela padrão: cabeçalho, linhas, hover, carregando e vazio sempre iguais.
// Com `mobileCard`, abaixo de 1024px vira lista de cartões (mesmos dados, mesmo padrão do app).
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty,
  mobileCard,
  footer,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: React.ReactNode;
  mobileCard?: (row: T) => React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const vazio = empty ?? <EmptyState title="Nada por aqui ainda" description="Quando houver itens, eles aparecem nesta lista." />;

  return (
    <div className={clsx('overflow-hidden rounded-lumos border border-lumos-border bg-lumos-surface shadow-sm', className)}>
      <div className={clsx('overflow-x-auto', mobileCard && 'hidden lg:block')}>
        <table className="w-full text-sm">
          <thead className="bg-lumos-text-secondary/5">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={clsx('whitespace-nowrap px-4 py-3 text-xs font-medium uppercase tracking-wider text-lumos-text-secondary', ALIGN[c.align ?? 'left'], c.width)}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-lumos-border">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-32" /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length}>{vazio}</td></tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={clsx('transition-colors duration-150 hover:bg-lumos-text-secondary/5', onRowClick && 'cursor-pointer')}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={clsx('px-4 py-3 text-lumos-text-primary', ALIGN[c.align ?? 'left'], c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {mobileCard && (
        <MobileCardList>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2 px-4 py-3.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>
            ))
          ) : rows.length === 0 ? (
            vazio
          ) : (
            rows.map((row) => (
              <MobileCard key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {mobileCard(row)}
              </MobileCard>
            ))
          )}
        </MobileCardList>
      )}

      {footer && <div className="border-t border-lumos-border px-4 py-3">{footer}</div>}
    </div>
  );
}
