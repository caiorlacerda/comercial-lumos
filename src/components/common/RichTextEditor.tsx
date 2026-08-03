import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Mention from '@tiptap/extension-mention';
import { PluginKey } from '@tiptap/pm/state';
import { clsx } from 'clsx';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Quote, Minus, Undo2, Redo2, Link2, Link2Off, FileText,
} from 'lucide-react';
import Select from '@/components/ui/Select';

const HEADING_OPTS = [
  { value: 'p', label: 'Texto' }, { value: '1', label: 'Título 1' }, { value: '2', label: 'Título 2' },
  { value: '3', label: 'Título 3' }, { value: '4', label: 'Título 4' }, { value: '5', label: 'Título 5' },
];

export interface MentionPage { id: string; title: string }

interface Props {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
  className?: string;
  minHeight?: number;
  // Quando presente, habilita menção de páginas com "@" (mesma mecânica das
  // menções do resto do app). Cada item vira um chip que, na leitura, leva à
  // página. Passe a lista de páginas mencionáveis (título + id).
  mentionPages?: MentionPage[];
}

// ── Menção de página ("@") ──────────────────────────────────────────────────
// Reusa a mesma forma de menção do app: popup com teclado, chip inline. O nó é
// o 'mention' padrão do TipTap, então serializa como
// <span data-type="mention" data-id="…" class="lumos-mention lumos-mention-page">
// e a leitura navega ao clicar (ver Wiki.tsx).
type PgItem = { id: string; label: string };

const PageMentionList = forwardRef((props: any, ref) => {
  const [i, setI] = useState(0);
  const items: PgItem[] = props.items || [];
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
  if (items.length === 0) return <div className="bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl px-3 py-2 text-xs text-lumos-text-secondary">Nenhuma página</div>;
  return (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl py-1 w-64 max-h-64 overflow-y-auto custom-scrollbar">
      {items.map((it, idx) => (
        <button key={it.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(idx)}
          className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs', idx === i ? 'bg-lumos-yellow/10' : 'hover:bg-lumos-text-primary/5')}>
          <FileText className="w-3.5 h-3.5 text-lumos-yellow flex-shrink-0" />
          <span className="truncate font-semibold text-lumos-text-primary">{it.label}</span>
        </button>
      ))}
    </div>
  );
});
PageMentionList.displayName = 'PageMentionList';

const PAGE_MENTION_KEY = new PluginKey('wikiPageMention');

function makePageMention(getPages: () => MentionPage[]) {
  return Mention.configure({
    HTMLAttributes: { class: 'lumos-mention lumos-mention-page' },
    suggestion: {
      char: '@',
      pluginKey: PAGE_MENTION_KEY,
      items: ({ query }: any) => getPages()
        .filter(p => p.title.toLowerCase().includes((query || '').toLowerCase()))
        .slice(0, 8)
        .map(p => ({ id: p.id, label: p.title })),
      command: ({ editor, range, props }: any) => {
        editor.chain().focus().insertContentAt(range, [
          { type: 'mention', attrs: { id: props.id, label: props.label } },
          { type: 'text', text: ' ' },
        ]).run();
      },
      render: () => {
        let component: ReactRenderer | null = null;
        let el: HTMLDivElement | null = null;
        const place = (rect: any) => {
          if (!el || !rect) return;
          const r = rect(); if (!r) return;
          el.style.top = `${r.bottom + 6}px`;
          el.style.left = `${r.left}px`;
        };
        return {
          onStart: (props: any) => {
            component = new ReactRenderer(PageMentionList, { props, editor: props.editor });
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
    },
  });
}

function TBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={e => e.preventDefault()} onClick={onClick} title={title}
      className={clsx('p-1.5 rounded-md transition-colors flex items-center justify-center',
        active ? 'bg-lumos-yellow/20 text-lumos-yellow' : 'text-lumos-text-secondary hover:bg-lumos-text-secondary/10 hover:text-lumos-text-primary')}>
      {children}
    </button>
  );
}
const Sep = () => <span className="w-px h-4 bg-lumos-border/70 mx-1" />;

// Editor rich text reutilizável (estilo ClickUp): títulos H1–H5, negrito,
// itálico, sublinhado, listas, citação e divisória. Emite HTML.
export default function RichTextEditor({ value, onChange, editable = true, className, minHeight = 160, mentionPages }: Props) {
  // Fonte síncrona das páginas mencionáveis (o editor é criado uma vez; a lista
  // pode chegar/atualizar depois — a suggestion lê sempre o ref).
  const pagesRef = useRef<MentionPage[]>(mentionPages || []);
  useEffect(() => { pagesRef.current = mentionPages || []; }, [mentionPages]);

  const editor = useEditor({
    editable,
    // immediatelyRender: false é o recomendado pro React (evita edge cases de
    // render/flushSync). O StarterKit v3 já traz Link e Underline, então
    // desabilitamos os embutidos e usamos os explícitos (com config própria) —
    // sem isso ficam extensões DUPLICADAS ('link'/'underline'), que geram
    // marcas ambíguas no schema e instabilidade.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5] }, link: false, underline: false }),
      Underline,
      Link.configure({ openOnClick: false }),
      // Menção de páginas só quando o caller habilita (ex.: Wiki).
      ...(mentionPages ? [makePageMention(() => pagesRef.current)] : []),
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: 'ProseMirror focus:outline-none' } },
  });

  // Sincroniza mudanças externas (ex.: carregar template) sem pular o cursor
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  if (!editor) return null;

  const curLevel = ([1, 2, 3, 4, 5] as const).find(l => editor.isActive('heading', { level: l }));
  const headingValue = curLevel ? String(curLevel) : 'p';
  const setHeading = (v: string) => {
    if (v === 'p') editor.chain().focus().setParagraph().run();
    else editor.chain().focus().setHeading({ level: Number(v) as 1 | 2 | 3 | 4 | 5 }).run();
  };
  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Endereço do link (URL):', prev || 'https://');
    if (url === null) return;                    // cancelou
    if (url.trim() === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <div className={clsx('border border-lumos-border rounded-lumos bg-lumos-surface overflow-hidden', className)}>
      {editable && (
        <div className="flex items-center flex-wrap gap-0.5 px-2 py-1.5 border-b border-lumos-border/60 bg-lumos-bg/30">
          <Select value={headingValue} onChange={setHeading} options={HEADING_OPTS} menuClassName="w-32"
            className="h-7 text-xs bg-transparent text-lumos-text-primary border border-lumos-border rounded-md px-1.5" />
          <Sep />
          <TBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito (Ctrl+B)"><Bold className="w-4 h-4" /></TBtn>
          <TBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico (Ctrl+I)"><Italic className="w-4 h-4" /></TBtn>
          <TBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado (Ctrl+U)"><UnderlineIcon className="w-4 h-4" /></TBtn>
          <TBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado"><Strikethrough className="w-4 h-4" /></TBtn>
          <Sep />
          <TBtn active={editor.isActive('link')} onClick={setLink} title="Inserir/editar link"><Link2 className="w-4 h-4" /></TBtn>
          {editor.isActive('link') && (
            <TBtn onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()} title="Remover link"><Link2Off className="w-4 h-4" /></TBtn>
          )}
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
      <div className="px-3 py-2.5 overflow-y-auto custom-scrollbar" style={{ minHeight }} onClick={() => editor.chain().focus().run()}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
