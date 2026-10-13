import type { ReactNode } from 'react';

/** Cartão de vidro com o título no padrão do deck (quadrado amarelo + rótulo em mono). */
export default function BlocoCartao({ titulo, direita, children }: { titulo: string; direita?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-3.5 space-y-3.5 shadow-sm">
      <div className="flex items-center justify-between border-b border-lumos-border/50 pb-2.5">
        <h2 className="text-[11px] uppercase tracking-[3px] text-lumos-text-primary flex items-center gap-3">
          <span className="block h-2 w-2 bg-lumos-yellow" /> {titulo}
        </h2>
        {direita}
      </div>
      {children}
    </div>
  );
}
