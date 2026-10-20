import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { clsx } from 'clsx';
import { IconButton } from '@/components/ui/Button';
import EscopoVisual from '@/components/ui/EscopoVisual';

export interface ActionItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  /** Ação destrutiva (excluir, cancelar): aparece em vermelho. */
  danger?: boolean;
  disabled?: boolean;
}

// Menu de ações ("três pontinhos"). O menu vai num portal com posição fixa, então não é cortado
// por tabelas ou cartões com overflow. Substitui os menus suspensos feitos à mão.
export default function ActionMenu({
  items,
  label = 'Mais ações',
  align = 'right',
}: {
  items: ActionItem[];
  label?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const alturaEstimada = items.length * 36 + 8;
    const abreParaCima = r.bottom + 4 + alturaEstimada > window.innerHeight - 8 && r.top - alturaEstimada - 4 > 8;
    setPos({
      top: abreParaCima ? r.top - alturaEstimada - 4 : r.bottom + 4,
      left: r.left,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const fecha = () => setOpen(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', fecha, true);
    window.addEventListener('resize', fecha);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', fecha, true);
      window.removeEventListener('resize', fecha);
    };
  }, [open]);

  return (
    <>
      <IconButton
        ref={triggerRef}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        size="sm"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <MoreVertical className="size-4" />
      </IconButton>

      {open && pos && createPortal(
        <EscopoVisual>
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, ...(align === 'right' ? { right: pos.right } : { left: pos.left }) }}
          className="fixed z-[300] min-w-44 rounded-lumos border border-lumos-border bg-lumos-surface p-1 shadow-lg"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}
              className={clsx(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none',
                it.danger
                  ? 'text-danger-fg hover:bg-danger/10'
                  : 'text-lumos-text-primary hover:bg-lumos-text-secondary/10',
              )}
            >
              {it.icon && <span className="[&_svg]:size-4">{it.icon}</span>}
              {it.label}
            </button>
          ))}
        </div>
        </EscopoVisual>,
        document.body,
      )}
    </>
  );
}
