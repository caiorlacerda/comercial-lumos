import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Mention from '@tiptap/extension-mention';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { mergeAttributes } from '@tiptap/core';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Quote, Minus, Undo2, Redo2, StickyNote, User, FileText, Film, Loader2,
  History, RotateCcw, ChevronDown, ChevronUp, CheckSquare,
} from 'lucide-react';

type MType = 'person' | 'task' | 'file' | 'video';
type MItem = { id: string; label: string; mtype: MType; url?: string };
type HistItem = { id: string; notes: string | null; created_at: string; edited_by: string | null; editor?: { full_name: string } | null };

// "há X" curtinho em pt-BR (evita dependência de locale do date-fns).
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function plainText(html: string): string { return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(); }

// ── Popup de menção ─────────────────────────────────────────────────────────
const MentionList = forwardRef((props: any, ref) => {
  const [i, setI] = useState(0);
  const items: MItem[] = props.items || [];
  useEffect(() => setI(0), [props.items]);
  const pick = (idx: number) => { const it = items[idx]; if (it) props.command(it); };
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: any) => {
      if (event.key === 'ArrowUp') { setI((i - 1 + items.length) % items.length); return true; }
      if (event.key === 'ArrowDown') { setI((i + 1) % items.length); return true; }
      if (event.key === 'Enter') { pick(i); return true; }
      return false;
    },
  }));
  if (items.length === 0) return <div className="bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl px-3 py-2 text-xs text-lumos-text-secondary">Nada encontrado</div>;
  const Icon = (t: MType) => t === 'file' ? FileText : t === 'video' ? Film : t === 'task' ? CheckSquare : User;
  const color = (t: MType) => t === 'file' ? 'text-blue-500' : t === 'video' ? 'text-purple-500' : t === 'task' ? 'text-green-500' : 'text-amber-500';
  const typeLabel = (t: MType) => t === 'person' ? 'pessoa' : t === 'task' ? 'tarefa' : t === 'file' ? 'arquivo' : 'vídeo';
  return (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl py-1 w-64 max-h-64 overflow-y-auto custom-scrollbar">
      {items.map((it, idx) => {
        const Ic = Icon(it.mtype);
        return (
          <button key={`${it.mtype}-${it.id}`} type="button" onClick={() => pick(idx)}
            className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs', idx === i ? 'bg-lumos-yellow/10' : 'hover:bg-lumos-text-primary/5')}>
            <Ic className={clsx('w-3.5 h-3.5 flex-shrink-0', color(it.mtype))} />
            <span className="truncate font-semibold text-lumos-text-primary">{it.label}</span>
            <span className="ml-auto text-[9px] uppercase font-black text-lumos-text-secondary/60">{typeLabel(it.mtype)}</span>
          </button>
        );
      })}
    </div>
  );
});
MentionList.displayName = 'MentionList';

// Menção com tipo + url. Render como chip; arquivos/vídeos abrem via clique
// (delegação no container), preservando o round-trip do parse padrão.
//
// Gatilhos (padrão ClickUp): @ pessoas · @@ tarefas · @@@ documentos.
// Todos inserem o MESMO nó ('mention'), só mudando o mtype — por isso a extensão
// aceita uma lista de configs de suggestion e registra um plugin para cada.
const LumosMention = Mention.extend({
  addOptions() {
    return { ...(this.parent?.() as any), suggestions: [] as any[] };
  },
  addAttributes() {
    return {
      ...(this.parent?.() as any),
      mtype: { default: 'person', parseHTML: (el: any) => el.getAttribute('data-mtype') || 'person', renderHTML: (a: any) => ({ 'data-mtype': a.mtype }) },
      url: { default: null, parseHTML: (el: any) => el.getAttribute('data-url'), renderHTML: (a: any) => a.url ? { 'data-url': a.url } : {} },
    };
  },
  renderHTML({ node }) {
    const t = node.attrs.mtype || 'person';
    const label = node.attrs.label ?? node.attrs.id ?? '';
    const prefix = t === 'file' ? '📄 ' : t === 'video' ? '🎬 ' : t === 'task' ? '☑ ' : '@';
    const attrs: any = { 'data-type': 'mention', 'data-id': node.attrs.id, 'data-label': node.attrs.label, 'data-mtype': t, class: `lumos-mention lumos-mention-${t}` };
    if (node.attrs.url) { attrs['data-url'] = node.attrs.url; attrs.title = 'Abrir'; }
    return ['span', mergeAttributes(attrs), `${prefix}${label}`];
  },
  addProseMirrorPlugins() {
    return ((this.options as any).suggestions || []).map((s: any) =>
      Suggestion({ editor: this.editor, ...s })
    );
  },
});

