import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { clsx } from 'clsx';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Quote, Minus, Undo2, Redo2, Link2, Link2Off,
} from 'lucide-react';

interface Props {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
  className?: string;
  minHeight?: number;
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
export default function RichTextEditor({ value, onChange, editable = true, className, minHeight = 160 }: Props) {
  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5] } }),
      Underline,
      Link.configure({ openOnClick: false }),
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
          <select value={headingValue} onChange={e => setHeading(e.target.value)}
            className="h-7 text-xs font-semibold bg-transparent text-lumos-text-primary border border-lumos-border rounded-md px-1.5 outline-none cursor-pointer">
            <option value="p">Texto</option>
            <option value="1">Título 1</option>
            <option value="2">Título 2</option>
            <option value="3">Título 3</option>
            <option value="4">Título 4</option>
            <option value="5">Título 5</option>
          </select>
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
