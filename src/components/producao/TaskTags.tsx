import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Check } from 'lucide-react';
import { clsx } from 'clsx';

export interface Tag { id: string; name: string; color: string; ordem?: number; }

// Texto preto/branco conforme a luminância do fundo (contraste)
export function tagTextColor(hex: string): string {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return '#111827';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1f2937' : '#ffffff';
}

export function TagChip({ tag, onRemove, small }: { tag: Tag; onRemove?: () => void; small?: boolean }) {
  return (
    <span style={{ backgroundColor: tag.color, color: tagTextColor(tag.color) }}
      className={clsx('inline-flex items-center gap-1 rounded-full font-bold whitespace-nowrap leading-none', small ? 'text-[9px] px-1.5 py-1' : 'text-[10px] px-2 py-0.5')}>
      {tag.name}
      {onRemove && (
        <button type="button" onClick={e => { e.stopPropagation(); onRemove(); }} className="hover:opacity-60">
          <X className={small ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
        </button>
      )}
    </span>
  );
}

interface PickerProps {
  allTags: Tag[];
  selectedIds: string[];
  onToggle: (tagId: string) => void;
  disabled?: boolean;
  addLabel?: string;
}

// Editor de tags de uma tarefa: chips + botão "+" que abre o catálogo (portal).
export function TagPicker({ allTags, selectedIds, onToggle, disabled, addLabel = 'Tag' }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = allTags.filter(t => selectedIds.includes(t.id));

  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect(); if (!r) return;
    const estH = Math.min(allTags.length * 30 + 16, 300);
    const up = r.bottom + 4 + estH > window.innerHeight - 8 && r.top - estH > 8;
    setPos({ top: up ? r.top - estH - 4 : r.bottom + 4, left: r.left });
  }, [open, allTags.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (btnRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return; setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true); window.addEventListener('resize', onScroll);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
  }, [open]);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {selected.map(t => <TagChip key={t.id} tag={t} onRemove={disabled ? undefined : () => onToggle(t.id)} />)}
      {!disabled && (
        <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)}
          className="inline-flex items-center gap-1 text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-yellow border border-dashed border-lumos-border rounded-full px-2 py-0.5 transition-colors">
          <Plus className="w-3 h-3" /> {addLabel}
        </button>
      )}
      {open && pos && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[200] w-52 max-h-[300px] overflow-y-auto custom-scrollbar bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary/70 px-1.5 pb-1.5">Tags</p>
          {allTags.map(t => {
            const on = selectedIds.includes(t.id);
            return (
              <button key={t.id} type="button" onClick={() => onToggle(t.id)}
                className="w-full flex items-center justify-between gap-2 text-left px-1.5 py-1 rounded hover:bg-lumos-text-secondary/10 transition-colors">
                <TagChip tag={t} />
                {on && <Check className="w-3.5 h-3.5 text-lumos-yellow flex-shrink-0" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
