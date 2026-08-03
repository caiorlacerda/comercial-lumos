import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, X, Check } from 'lucide-react';
import { clsx } from 'clsx';
import UserAvatar from '@/components/common/UserAvatar';
import type { PickableUser } from '@/components/common/AssigneePicker';

interface Props {
  /** Colaboradores atuais (fora o dono). */
  value: string[];
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  users: PickableUser[];
  /** Dono da tarefa: fica de fora da lista (já é o responsável). */
  ownerId?: string | null;
  canManage?: boolean;
  /** 'stack' = só os avatares empilhados (linha da tabela); 'full' = avatar + nome (modal). */
  variant?: 'stack' | 'full';
}

/**
 * Colaboradores da tarefa: pessoas que participam junto com o responsável.
 * O dono continua sendo o responsável (Carga por Pessoa, cobrança); quem entra
 * aqui é notificado e vê a tarefa em "Minhas tarefas" também.
 */
export default function TaskCollaborators({ value, onAdd, onRemove, users, ownerId, canManage = true, variant = 'stack' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = value.map(id => users.find(u => u.id === id)).filter(Boolean) as PickableUser[];
  const q = query.trim().toLowerCase();
  // O dono não entra na lista de colaboradores (evita duplicar a mesma pessoa).
  const available = users.filter(u => u.id !== ownerId);
  const filtered = q ? available.filter(u => u.full_name.toLowerCase().includes(q)) : available;

  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const estH = 300;
    const openUp = r.bottom + 4 + estH > window.innerHeight - 8 && r.top - estH - 4 > 8;
    setPos({ top: openUp ? r.top - estH - 4 : r.bottom + 4, left: Math.min(r.left, window.innerWidth - 248) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => searchRef.current?.focus(), 30);
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false); setQuery('');
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setQuery(''); } };
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <div className={clsx('flex items-center', variant === 'stack' ? 'gap-0' : 'gap-1.5 flex-wrap')}>
        {variant === 'stack' ? (
          selected.map((u, i) => (
            <span key={u.id} className={clsx('rounded-full ring-2 ring-lumos-surface', i > 0 && '-ml-1.5')} title={u.full_name}>
              <UserAvatar user={u} size={20} />
            </span>
          ))
        ) : (
          selected.map(u => (
            <span key={u.id} className="inline-flex items-center gap-1.5 bg-lumos-text-secondary/10 border border-lumos-border rounded-full pl-1 pr-1.5 py-0.5">
              <UserAvatar user={u} size={18} showStatus />
              <span className="text-[11px] font-bold text-lumos-text-primary">{u.full_name.split(' ')[0]}</span>
              {canManage && (
                <button type="button" onClick={() => onRemove(u.id)} className="text-lumos-text-secondary hover:text-red-400" title={`Tirar ${u.full_name.split(' ')[0]} da tarefa`}>
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))
        )}

        {canManage && (
          <button
            ref={triggerRef} type="button"
            onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
            title="Adicionar pessoa na tarefa"
            className={clsx('flex items-center justify-center rounded-full border border-dashed border-lumos-border text-lumos-text-secondary hover:border-lumos-yellow hover:text-lumos-yellow transition-colors flex-shrink-0',
              variant === 'stack' ? clsx('w-5 h-5', selected.length > 0 && '-ml-1.5 ring-2 ring-lumos-surface bg-lumos-surface') : 'w-6 h-6')}
          >
            <Plus className={variant === 'stack' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          </button>
        )}
      </div>

      {open && pos && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: 240 }}
          className="z-[200] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1">
          <div className="flex items-center gap-1.5 px-1.5 py-1 border-b border-lumos-border mb-1">
            <Search className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
            <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar pessoa…"
              onClick={e => e.stopPropagation()}
              className="flex-1 min-w-0 bg-transparent outline-none border-0 p-0 text-xs text-lumos-text-primary placeholder:text-lumos-text-secondary" />
          </div>
          <div className="max-h-56 overflow-y-auto custom-scrollbar">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-lumos-text-secondary/70">Ninguém encontrado.</p>
            ) : filtered.map(u => {
              const isSel = value.includes(u.id);
              return (
                <button key={u.id} type="button"
                  onClick={e => { e.stopPropagation(); isSel ? onRemove(u.id) : onAdd(u.id); }}
                  className={clsx('w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-xs font-semibold transition-colors',
                    isSel ? 'text-lumos-yellow bg-lumos-yellow/10' : 'text-lumos-text-primary hover:bg-lumos-text-secondary/10')}>
                  <UserAvatar user={u} size={22} showStatus />
                  <span className="truncate">{u.full_name}</span>
                  {isSel && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-auto" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
