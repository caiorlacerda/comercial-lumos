import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search, UserX } from 'lucide-react';
import { clsx } from 'clsx';
import UserAvatar, { type AvatarUser } from '@/components/common/UserAvatar';

export interface PickableUser extends AvatarUser {
  id: string;
  full_name: string;
}

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
  users: PickableUser[];
  className?: string;        // estiliza o "gatilho" (botão)
  placeholder?: string;
  disabled?: boolean;
  align?: 'left' | 'right';
}

/**
 * Seletor de responsável estilo ClickUp: busca por nome e mostra a foto de cada
 * pessoa + bolinha de presença ao vivo. Menu em portal (não é cortado por
 * tabelas/overflow).
 */
export default function AssigneePicker({ value, onChange, users, className, placeholder = 'Sem responsável', disabled, align = 'left' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = users.find(u => u.id === value) || null;
  const filtered = query.trim()
    ? users.filter(u => u.full_name.toLowerCase().includes(query.trim().toLowerCase()))
    : users;

  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const estH = Math.min(filtered.length * 38 + 52, 320);
    const openUp = r.bottom + 4 + estH > window.innerHeight - 8 && r.top - estH - 4 > 8;
    setPos({ top: openUp ? r.top - estH - 4 : r.bottom + 4, left: r.left, width: r.width });
  }, [open, filtered.length]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => searchRef.current?.focus(), 20);
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
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

  const pick = (id: string | null) => { onChange(id); setOpen(false); setQuery(''); };

  return (
    <>
      <button
        ref={triggerRef} type="button" disabled={disabled}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={clsx('flex items-center justify-between gap-2 w-full text-left cursor-pointer disabled:opacity-60 disabled:cursor-default', className)}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected ? (
            <>
              <UserAvatar user={selected} size={20} showStatus />
              <span className="truncate">{selected.full_name}</span>
            </>
          ) : (
            <span className="text-lumos-text-secondary truncate">{placeholder}</span>
          )}
        </span>
        <ChevronDown className={clsx('w-3.5 h-3.5 flex-shrink-0 text-lumos-text-secondary transition-transform', open && 'rotate-180')} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: pos.top, minWidth: Math.max(pos.width, 220),
            left: align === 'right' ? undefined : pos.left,
            right: align === 'right' ? Math.max(8, window.innerWidth - (pos.left + pos.width)) : undefined,
          }}
          className="z-[200] max-w-[320px] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1"
        >
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-lumos-border/60 mb-1">
            <Search className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
            <input
              ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Buscar pessoa…"
              className="bg-transparent outline-none text-xs font-semibold text-lumos-text-primary w-full placeholder:text-lumos-text-secondary/60"
            />
          </div>
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            <button
              type="button" onClick={e => { e.stopPropagation(); pick(null); }}
              className={clsx('w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-xs font-semibold transition-colors',
                !value ? 'text-lumos-yellow bg-lumos-yellow/10' : 'text-lumos-text-secondary hover:bg-lumos-text-secondary/10')}
            >
              <span className="w-5 h-5 rounded-full bg-lumos-text-secondary/10 flex items-center justify-center flex-shrink-0"><UserX className="w-3 h-3" /></span>
              Sem responsável
              {!value && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-auto" />}
            </button>
            {filtered.map(u => (
              <button
                key={u.id} type="button"
                onClick={e => { e.stopPropagation(); pick(u.id); }}
                className={clsx('w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-xs font-semibold transition-colors',
                  u.id === value ? 'text-lumos-yellow bg-lumos-yellow/10' : 'text-lumos-text-primary hover:bg-lumos-text-secondary/10')}
              >
                <UserAvatar user={u} size={22} showStatus />
                <span className="truncate">{u.full_name}</span>
                {u.id === value && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-auto" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-lumos-text-secondary/70">Ninguém encontrado.</p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
