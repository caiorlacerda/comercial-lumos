import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, Users, BookOpen, Truck, FolderOpen, Check, CornerDownLeft,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { getVisibleSections } from '@/lib/navigation';

// Evento global para abrir a paleta a partir de botões (Topbar/MobileHeader)
export const OPEN_PALETTE_EVENT = 'lumos:command-palette';
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
}

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
}

const GROUP_ORDER = ['Ações', 'Páginas', 'Projetos', 'Tarefas', 'Clientes', 'Orçamentos', 'Fornecedores'];

export default function CommandPalette() {
  const { can, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [asyncItems, setAsyncItems] = useState<PaletteItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);

  const ctx = useMemo(() => ({ can, isAdmin }), [can, isAdmin]);

  // ---------------------------------------------------------
  // Itens estáticos: páginas (da navegação, já filtradas por
  // permissão) e ações rápidas
  // ---------------------------------------------------------
  const staticItems = useMemo<PaletteItem[]>(() => {
    const pages: PaletteItem[] = [
      { id: 'page-home', group: 'Páginas', label: 'Início', icon: FolderOpen, path: '/' },
    ];
    getVisibleSections(ctx).forEach(section => {
      section.items.forEach(item => {
        // Reaplica o filtro de permissão por item
        const allowed = (() => {
          if (!item.permission) return true;
          if (['admin', 'financeiro_admin', 'financeiro_dashboard'].includes(item.permission)) return ctx.isAdmin;
          return ctx.can(item.permission);
        })();
        if (allowed) {
          pages.push({
            id: `page-${item.path}`,
            group: 'Páginas',
            label: item.label,
            sublabel: section.title.charAt(0) + section.title.slice(1).toLowerCase(),
            icon: item.icon,
            path: item.path,
          });
        }
      });
    });

    const actions: PaletteItem[] = [];
    if (isAdmin) actions.push({ id: 'act-orc', group: 'Ações', label: 'Novo orçamento', icon: Plus, path: '/orcamentos/novo' });
    if (isAdmin || can('ordem_do_dia')) {
      actions.push({ id: 'act-proj', group: 'Ações', label: 'Criar projeto', icon: Plus, path: '/producao/projetos' });
      actions.push({ id: 'act-od', group: 'Ações', label: 'Nova Ordem do Dia', icon: Plus, path: '/ordem-do-dia/nova' });
    }
    if (isAdmin || can('fornecedores')) actions.push({ id: 'act-forn', group: 'Ações', label: 'Novo fornecedor', icon: Plus, path: '/producao/fornecedores/nova' });
    if (isAdmin || can('reembolso')) actions.push({ id: 'act-reemb', group: 'Ações', label: 'Solicitar reembolso', icon: Plus, path: '/financeiro/reembolso' });

    return [...actions, ...pages];
  }, [ctx, isAdmin, can]);

  // ---------------------------------------------------------
  // Filtro local + resultados assíncronos
  // ---------------------------------------------------------
  const filteredStatic = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return staticItems.filter(i => i.group === 'Ações' || i.group === 'Páginas');
    return staticItems.filter(i => `${i.label} ${i.sublabel || ''}`.toLowerCase().includes(t));
  }, [staticItems, term]);

  const allItems = useMemo(() => {
    const combined = [...filteredStatic, ...asyncItems];
    combined.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    return combined;
  }, [filteredStatic, asyncItems]);

  // Busca entidades no Supabase (debounced)
  useEffect(() => {
    if (!open) return;
    const t = term.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (t.length < 2) {
      setAsyncItems([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const seq = ++searchSeqRef.current;
      const like = `%${t}%`;
      const canProd = isAdmin || can('ordem_do_dia');
      const canForn = isAdmin || can('fornecedores');

      try {
        const [projRes, taskRes, cliRes, budRes, fornRes] = await Promise.all([
          canProd
            ? supabase.from('projects').select('id, name, client:clients(name)').ilike('name', like).eq('status', 'ativo').limit(5)
            : Promise.resolve({ data: [] as any[] }),
          canProd
            ? supabase.from('project_tasks').select('id, titulo, project_id, project:projects!inner(name, status)').ilike('titulo', like).eq('project.status', 'ativo').limit(5)
            : Promise.resolve({ data: [] as any[] }),
          isAdmin
            ? supabase.from('clients').select('id, name').ilike('name', like).limit(5)
            : Promise.resolve({ data: [] as any[] }),
          isAdmin
            ? supabase.from('budgets').select('id, project_name, code').ilike('project_name', like).limit(5)
            : Promise.resolve({ data: [] as any[] }),
          canForn
            ? supabase.from('fornecedores').select('id, nome').ilike('nome', like).limit(5)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        // Ignora respostas atrasadas de buscas antigas
        if (seq !== searchSeqRef.current) return;

        const items: PaletteItem[] = [];
        ((projRes as any).data || []).forEach((p: any) =>
          items.push({ id: `proj-${p.id}`, group: 'Projetos', label: p.name, sublabel: p.client?.name, icon: FolderOpen, path: `/producao/projetos?projectId=${p.id}` })
        );
        ((taskRes as any).data || []).forEach((tk: any) =>
          items.push({ id: `task-${tk.id}`, group: 'Tarefas', label: tk.titulo, sublabel: tk.project?.name, icon: Check, path: `/producao/projetos?projectId=${tk.project_id}&taskId=${tk.id}` })
        );
        ((cliRes as any).data || []).forEach((c: any) =>
          items.push({ id: `cli-${c.id}`, group: 'Clientes', label: c.name, icon: Users, path: `/clientes/${c.id}` })
        );
        ((budRes as any).data || []).forEach((b: any) =>
          items.push({ id: `bud-${b.id}`, group: 'Orçamentos', label: b.project_name, sublabel: b.code || undefined, icon: BookOpen, path: `/orcamentos/${b.id}` })
        );
        ((fornRes as any).data || []).forEach((f: any) =>
          items.push({ id: `forn-${f.id}`, group: 'Fornecedores', label: f.nome, icon: Truck, path: `/producao/fornecedores/${f.id}` })
        );

        setAsyncItems(items);
      } catch (err) {
        console.error('Erro na busca da paleta:', err);
      } finally {
        if (seq === searchSeqRef.current) setSearching(false);
      }
    }, 250);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [term, open, isAdmin, can]);

  // Reinicia a seleção quando os resultados mudam
  useEffect(() => { setSelectedIdx(0); }, [allItems.length, term]);

  // ---------------------------------------------------------
  // Abertura / fechamento / teclado global
  // ---------------------------------------------------------
  const close = useCallback(() => {
    setOpen(false);
    setTerm('');
    setAsyncItems([]);
    setSelectedIdx(0);
  }, []);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    const handleOpenEvent = () => setOpen(true);

    window.addEventListener('keydown', handleGlobalKey);
    window.addEventListener(OPEN_PALETTE_EVENT, handleOpenEvent);
    return () => {
      window.removeEventListener('keydown', handleGlobalKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, handleOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const selectItem = useCallback((item: PaletteItem) => {
    close();
    navigate(item.path);
  }, [close, navigate]);

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = allItems[selectedIdx];
      if (item) selectItem(item);
    }
  };

  // Mantém o item selecionado visível na lista
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (!open) return null;

  // Agrupa preservando a ordem
  const grouped: Array<{ group: string; items: Array<{ item: PaletteItem; idx: number }> }> = [];
  allItems.forEach((item, idx) => {
    const last = grouped[grouped.length - 1];
    if (last && last.group === item.group) last.items.push({ item, idx });
    else grouped.push({ group: item.group, items: [{ item, idx }] });
  });

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center px-4 pt-[12vh] bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={close}
    >
      <div
        className="w-full max-w-xl bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-top-2 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 border-b border-lumos-border">
          <Search className={clsx('w-4 h-4 flex-shrink-0', searching ? 'text-lumos-yellow animate-pulse' : 'text-lumos-text-secondary')} />
          <input
            ref={inputRef}
            type="text"
            value={term}
            onChange={e => setTerm(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Buscar projetos, tarefas, clientes... ou digitar um comando"
            className="flex-1 h-12 bg-transparent text-sm text-lumos-text-primary placeholder:text-lumos-text-secondary/50 outline-none font-medium"
          />
          <kbd className="text-[9px] font-bold text-lumos-text-secondary border border-lumos-border rounded px-1.5 py-0.5 uppercase">esc</kbd>
        </div>

        {/* Resultados */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto custom-scrollbar py-2">
          {allItems.length === 0 ? (
            <p className="text-center text-xs text-lumos-text-secondary italic py-8">
              {term.trim().length >= 2 && !searching ? 'Nada encontrado.' : 'Digite para buscar…'}
            </p>
          ) : (
            grouped.map(g => (
              <div key={g.group} className="mb-1">
                <p className="px-4 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary/50">
                  {g.group}
                </p>
                {g.items.map(({ item, idx }) => (
                  <button
                    key={item.id}
                    data-selected={idx === selectedIdx}
                    onClick={() => selectItem(item)}
                    onMouseMove={() => setSelectedIdx(idx)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                      idx === selectedIdx
                        ? 'bg-lumos-yellow/10 border-l-2 border-lumos-yellow'
                        : 'border-l-2 border-transparent hover:bg-lumos-text-secondary/5'
                    )}
                  >
                    <item.icon className={clsx('w-4 h-4 flex-shrink-0', idx === selectedIdx ? 'text-lumos-yellow' : 'text-lumos-text-secondary')} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-bold text-lumos-text-primary truncate">{item.label}</span>
                      {item.sublabel && (
                        <span className="block text-[10px] text-lumos-text-secondary truncate">{item.sublabel}</span>
                      )}
                    </span>
                    {idx === selectedIdx && <CornerDownLeft className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-lumos-border bg-lumos-bg/40">
          <span className="text-[9px] font-bold text-lumos-text-secondary uppercase tracking-wider">↑↓ navegar</span>
          <span className="text-[9px] font-bold text-lumos-text-secondary uppercase tracking-wider">↵ abrir</span>
          <span className="text-[9px] font-bold text-lumos-text-secondary uppercase tracking-wider">esc fechar</span>
        </div>
      </div>
    </div>
  );
}
