import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search, UserX, Plus, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import UserAvatar, { type AvatarUser } from '@/components/common/UserAvatar';

export interface PickableUser extends AvatarUser {
  id: string;
  full_name: string;
}

// Responsável de uma tarefa: interno (equipe) ou freelancer (fornecedor).
export type AssigneeValue = { type: 'user' | 'freela'; id: string } | null;

interface Props {
  value: AssigneeValue;
  onChange: (sel: AssigneeValue) => void;
  users: PickableUser[];
  freelancers?: PickableUser[];
  /** Cadastro rápido de freelancer; retorna o novo registro (ou null em erro). */
  onQuickAddFreela?: (name: string) => Promise<PickableUser | null>;
  className?: string;        // estiliza o "gatilho" (botão)
  placeholder?: string;
  disabled?: boolean;
  align?: 'left' | 'right';
}

const FreelaTag = () => (
  <span className="text-[8px] font-black uppercase tracking-wider text-lumos-yellow bg-lumos-yellow/15 rounded px-1 py-0.5 flex-shrink-0">freela</span>
);

/**
 * Seletor de responsável estilo ClickUp: busca por nome e mostra a foto de cada
 * pessoa + bolinha de presença ao vivo. Tem duas abas — Equipe (usuários
 * internos) e Freelancers (parceiros vindos de fornecedores), com cadastro
 * rápido. Menu em portal (não é cortado por tabelas/overflow).
 */
export default function AssigneePicker({ value, onChange, users, freelancers = [], onQuickAddFreela, className, placeholder = 'Sem responsável', disabled, align = 'left' }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'user' | 'freela'>('user');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = value
    ? (value.type === 'user' ? users.find(u => u.id === value.id) : freelancers.find(f => f.id === value.id)) || null
    : null;
  const selectedIsFreela = value?.type === 'freela';

  const source = tab === 'user' ? users : freelancers;
  const q = query.trim().toLowerCase();
  const filtered = q ? source.filter(u => u.full_name.toLowerCase().includes(q)) : source;
  const hasExact = source.some(u => u.full_name.trim().toLowerCase() === q);
  const canQuickAdd = tab === 'freela' && !!onQuickAddFreela && q.length > 0 && !hasExact;

  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const estH = Math.min(filtered.length * 38 + 96, 340);
    const openUp = r.bottom + 4 + estH > window.innerHeight - 8 && r.top - estH - 4 > 8;
    setPos({ top: openUp ? r.top - estH - 4 : r.bottom + 4, left: r.left, width: r.width });
  }, [open, filtered.length]);

  useEffect(() => {
    if (!open) return;
    setTab(value?.type ?? 'user');   // abre já na aba do responsável atual
    setTimeout(() => searchRef.current?.focus(), 20);
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Ignora o scroll de dentro do menu (para rolar a lista de pessoas)
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

  const close = () => { setOpen(false); setQuery(''); };
  const pick = (sel: AssigneeValue) => { onChange(sel); close(); };

  const handleQuickAdd = async () => {
    if (!onQuickAddFreela || !query.trim() || adding) return;
    setAdding(true);
    const novo = await onQuickAddFreela(query.trim());
    setAdding(false);
    if (novo) pick({ type: 'freela', id: novo.id });
  };

  const TabBtn = ({ id, label }: { id: 'user' | 'freela'; label: string }) => (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); setTab(id); setQuery(''); setTimeout(() => searchRef.current?.focus(), 10); }}
      className={clsx('flex-1 text-[11px] font-black uppercase tracking-wider py-1.5 rounded-md transition-colors',
        tab === id ? 'bg-lumos-yellow/15 text-lumos-yellow' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}
    >
      {label}
    </button>
  );

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
              <UserAvatar user={selected} size={20} showStatus={!selectedIsFreela} />
              <span className="truncate">{selected.full_name}</span>
              {selectedIsFreela && <FreelaTag />}
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
            position: 'fixed', top: pos.top, minWidth: Math.max(pos.width, 240),
            left: align === 'right' ? undefined : pos.left,
            right: align === 'right' ? Math.max(8, window.innerWidth - (pos.left + pos.width)) : undefined,
          }}
          className="z-[200] max-w-[320px] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1"
        >
          <div className="flex items-center gap-1 p-1 mb-1">
            <TabBtn id="user" label="Equipe" />
            <TabBtn id="freela" label="Freelancers" />
          </div>

          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-lumos-border/60 mb-1">
            <Search className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
            <input
              ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canQuickAdd) { e.preventDefault(); handleQuickAdd(); } }}
              placeholder={tab === 'user' ? 'Buscar pessoa…' : 'Buscar ou adicionar freelancer…'}
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

            {filtered.map(u => {
              const isSel = value?.type === tab && value.id === u.id;
              return (
                <button
                  key={u.id} type="button"
                  onClick={e => { e.stopPropagation(); pick({ type: tab, id: u.id }); }}
                  className={clsx('w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-xs font-semibold transition-colors',
                    isSel ? 'text-lumos-yellow bg-lumos-yellow/10' : 'text-lumos-text-primary hover:bg-lumos-text-secondary/10')}
                >
                  <UserAvatar user={u} size={22} showStatus={tab === 'user'} />
                  <span className="truncate">{u.full_name}</span>
                  {isSel && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-auto" />}
                </button>
              );
            })}

            {canQuickAdd && (
              <button
                type="button" disabled={adding}
                onClick={e => { e.stopPropagation(); handleQuickAdd(); }}
                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-xs font-bold text-lumos-yellow hover:bg-lumos-yellow/10 transition-colors mt-0.5 border-t border-lumos-border/40"
              >
                <span className="w-5 h-5 rounded-full bg-lumos-yellow/15 flex items-center justify-center flex-shrink-0">
                  {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                </span>
                Adicionar “{query.trim()}” como freelancer
              </button>
            )}

            {filtered.length === 0 && !canQuickAdd && (
              <p className="px-2 py-3 text-center text-[11px] text-lumos-text-secondary/70">
                {tab === 'freela' ? 'Nenhum freelancer.' : 'Ninguém encontrado.'}
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
