import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import RichTextEditor from '@/components/common/RichTextEditor';
import { useConfirm } from '@/components/ui/useConfirm';
import DOMPurify from 'dompurify';
import { clsx } from 'clsx';
import {
  ChevronRight, ChevronDown, Plus, Search, Pencil, Trash2, Check, X, Loader2, BookOpen, FileText,
} from 'lucide-react';

// Links do conteúdo abrem em nova aba, com segurança.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
});

interface Space { id: string; name: string; icon: string | null; ordem: number; }
interface Page { id: string; space_id: string; parent_id: string | null; title: string; content: string; icon: string | null; ordem: number; updated_at: string; }

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sec';

// Injeta ids nos títulos (h2/h3) do HTML e extrai o índice "nesta página".
function withHeadings(html: string): { html: string; outline: { id: string; text: string; level: number }[] } {
  const outline: { id: string; text: string; level: number }[] = [];
  const used = new Set<string>();
  const out = html.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi, (_m, lvl, attrs, inner) => {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    let id = slugify(text); let n = 1;
    while (used.has(id)) id = `${slugify(text)}-${n++}`;
    used.add(id);
    outline.push({ id, text, level: Number(lvl) });
    return `<h${lvl}${attrs} id="${id}">${inner}</h${lvl}>`;
  });
  return { html: out, outline };
}

