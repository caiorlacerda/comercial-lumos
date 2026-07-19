import React from 'react';
import { clsx } from 'clsx';

// Padrão reutilizável para transformar tabelas densas em cartões no celular.
// A tabela original continua no desktop (envolvida em `hidden lg:block`); no
// mobile renderizamos uma lista de cartões a partir dos MESMOS dados. Assim o
// desktop nunca regride e o celular ganha uma leitura empilhada e tocável.
//
// Uso típico numa página:
//   <div className="overflow-x-auto hidden lg:block"> ...tabela... </div>
//   <MobileCardList>
//     {loading ? <MobileCardSkeleton rows={6} /> : items.length === 0 ? (
//       <MobileCardEmpty>Nenhum resultado.</MobileCardEmpty>
//     ) : items.map((it) => (
//       <MobileCard key={it.id} onClick={() => navigate(...)}>
//         ...conteúdo do cartão...
//       </MobileCard>
//     ))}
//   </MobileCardList>

export function MobileCardList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('lg:hidden divide-y divide-lumos-border', className)}>
      {children}
    </div>
  );
}

export function MobileCard({
  onClick,
  children,
  className,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const base = 'w-full text-left px-4 py-3.5 block transition-colors';
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={clsx(base, 'active:bg-lumos-yellow/[0.04] hover:bg-lumos-yellow/[0.02]', className)}
      >
        {children}
      </button>
    );
  }
  return <div className={clsx(base, className)}>{children}</div>;
}

export function MobileCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3.5 animate-pulse">
          <div className="flex items-center justify-between mb-2">
            <div className="h-3 w-16 rounded bg-lumos-border" />
            <div className="h-4 w-20 rounded-full bg-lumos-border" />
          </div>
          <div className="h-3.5 w-40 rounded bg-lumos-border mb-1.5" />
          <div className="h-2.5 w-24 rounded bg-lumos-border" />
        </div>
      ))}
    </>
  );
}

export function MobileCardEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-6 py-12 text-center text-lumos-text-secondary italic font-medium text-sm">
      {children}
    </div>
  );
}
