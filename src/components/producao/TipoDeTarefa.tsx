import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { textoSobre } from '@/lib/cores';
import type { TipoTarefa } from '@/lib/tiposTarefa';

/** Pílula sólida com o nome do tipo, na cor do catálogo. */
export function TipoPilula({ tipo, pequeno, className }: { tipo: Pick<TipoTarefa, 'nome' | 'cor'>; pequeno?: boolean; className?: string }) {
  return (
    <span
      className={clsx('inline-flex items-center rounded-full font-black uppercase leading-none whitespace-nowrap flex-shrink-0',
        pequeno ? 'px-1.5 py-[3px] text-[8.5px] tracking-wide' : 'px-2 py-1 text-[9.5px] tracking-wide', className)}
      style={{ background: tipo.cor, color: textoSobre(tipo.cor) }}
    >
      {tipo.nome}
    </span>
  );
}

/**
 * Escolha do tipo de uma tarefa: mostra a pílula (ou "+ Tipo" quando não há) e abre a lista ao clicar.
 * Uma escolha só. "Sem tipo" tira.
 */
export function TipoSeletor({ valor, tipos, onChange, disabled, pequeno, discreto, rotuloVazio = 'Tipo' }: {
  valor: string | null | undefined;
  tipos: TipoTarefa[];
  onChange: (id: string | null) => void;
  disabled?: boolean;
  pequeno?: boolean;
  /** Sem tipo, o botão "+ Tipo" só aparece com o mouse sobre a linha (lista). */
  discreto?: boolean;
  rotuloVazio?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const atual = tipos.find(t => t.id === valor);

  useEffect(() => {
    if (!pos) return;
    const fechar = (e: Event) => { if (!(e.target as HTMLElement).closest?.('[data-tipo-menu]') && !botao.current?.contains(e.target as Node)) setPos(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null); };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('touchstart', fechar);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', () => setPos(null), { once: true, capture: true });
    return () => { document.removeEventListener('mousedown', fechar); document.removeEventListener('touchstart', fechar); document.removeEventListener('keydown', esc); };
  }, [pos]);

  if (tipos.length === 0) return null;

  const abrir = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    const r = botao.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(r.left, window.innerWidth - 188), y: r.bottom + 4 + 330 > window.innerHeight ? Math.max(8, r.top - 330) : r.bottom + 4 });
  };

  return (
    <>
      <button type="button" ref={botao} onClick={abrir} disabled={disabled}
        title={disabled ? undefined : 'Escolher o tipo da tarefa'}
        className={clsx('inline-flex items-center flex-shrink-0 rounded-full transition-[filter,opacity]', !disabled && 'hover:brightness-110',
          !atual && discreto && 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100')}>
        {atual ? <TipoPilula tipo={atual} pequeno={pequeno} /> : (
          <span className={clsx('inline-flex items-center gap-0.5 rounded-full border border-dashed border-lumos-text-secondary/40 font-bold text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow whitespace-nowrap',
            pequeno ? 'px-1.5 py-[2px] text-[8.5px]' : 'px-2 py-[3px] text-[10px]')}>
            <Plus className="w-2.5 h-2.5" /> {rotuloVazio}
          </span>
        )}
      </button>
      {pos && createPortal(
        <div data-tipo-menu className="fixed z-[500] w-44 rounded-lumos border border-lumos-border bg-lumos-surface p-1 shadow-2xl" style={{ left: pos.x, top: pos.y }}>
          {tipos.map(t => (
            <button key={t.id} type="button" onClick={e => { e.stopPropagation(); onChange(t.id); setPos(null); }}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-lumos-text-primary/5">
              <TipoPilula tipo={t} pequeno />
              {t.id === valor && <Check className="w-3.5 h-3.5 ml-auto text-lumos-yellow" />}
            </button>
          ))}
          {atual && (
            <button type="button" onClick={e => { e.stopPropagation(); onChange(null); setPos(null); }}
              className="w-full rounded px-2 py-1.5 text-left text-[11px] font-bold text-lumos-text-secondary hover:bg-lumos-text-primary/5 border-t border-lumos-border mt-1">
              Sem tipo
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