const PERSON_KEY = new PluginKey('lumosMentionPerson');
const TASK_KEY = new PluginKey('lumosMentionTask');
const DOC_KEY = new PluginKey('lumosMentionDoc');

// Monta a config de um gatilho de menção. `blockIfNextAt` desambigua os gatilhos:
// se logo depois do match vier outro '@', significa que o usuário está digitando
// um gatilho MAIOR (@@ ou @@@), então este não deve abrir. Assim só um popup fica
// ativo por vez enquanto o usuário digita @ → @@ → @@@.
function makeSuggestion(char: string, pluginKey: PluginKey, getItems: () => MItem[], blockIfNextAt: boolean) {
  return {
    char,
    pluginKey,
    allow: ({ state, range }: any) => {
      if (!blockIfNextAt) return true;
      const end = Math.min(range.to + 1, state.doc.content.size);
      return state.doc.textBetween(range.to, end) !== '@';
    },
    items: ({ query }: any) => {
      const q = (query || '').toLowerCase();
      return getItems().filter(it => it.label.toLowerCase().includes(q)).slice(0, 8);
    },
    command: ({ editor, range, props }: any) => {
      const nodeAfter = editor.view.state.selection.$to.nodeAfter;
      if (nodeAfter?.text?.startsWith(' ')) range.to += 1;
      editor.chain().focus().insertContentAt(range, [
        { type: 'mention', attrs: props },
        { type: 'text', text: ' ' },
      ]).run();
      editor.view.dom.ownerDocument.defaultView?.getSelection()?.collapseToEnd();
    },
    render: () => {
      let component: ReactRenderer | null = null;
      let el: HTMLDivElement | null = null;
      const place = (rect: any) => {
        if (!el || !rect) return;
        const r = rect();
        if (!r) return;
        el.style.top = `${r.bottom + 6}px`;
        el.style.left = `${r.left}px`;
      };
      return {
        onStart: (props: any) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor });
          el = document.createElement('div');
          el.style.position = 'fixed';
          el.style.zIndex = '300';
          el.appendChild(component.element);
          document.body.appendChild(el);
          place(props.clientRect);
        },
        onUpdate: (props: any) => { component?.updateProps(props); place(props.clientRect); },
        onKeyDown: (props: any) => {
          if (props.event.key === 'Escape') return true;
          return (component?.ref as any)?.onKeyDown(props) ?? false;
        },
        onExit: () => { component?.destroy(); el?.remove(); el = null; },
      };
    },
  };
}

function TBtn({ active, onClick, title, children }: any) {
  return (
    <button type="button" onMouseDown={e => e.preventDefault()} onClick={onClick} title={title}
      className={clsx('p-1.5 rounded-md transition-colors', active ? 'bg-lumos-yellow/20 text-lumos-yellow' : 'text-lumos-text-secondary hover:bg-lumos-text-secondary/10 hover:text-lumos-text-primary')}>
      {children}
    </button>
  );
}
const Sep = () => <span className="w-px h-4 bg-lumos-border/70 mx-1" />;

interface Props { projectId: string; canManage?: boolean; }

