import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import RichTextEditor from '@/components/common/RichTextEditor';
import DOMPurify from 'dompurify';
import { clsx } from 'clsx';
import { Search, Pencil, Check, X, Loader2, BookOpen, Smile, Plus } from 'lucide-react';
import { useWiki, type WikiPage } from '@/context/WikiContext';
import WikiTree from '@/components/layout/WikiTree';

// Emojis sugeridos pro ícone da página (dá pra colar qualquer outro também).
const WIKI_EMOJIS = ['📄','📘','📗','📕','📙','📚','📓','🗂️','📁','💛','⭐','🔥','🚀','✅','📌','🎬','🎥','🎨','💡','⚙️','🔧','🔑','👥','💰','📊','📈','📝','📢','🏆','🎯','🔒','🌟','🧠','🧩','🗓️','🔔','💬','🏷️','🧾','📦','🎓','🧭','⚡','❤️','👋','🙌','🎉','🛠️'];

// Links do conteúdo abrem em nova aba, com segurança.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
});

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sec';

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
  const location = useLocation();
  const { profile } = useAuth();
  const toast = useToast();
  // Dados vêm do WikiContext — os MESMOS usados pela árvore no painel do app.
  const { pages, activeSpace, loading, createPage, reload } = useWiki();

  // edição
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftIcon, setDraftIcon] = useState<string | null>(null);
  const [iconPicker, setIconPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const activePage = pages.find(p => p.id === pageId) || null;

  // Ao entrar sem página selecionada (raiz /wiki), abre a primeira. Só redireciona
  // quando ainda estamos DE FATO na raiz — senão o AnimatePresence, ao sair da
  // Wiki, dispararia um navigate de volta e prenderia o usuário.
  useEffect(() => {
    const naRaizDaWiki = location.pathname === '/wiki' || location.pathname === '/wiki/';
    if (naRaizDaWiki && !pageId && pages.length) navigate(`/wiki/${pages[0].id}`, { replace: true });
  }, [pages, pageId, navigate, location.pathname]);

  // Troca de página: sai da edição — EXCETO quando a página acabou de ser criada
  // (navigate com state.edit), aí já entra em edição na página nova.
  const editConsumedRef = useRef<string | null>(null);
  useEffect(() => {
    const wantEdit = !!(location.state as any)?.edit;
    if (wantEdit && activePage && editConsumedRef.current !== activePage.id) {
      editConsumedRef.current = activePage.id;
      setDraftTitle(activePage.title); setDraftContent(activePage.content); setDraftIcon(activePage.icon);
      setIconPicker(false); setEditing(true);
    } else if (!wantEdit) {
      setEditing(false);
    }
  }, [pageId, activePage?.id, location.state]);

  const rendered = useMemo(() => activePage ? withHeadings(DOMPurify.sanitize(activePage.content || '')) : { html: '', outline: [] }, [activePage]);

  const startEdit = () => { if (!activePage) return; setDraftTitle(activePage.title); setDraftContent(activePage.content); setDraftIcon(activePage.icon); setIconPicker(false); setEditing(true); };

  const savePage = async () => {
    if (!activePage) return;
    setSaving(true);
    const { error } = await supabase.from('wiki_pages').update({
      title: draftTitle.trim() || 'Sem título', content: draftContent, icon: draftIcon, updated_at: new Date().toISOString(), updated_by: profile?.id,
    }).eq('id', activePage.id);
    setSaving(false);
    if (error) { toast.error('Não foi possível salvar.'); return; }
    setEditing(false);
    reload();
    toast.success('Página salva ✓');
  };

  // Modo leitura: clicar num chip de menção (@página) navega pra ela.
  const onContentClick = (e: React.MouseEvent) => {
    const chip = (e.target as HTMLElement).closest('[data-type="mention"][data-id]');
    if (!chip) return;
    e.preventDefault();
    const id = chip.getAttribute('data-id');
    if (id) navigate(`/wiki/${id}`);
  };

  // breadcrumb (cadeia de pais até a raiz)
  const crumb = useMemo(() => {
    const chain: WikiPage[] = [];
    let cur = activePage;
    while (cur) { chain.unshift(cur); cur = cur.parent_id ? pages.find(p => p.id === cur!.parent_id) || null : null; }
    return chain;
  }, [activePage, pages]);

  return (
    <div className="-m-4 lg:-m-8 h-[calc(100vh-0px)] flex min-h-0 font-work-sans">
      {/* Árvore só no tablet (md→lg): no desktop (lg+) ela vive no painel do app,
          igual às outras seções; no celular, fica pelo menu. */}
      <aside className="lumos-nav-surface w-72 flex-shrink-0 border-r border-lumos-border hidden md:flex lg:hidden flex-col">
        <div className="p-3.5 border-b border-lumos-border/60 flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-lumos bg-lumos-yellow/15 flex items-center justify-center text-lg flex-shrink-0">{activeSpace?.icon || '📘'}</span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-black text-lumos-text-primary truncate">{activeSpace?.name || 'Wiki'}</span>
            <span className="block text-[11px] text-lumos-text-secondary">Base de conhecimento</span>
          </span>
        </div>
        <WikiTree />
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
          {loading ? (
            <div className="flex justify-center py-32"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow/70" /></div>
          ) : !activePage ? (
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
                  <div className="flex items-start gap-3 mb-4">
                    {/* Seletor de emoji da página */}
                    <div className="relative flex-shrink-0">
                      <button type="button" onClick={() => setIconPicker(o => !o)} title="Escolher emoji"
                        className="w-12 h-12 lg:w-14 lg:h-14 rounded-lumos flex items-center justify-center text-3xl lg:text-4xl hover:bg-lumos-text-secondary/10 transition-colors">
                        {draftIcon || <Smile className="w-6 h-6 text-lumos-text-secondary/40" />}
                      </button>
                      {iconPicker && (
                        <div className="absolute left-0 top-full mt-1 z-30 w-64 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-2">
                          <div className="grid grid-cols-8 gap-0.5 max-h-40 overflow-y-auto custom-scrollbar">
                            {WIKI_EMOJIS.map(e => (
                              <button key={e} type="button" onClick={() => { setDraftIcon(e); setIconPicker(false); }}
                                className="w-7 h-7 flex items-center justify-center text-lg rounded hover:bg-lumos-yellow/10">{e}</button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-lumos-border/50">
                            <input value={draftIcon || ''} onChange={e => setDraftIcon(e.target.value || null)} maxLength={8} placeholder="ou cole um emoji"
                              className="flex-1 min-w-0 bg-lumos-bg/40 border border-lumos-border rounded px-2 py-1 text-sm outline-none" />
                            <button type="button" onClick={() => { setDraftIcon(null); setIconPicker(false); }}
                              className="text-[11px] font-semibold text-lumos-text-secondary hover:text-red-400 px-1.5 py-1 flex-shrink-0">Limpar</button>
                          </div>
                        </div>
                      )}
                    </div>
                    <input value={draftTitle} onChange={e => setDraftTitle(e.target.value)} placeholder="Título da página"
                      className="flex-1 min-w-0 bg-transparent text-3xl lg:text-4xl font-black tracking-tight text-lumos-text-primary outline-none placeholder:text-lumos-text-secondary/40 mt-1" />
                  </div>
                  <RichTextEditor
                    value={draftContent}
                    onChange={setDraftContent}
                    minHeight={400}
                    mentionPages={pages.filter(p => p.id !== activePage.id).map(p => ({ id: p.id, title: p.title }))}
                  />
                </>
              ) : (
                <>
                  <h1 className="text-3xl lg:text-4xl font-black tracking-tight text-lumos-text-primary mb-6 flex items-center gap-3">
                    {activePage.icon && <span>{activePage.icon}</span>}{activePage.title}
                  </h1>
                  {rendered.html.trim() ? (
                    <div className="wiki-content" onClick={onContentClick} dangerouslySetInnerHTML={{ __html: rendered.html }} />
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