export default function Wiki() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [spaceMenu, setSpaceMenu] = useState(false);

  // edição
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [saving, setSaving] = useState(false);

  const activePage = pages.find(p => p.id === pageId) || null;

  // ---- carregamento ----
  useEffect(() => { loadSpaces(); }, []);
  async function loadSpaces() {
    const { data } = await supabase.from('wiki_spaces').select('*').order('ordem').order('created_at');
    const sp = (data as Space[]) || [];
    setSpaces(sp);
    setActiveSpaceId(prev => prev || sp[0]?.id || null);
    setLoading(false);
  }
  useEffect(() => { if (activeSpaceId) loadPages(activeSpaceId); }, [activeSpaceId]);
  async function loadPages(spaceId: string) {
    const { data } = await supabase.from('wiki_pages').select('*').eq('space_id', spaceId).order('ordem').order('created_at');
    setPages((data as Page[]) || []);
  }

  // Ao entrar sem página selecionada, abre a primeira do espaço.
  useEffect(() => {
    if (!pageId && pages.length) navigate(`/wiki/${pages[0].id}`, { replace: true });
  }, [pages, pageId, navigate]);

  // Sai do modo edição ao trocar de página.
  useEffect(() => { setEditing(false); }, [pageId]);

  const tree = useMemo(() => {
    const byParent = new Map<string | null, Page[]>();
    for (const p of pages) {
      const k = p.parent_id;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(p);
    }
    return byParent;
  }, [pages]);

  const rendered = useMemo(() => activePage ? withHeadings(DOMPurify.sanitize(activePage.content || '')) : { html: '', outline: [] }, [activePage]);

  // ---- ações ----
  const createSpace = async () => {
    const name = window.prompt('Nome do novo espaço:', 'Novo espaço');
    if (!name) return;
    const { data } = await supabase.from('wiki_spaces').insert([{ name: name.trim(), ordem: spaces.length, created_by: profile?.id }]).select('*').single();
    if (data) { await loadSpaces(); setActiveSpaceId((data as Space).id); setSpaceMenu(false); }
  };

  const createPage = async (parentId: string | null) => {
    if (!activeSpaceId) return;
    const siblings = pages.filter(p => p.parent_id === parentId);
    const { data } = await supabase.from('wiki_pages').insert([{
      space_id: activeSpaceId, parent_id: parentId, title: 'Sem título', content: '', ordem: siblings.length, created_by: profile?.id,
    }]).select('*').single();
    if (data) {
      if (parentId) setExpanded(prev => new Set(prev).add(parentId));
      await loadPages(activeSpaceId);
      const p = data as Page;
      navigate(`/wiki/${p.id}`);
      setDraftTitle(p.title); setDraftContent(p.content); setEditing(true);
    }
  };

  const startEdit = () => { if (!activePage) return; setDraftTitle(activePage.title); setDraftContent(activePage.content); setEditing(true); };

  const savePage = async () => {
    if (!activePage) return;
    setSaving(true);
    const { error } = await supabase.from('wiki_pages').update({
      title: draftTitle.trim() || 'Sem título', content: draftContent, updated_at: new Date().toISOString(), updated_by: profile?.id,
    }).eq('id', activePage.id);
    setSaving(false);
    if (error) { toast.error('Não foi possível salvar.'); return; }
    setEditing(false);
    if (activeSpaceId) loadPages(activeSpaceId);
    toast.success('Página salva ✓');
  };

  const deletePage = async (p: Page) => {
    const kids = pages.filter(x => x.parent_id === p.id).length;
    if (!(await confirm({ title: 'Excluir página', message: kids ? `Excluir "${p.title}" e suas ${kids} sub-página(s)? Não dá pra desfazer.` : `Excluir "${p.title}"? Não dá pra desfazer.`, confirmLabel: 'Excluir', danger: true }))) return;
    const { error } = await supabase.from('wiki_pages').delete().eq('id', p.id);
    if (error) { toast.error('Não foi possível excluir.'); return; }
    if (activeSpaceId) await loadPages(activeSpaceId);
    if (pageId === p.id) navigate('/wiki', { replace: true });
    toast.success('Página excluída.');
  };

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const activeSpace = spaces.find(s => s.id === activeSpaceId) || null;

  // breadcrumb (cadeia de pais até a raiz)
  const crumb = useMemo(() => {
    const chain: Page[] = [];
    let cur = activePage;
    while (cur) { chain.unshift(cur); cur = cur.parent_id ? pages.find(p => p.id === cur!.parent_id) || null : null; }
    return chain;
  }, [activePage, pages]);

  // ---- render da árvore ----
  const renderNodes = (parentId: string | null, depth = 0) => {
    const nodes = (tree.get(parentId) || []);
    return nodes.map(p => {
      const kids = tree.get(p.id) || [];
      const isOpen = expanded.has(p.id);
      const isActive = p.id === pageId;
      return (
        <div key={p.id}>
          <div
            className={clsx('group flex items-center gap-1.5 rounded-lumos pr-1.5 text-[13.5px] transition-colors',
              isActive ? 'bg-lumos-yellow/[0.12] text-lumos-yellow font-bold' : 'text-lumos-text-secondary hover:bg-white/[0.05] hover:text-lumos-text-primary')}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <button type="button" onClick={() => kids.length && toggleExpand(p.id)} className="w-4 flex-shrink-0 flex items-center justify-center text-lumos-text-secondary/70">
              {kids.length ? (isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : <span className="w-3.5" />}
            </button>
            <button type="button" onClick={() => navigate(`/wiki/${p.id}`)} className="flex-1 min-w-0 text-left py-1.5 flex items-center gap-1.5">
              <span className="flex-shrink-0">{p.icon || <FileText className="w-3.5 h-3.5 opacity-60" />}</span>
              <span className="truncate">{p.title}</span>
            </button>
            <button type="button" onClick={() => createPage(p.id)} title="Nova sub-página" className="w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10 flex-shrink-0"><Plus className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => deletePage(p)} title="Excluir" className="w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
          {isOpen && kids.length > 0 && renderNodes(p.id, depth + 1)}
        </div>
      );
    });
  };

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-lumos-yellow" /></div>;

  return (
    <div className="-m-4 lg:-m-8 h-[calc(100vh-0px)] flex min-h-0 font-work-sans">
      {dialog}
      {/* ------- Coluna esquerda: espaço + árvore ------- */}
      <aside className="lumos-nav-surface w-72 flex-shrink-0 border-r border-lumos-border hidden md:flex flex-col">
        {/* seletor de espaço */}
        <div className="relative border-b border-lumos-border/60">
          <button onClick={() => setSpaceMenu(o => !o)} className="w-full flex items-center gap-2.5 p-3.5 text-left hover:bg-white/[0.03] transition-colors">
            <span className="w-9 h-9 rounded-lumos bg-lumos-yellow/15 flex items-center justify-center text-lg flex-shrink-0">{activeSpace?.icon || '📘'}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-black text-lumos-text-primary truncate">{activeSpace?.name || 'Wiki'}</span>
              <span className="block text-[11px] text-lumos-text-secondary">{spaces.length} espaço(s) · Wiki</span>
            </span>
            <ChevronDown className="w-4 h-4 text-lumos-text-secondary flex-shrink-0" />
          </button>
          {spaceMenu && (
            <div className="absolute left-2 right-2 top-full mt-1 z-30 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1">
              {spaces.map(s => (
                <button key={s.id} onClick={() => { setActiveSpaceId(s.id); setSpaceMenu(false); }}
                  className={clsx('w-full flex items-center gap-2 px-2 py-2 rounded text-sm text-left', s.id === activeSpaceId ? 'bg-lumos-yellow/10 text-lumos-yellow font-bold' : 'text-lumos-text-primary hover:bg-white/5')}>
                  <span>{s.icon || '📘'}</span><span className="truncate">{s.name}</span>
                </button>
              ))}
              <button onClick={createSpace} className="w-full flex items-center gap-2 px-2 py-2 rounded text-sm text-lumos-yellow hover:bg-lumos-yellow/10 border-t border-lumos-border/50 mt-1">
                <Plus className="w-4 h-4" /> Novo espaço
              </button>
            </div>
          )}
        </div>
        {/* árvore */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {renderNodes(null)}
          <button onClick={() => createPage(null)} className="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-lumos border border-dashed border-lumos-border text-lumos-text-secondary hover:border-lumos-yellow/40 hover:text-lumos-yellow text-[12.5px] font-bold transition-colors">
            <Plus className="w-3.5 h-3.5" /> Nova página
          </button>
        </div>
      </aside>

      {/* ------- Centro: conteúdo ------- */}
      <main className="flex-1 min-w-0 flex flex-col bg-lumos-bg">
        <div className="h-14 flex-shrink-0 flex items-center gap-3 px-6 border-b border-lumos-border">
          <button onClick={() => { /* busca — fase 2 */ }} className="flex items-center gap-2 h-9 px-3 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:border-lumos-yellow/40 max-w-md w-full">
            <Search className="w-4 h-4" /><span className="text-[13px]">Buscar na Wiki…</span>
          </button>
          <div className="flex-1" />
          {activePage && !editing && (
            <button onClick={startEdit} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> Editar</button>
          )}
          {editing && (
            <>
              <button onClick={() => setEditing(false)} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Cancelar</button>
              <button onClick={savePage} disabled={saving} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Salvar</button>
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {!activePage ? (
            <div className="max-w-2xl mx-auto text-center py-32 px-6">
              <BookOpen className="w-10 h-10 text-lumos-text-secondary/40 mx-auto mb-4" />
              <h2 className="text-lg font-bold text-lumos-text-primary">Comece sua Wiki</h2>
              <p className="text-sm text-lumos-text-secondary mt-1 mb-5">Crie a primeira página deste espaço.</p>
              <button onClick={() => createPage(null)} className="btn-primary text-sm py-2 px-4 inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Nova página</button>
            </div>
          ) : (
            <article className="max-w-3xl mx-auto px-6 lg:px-10 py-10 pb-32">
              {crumb.length > 0 && (
                <div className="text-xs text-lumos-text-secondary/60 mb-4">
                  {activeSpace?.name} {crumb.map(c => <span key={c.id}> <span className="opacity-50">›</span> {c.title}</span>)}
                </div>
              )}
              {editing ? (
                <>
                  <input value={draftTitle} onChange={e => setDraftTitle(e.target.value)} placeholder="Título da página"
                    className="w-full bg-transparent text-3xl lg:text-4xl font-black tracking-tight text-lumos-text-primary outline-none mb-4 placeholder:text-lumos-text-secondary/40" />
                  <RichTextEditor value={draftContent} onChange={setDraftContent} minHeight={400} />
                </>
              ) : (
                <>
                  <h1 className="text-3xl lg:text-4xl font-black tracking-tight text-lumos-text-primary mb-6 flex items-center gap-3">
                    {activePage.icon && <span>{activePage.icon}</span>}{activePage.title}
                  </h1>
                  {rendered.html.trim() ? (
                    <div className="wiki-content" dangerouslySetInnerHTML={{ __html: rendered.html }} />
                  ) : (
                    <p className="text-lumos-text-secondary/60 italic">Página vazia. Clique em <b>Editar</b> pra escrever.</p>
                  )}
                </>
              )}
            </article>
          )}
        </div>
      </main>

      {/* ------- Direita: nesta página ------- */}
      <aside className="w-60 flex-shrink-0 border-l border-lumos-border hidden xl:block bg-lumos-bg">
        {!editing && rendered.outline.length > 0 && (
          <div className="sticky top-0 p-6">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-lumos-text-secondary/60 mb-3">Nesta página</h4>
            <nav className="space-y-0.5">
              {rendered.outline.map(h => (
                <a key={h.id} href={`#${h.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  className={clsx('block text-[13px] text-lumos-text-secondary hover:text-lumos-text-primary border-l-2 border-transparent hover:border-lumos-border transition-colors py-1', h.level === 3 ? 'pl-6' : 'pl-3')}>
                  {h.text}
                </a>
              ))}
            </nav>
          </div>
        )}
      </aside>
    </div>
  );
}