export default function ProjectNotes({ projectId, canManage = true }: Props) {
  const { profile } = useAuth();
  // Listas por gatilho: @ pessoas · @@ tarefas · @@@ documentos (arquivos + vídeos).
  const peopleRef = useRef<MItem[]>([]);
  const tasksRef = useRef<MItem[]>([]);
  const docsRef = useRef<MItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fonte da verdade síncrona do projeto atual + trava anti-perda: só salvamos
  // DEPOIS que o conteúdo carregou. Sem isso, um autosave disparado antes do
  // fetch (ou de outro projeto) sobrescrevia as notas com vazio.
  const projectIdRef = useRef(projectId);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);
  const loadedRef = useRef(false);

  // Histórico / atividades recentes das anotações.
  const [history, setHistory] = useState<HistItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const lastHistoryAtRef = useRef(0);   // throttle de snapshots (ms epoch)
  const lastNonEmptyRef = useRef(false); // se o último conteúdo tinha texto
  const HISTORY_THROTTLE_MS = 90_000;

  const fetchHistory = async () => {
    const { data } = await supabase
      .from('project_notes_history')
      .select('id, notes, created_at, edited_by, editor:app_users!edited_by(full_name)')
      .eq('project_id', projectIdRef.current)
      .order('created_at', { ascending: false })
      .limit(20);
    setHistory((data as any) || []);
  };

  // Registra um snapshot no histórico — periodicamente durante a edição e SEMPRE
  // no momento em que o conteúdo fica vazio (o evento "sumiu"), para dar rastro e
  // permitir recuperar.
  const maybeSnapshot = async (html: string) => {
    const isEmpty = plainText(html).length === 0;
    const now = Date.now();
    const shouldSnapshot = now - lastHistoryAtRef.current > HISTORY_THROTTLE_MS || (isEmpty && lastNonEmptyRef.current);
    if (!shouldSnapshot) return;
    lastHistoryAtRef.current = now;
    lastNonEmptyRef.current = !isEmpty;
    await supabase.from('project_notes_history').insert({ project_id: projectIdRef.current, notes: html, edited_by: profile?.id || null });
    fetchHistory();
  };

  const save = (html: string) => {
    if (!loadedRef.current) return; // ainda carregando: nunca sobrescrever
    const targetId = projectIdRef.current;
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await supabase.from('projects').update({ notes: html }).eq('id', targetId);
      maybeSnapshot(html);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    }, 800);
  };

  const editor = useEditor({
    editable: canManage,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5] } }),
      Underline,
      LumosMention.configure({
        HTMLAttributes: { class: 'lumos-mention' },
        suggestions: [
          makeSuggestion('@', PERSON_KEY, () => peopleRef.current, true),
          makeSuggestion('@@', TASK_KEY, () => tasksRef.current, true),
          makeSuggestion('@@@', DOC_KEY, () => docsRef.current, false),
        ],
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => { if (canManage) save(editor.getHTML()); },
    // lumos-notes: espaçamento compacto fixo, escoped nas anotações (ver index.css).
    editorProps: { attributes: { class: 'ProseMirror focus:outline-none lumos-notes' } },
  });

  // Carrega itens de menção + as notas do projeto
  useEffect(() => {
    let alive = true;
    loadedRef.current = false;
    (async () => {
      setLoading(true);
      const [u, tasks, docs, vids, proj] = await Promise.all([
        supabase.from('app_users').select('id, full_name').eq('status', 'ativo').order('full_name'),
        supabase.from('project_tasks').select('id, titulo').eq('project_id', projectId).order('ordem'),
        supabase.from('project_documents').select('id, name, url').eq('project_id', projectId),
        supabase.from('video_versions').select('id, file_name, versao, drive_web_link').eq('project_id', projectId).order('versao', { ascending: false }),
        supabase.from('projects').select('notes').eq('id', projectId).single(),
      ]);
      if (!alive) return;
      peopleRef.current = ((u.data as any[]) || []).map(x => ({ id: x.id, label: x.full_name, mtype: 'person' as const }));
      tasksRef.current = ((tasks.data as any[]) || []).map(x => ({ id: x.id, label: x.titulo, mtype: 'task' as const }));
      // Documentos = arquivos subidos em Documentos + vídeos em revisão (ambos abrem por link).
      docsRef.current = [
        ...((docs.data as any[]) || []).map(x => ({ id: x.id, label: x.name, mtype: 'file' as const, url: x.url })),
        ...((vids.data as any[]) || []).map(x => ({ id: x.id, label: `v${x.versao} · ${x.file_name}`, mtype: 'video' as const, url: x.drive_web_link || undefined })),
      ];
      const loadedNotes = (proj.data as any)?.notes || '';
      editor?.commands.setContent(loadedNotes, { emitUpdate: false });
      lastNonEmptyRef.current = plainText(loadedNotes).length > 0;
      loadedRef.current = true; // a partir daqui, edições podem salvar
      setLoading(false);
      fetchHistory();
    })();
    return () => { alive = false; };
  }, [projectId, editor]);

  useEffect(() => { editor?.setEditable(canManage); }, [canManage, editor]);

  // Restaura o conteúdo de um snapshot do histórico.
  const restore = async (h: HistItem) => {
    if (!canManage || !editor) return;
    const html = h.notes || '';
    editor.commands.setContent(html, { emitUpdate: false });
    await supabase.from('projects').update({ notes: html }).eq('id', projectIdRef.current);
    lastHistoryAtRef.current = 0; // força registrar a restauração como snapshot
    await maybeSnapshot(html);
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  };

  // Abre arquivos/vídeos ao clicar na menção (edição ou leitura)
  const onContainerClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-mtype]') as HTMLElement | null;
    const url = el?.getAttribute('data-url');
    if (url) { e.preventDefault(); window.open(url, '_blank', 'noopener'); }
  };

  const headingValue = useMemo(() => {
    const l = ([1, 2, 3, 4, 5] as const).find(x => editor?.isActive('heading', { level: x }));
    return l ? String(l) : 'p';
  }, [editor?.state]);

  // Seção recolhível (lembra a preferência entre projetos).
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('lumos_notes_collapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed(v => {
    const n = !v;
    try { localStorage.setItem('lumos_notes_collapsed', n ? '1' : '0'); } catch { /* noop */ }
    return n;
  });

  if (!editor) return null;

  return (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos overflow-hidden">
      <button
        type="button"
        onClick={toggleCollapsed}
        className={clsx('w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-lumos-text-secondary/[0.03] transition-colors', !collapsed && 'border-b border-lumos-border')}
      >
        <StickyNote className="w-4 h-4 text-lumos-yellow flex-shrink-0" />
        <h3 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Anotações do Projeto</h3>
        {!collapsed && (
          <span className="text-[11px] text-lumos-text-secondary hidden sm:inline">
            <strong className="font-bold text-amber-500">@</strong> pessoas ·{' '}
            <strong className="font-bold text-green-500">@@</strong> tarefas ·{' '}
            <strong className="font-bold text-blue-500">@@@</strong> documentos
          </span>
        )}
        {saveState !== 'idle' && !collapsed && (
          <span className="ml-auto text-[10px] font-bold text-lumos-text-secondary flex items-center gap-1">
            {saveState === 'saving' ? <><Loader2 className="w-3 h-3 animate-spin" /> salvando…</> : 'salvo ✓'}
          </span>
        )}
        {collapsed ? <ChevronDown className="w-4 h-4 text-lumos-text-secondary ml-auto flex-shrink-0" /> : <ChevronUp className="w-4 h-4 text-lumos-text-secondary flex-shrink-0" />}
      </button>

      <div className={clsx(collapsed && 'hidden')}>

      {canManage && (
        <div className="flex items-center flex-wrap gap-0.5 px-2 py-1.5 border-b border-lumos-border/60 bg-lumos-bg/30">
          <select value={headingValue} onChange={e => { const v = e.target.value; if (v === 'p') editor.chain().focus().setParagraph().run(); else editor.chain().focus().setHeading({ level: Number(v) as any }).run(); }}
            className="h-7 text-xs font-semibold bg-transparent text-lumos-text-primary border border-lumos-border rounded-md px-1.5 outline-none cursor-pointer">
            <option value="p">Texto</option><option value="1">Título 1</option><option value="2">Título 2</option><option value="3">Título 3</option><option value="4">Título 4</option><option value="5">Título 5</option>
          </select>
          <Sep />
          <TBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito"><Bold className="w-4 h-4" /></TBtn>
          <TBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico"><Italic className="w-4 h-4" /></TBtn>
          <TBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado"><UnderlineIcon className="w-4 h-4" /></TBtn>
          <TBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado"><Strikethrough className="w-4 h-4" /></TBtn>
          <Sep />
          <TBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista"><List className="w-4 h-4" /></TBtn>
          <TBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada"><ListOrdered className="w-4 h-4" /></TBtn>
          <TBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Citação"><Quote className="w-4 h-4" /></TBtn>
          <TBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divisória"><Minus className="w-4 h-4" /></TBtn>
          <Sep />
          <TBtn onClick={() => editor.chain().focus().undo().run()} title="Desfazer"><Undo2 className="w-4 h-4" /></TBtn>
          <TBtn onClick={() => editor.chain().focus().redo().run()} title="Refazer"><Redo2 className="w-4 h-4" /></TBtn>
        </div>
      )}

      <div className="px-4 py-3 min-h-[120px] overflow-y-auto custom-scrollbar" onClick={onContainerClick}>
        {loading ? <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow mx-auto" /></div> : <EditorContent editor={editor} />}
      </div>

      {/* Atividades recentes das anotações (histórico + restaurar) */}
      {!loading && (
        <div className="border-t border-lumos-border/60">
          <button
            type="button"
            onClick={() => setShowHistory(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-lumos-text-secondary hover:text-lumos-text-primary transition-colors"
          >
            <History className="w-3.5 h-3.5" />
            Atividades recentes
            {history.length > 0 && <span className="text-lumos-text-secondary/60">({history.length})</span>}
            {showHistory ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
          </button>

          {showHistory && (
            <div className="px-4 pb-3 max-h-64 overflow-y-auto custom-scrollbar">
              {history.length === 0 ? (
                <p className="text-xs text-lumos-text-secondary/70 italic py-2">Nenhuma alteração registrada ainda.</p>
              ) : (
                <ul className="space-y-1">
                  {history.map(h => {
                    const preview = plainText(h.notes || '');
                    const empty = preview.length === 0;
                    return (
                      <li key={h.id} className="flex items-center gap-2 py-1.5 border-b border-lumos-border/40 last:border-0">
                        <User className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-semibold text-lumos-text-primary truncate">{h.editor?.full_name || 'Alguém'}</span>
                            <span className="text-lumos-text-secondary/60 flex-shrink-0">· {timeAgo(h.created_at)}</span>
                          </div>
                          <p className={clsx('text-[11px] truncate', empty ? 'text-red-500 italic' : 'text-lumos-text-secondary')}>
                            {empty ? 'esvaziou as anotações' : preview}
                          </p>
                        </div>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => restore(h)}
                            title="Restaurar esta versão"
                            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/10 transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" /> Restaurar
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
