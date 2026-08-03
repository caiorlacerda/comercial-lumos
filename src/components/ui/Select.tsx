import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search } from 'lucide-react';
import { clsx } from 'clsx';

export interface SelectOption { value: string; label: string; dotClass?: string; groupLabel?: string; }

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;       // estiliza o "gatilho" (botão)
  menuClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
  align?: 'left' | 'right';
  searchable?: boolean;         // mostra um campo de filtro no topo do menu
  searchPlaceholder?: string;
}

// Remove acentos e caixa para o filtro casar "camera" com "Câmera".
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Dropdown com a cara da Lumos. O <select> nativo não deixa estilizar o menu
// (é o SO/navegador que desenha). O menu vai num portal com posição fixa, então
// não é cortado por tabelas/containers com overflow.
export default function Select({ value, onChange, options, placeholder = 'Selecionar…', className, menuClassName, disabled, ariaLabel, align = 'left', searchable, searchPlaceholder = 'Filtrar…' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);
  const visible = searchable && query.trim() ? options.filter(o => norm(o.label).includes(norm(query))) : options;

  // Zera o filtro sempre que fecha, pra abrir limpo na próxima vez.
  useEffect(() => { if (!open) setQuery(''); }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const groupCount = new Set(options.map(o => o.groupLabel).filter(Boolean)).size;
    const estH = Math.min(options.length * 30 + groupCount * 22 + 8, 256) + (searchable ? 44 : 0);
    const openUp = r.bottom + 4 + estH > window.innerHeight - 8 && r.top - estH - 4 > 8;
    setPos({ top: openUp ? r.top - estH - 4 : r.bottom + 4, left: r.left, width: r.width });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Fecha ao rolar a PÁGINA (o menu é fixed e descolaria do gatilho), mas
    // ignora o scroll de DENTRO do próprio menu (para dar pra rolar a lista).
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef} type="button" disabled={disabled} aria-label={ariaLabel}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={clsx('flex items-center justify-between gap-2 w-full text-left cursor-pointer disabled:opacity-60 disabled:cursor-default', className)}
      >
        <span className={clsx('truncate flex items-center gap-2', !selected && 'text-lumos-text-secondary')}>
          {selected?.dotClass && <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', selected.dotClass)} />}
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={clsx('w-3.5 h-3.5 flex-shrink-0 text-lumos-text-secondary transition-transform', open && 'rotate-180')} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: pos.top, minWidth: pos.width,
            left: align === 'right' ? undefined : pos.left,
            right: align === 'right' ? Math.max(8, window.innerWidth - (pos.left + pos.width)) : undefined,
          }}
          className={clsx('z-[300] max-w-[300px] flex flex-col max-h-72 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl', menuClassName)}
        >
          {searchable && (
            <div className="p-1.5 border-b border-lumos-border flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0 ml-1" />
              <input
                autoFocus type="text" value={query} placeholder={searchPlaceholder}
                onChange={e => setQuery(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Enter' && visible[0]) { e.preventDefault(); onChange(visible[0].value); setOpen(false); } }}
                className="flex-1 min-w-0 bg-transparent outline-none border-0 p-0 text-xs text-lumos-text-primary placeholder:text-lumos-text-secondary"
              />
            </div>
          )}
          <div className="overflow-y-auto custom-scrollbar p-1">
            {visible.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-lumos-text-secondary italic">Nada encontrado</div>
            ) : visible.map((o, i) => {
              const showHeader = o.groupLabel && o.groupLabel !== visible[i - 1]?.groupLabel;
              return (
                <div key={o.value}>
                  {showHeader && (
                    <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-lumos-text-secondary/70 select-none">{o.groupLabel}</div>
                  )}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onChange(o.value); setOpen(false); }}
                    className={clsx('w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded text-xs font-normal transition-colors',
                      o.value === value ? 'text-lumos-yellow bg-lumos-yellow/10' : 'text-lumos-text-primary hover:bg-lumos-text-secondary/10')}
                  >
                    <span className="truncate flex items-center gap-2">
                      {o.dotClass && <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', o.dotClass)} />}
                      {o.label}
                    </span>
                    {o.value === value && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
