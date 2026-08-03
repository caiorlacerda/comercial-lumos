import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, Check } from 'lucide-react';
import { clsx } from 'clsx';

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];            // valores já usados (viram sugestões)
  placeholder?: string;
  className?: string;           // estiliza o "gatilho" (mesmo padrão do Select)
  menuClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
  emptyLabel?: string;          // texto quando não há nenhuma sugestão ainda
}

// Combobox "criável" com a cara da Lumos: input de texto livre + menu de sugestões
// (portal, não é cortado por overflow). Serve para campos que crescem sozinhos —
// você digita um valor novo e ele passa a aparecer como sugestão depois. Diferente
// do <datalist> nativo, o menu é estilizado igual ao resto do app.
export default function Combobox({ value, onChange, options, placeholder = 'Digite ou selecione…', className, menuClassName, disabled, ariaLabel, emptyLabel = 'Nada ainda. Digite para adicionar.' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const norm = (s: string) => s.trim().toLowerCase();
  // Aberto → mostra o que está sendo digitado (filtro). Fechado → mostra o valor.
  const shown = open ? query : value;

  const uniqueSorted = Array.from(new Set(options.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const filtered = query.trim() ? uniqueSorted.filter(o => norm(o).includes(norm(query))) : uniqueSorted;
  const exact = uniqueSorted.some(o => norm(o) === norm(query));
  const canAdd = query.trim().length > 0 && !exact;

  useLayoutEffect(() => {
    if (!open) return;
    const el = wrapRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const rows = Math.max(filtered.length + (canAdd ? 1 : 0), 1);
    const estH = Math.min(rows * 32 + 8, 256);
    const openUp = r.bottom + 4 + estH > window.innerHeight - 8 && r.top - estH - 4 > 8;
    setPos({ top: openUp ? r.top - estH - 4 : r.bottom + 4, left: r.left, width: r.width });
  }, [open, filtered.length, canAdd]);

  const pick = (v: string) => { onChange(v.trim()); setQuery(''); setOpen(false); };
  // Ao fechar clicando fora, mantém o que foi digitado como valor (texto livre).
  const commitAndClose = () => { if (query.trim()) onChange(query.trim()); setQuery(''); setOpen(false); };
  const openMenu = () => { if (disabled) return; setQuery(''); setOpen(true); };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      commitAndClose();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setQuery(''); setOpen(false); } };
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      commitAndClose();
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
  }, [open, query]);

  return (
    <>
      <div ref={wrapRef} className={clsx('flex items-center gap-2', className)}>
        <input
          type="text" disabled={disabled} aria-label={ariaLabel} value={shown} placeholder={placeholder}
          onFocus={openMenu}
          onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (query.trim()) pick(query.trim()); else setOpen(false); } }}
          className="flex-1 min-w-0 bg-transparent outline-none border-0 p-0 text-left placeholder:text-lumos-text-secondary"
        />
        <ChevronDown onClick={() => (open ? commitAndClose() : openMenu())}
          className={clsx('w-3.5 h-3.5 flex-shrink-0 text-lumos-text-secondary transition-transform cursor-pointer', open && 'rotate-180')} />
      </div>

      {open && pos && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
          className={clsx('z-[300] max-w-[300px] max-h-64 overflow-y-auto custom-scrollbar bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1', menuClassName)}>
          {filtered.map(o => (
            <button key={o} type="button" onClick={() => pick(o)}
              className={clsx('w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded text-xs font-normal transition-colors',
                norm(o) === norm(value) ? 'text-lumos-yellow bg-lumos-yellow/10' : 'text-lumos-text-primary hover:bg-lumos-text-secondary/10')}>
              <span className="truncate">{o}</span>
              {norm(o) === norm(value) && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
            </button>
          ))}
          {canAdd && (
            <button type="button" onClick={() => pick(query.trim())}
              className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded text-xs font-medium text-lumos-yellow hover:bg-lumos-yellow/10 transition-colors">
              <Plus className="w-3.5 h-3.5 flex-shrink-0" /> Adicionar “{query.trim()}”
            </button>
          )}
          {filtered.length === 0 && !canAdd && (
            <div className="px-2.5 py-2 text-xs text-lumos-text-secondary italic">{emptyLabel}</div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
