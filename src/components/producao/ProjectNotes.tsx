import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Mention from '@tiptap/extension-mention';
import { mergeAttributes } from '@tiptap/core';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Quote, Minus, Undo2, Redo2, StickyNote, User, FileText, Film, Loader2,
} from 'lucide-react';

type MItem = { id: string; label: string; mtype: 'person' | 'file' | 'video'; url?: string };

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
  const Icon = (t: MItem['mtype']) => t === 'file' ? FileText : t === 'video' ? Film : User;
  const color = (t: MItem['mtype']) => t === 'file' ? 'text-blue-500' : t === 'video' ? 'text-purple-500' : 'text-amber-500';
  return (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl py-1 w-64 max-h-64 overflow-y-auto custom-scrollbar">
      {items.map((it, idx) => {
        const Ic = Icon(it.mtype);
        return (
          <button key={`${it.mtype}-${it.id}`} type="button" onClick={() => pick(idx)}
            className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs', idx === i ? 'bg-lumos-yellow/10' : 'hover:bg-lumos-text-primary/5')}>
            <Ic className={clsx('w-3.5 h-3.5 flex-shrink-0', color(it.mtype))} />
            <span className="truncate font-semibold text-lumos-text-primary">{it.label}</span>
            <span className="ml-auto text-[9px] uppercase font-black text-lumos-text-secondary/60">{it.mtype === 'person' ? 'pessoa' : it.mtype === 'file' ? 'arquivo' : 'vídeo'}</span>
          </button>
        );
      })}
    </div>
  );
});
MentionList.displayName = 'MentionList';

// Menção com tipo + url. Render como chip; arquivos/vídeos abrem via clique
// (delegação no container), preservando o round-trip do parse padrão.
const LumosMention = Mention.extend({
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
    const prefix = t === 'file' ? '📄 ' : t === 'video' ? '🎬 ' : '@';
    const attrs: any = { 'data-type': 'mention', 'data-id': node.attrs.id, 'data-label': node.attrs.label, 'data-mtype': t, class: `lumos-mention lumos-mention-${t}` };
    if (node.attrs.url) { attrs['data-url'] = node.attrs.url; attrs.title = 'Abrir'; }
    return ['span', mergeAttributes(attrs), `${prefix}${label}`];
  },
});

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
  const itemsRef = useRef<MItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // Fonte da verdade síncrona do projeto atual + trava anti-perda: só salvamos
  // DEPOIS que o conteúdo carregou. Sem isso, um autosave disparado antes do
  // fetch (ou de outro projeto) sobrescrevia as notas com vazio.
  const projectIdRef = useRef(projectId);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);
  const loadedRef = useRef(false);

  const save = (html: string) => {
    if (!loadedRef.current) return; // ainda carregando: nunca sobrescrever
    const targetId = projectIdRef.current;
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await supabase.from('projects').update({ notes: html }).eq('id', targetId);
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
        suggestion: {
          char: '@',
          items: ({ query }: any) => {
            const q = (query || '').toLowerCase();
            return itemsRef.current.filter(it => it.label.toLowerCase().includes(q)).slice(0, 8);
          },
          render: () => {
            let component: ReactRenderer | null = null;
            const place = (rect: any) => {
              if (!popupRef.current || !rect) return;
              const r = rect();
              if (!r) return;
              popupRef.current.style.top = `${r.bottom + 6}px`;
              popupRef.current.style.left = `${r.left}px`;
            };
            return {
              onStart: (props: any) => {
                component = new ReactRenderer(MentionList, { props, editor: props.editor });
                const el = document.createElement('div');
                el.style.position = 'fixed'; el.style.zIndex = '300';
                el.appendChild(component.element);
                document.body.appendChild(el);
                popupRef.current = el;
                place(props.clientRect);
              },
              onUpdate: (props: any) => { component?.updateProps(props); place(props.clientRect); },
              onKeyDown: (props: any) => {
                if (props.event.key === 'Escape') { return true; }
                return (component?.ref as any)?.onKeyDown(props) ?? false;
              },
              onExit: () => { component?.destroy(); popupRef.current?.remove(); popupRef.current = null; },
            };
          },
        },
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => { if (canManage) save(editor.getHTML()); },
    editorProps: { attributes: { class: 'ProseMirror focus:outline-none' } },
  });

  // Carrega itens de menção + as notas do projeto
  useEffect(() => {
    let alive = true;
    loadedRef.current = false;
    (async () => {
      setLoading(true);
      const [u, docs, vids, proj] = await Promise.all([
        supabase.from('app_users').select('id, full_name').eq('status', 'ativo').order('full_name'),
        supabase.from('project_documents').select('id, name, url').eq('project_id', projectId),
        supabase.from('video_versions').select('id, file_name, versao, drive_web_link').eq('project_id', projectId).order('versao', { ascending: false }),
        supabase.from('projects').select('notes').eq('id', projectId).single(),
      ]);
      if (!alive) return;
      const items: MItem[] = [
        ...((u.data as any[]) || []).map(x => ({ id: x.id, label: x.full_name, mtype: 'person' as const })),
        ...((docs.data as any[]) || []).map(x => ({ id: x.id, label: x.name, mtype: 'file' as const, url: x.url })),
        ...((vids.data as any[]) || []).map(x => ({ id: x.id, label: `v${x.versao} · ${x.file_name}`, mtype: 'video' as const, url: x.drive_web_link || undefined })),
      ];
      itemsRef.current = items;
      editor?.commands.setContent((proj.data as any)?.notes || '', { emitUpdate: false });
      loadedRef.current = true; // a partir daqui, edições podem salvar
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [projectId, editor]);

  useEffect(() => { editor?.setEditable(canManage); }, [canManage, editor]);

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

  if (!editor) return null;

  return (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos overflow-hidden">
      <div className="px-4 py-3 border-b border-lumos-border flex items-center gap-2">
        <StickyNote className="w-4 h-4 text-lumos-yellow" />
        <h3 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Anotações do Projeto</h3>
        <span className="text-[11px] text-lumos-text-secondary">use @ para mencionar pessoas, arquivos e vídeos</span>
        {saveState !== 'idle' && (
          <span className="ml-auto text-[10px] font-bold text-lumos-text-secondary flex items-center gap-1">
            {saveState === 'saving' ? <><Loader2 className="w-3 h-3 animate-spin" /> salvando…</> : 'salvo ✓'}
          </span>
        )}
      </div>

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
    </div>
  );
}
