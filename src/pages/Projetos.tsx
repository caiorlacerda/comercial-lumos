import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { ServiceOrderPDF } from '@/components/editor/ServiceOrderPDF';
import { pdf } from '@react-pdf/renderer';
import {
  FolderClosed,
  FolderOpen,
  ExternalLink,
  Plus,
  ClipboardList, 
  Search, 
  Calendar, 
  FileText, 
  Check, 
  RotateCcw, 
  X, 
  ChevronRight,
  ChevronDown,
  Briefcase,
  AlertCircle,
  Clock,
  Loader2,
  Trash2,
  Columns,
  Layers,
  ArrowRight,
  User,
  PlusCircle,
  HelpCircle,
  CornerDownRight,
  MessageSquare,
  Edit2,
  Menu
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatBudgetCode } from '@/utils/formatters';

// TipTap and DOMPurify imports for Rich Text
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Node, mergeAttributes } from '@tiptap/core';
import DOMPurify from 'dompurify';

interface Client {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  code: string | null;
  budget_id: string | null;
  client_id: string | null;
  status: 'ativo' | 'concluido';
  data_inicio: string | null;
  data_fim: string | null;
  descricao: string | null;
  category: 'digital' | 'filme' | 'live' | null;
  budget?: {
    category: 'digital' | 'filme' | 'live';
  } | null;
}

interface TaskSummary {
  id: string;
  project_id: string;
  status: string;
}

export const TASK_STATUS_GROUPS = {
  nao_iniciado: [
    { value: 'iniciar', label: 'Iniciar', color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' },
    { value: 'pausado', label: 'Pausado', color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' },
    { value: 'aguard_captacao', label: 'Aguard. Captação', color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' },
    { value: 'aguard_material', label: 'Aguard. Material', color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' }
  ],
  ativo: [
    { value: 'na_fila', label: 'Na Fila', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
    { value: 'em_progresso', label: 'Em Progresso', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
    { value: 'revisao_interna', label: 'Revisão Interna', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
    { value: 'aprov_interna', label: 'Aprov. Interna', color: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
    { value: 'revisao_cliente', label: 'Revisão do Cliente', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    { value: 'alteracoes', label: 'Alterações', color: 'bg-red-500/10 text-red-400 border-red-500/20' }
  ],
  concluido: [
    { value: 'entregue', label: 'Entregue', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    { value: 'concluido', label: 'Concluído', color: 'bg-green-500/10 text-green-400 border-green-500/20' }
  ]
};

export const getStatusDetails = (statusVal: string) => {
  for (const group of Object.values(TASK_STATUS_GROUPS)) {
    const found = group.find(s => s.value === statusVal);
    if (found) return found;
  }
  return { value: statusVal, label: statusVal, color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' };
};

interface Task {
  id: string;
  project_id: string;
  titulo: string;
  descricao: string | null;
  status: string;
  prioridade: 'baixa' | 'media' | 'alta';
  ordem: number;
  data_inicio: string | null;
  data_fim: string | null;
  responsavel_id: string | null;
}

interface TeamUser {
  id: string;
  full_name: string;
}

interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  user?: {
    full_name: string;
    email: string;
    role: string;
  } | null;
}

// Configuração segura para sanitização do HTML (DOMPurify) incluindo novos elementos e classes
export const DOM_PURIFY_CONFIG = {
  ADD_TAGS: ['div', 'li', 'ul', 'ol', 'input', 'label', 'hr', 'p', 'h1', 'h2', 'h3', 'blockquote', 'a', 'span'],
  ADD_ATTR: ['data-type', 'data-checked', 'class', 'type', 'checked', 'disabled', 'href', 'target', 'rel']
};

// Helpers para avatar (iniciais) e data de comentários
const getInitials = (name: string) => {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0][0].toUpperCase();
};

const formatCommentDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffMins < 1) return 'Agora mesmo';
  if (diffMins < 60) return `Há ${diffMins} min`;
  if (diffHours < 24) return `Há ${diffHours} h`;
  
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// Parser para detectar menções válidas e ordenadas no texto do comentário
const parseMentions = (text: string, users: TeamUser[]) => {
  const mentionedIds = new Set<string>();
  // Ordena os usuários pelo tamanho do nome decrescente para priorizar nomes completos no matching
  const sortedUsers = [...users].sort((a, b) => b.full_name.length - a.full_name.length);
  
  for (const u of sortedUsers) {
    const mentionTag = `@${u.full_name}`;
    const escapedTag = mentionTag.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(^|\\s)${escapedTag}(\\s|$|[,.!?])`, 'g');
    if (regex.test(text)) {
      mentionedIds.add(u.id);
    }
  }
  return Array.from(mentionedIds);
};

// Formatador seguro para renderizar o comentário e destacar menções como chips sem perigo de XSS
const renderCommentTextWithMentions = (content: string, users: TeamUser[]) => {
  if (!content) return null;
  
  const sortedUsers = [...users].sort((a, b) => b.full_name.length - a.full_name.length);
  let parts: Array<string | React.ReactNode> = [content];
  
  for (const u of sortedUsers) {
    const tag = `@${u.full_name}`;
    const newParts: Array<string | React.ReactNode> = [];
    
    for (const part of parts) {
      if (typeof part !== 'string') {
        newParts.push(part);
        continue;
      }
      
      const index = part.indexOf(tag);
      if (index === -1) {
        newParts.push(part);
      } else {
        let remaining = part;
        let counter = 0;
        while (true) {
          const idx = remaining.indexOf(tag);
          if (idx === -1) {
            newParts.push(remaining);
            break;
          }
          if (idx > 0) {
            newParts.push(remaining.slice(0, idx));
          }
          newParts.push(
            <span 
              key={`${u.id}-${idx}-${counter++}`} 
              className="bg-lumos-yellow/20 text-lumos-yellow font-bold px-1.5 py-0.5 rounded text-[10px] inline-block mx-0.5 border border-lumos-yellow/20"
            >
              {tag}
            </span>
          );
          remaining = remaining.slice(idx + tag.length);
        }
      }
    }
    parts = newParts;
  }
  
  return <>{parts}</>;
};

// -------------------------------------------------------------
// Extensão Customizada: Callout (Banner de Destaque)
// -------------------------------------------------------------
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div', 
      mergeAttributes(HTMLAttributes, { 
        'data-type': 'callout', 
        class: 'p-3 bg-yellow-500/10 border-l-4 border-yellow-400 rounded text-lumos-text-primary my-2 italic' 
      }), 
      0
    ];
  },
  addCommands() {
    return {
      toggleCallout: () => ({ commands }: any) => {
        return commands.toggleNode(this.name, 'paragraph');
      }
    } as any;
  }
});

// -------------------------------------------------------------
// Componente TipTapEditor (Rich Text)
// -------------------------------------------------------------
interface TipTapEditorProps {
  content: string;
  onChange: (html: string) => void;
  editable: boolean;
}

interface SlashCommandItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  action: (editor: any, range: { from: number; to: number }) => void;
}

const ALL_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: 'text',
    title: 'Texto Normal',
    description: 'Transformar em texto comum',
    icon: 'T',
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('paragraph').run();
    }
  },
  {
    id: 'h1',
    title: 'Título H1',
    description: 'Cabeçalho grande de seção',
    icon: 'H1',
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
    }
  },
  {
    id: 'h2',
    title: 'Título H2',
    description: 'Cabeçalho médio de seção',
    icon: 'H2',
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
    }
  },
  {
    id: 'h3',
    title: 'Título H3',
    description: 'Cabeçalho pequeno de seção',
    icon: 'H3',
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
    }
  },
  {
    id: 'checklist',
    title: 'Checklist',
    description: 'Lista de tarefas interativas',
    icon: '☑',
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    }
  },
  {
    id: 'bullet',
    title: 'Lista de Marcadores',
    description: 'Lista com marcadores circulares',
    icon: '•',
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    }
  },
  {
    id: 'ordered',
    title: 'Lista Numerada',
    description: 'Lista com números sequenciais',
    icon: '1.',
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    }
  },
  {
    id: 'divider',
    title: 'Divisória',
    description: 'Linha separadora horizontal',
    icon: '―',
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    }
  },
  {
    id: 'callout',
    title: 'Banner de Destaque',
    description: 'Caixa de alerta na cor Lumos',
    icon: '⚠',
    action: (editor, range) => {
      (editor.chain().focus() as any).deleteRange(range).toggleCallout().run();
    }
  }
];

function TipTapEditor({ content, onChange, editable }: TipTapEditorProps) {
  const [slashMenu, setSlashMenu] = useState<{ x: number; y: number; text: string; range: { from: number; to: number } } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = ALL_SLASH_COMMANDS.filter(cmd =>
    cmd.title.toLowerCase().includes(slashMenu?.text.toLowerCase() || '') ||
    cmd.description.toLowerCase().includes(slashMenu?.text.toLowerCase() || '')
  );

  const slashMenuRef = React.useRef(slashMenu);
  const selectedIndexRef = React.useRef(selectedIndex);
  const filteredCommandsRef = React.useRef(filteredCommands);

  React.useEffect(() => {
    slashMenuRef.current = slashMenu;
    selectedIndexRef.current = selectedIndex;
    filteredCommandsRef.current = filteredCommands;
  }, [slashMenu, selectedIndex, filteredCommands]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Color,
      TextStyle,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'text-lumos-yellow underline hover:text-yellow-400'
        }
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: 'flex items-start gap-2 my-1'
        }
      }),
      Callout
    ],
    content: content || '',
    editable: editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
      
      const { selection } = editor.state;
      const $anchor = selection.$anchor;
      const currentLineText = $anchor.parent.textContent;
      const textBefore = currentLineText.slice(0, $anchor.parentOffset);
      const match = textBefore.match(/(^|\s)\/(\w*)$/);

      if (match) {
        const query = match[2];
        const slashIndex = textBefore.lastIndexOf('/');
        const from = $anchor.start() + slashIndex;
        const to = selection.from;
        
        try {
          const coords = editor.view.coordsAtPos(selection.from);
          setSlashMenu({
            x: coords.left,
            y: coords.bottom + 4,
            text: query,
            range: { from, to }
          });
          setSelectedIndex(0);
        } catch (e) {
          setSlashMenu(null);
        }
      } else {
        setSlashMenu(null);
      }
    },
    onSelectionUpdate: ({ editor }) => {
      const { selection } = editor.state;
      const $anchor = selection.$anchor;
      const currentLineText = $anchor.parent.textContent;
      const textBefore = currentLineText.slice(0, $anchor.parentOffset);
      const match = textBefore.match(/(^|\s)\/(\w*)$/);

      if (match) {
        const query = match[2];
        const slashIndex = textBefore.lastIndexOf('/');
        const from = $anchor.start() + slashIndex;
        const to = selection.from;
        
        try {
          const coords = editor.view.coordsAtPos(selection.from);
          setSlashMenu({
            x: coords.left,
            y: coords.bottom + 4,
            text: query,
            range: { from, to }
          });
        } catch (e) {
          setSlashMenu(null);
        }
      } else {
        setSlashMenu(null);
      }
    },
    editorProps: {
      handleKeyDown: (view, event) => {
        if (slashMenuRef.current) {
          const items = filteredCommandsRef.current;
          if (event.key === 'ArrowDown') {
            setSelectedIndex((prev) => (prev + 1) % items.length);
            return true;
          }
          if (event.key === 'ArrowUp') {
            setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
            return true;
          }
          if (event.key === 'Enter') {
            const selectedItem = items[selectedIndexRef.current];
            if (selectedItem && editor) {
              selectedItem.action(editor, slashMenuRef.current.range);
              setSlashMenu(null);
            }
            return true;
          }
          if (event.key === 'Escape') {
            setSlashMenu(null);
            return true;
          }
        }
        return false;
      }
    }
  });

  useEffect(() => {
    if (editor) {
      if (editor.getHTML() !== (content || '')) {
        editor.commands.setContent(content || '');
      }
      editor.setEditable(editable);
    }
  }, [content, editable, editor]);

  if (!editor) return null;

  const addLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Inserir URL:', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="relative border border-lumos-border rounded-lumos overflow-visible bg-lumos-bg/30">
      {editable && (
        <div className="flex flex-wrap gap-1 p-1 bg-lumos-surface border-b border-lumos-border items-center">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[10px] font-black transition-all",
              editor.isActive('bold') ? "bg-lumos-yellow/20 text-lumos-yellow font-black" : "text-lumos-text-secondary"
            )}
            title="Negrito"
          >
            B
          </button>
          
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[10px] italic transition-all",
              editor.isActive('italic') ? "bg-lumos-yellow/20 text-lumos-yellow" : "text-lumos-text-secondary"
            )}
            title="Itálico"
          >
            I
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[10px] underline transition-all",
              editor.isActive('underline') ? "bg-lumos-yellow/20 text-lumos-yellow" : "text-lumos-text-secondary"
            )}
            title="Sublinhado"
          >
            U
          </button>

          <span className="w-px h-3 bg-lumos-border/50 mx-1"></span>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[9px] font-black transition-all",
              editor.isActive('heading', { level: 1 }) ? "bg-lumos-yellow/20 text-lumos-yellow font-black" : "text-lumos-text-secondary"
            )}
            title="Título 1"
          >
            H1
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[9px] font-black transition-all",
              editor.isActive('heading', { level: 2 }) ? "bg-lumos-yellow/20 text-lumos-yellow font-black" : "text-lumos-text-secondary"
            )}
            title="Título 2"
          >
            H2
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[9px] font-black transition-all",
              editor.isActive('heading', { level: 3 }) ? "bg-lumos-yellow/20 text-lumos-yellow font-black" : "text-lumos-text-secondary"
            )}
            title="Título 3"
          >
            H3
          </button>

          <span className="w-px h-3 bg-lumos-border/50 mx-1"></span>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[9px] font-semibold transition-all",
              editor.isActive('taskList') ? "bg-lumos-yellow/20 text-lumos-yellow" : "text-lumos-text-secondary"
            )}
            title="Checklist"
          >
            ☑ Checklist
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[9px] font-semibold transition-all",
              editor.isActive('bulletList') ? "bg-lumos-yellow/20 text-lumos-yellow" : "text-lumos-text-secondary"
            )}
            title="Marcadores"
          >
            • Lista
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[9px] font-semibold transition-all",
              editor.isActive('orderedList') ? "bg-lumos-yellow/20 text-lumos-yellow" : "text-lumos-text-secondary"
            )}
            title="Numerada"
          >
            1. Lista
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[9px] font-semibold transition-all",
              editor.isActive('blockquote') ? "bg-lumos-yellow/20 text-lumos-yellow" : "text-lumos-text-secondary"
            )}
            title="Citação"
          >
            “ Citação
          </button>

          <button
            type="button"
            onClick={() => (editor.chain().focus() as any).toggleCallout().run()}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[9px] font-semibold transition-all",
              editor.isActive('callout') ? "bg-lumos-yellow/20 text-lumos-yellow" : "text-lumos-text-secondary"
            )}
            title="Banner Destaque"
          >
            ⚠ Banner
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            className="p-1.5 rounded hover:bg-lumos-bg text-[9px] font-semibold text-lumos-text-secondary transition-all"
            title="Divisória"
          >
            ― Divisória
          </button>

          <span className="w-px h-3 bg-lumos-border/50 mx-1"></span>

          <button
            type="button"
            onClick={addLink}
            className={clsx(
              "p-1.5 rounded hover:bg-lumos-bg text-[9px] font-semibold transition-all",
              editor.isActive('link') ? "bg-lumos-yellow/20 text-lumos-yellow" : "text-lumos-text-secondary"
            )}
            title="Link"
          >
            Link
          </button>

          <span className="w-px h-3 bg-lumos-border/50 mx-1"></span>

          <button
            type="button"
            onClick={() => editor.chain().focus().setColor('#facc15').run()}
            className="w-3 h-3 rounded-full bg-yellow-400 border border-black/40 hover:scale-110 transition-all"
            title="Amarelo Lumos"
          />
          <button
            type="button"
            onClick={() => editor.chain().focus().setColor('#ffffff').run()}
            className="w-3 h-3 rounded-full bg-white border border-black/40 hover:scale-110 transition-all"
            title="Branco"
          />
          <button
            type="button"
            onClick={() => editor.chain().focus().setColor('#9ca3af').run()}
            className="w-3 h-3 rounded-full bg-gray-400 border border-black/40 hover:scale-110 transition-all"
            title="Cinza"
          />
          <button
            type="button"
            onClick={() => editor.chain().focus().setColor('#f87171').run()}
            className="w-3 h-3 rounded-full bg-red-400 border border-black/40 hover:scale-110 transition-all"
            title="Vermelho"
          />
          <button
            type="button"
            onClick={() => editor.chain().focus().unsetColor().run()}
            className="text-[9px] text-lumos-text-secondary hover:text-lumos-text-primary ml-1"
            title="Limpar Cor"
          >
            Limpar
          </button>
        </div>
      )}

      <div className="p-3 min-h-[120px] text-xs leading-relaxed text-lumos-text-primary focus-within:outline-none bg-transparent">
        <EditorContent editor={editor} />
      </div>

      {/* Floating Slash Commands Menu */}
      {slashMenu && filteredCommands.length > 0 && (
        <div 
          style={{ 
            position: 'fixed', 
            top: `${slashMenu.y}px`, 
            left: `${slashMenu.x}px` 
          }}
          className="z-[250] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1 flex flex-col max-h-60 overflow-y-auto custom-scrollbar w-60 animate-in fade-in zoom-in-95 duration-100"
        >
          {filteredCommands.map((cmd, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={cmd.id}
                type="button"
                onClick={() => {
                  cmd.action(editor, slashMenu.range);
                  setSlashMenu(null);
                }}
                className={clsx(
                  "px-3 py-1.5 rounded text-[11px] font-semibold text-left transition-all flex items-center gap-2 w-full",
                  isSelected 
                    ? "bg-lumos-yellow text-black font-bold" 
                    : "text-lumos-text-primary hover:bg-lumos-bg"
                )}
              >
                <span className={clsx(
                  "w-5 h-5 rounded flex items-center justify-center text-xs font-black",
                  isSelected ? "bg-black/10 text-black" : "bg-lumos-border/40 text-lumos-text-primary"
                )}>
                  {cmd.icon}
                </span>
                <div className="flex flex-col">
                  <span className="leading-tight">{cmd.title}</span>
                  <span className={clsx(
                    "text-[8px] leading-tight",
                    isSelected ? "text-black/60 font-medium" : "text-lumos-text-secondary font-normal"
                  )}>
                    {cmd.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Componente Projetos (Página Principal)
// -------------------------------------------------------------
export default function Projetos() {
  const { can, isAdmin, profile } = useAuth();
  const toast = useToast();
  
  // Permissions
  const canManage = isAdmin || can('ordem_do_dia');

  // Database States
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);

  // UI Selection States
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({});
  const [showConcludedProjects, setShowConcludedProjects] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // No desktop a navegação de clientes/projetos vive na sidebar principal
  // (SidebarProjectTree), então a coluna interna nasce recolhida; no mobile
  // (sem sidebar principal) ela continua aberta.
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1024
  );
  
  // Project Tasks Panel States
  const [projectTasks, setProjectTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'lista' | 'kanban' | 'gantt'>('lista');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isConfirmTemplateOpen, setIsConfirmTemplateOpen] = useState(false);

  // Task Details Modal States
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [descHTML, setDescHTML] = useState('');
  const [isSavingDesc, setIsSavingDesc] = useState(false);

  // Task Comments & Mentions States
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');

  // Comment @mention Autocomplete States
  const [mentionAutocomplete, setMentionAutocomplete] = useState<{ query: string; start: number; end: number } | null>(null);
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);
  const commentInputRef = useRef<HTMLInputElement>(null);

  // Right-click context menu states
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null);

  // PDF Generation State
  const [isGeneratingOS, setIsGeneratingOS] = useState<string | null>(null);

  // Modal State for Manual Creation
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Exclusão definitiva de projeto (admin)
  const [isDeleteProjectModalOpen, setIsDeleteProjectModalOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjClient, setNewProjClient] = useState('');
  const [newProjCode, setNewProjCode] = useState('');
  const [newProjCategory, setNewProjCategory] = useState<'digital' | 'filme' | 'live'>('digital');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjStart, setNewProjStart] = useState('');
  const [newProjEnd, setNewProjEnd] = useState('');
  const [applyTemplate, setApplyTemplate] = useState(true);

  // Filter members on @mention query
  const filteredMentionUsers = teamUsers.filter(u =>
    u.full_name.toLowerCase().includes(mentionAutocomplete?.query.toLowerCase() || '')
  );

  // Deep-link: consome ?projectId=&taskId= da URL (notificações, Board e busca Cmd+K)
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectTasks(selectedProjectId);
    } else {
      setProjectTasks([]);
    }
    setSelectedTaskId(null);
  }, [selectedProjectId]);

  // Abre projeto/tarefa vindos da URL assim que os projetos estiverem carregados.
  // Roda também quando a query muda com a página já aberta (ex.: seleção na
  // busca Cmd+K). A limpeza da query no final evita reprocessamento em loop.
  useEffect(() => {
    if (projects.length === 0) return;

    const pid = searchParams.get('projectId');
    if (!pid) return;

    const proj = projects.find(p => p.id === pid);
    if (proj) {
      const tid = searchParams.get('taskId');
      if (proj.id === selectedProjectId) {
        // Projeto já aberto: abre a tarefa direto (o efeito de tasks não re-dispara)
        if (tid) setSelectedTaskId(tid);
      } else {
        pendingTaskIdRef.current = tid;
        setSelectedClientId(proj.client_id);
        setSelectedProjectId(proj.id);
      }
    }
    setSearchParams({}, { replace: true });
  }, [projects, searchParams]);

  // Quando as tarefas do projeto deep-linkado chegam, abre a tarefa pendente
  useEffect(() => {
    const tid = pendingTaskIdRef.current;
    if (tid && projectTasks.some(t => t.id === tid)) {
      pendingTaskIdRef.current = null;
      setSelectedTaskId(tid);
    }
  }, [projectTasks]);

  const selectedTask = projectTasks.find(t => t.id === selectedTaskId);

  // Sincronizar editor de descrição no modal
  useEffect(() => {
    if (selectedTask) {
      setDescHTML(selectedTask.descricao || '');
    } else {
      setDescHTML('');
    }
  }, [selectedTaskId, selectedTask?.id]);

  // Carregar comentários quando a tarefa for selecionada
  useEffect(() => {
    if (selectedTaskId) {
      fetchTaskComments(selectedTaskId);
    } else {
      setComments([]);
    }
  }, [selectedTaskId]);

  // Global keydown triggers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mentionAutocomplete) {
          setMentionAutocomplete(null);
        } else if (renamingTaskId) {
          setRenamingTaskId(null);
        } else if (selectedTaskId) {
          const taskObj = projectTasks.find(t => t.id === selectedTaskId);
          if (taskObj && descHTML !== (taskObj.descricao || '')) {
            if (window.confirm('Você tem alterações não salvas na descrição. Deseja realmente fechar?')) {
              setSelectedTaskId(null);
            }
          } else {
            setSelectedTaskId(null);
          }
        }
      }
    };
    
    const handleGlobalClick = () => {
      setContextMenu(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleGlobalClick);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleGlobalClick);
    };
  }, [selectedTaskId, renamingTaskId, descHTML, projectTasks, mentionAutocomplete]);

  async function fetchData() {
    setLoading(true);
    try {
      const { data: clientsData, error: cErr } = await supabase
        .from('clients')
        .select('id, name')
        .order('name', { ascending: true });
      if (cErr) throw cErr;

      const { data: projectsData, error: pErr } = await supabase
        .from('projects')
        .select('*, budget:budgets(category)')
        .order('created_at', { ascending: false });
      if (pErr) throw pErr;

      const { data: tasksData, error: tErr } = await supabase
        .from('project_tasks')
        .select('id, project_id, status');
      if (tErr) throw tErr;

      const { data: usersData, error: uErr } = await supabase
        .from('app_users')
        .select('id, full_name')
        .eq('status', 'ativo')
        .order('full_name', { ascending: true });
      if (uErr) throw uErr;

      setClients(clientsData || []);
      setProjects(projectsData || []);
      setTasks(tasksData || []);
      setTeamUsers(usersData || []);
    } catch (err: any) {
      console.error('Error fetching project data:', err);
      toast.error('Erro ao carregar dados dos projetos.');
    } finally {
      setLoading(false);
    }
  }

  const fetchProjectTasks = async (projectId: string) => {
    setTasksLoading(true);
    try {
      const { data, error } = await supabase
        .from('project_tasks')
        .select('*')
        .eq('project_id', projectId)
        .order('ordem', { ascending: true });
      if (error) throw error;
      setProjectTasks(data || []);
    } catch (err: any) {
      console.error('Error fetching tasks:', err);
      toast.error('Erro ao carregar tarefas.');
    } finally {
      setTasksLoading(false);
    }
  };

  // Carregar comentários da tarefa
  const fetchTaskComments = async (taskId: string) => {
    setCommentsLoading(true);
    try {
      const { data, error } = await supabase
        .from('task_comments')
        .select('*, user:app_users(full_name, email, role)')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setComments(data || []);
    } catch (err: any) {
      console.error('Error fetching comments:', err);
      toast.error('Erro ao carregar feed de comentários.');
    } finally {
      setCommentsLoading(false);
    }
  };

  // Enviar novo comentário e processar menções associadas no banco de dados
  const handleSendComment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newCommentText.trim() || !selectedTaskId || !profile) return;

    const text = newCommentText.trim();
    setNewCommentText('');
    setMentionAutocomplete(null);

    try {
      // 1. Inserir comentário na tabela task_comments
      const { data: newComment, error: cErr } = await supabase
        .from('task_comments')
        .insert({
          task_id: selectedTaskId,
          user_id: profile.id,
          content: text
        })
        .select('*, user:app_users(full_name, email, role)')
        .single();

      if (cErr) throw cErr;

      // 2. Fazer parse de menções no texto e inserir na tabela task_comment_mentions
      const mentionedUserIds = parseMentions(text, teamUsers);
      if (mentionedUserIds.length > 0 && newComment) {
        const mentionsToInsert = mentionedUserIds.map(uid => ({
          comment_id: newComment.id,
          mentioned_user_id: uid,
          notified: false // Conforme regra: registrado para worker de envio futuro, mas não notifica na UI agora
        }));

        const { error: mErr } = await supabase
          .from('task_comment_mentions')
          .insert(mentionsToInsert);

        if (mErr) {
          console.error('Error inserting task comment mentions:', mErr);
          // Não quebramos o fluxo do comentário se as menções derem erro de registro, apenas logamos
        }
      }

      setComments(prev => [...prev, newComment]);
    } catch (err: any) {
      console.error('Error sending comment:', err);
      toast.error('Erro ao enviar comentário.');
      setNewCommentText(text); // Recupera o texto no input em caso de erro
    }
  };

  // Editar comentário
  const handleEditComment = async (comment: TaskComment) => {
    const newContent = window.prompt('Editar comentário:', comment.content);
    if (newContent === null) return;
    if (!newContent.trim()) {
      toast.error('O comentário não pode ficar vazio.');
      return;
    }

    try {
      const { error } = await supabase
        .from('task_comments')
        .update({ content: newContent.trim() })
        .eq('id', comment.id);

      if (error) throw error;

      // Atualiza também os registros na tabela task_comment_mentions correspondentes
      // 1. Deletar menções antigas deste comentário
      await supabase
        .from('task_comment_mentions')
        .delete()
        .eq('comment_id', comment.id);

      // 2. Fazer parsing e inserir novas menções detectadas
      const newMentionedUserIds = parseMentions(newContent.trim(), teamUsers);
      if (newMentionedUserIds.length > 0) {
        const newMentions = newMentionedUserIds.map(uid => ({
          comment_id: comment.id,
          mentioned_user_id: uid,
          notified: false
        }));
        await supabase
          .from('task_comment_mentions')
          .insert(newMentions);
      }

      setComments(prev => prev.map(c => c.id === comment.id ? { ...c, content: newContent.trim() } : c));
    } catch (err: any) {
      console.error('Error editing comment:', err);
      toast.error('Erro ao editar comentário.');
    }
  };

  // Excluir comentário
  const handleDeleteComment = async (commentId: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este comentário?')) return;

    try {
      const { error } = await supabase
        .from('task_comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;

      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (err: any) {
      console.error('Error deleting comment:', err);
      toast.error('Erro ao excluir comentário.');
    }
  };

  // Handle Autocomplete Input Key Events
  const handleCommentInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionAutocomplete && filteredMentionUsers.length > 0) {
      const items = filteredMentionUsers;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIdx(prev => (prev + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIdx(prev => (prev - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selectedUser = items[selectedMentionIdx];
        if (selectedUser) {
          handleSelectMention(selectedUser);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setMentionAutocomplete(null);
      }
    }
  };

  // Handle Autocomplete Input Changes
  const handleCommentInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewCommentText(val);
    
    const cursor = e.target.selectionStart || 0;
    const textBefore = val.slice(0, cursor);
    const match = textBefore.match(/@(\w*)$/);
    
    if (match) {
      setMentionAutocomplete({
        query: match[1],
        start: cursor - match[0].length,
        end: cursor
      });
      setSelectedMentionIdx(0);
    } else {
      setMentionAutocomplete(null);
    }
  };

  // Select team member from dropdown list
  const handleSelectMention = (user: TeamUser) => {
    if (!mentionAutocomplete) return;
    
    const text = newCommentText;
    const start = mentionAutocomplete.start;
    const end = mentionAutocomplete.end;
    
    const newText = text.slice(0, start) + `@${user.full_name} ` + text.slice(end);
    setNewCommentText(newText);
    setMentionAutocomplete(null);
    
    if (commentInputRef.current) {
      commentInputRef.current.focus();
    }
  };

  // Toggle client accordion expansion
  const toggleClientExpanded = (clientId: string) => {
    setExpandedClients(prev => ({
      ...prev,
      [clientId]: !prev[clientId]
    }));
  };

  // Archive / Conclude Project
  // Exclui o projeto DEFINITIVAMENTE: as tarefas, comentários e o registro
  // financeiro caem junto (FKs em cascade). A pasta do Drive NÃO é apagada.
  const handleDeleteProject = async () => {
    if (!selectedProjectId || !selectedProject) return;
    try {
      setDeletingProject(true);
      const { error } = await supabase.from('projects').delete().eq('id', selectedProjectId);
      if (error) throw error;

      toast.success(`Projeto "${selectedProject.name}" excluído.`);
      setIsDeleteProjectModalOpen(false);
      setSelectedProjectId(null);
      await fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir projeto:', error);
      toast.error(`Erro ao excluir: ${error.message}`);
    } finally {
      setDeletingProject(false);
    }
  };

  const handleToggleProjectStatus = async (projectId: string, currentStatus: 'ativo' | 'concluido') => {
    const newStatus = currentStatus === 'ativo' ? 'concluido' : 'ativo';
    try {
      const { error } = await supabase
        .from('projects')
        .update({ status: newStatus })
        .eq('id', projectId);
      
      if (error) throw error;
      
      toast.success(newStatus === 'concluido' ? 'Projeto encerrado com sucesso!' : 'Projeto reativado com sucesso!');
      await fetchData();
    } catch (err: any) {
      console.error('Error updating project status:', err);
      toast.error('Erro ao atualizar status do projeto.');
    }
  };

  // Inline update task details
  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      setProjectTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));

      const { error } = await supabase
        .from('project_tasks')
        .update(updates)
        .eq('id', taskId);
      
      if (error) throw error;

      setTasks(prev => {
        if (updates.status === undefined) return prev;
        return prev.map(t => t.id === taskId ? { ...t, status: updates.status! } : t);
      });
    } catch (err: any) {
      console.error('Error updating task:', err);
      toast.error('Erro ao atualizar tarefa.');
      if (selectedProjectId) fetchProjectTasks(selectedProjectId);
    }
  };

  // Save Task Rich Text Description
  const handleSaveDescription = async () => {
    if (!selectedTaskId) return;
    setIsSavingDesc(true);
    try {
      await handleUpdateTask(selectedTaskId, { descricao: descHTML });
      toast.success('Descrição da tarefa atualizada!');
    } catch (err: any) {
      console.error('Error saving task description:', err);
      toast.error('Erro ao salvar descrição.');
    } finally {
      setIsSavingDesc(false);
    }
  };

  // Quick Task Creation (input + enter)
  const handleQuickAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !selectedProjectId) return;

    const nextOrder = projectTasks.length > 0 
      ? Math.max(...projectTasks.map(t => t.ordem)) + 10 
      : 10;

    try {
      const { data: newTask, error } = await supabase
        .from('project_tasks')
        .insert({
          project_id: selectedProjectId,
          titulo: newTaskTitle.trim(),
          descricao: '',
          status: 'iniciar',
          prioridade: 'media',
          ordem: nextOrder,
          data_inicio: null,
          data_fim: null
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Tarefa adicionada!');
      setNewTaskTitle('');
      
      await fetchProjectTasks(selectedProjectId);
      await fetchData();
    } catch (err: any) {
      console.error('Error adding task:', err);
      toast.error('Erro ao adicionar tarefa.');
    }
  };

  // Delete task
  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta tarefa?')) return;

    try {
      const { error } = await supabase
        .from('project_tasks')
        .delete()
        .eq('id', taskId);

      if (error) throw error;

      toast.success('Tarefa excluída.');
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
      }
      setProjectTasks(prev => prev.filter(t => t.id !== taskId));
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err: any) {
      console.error('Error deleting task:', err);
      toast.error('Erro ao excluir tarefa.');
    }
  };

  // Trigger Apply template
  const handleApplyTemplateTrigger = () => {
    if (!selectedProject) return;
    if (projectTasks.length > 0) {
      setIsConfirmTemplateOpen(true);
    } else {
      executeApplyTemplate(false);
    }
  };

  // Apply project segment template tasks
  const executeApplyTemplate = async (append: boolean, overwrite: boolean = false) => {
    if (!selectedProject || !selectedProjectId) return;
    setIsConfirmTemplateOpen(false);
    setTasksLoading(true);

    try {
      const category = selectedProject.category || selectedProject.budget?.category;
      if (!category) {
        toast.error('Este projeto não possui um segmento definido para aplicar o template.');
        setTasksLoading(false);
        return;
      }

      if (overwrite) {
        const { error: delErr } = await supabase
          .from('project_tasks')
          .delete()
          .eq('project_id', selectedProjectId);
        if (delErr) throw delErr;
        setSelectedTaskId(null);
      }

      const { data: templates, error: tempErr } = await supabase
        .from('project_task_templates')
        .select('*')
        .eq('segmento', category)
        .order('ordem', { ascending: true });

      if (tempErr) throw tempErr;

      if (!templates || templates.length === 0) {
        toast.warning(`Nenhum template encontrado para o segmento "${category}".`);
        setTasksLoading(false);
        return;
      }

      const startOrder = append && projectTasks.length > 0 
        ? Math.max(...projectTasks.map(t => t.ordem)) + 10 
        : 10;

      const tasksToInsert = templates.map((t, index) => ({
        project_id: selectedProjectId,
        titulo: t.titulo,
        descricao: t.descricao,
        status: 'iniciar',
        prioridade: t.prioridade,
        ordem: startOrder + (index * 10),
        data_inicio: null,
        data_fim: null
      }));

      const { error: insErr } = await supabase
        .from('project_tasks')
        .insert(tasksToInsert);

      if (insErr) throw insErr;

      toast.success('Template de segmento aplicado!');
      await fetchProjectTasks(selectedProjectId);
      await fetchData();
    } catch (err: any) {
      console.error('Error applying template:', err);
      toast.error('Erro ao aplicar o template: ' + err.message);
    } finally {
      setTasksLoading(false);
    }
  };

  // Generate OS PDF dynamics
  const handleDownloadOS = async (projectId: string, budgetId: string) => {
    setIsGeneratingOS(projectId);
    try {
      const { data: budget, error: bErr } = await supabase
        .from('budgets')
        .select('*, clients(*)')
        .eq('id', budgetId)
        .single();
      if (bErr || !budget) throw new Error('Budget not found');

      if (!budget.active_version_id) {
        toast.error('Este orçamento não possui uma versão ativa configurada.');
        return;
      }

      const { data: version, error: vErr } = await supabase
        .from('budget_versions')
        .select('*')
        .eq('id', budget.active_version_id)
        .single();
      if (vErr || !version) throw new Error('Version not found');

      const { data: items, error: iErr } = await supabase
        .from('budget_items')
        .select('*')
        .eq('version_id', budget.active_version_id)
        .order('sort_order', { ascending: true });
      if (iErr || !items) throw new Error('Items not found');

      const fileName = `OS_${budget.code}_Lumos_${budget.project_name}.pdf`;
      const blob = await pdf(
        <ServiceOrderPDF
          budget={budget}
          version={version}
          contact={null}
          items={items}
        />
      ).toBlob();
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Ordem de Serviço baixada!');
    } catch (err: any) {
      console.error('Error generating OS:', err);
      toast.error('Erro ao gerar Ordem de Serviço PDF.');
    } finally {
      setIsGeneratingOS(null);
    }
  };

  // Modal Creation Submit
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName || !newProjClient) {
      toast.error('Nome do Projeto e Cliente são obrigatórios.');
      return;
    }

    setModalLoading(true);
    try {
      const { data: newProj, error: pErr } = await supabase
        .from('projects')
        .insert({
          name: newProjName,
          client_id: newProjClient,
          code: newProjCode || null,
          category: newProjCategory,
          descricao: newProjDesc || null,
          data_inicio: newProjStart || null,
          data_fim: newProjEnd || null,
          status: 'ativo'
        })
        .select()
        .single();

      if (pErr) throw pErr;

      if (applyTemplate && newProj) {
        const { data: templates } = await supabase
          .from('project_task_templates')
          .select('*')
          .eq('segmento', newProjCategory)
          .order('ordem', { ascending: true });

        if (templates && templates.length > 0) {
          const tasksToInsert = templates.map((t) => ({
            project_id: newProj.id,
            titulo: t.titulo,
            descricao: t.descricao,
            status: 'iniciar',
            prioridade: t.prioridade,
            ordem: t.ordem,
            data_inicio: null,
            data_fim: null
          }));

          const { error: tErr } = await supabase
            .from('project_tasks')
            .insert(tasksToInsert);

          if (tErr) {
            console.error('Error seeding manual project tasks:', tErr);
            toast.warning('Projeto criado, mas ocorreu um problema ao aplicar as tarefas-padrão.');
          }
        }
      }

      toast.success('Projeto criado com sucesso!');
      setIsModalOpen(false);
      
      setNewProjName('');
      setNewProjClient('');
      setNewProjCode('');
      setNewProjCategory('digital');
      setNewProjDesc('');
      setNewProjStart('');
      setNewProjEnd('');
      setApplyTemplate(true);

      await fetchData();
    } catch (err: any) {
      console.error('Error creating manual project:', err);
      toast.error('Erro ao criar projeto manual: ' + err.message);
    } finally {
      setModalLoading(false);
    }
  };

  const filteredClients = clients.filter(c => {
    const clientProjects = projects.filter(p => p.client_id === c.id);
    const clientMatches = c.name.toLowerCase().includes(searchTerm.toLowerCase());
    const projectMatches = clientProjects.some(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (p.code && p.code.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    return clientMatches || projectMatches;
  });

  const getProjectTasksStats = (projectId: string) => {
    const projectTasksList = tasks.filter(t => t.project_id === projectId);
    const total = projectTasksList.length;
    const completed = projectTasksList.filter(t => t.status === 'concluido' || t.status === 'entregue').length;
    return {
      total,
      completed,
      pct: total > 0 ? Math.round((completed / total) * 100) : 0
    };
  };

  const getCategoryTheme = (category: 'digital' | 'filme' | 'live' | null) => {
    switch (category) {
      case 'digital':
        return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
      case 'filme':
        return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
      case 'live':
        return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      default:
        return 'bg-lumos-border/20 text-lumos-text-secondary border border-lumos-border/30';
    }
  };

  const getPriorityTheme = (priority: 'baixa' | 'media' | 'alta') => {
    switch (priority) {
      case 'baixa':
        return 'text-lumos-text-secondary border border-lumos-border/40 bg-lumos-border/10';
      case 'media':
        return 'text-lumos-yellow border border-lumos-yellow/20 bg-lumos-yellow/5';
      case 'alta':
        return 'text-red-400 border border-red-500/20 bg-red-500/5';
      default:
        return '';
    }
  };

  const selectedClient = clients.find(c => c.id === selectedClientId);
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const clientProjectsFiltered = projects.filter(p => {
    if (p.client_id !== selectedClientId) return false;
    if (!showConcludedProjects && p.status === 'concluido') return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          {!isSidebarOpen && !loading && (
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 bg-lumos-surface border border-lumos-border rounded-lumos text-lumos-yellow hover:scale-105 active:scale-95 transition-all flex items-center justify-center flex-shrink-0"
              title="Expandir painel de clientes"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <div>
            <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight uppercase">
              Gerenciador de Projetos
            </h1>
            <p className="text-sm font-medium text-lumos-text-secondary mt-1">
              Visualização hierárquica e controle dos fluxos operacionais da Lumos.
            </p>
          </div>
        </div>
        
        {canManage && (
          <button 
            onClick={() => setIsModalOpen(true)}
            className="btn-primary flex items-center gap-2 text-sm shadow-xl shadow-lumos-yellow/10 hover:scale-105 active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            Criar Projeto
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <Loader2 className="w-10 h-10 animate-spin text-lumos-yellow mb-4" />
          <p className="text-xs text-lumos-text-secondary font-semibold uppercase tracking-wider">Carregando painel...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-[600px] items-start transition-all duration-300">
          
          {/* Panel 1: Collapsible Folders (Lateral Esquerda) */}
          {isSidebarOpen && (
            <div className="lg:col-span-1 card border border-lumos-border bg-lumos-surface/40 flex flex-col p-4 space-y-4 h-[650px] relative animate-in slide-in-from-left duration-200">
              
              {/* Panel Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
                <input
                  type="text"
                  placeholder="Buscar cliente ou projeto..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="input-lumos w-full pl-9 h-10 text-xs font-semibold"
                />
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
                <div className="flex items-center justify-between px-2 mb-2">
                  <span className="text-[9px] font-black tracking-widest text-lumos-text-secondary uppercase opacity-50 block">
                    Pastas de Clientes
                  </span>
                  <button
                    onClick={() => setIsSidebarOpen(false)}
                    className="p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-border/20 transition-all"
                    title="Recolher painel"
                  >
                    <Menu className="w-3.5 h-3.5" />
                  </button>
                </div>

                {filteredClients.length === 0 ? (
                  <p className="text-xs text-lumos-text-secondary italic text-center py-8">Nenhum cliente encontrado.</p>
                ) : (
                  filteredClients.map((client) => {
                    const clientProjects = projects.filter(p => p.client_id === client.id);
                    const activeProjects = clientProjects.filter(p => p.status === 'ativo');
                    const concludedProjects = clientProjects.filter(p => p.status === 'concluido');
                    const isExpanded = !!expandedClients[client.id] || searchTerm.length > 0;
                    const isClientSelected = selectedClientId === client.id && !selectedProjectId;

                    return (
                      <div key={client.id} className="space-y-1">
                        <div 
                          onClick={() => {
                            setSelectedClientId(client.id);
                            setSelectedProjectId(null);
                            toggleClientExpanded(client.id);
                          }}
                          className={clsx(
                            "flex items-center justify-between px-3 py-2 rounded-lumos cursor-pointer transition-all hover:bg-lumos-surface group",
                            isClientSelected ? "bg-lumos-yellow/10 text-lumos-yellow border-l-2 border-lumos-yellow" : "text-lumos-text-primary"
                          )}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {isExpanded ? (
                              <FolderOpen className="w-4 h-4 text-lumos-yellow flex-shrink-0" />
                            ) : (
                              <FolderClosed className="w-4 h-4 text-lumos-text-secondary/70 flex-shrink-0" />
                            )}
                            <span className="text-xs font-bold truncate tracking-tight">{client.name}</span>
                          </div>
                          
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {activeProjects.length > 0 && (
                              <span className="text-[9px] font-black bg-lumos-border/50 px-1.5 py-0.5 rounded text-lumos-text-secondary">
                                {activeProjects.length}
                              </span>
                            )}
                            {isExpanded ? <ChevronDown className="w-3 h-3 text-lumos-text-secondary/55" /> : <ChevronRight className="w-3 h-3 text-lumos-text-secondary/55" />}
                          </div>
                        </div>

                        {/* Client Projects List (Submenu) */}
                        {isExpanded && (
                          <div className="pl-6 pr-1 py-1 space-y-1 border-l border-lumos-border/30 ml-5">
                            {activeProjects.length === 0 && concludedProjects.length === 0 ? (
                              <span className="text-[10px] text-lumos-text-secondary/50 italic block py-1">Sem projetos</span>
                            ) : (
                              <>
                                {activeProjects.map((proj) => {
                                  const isProjSelected = selectedProjectId === proj.id;
                                  return (
                                    <div
                                      key={proj.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedClientId(client.id);
                                        setSelectedProjectId(proj.id);
                                      }}
                                      className={clsx(
                                        "flex items-center justify-between px-2.5 py-1.5 rounded text-[11px] font-medium cursor-pointer transition-all hover:text-lumos-yellow",
                                        isProjSelected 
                                          ? "text-lumos-yellow bg-lumos-surface/60 font-bold" 
                                          : "text-lumos-text-secondary"
                                      )}
                                    >
                                      <span className="truncate max-w-[80%]">{proj.name}</span>
                                      {proj.code && (
                                        <span className="text-[8px] font-bold px-1 py-0.2 bg-lumos-border/30 rounded text-lumos-text-secondary tracking-tight">
                                          {formatBudgetCode(proj.code)}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}

                                {showConcludedProjects && concludedProjects.length > 0 && (
                                  <div className="space-y-1 mt-2 pt-1 border-t border-lumos-border/10">
                                    <div className="text-[8px] font-black uppercase text-lumos-text-secondary opacity-40 tracking-wider pb-1">
                                      Encerrados
                                    </div>
                                    {concludedProjects.map((proj) => {
                                      const isProjSelected = selectedProjectId === proj.id;
                                      return (
                                        <div
                                          key={proj.id}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedClientId(client.id);
                                            setSelectedProjectId(proj.id);
                                          }}
                                          className={clsx(
                                            "flex items-center justify-between px-2.5 py-1.5 rounded text-[11px] font-medium cursor-pointer transition-all hover:text-lumos-yellow",
                                            isProjSelected 
                                              ? "text-lumos-yellow bg-lumos-surface/60 font-bold" 
                                              : "text-lumos-text-secondary/40 line-through"
                                          )}
                                        >
                                          <span className="truncate max-w-[80%]">{proj.name}</span>
                                          {proj.code && (
                                            <span className="text-[8px] font-bold px-1 py-0.2 bg-lumos-border/30 rounded text-lumos-text-secondary tracking-tight">
                                              {formatBudgetCode(proj.code)}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Panel 2 & 3: Selected client grid OR Selected project detail (Centro/Direita) */}
          <div className={clsx(
            "space-y-6 min-h-[600px] transition-all duration-300",
            isSidebarOpen ? "lg:col-span-3" : "lg:col-span-4"
          )}>
            
            {selectedProjectId && selectedProject ? (
              /* ================= SELECTED PROJECT DETAILS & TASKS ================= */
              <div className="card border border-lumos-border bg-lumos-surface flex flex-col p-6 space-y-6">
                
                {/* Project Detail Header */}
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 pb-5 border-b border-lumos-border/50">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {canManage ? (
                        <select
                          value={selectedProject.category || selectedProject.budget?.category || ''}
                          onChange={async (e) => {
                            const newCategory = e.target.value as 'digital' | 'filme' | 'live';
                            try {
                              const { error } = await supabase
                                .from('projects')
                                .update({ category: newCategory })
                                .eq('id', selectedProject.id);
                              if (error) throw error;
                              toast.success('Segmento do projeto atualizado!');
                              await fetchData();
                            } catch (err: any) {
                              console.error('Error updating project category:', err);
                              toast.error('Erro ao atualizar segmento.');
                            }
                          }}
                          className={clsx(
                            "text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wider border bg-transparent cursor-pointer outline-none focus:border-lumos-yellow",
                            getCategoryTheme(selectedProject.category || selectedProject.budget?.category || null)
                          )}
                        >
                          <option value="" className="bg-lumos-surface text-lumos-text-primary">Sem Segmento</option>
                          <option value="digital" className="bg-lumos-surface text-lumos-text-primary">Digital</option>
                          <option value="filme" className="bg-lumos-surface text-lumos-text-primary">Filme</option>
                          <option value="live" className="bg-lumos-surface text-lumos-text-primary">Live</option>
                        </select>
                      ) : (
                        <span className={clsx(
                          "text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wider border",
                          getCategoryTheme(selectedProject.category || selectedProject.budget?.category || null)
                        )}>
                          {selectedProject.category || selectedProject.budget?.category || 'Sem Segmento'}
                        </span>
                      )}

                      {selectedProject.code && (
                        <span className="text-[9px] font-black bg-lumos-border/40 text-lumos-text-secondary px-2 py-0.5 rounded tracking-wider uppercase">
                          Cód: {formatBudgetCode(selectedProject.code)}
                        </span>
                      )}
                      <span className={clsx(
                        "text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wider",
                        selectedProject.status === 'concluido' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'
                      )}>
                        {selectedProject.status}
                      </span>
                    </div>

                    <h2 className="text-2xl font-black text-lumos-text-primary uppercase tracking-tight">
                      {selectedProject.name}
                    </h2>
                    
                    <p className="text-xs text-lumos-text-secondary font-medium">
                      Cliente: <span className="text-lumos-text-primary font-bold">{selectedClient?.name}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5 flex-wrap">
                    {selectedProject.budget_id && (
                      <button
                        onClick={() => handleDownloadOS(selectedProject.id, selectedProject.budget_id!)}
                        disabled={isGeneratingOS === selectedProject.id}
                        className="btn-secondary py-2 px-3 flex items-center gap-2 text-xs font-semibold"
                      >
                        {isGeneratingOS === selectedProject.id ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-lumos-yellow" />
                            Gerando...
                          </>
                        ) : (
                          <>
                            <FileText className="w-3.5 h-3.5" />
                            Baixar OS (PDF)
                          </>
                        )}
                      </button>
                    )}

                    {canManage && (
                      <button
                        onClick={handleApplyTemplateTrigger}
                        className="btn-secondary py-2 px-3 flex items-center gap-2 text-xs font-semibold"
                      >
                        <Layers className="w-3.5 h-3.5 text-lumos-yellow" />
                        Aplicar Template do Segmento
                      </button>
                    )}

                    {canManage && (
                      <button
                        onClick={() => handleToggleProjectStatus(selectedProject.id, selectedProject.status)}
                        className={clsx(
                          "btn-secondary py-2 px-3 flex items-center gap-2 text-xs font-semibold",
                          selectedProject.status === 'ativo' ? "hover:border-red-500/40 hover:bg-red-500/10" : "hover:border-green-500/40 hover:bg-green-500/10"
                        )}
                      >
                        {selectedProject.status === 'ativo' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-red-400" />
                            Encerrar Projeto
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-3.5 h-3.5 text-green-400" />
                            Reativar Projeto
                          </>
                        )}
                      </button>
                    )}

                    {isAdmin && (
                      <button
                        onClick={() => setIsDeleteProjectModalOpen(true)}
                        className="btn-secondary py-2 px-3 flex items-center gap-2 text-xs font-semibold border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/60"
                        title="Excluir projeto definitivamente"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Excluir
                      </button>
                    )}
                  </div>
                </div>

                {/* Macro Timeline Summary */}
                {(selectedProject.data_inicio || selectedProject.data_fim || selectedProject.descricao) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-lumos-bg/30 p-4 border border-lumos-border/40 rounded-lumos">
                    <div className="md:col-span-2 space-y-1">
                      <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-widest opacity-60">Descrição</span>
                      <p className="text-xs text-lumos-text-primary font-medium leading-relaxed">
                        {selectedProject.descricao || 'Sem descrição cadastrada.'}
                      </p>
                    </div>
                    <div className="space-y-2 border-t md:border-t-0 md:border-l border-lumos-border/30 pt-3 md:pt-0 md:pl-4">
                      <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-widest opacity-60 block">Cronograma Macro</span>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-lumos-text-secondary">Início:</span>
                          <span className="text-lumos-text-primary font-bold">
                            {selectedProject.data_inicio ? new Date(selectedProject.data_inicio + 'T12:00:00').toLocaleDateString('pt-BR') : 'A definir'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-lumos-text-secondary">Término:</span>
                          <span className="text-lumos-text-primary font-bold">
                            {selectedProject.data_fim ? new Date(selectedProject.data_fim + 'T12:00:00').toLocaleDateString('pt-BR') : 'A definir'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Progress bar info */}
                <div className="space-y-2 pb-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-lumos-text-secondary">Progresso do Workflow</span>
                    <span className="text-lumos-text-primary font-bold">
                      {getProjectTasksStats(selectedProject.id).completed} de {getProjectTasksStats(selectedProject.id).total} concluídas ({getProjectTasksStats(selectedProject.id).pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-lumos-border/30 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-lumos-yellow h-full transition-all duration-500" 
                      style={{ width: `${getProjectTasksStats(selectedProject.id).pct}%` }}
                    ></div>
                  </div>
                </div>

                {/* ================= TABS FOR TASK VIEWS ================= */}
                <div className="flex items-center justify-between border-b border-lumos-border/50">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setActiveTab('lista')}
                      className={clsx(
                        "px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all -mb-px",
                        activeTab === 'lista'
                          ? "border-lumos-yellow text-lumos-yellow font-black"
                          : "border-transparent text-lumos-text-secondary hover:text-lumos-text-primary"
                      )}
                    >
                      Lista
                    </button>
                    <button
                      onClick={() => navigate(`/producao/board?projectId=${selectedProjectId}`)}
                      className="px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 border-transparent text-lumos-text-secondary hover:text-lumos-text-primary flex items-center gap-1.5 transition-colors"
                      title="Abrir este projeto no Board de Produção"
                    >
                      Kanban
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </button>
                    <button
                      onClick={() => navigate(`/producao/schedule?projectId=${selectedProjectId}`)}
                      className="px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 border-transparent text-lumos-text-secondary hover:text-lumos-text-primary flex items-center gap-1.5 transition-colors"
                      title="Abrir este projeto na Timeline"
                    >
                      Gantt
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </button>
                  </div>
                </div>

                {/* Tab Content */}
                <div className="flex-1 min-h-[300px] flex flex-col">
                  {tasksLoading ? (
                    <div className="flex-grow flex items-center justify-center py-16">
                      <Loader2 className="w-8 h-8 animate-spin text-lumos-yellow" />
                    </div>
                  ) : activeTab === 'lista' ? (
                    /* ================= LIST VIEW (ACTIVE) ================= */
                    <div className="space-y-4 flex-grow flex flex-col justify-between">
                      
                      {projectTasks.length === 0 ? (
                        <div className="flex-grow border border-dashed border-lumos-border/50 rounded-lumos flex flex-col justify-center items-center text-center p-8 bg-lumos-bg/10 py-16">
                          <ClipboardList className="w-8 h-8 text-lumos-text-secondary opacity-30 mb-3" />
                          <h4 className="text-sm font-bold text-lumos-text-primary uppercase tracking-wider">Nenhuma tarefa ativa</h4>
                          <p className="text-xs text-lumos-text-secondary mt-1 max-w-xs">
                            Comece aplicando o template padrão para este segmento ou digite uma tarefa na linha abaixo.
                          </p>
                          {canManage && (
                            <button
                              onClick={handleApplyTemplateTrigger}
                              className="btn-secondary text-xs mt-4 py-1.5 px-3 flex items-center gap-1.5"
                            >
                              <Layers className="w-3.5 h-3.5 text-lumos-yellow" />
                              Aplicar Template
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-lumos-border/40 text-lumos-text-secondary font-black uppercase tracking-wider text-[9px] opacity-70">
                                <th className="py-2.5 px-2 w-8 text-center">Ok</th>
                                <th className="py-2.5 px-2 min-w-[250px]">Título da Tarefa</th>
                                <th className="py-2.5 px-2 w-36">Status</th>
                                <th className="py-2.5 px-2 w-28">Prioridade</th>
                                <th className="py-2.5 px-2 w-44">Responsável</th>
                                <th className="py-2.5 px-2 w-32">Prazo</th>
                                <th className="py-2.5 px-2 w-16 text-center">Ações</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-lumos-border/20">
                              {projectTasks.map((task) => {
                                const isTaskCompleted = task.status === 'concluido' || task.status === 'entregue';
                                return (
                                  <tr 
                                    key={task.id} 
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setContextMenu({
                                        x: e.clientX,
                                        y: e.clientY,
                                        taskId: task.id
                                      });
                                    }}
                                    className={clsx(
                                      "hover:bg-lumos-surface/40 transition-all group/row",
                                      isTaskCompleted && "bg-green-500/[0.01]",
                                      selectedTaskId === task.id && "bg-lumos-yellow/[0.03]"
                                    )}
                                  >
                                    {/* Done check checkbox toggle */}
                                    <td className="py-2 px-2 text-center">
                                      <input
                                        type="checkbox"
                                        checked={isTaskCompleted}
                                        disabled={!canManage}
                                        onChange={() => handleUpdateTask(task.id, { 
                                          status: isTaskCompleted ? 'iniciar' : 'concluido' 
                                        })}
                                        className="rounded border-lumos-border text-lumos-yellow focus:ring-lumos-yellow h-4 w-4 bg-lumos-bg cursor-pointer disabled:cursor-not-allowed"
                                      />
                                    </td>

                                    {/* Task Title (Static by default, input if renaming) */}
                                    <td 
                                      className="py-2 px-2 cursor-pointer"
                                      onClick={() => {
                                        if (renamingTaskId !== task.id) {
                                          setSelectedTaskId(task.id);
                                        }
                                      }}
                                    >
                                      {renamingTaskId === task.id ? (
                                        <input
                                          type="text"
                                          defaultValue={task.titulo}
                                          autoFocus
                                          onBlur={(e) => {
                                            const val = e.target.value.trim();
                                            if (val && val !== task.titulo) {
                                              handleUpdateTask(task.id, { titulo: val });
                                            }
                                            setRenamingTaskId(null);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              const val = (e.target as HTMLInputElement).value.trim();
                                              if (val && val !== task.titulo) {
                                                handleUpdateTask(task.id, { titulo: val });
                                              }
                                              setRenamingTaskId(null);
                                            }
                                            if (e.key === 'Escape') {
                                              setRenamingTaskId(null);
                                            }
                                          }}
                                          onClick={(e) => e.stopPropagation()} // Prevent modal opening
                                          className="w-full bg-lumos-bg border border-lumos-yellow rounded px-1.5 py-0.5 text-xs font-semibold outline-none text-lumos-text-primary"
                                        />
                                      ) : (
                                        <span className={clsx(
                                          "font-semibold text-xs text-lumos-text-primary transition-all hover:text-lumos-yellow",
                                          isTaskCompleted && "line-through text-lumos-text-secondary/50 opacity-60"
                                        )}>
                                          {task.titulo}
                                        </span>
                                      )}
                                    </td>

                                    {/* Status Badge Dropdown */}
                                    <td className="py-2 px-2">
                                      <select
                                        value={task.status}
                                        disabled={!canManage}
                                        onChange={(e) => handleUpdateTask(task.id, { status: e.target.value })}
                                        className={clsx(
                                          "bg-transparent border border-transparent rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider outline-none cursor-pointer focus:border-lumos-yellow w-full max-w-[140px]",
                                          getStatusDetails(task.status).color
                                        )}
                                      >
                                        <optgroup label="Não Iniciado" className="bg-lumos-surface text-lumos-text-primary text-[10px]">
                                          <option value="iniciar">Iniciar</option>
                                          <option value="pausado">Pausado</option>
                                          <option value="aguard_captacao">Aguard. Captação</option>
                                          <option value="aguard_material">Aguard. Material</option>
                                        </optgroup>
                                        <optgroup label="Ativo" className="bg-lumos-surface text-lumos-text-primary text-[10px]">
                                          <option value="na_fila">Na Fila</option>
                                          <option value="em_progresso">Em Progresso</option>
                                          <option value="revisao_interna">Revisão Interna</option>
                                          <option value="aprov_interna">Aprov. Interna</option>
                                          <option value="revisao_cliente">Revisão do Cliente</option>
                                          <option value="alteracoes">Alterações</option>
                                        </optgroup>
                                        <optgroup label="Concluído" className="bg-lumos-surface text-lumos-text-primary text-[10px]">
                                          <option value="entregue">Entregue</option>
                                          <option value="concluido">Concluído</option>
                                        </optgroup>
                                      </select>
                                    </td>

                                    {/* Priority Badge Dropdown */}
                                    <td className="py-2 px-2">
                                      <select
                                        value={task.prioridade}
                                        disabled={!canManage}
                                        onChange={(e) => handleUpdateTask(task.id, { prioridade: e.target.value as any })}
                                        className={clsx(
                                          "bg-transparent border border-transparent rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider outline-none cursor-pointer focus:border-lumos-yellow w-full max-w-[90px]",
                                          getPriorityTheme(task.prioridade)
                                        )}
                                      >
                                        <option value="baixa">Baixa</option>
                                        <option value="media">Média</option>
                                        <option value="alta">Alta</option>
                                      </select>
                                    </td>

                                    {/* Assignee Select Dropdown */}
                                    <td className="py-2 px-2">
                                      <div className="flex items-center gap-1.5 min-w-[130px] border border-transparent hover:border-lumos-border/30 rounded px-1">
                                        <User className="w-3 h-3 text-lumos-text-secondary opacity-50 flex-shrink-0" />
                                        <select
                                          value={task.responsavel_id || ''}
                                          disabled={!canManage}
                                          onChange={(e) => handleUpdateTask(task.id, { responsavel_id: e.target.value || null })}
                                          className="bg-transparent border-none text-[11px] font-medium text-lumos-text-primary outline-none cursor-pointer w-full py-0.5"
                                        >
                                          <option value="">Sem responsável</option>
                                          {teamUsers.map(user => (
                                            <option key={user.id} value={user.id}>{user.full_name}</option>
                                          ))}
                                        </select>
                                      </div>
                                    </td>

                                    {/* Date Picker End (Prazo) */}
                                    <td className="py-2 px-2">
                                      <input
                                        type="date"
                                        value={task.data_fim || ''}
                                        disabled={!canManage}
                                        onChange={(e) => handleUpdateTask(task.id, { data_fim: e.target.value || null })}
                                        className="bg-transparent border border-transparent hover:border-lumos-border/30 rounded text-[10px] font-bold text-lumos-text-primary px-1.5 py-0.5 outline-none cursor-pointer focus:border-lumos-yellow w-full"
                                      />
                                    </td>

                                    {/* Actions cell */}
                                    <td className="py-2 px-2 text-center">
                                      <div className="flex items-center justify-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => setSelectedTaskId(task.id)}
                                          className="p-1 text-lumos-text-secondary hover:text-lumos-yellow rounded hover:bg-lumos-border/20 transition-all"
                                          title="Ver detalhes da tarefa"
                                        >
                                          <ArrowRight className="w-3.5 h-3.5" />
                                        </button>
                                        
                                        {canManage && (
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteTask(task.id)}
                                            className="p-1 text-lumos-text-secondary hover:text-red-500 rounded hover:bg-red-500/10 opacity-0 group-hover/row:opacity-100 transition-all"
                                            title="Excluir tarefa"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Quick Add Row */}
                      {canManage && (
                        <form onSubmit={handleQuickAddTask} className="flex items-center gap-3 pt-3 border-t border-lumos-border/40 mt-2">
                          <input
                            type="text"
                            placeholder="Digitar nova tarefa... (Pressione Enter para adicionar)"
                            value={newTaskTitle}
                            onChange={e => setNewTaskTitle(e.target.value)}
                            className="input-lumos flex-grow h-10 text-xs font-semibold"
                          />
                          <button
                            type="submit"
                            disabled={!newTaskTitle.trim()}
                            className="btn-primary h-10 px-4 flex items-center gap-1.5 text-xs shadow-md disabled:opacity-40 disabled:scale-100 disabled:cursor-not-allowed"
                          >
                            <PlusCircle className="w-4 h-4" />
                            Adicionar
                          </button>
                        </form>
                      )}

                    </div>
                  ) : null}
                </div>

              </div>
            ) : selectedClientId && selectedClient ? (
              /* ================= DOCK PROJECTS OF SELECTED CLIENT ================= */
              <div className="space-y-6">
                
                <div className="flex items-center justify-between pb-4 border-b border-lumos-border">
                  <div>
                    <h2 className="text-xl font-black text-lumos-text-primary uppercase tracking-tight">
                      Pasta: {selectedClient.name}
                    </h2>
                    <p className="text-xs text-lumos-text-secondary font-medium">
                      Visualize os projetos associados a esta pasta de cliente.
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-widest cursor-pointer select-none">
                      Mostrar Encerrados
                    </label>
                    <button
                      onClick={() => setShowConcludedProjects(!showConcludedProjects)}
                      className={clsx(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                        showConcludedProjects ? "bg-lumos-yellow" : "bg-lumos-border"
                      )}
                    >
                      <span
                        className={clsx(
                          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-lumos-bg shadow ring-0 transition duration-200 ease-in-out",
                          showConcludedProjects ? "translate-x-4" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>
                </div>

                {clientProjectsFiltered.length === 0 ? (
                  <div className="card border border-lumos-border text-center py-16">
                    <Briefcase className="w-10 h-10 text-lumos-text-secondary opacity-30 mx-auto mb-3" />
                    <p className="text-sm font-bold text-lumos-text-primary uppercase tracking-tight">Nenhum projeto encontrado</p>
                    <p className="text-xs text-lumos-text-secondary mt-1">
                      {showConcludedProjects ? 'Este cliente ainda não tem projetos registrados.' : 'Nenhum projeto ativo. Ative "Mostrar Encerrados" para ver o histórico.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {clientProjectsFiltered.map((proj) => {
                      const stats = getProjectTasksStats(proj.id);
                      return (
                        <div 
                          key={proj.id} 
                          onClick={() => setSelectedProjectId(proj.id)}
                          className="card border border-lumos-border hover:border-lumos-yellow/40 transition-all duration-300 cursor-pointer p-5 flex flex-col justify-between space-y-4 hover:shadow-xl group"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className={clsx(
                                "text-[8px] font-black uppercase px-2 py-0.5 rounded tracking-wider border",
                                getCategoryTheme(proj.category || proj.budget?.category || null)
                              )}>
                                {proj.category || proj.budget?.category || 'Sem Segmento'}
                              </span>
                              
                              <span className={clsx(
                                "text-[8px] font-black uppercase px-1.5 py-0.5 rounded tracking-wider",
                                proj.status === 'concluido' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'
                              )}>
                                {proj.status}
                              </span>
                            </div>
                            
                            <h3 className="text-base font-bold text-lumos-text-primary uppercase tracking-tight truncate group-hover:text-lumos-yellow transition-all">
                              {proj.name}
                            </h3>

                            {proj.code && (
                              <p className="text-[10px] text-lumos-text-secondary font-semibold">
                                Código: <span className="text-lumos-text-primary">{formatBudgetCode(proj.code)}</span>
                              </p>
                            )}

                            {proj.descricao && (
                              <p className="text-xs text-lumos-text-secondary line-clamp-2 leading-relaxed">
                                {proj.descricao}
                              </p>
                            )}
                          </div>

                          <div className="space-y-1.5 pt-2">
                            <div className="flex justify-between text-[10px] font-semibold text-lumos-text-secondary">
                              <span>Progresso</span>
                              <span>{stats.completed}/{stats.total} Tarefas</span>
                            </div>
                            <div className="w-full bg-lumos-border/30 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className="bg-lumos-yellow h-full" 
                                style={{ width: `${stats.pct}%` }}
                              ></div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between border-t border-lumos-border/30 pt-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
                            <div className="text-[9px] font-semibold text-lumos-text-secondary">
                              {proj.data_fim ? `Fim: ${new Date(proj.data_fim + 'T12:00:00').toLocaleDateString('pt-BR')}` : 'Sem prazo macro'}
                            </div>

                            <div className="flex items-center gap-2">
                              {proj.budget_id && (
                                <button
                                  onClick={() => handleDownloadOS(proj.id, proj.budget_id!)}
                                  disabled={isGeneratingOS === proj.id}
                                  className="p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow transition-all"
                                  title="Baixar Ordem de Serviço (PDF)"
                                >
                                  {isGeneratingOS === proj.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <FileText className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}

                              {canManage && (
                                <button
                                  onClick={() => handleToggleProjectStatus(proj.id, proj.status)}
                                  className="p-1 rounded text-lumos-text-secondary hover:text-red-400 transition-all"
                                  title={proj.status === 'ativo' ? 'Encerrar Projeto' : 'Reativar Projeto'}
                                >
                                  {proj.status === 'ativo' ? <Check className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>
            ) : (
              /* ================= DEFAULT LANDING ================= */
              <div className="card border border-lumos-border bg-lumos-surface flex flex-col justify-center items-center text-center p-8 h-[600px] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-lumos-yellow/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="max-w-md space-y-4 relative z-10">
                  <div className="mx-auto w-14 h-14 bg-lumos-yellow/10 border border-lumos-yellow/20 rounded-full flex items-center justify-center text-lumos-yellow shadow-lg shadow-lumos-yellow/5">
                    <ClipboardList className="w-7 h-7" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold text-lumos-text-primary uppercase tracking-tight">
                      Selecione um Cliente
                    </h3>
                    <p className="text-xs text-lumos-text-secondary leading-relaxed">
                      Utilize a árvore de pastas à esquerda para visualizar e gerenciar os projetos vinculados a cada cliente, ou clique no botão superior para cadastrar um novo projeto manual.
                    </p>
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>
      )}

      {/* ================= MODAL CENTRAL: DETALHES DA TAREFA (STYLE CLICKUP) ================= */}
      {selectedTaskId && selectedTask && (
        <>
          {/* Backdrop Overlay */}
          <div 
            onClick={() => {
              if (!canManage || descHTML === (selectedTask.descricao || '')) {
                setSelectedTaskId(null);
              } else {
                if (window.confirm('Você tem alterações não salvas na descrição. Deseja realmente fechar?')) {
                  setSelectedTaskId(null);
                }
              }
            }} 
            className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
          />

          {/* Centered Modal popup */}
          <div className="fixed inset-4 sm:inset-10 md:inset-16 lg:inset-20 z-[140] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 text-lumos-text-primary max-w-6xl mx-auto my-auto h-[80vh]">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-lumos-border/50 bg-lumos-surface flex-shrink-0">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-lumos-yellow" />
                <span className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-widest">
                  Detalhes da Tarefa
                </span>
                {selectedProject && (
                  <>
                    <span className="text-lumos-text-secondary">/</span>
                    <span className="text-[10px] font-bold text-lumos-text-primary uppercase tracking-wider">
                      {selectedProject.name}
                    </span>
                  </>
                )}
              </div>
              
              <button 
                onClick={() => {
                  if (!canManage || descHTML === (selectedTask.descricao || '')) {
                    setSelectedTaskId(null);
                  } else {
                    if (window.confirm('Você tem alterações não salvas na descrição. Deseja realmente fechar?')) {
                      setSelectedTaskId(null);
                    }
                  }
                }}
                className="p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow transition-all"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Columns Grid (Left: Description/Meta; Right: Comments Feed) */}
            <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-3 h-full">
              
              {/* Left Column (Details and Editor - 2/3 width) */}
              <div className="lg:col-span-2 overflow-y-auto custom-scrollbar p-6 space-y-6 border-r border-lumos-border/40">
                
                {/* Title */}
                <div className="space-y-1">
                  <input
                    type="text"
                    value={selectedTask.titulo}
                    disabled={!canManage}
                    onChange={(e) => handleUpdateTask(selectedTask.id, { titulo: e.target.value })}
                    className="w-full text-xl font-black bg-transparent border-b border-transparent focus:border-lumos-yellow outline-none py-1 text-lumos-text-primary uppercase tracking-tight"
                  />
                </div>

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-lumos-bg/30 p-4 rounded-lumos border border-lumos-border/40 text-xs">
                  
                  {/* Status */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-wider block">Status</span>
                    <select
                      value={selectedTask.status}
                      disabled={!canManage}
                      onChange={(e) => handleUpdateTask(selectedTask.id, { status: e.target.value })}
                      className={clsx(
                        "bg-transparent border border-lumos-border/40 rounded px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider outline-none cursor-pointer focus:border-lumos-yellow w-full",
                        getStatusDetails(selectedTask.status).color
                      )}
                    >
                      <optgroup label="Não Iniciado" className="bg-lumos-surface text-lumos-text-primary">
                        <option value="iniciar">Iniciar</option>
                        <option value="pausado">Pausado</option>
                        <option value="aguard_captacao">Aguard. Captação</option>
                        <option value="aguard_material">Aguard. Material</option>
                      </optgroup>
                      <optgroup label="Ativo" className="bg-lumos-surface text-lumos-text-primary">
                        <option value="na_fila">Na Fila</option>
                        <option value="em_progresso">Em Progresso</option>
                        <option value="revisao_interna">Revisão Interna</option>
                        <option value="aprov_interna">Aprov. Interna</option>
                        <option value="revisao_cliente">Revisão do Cliente</option>
                        <option value="alteracoes">Alterações</option>
                      </optgroup>
                      <optgroup label="Concluído" className="bg-lumos-surface text-lumos-text-primary">
                        <option value="entregue">Entregue</option>
                        <option value="concluido">Concluído</option>
                      </optgroup>
                    </select>
                  </div>

                  {/* Priority */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-wider block">Prioridade</span>
                    <select
                      value={selectedTask.prioridade}
                      disabled={!canManage}
                      onChange={(e) => handleUpdateTask(selectedTask.id, { prioridade: e.target.value as any })}
                      className={clsx(
                        "bg-transparent border border-lumos-border/40 rounded px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider outline-none cursor-pointer focus:border-lumos-yellow w-full",
                        getPriorityTheme(selectedTask.prioridade)
                      )}
                    >
                      <option value="baixa">Baixa</option>
                      <option value="media">Média</option>
                      <option value="alta">Alta</option>
                    </select>
                  </div>

                  {/* Assignee */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-wider block">Responsável</span>
                    <div className="flex items-center gap-1.5 border border-lumos-border/40 rounded px-2.5 py-1">
                      <User className="w-3.5 h-3.5 text-lumos-text-secondary opacity-50 flex-shrink-0" />
                      <select
                        value={selectedTask.responsavel_id || ''}
                        disabled={!canManage}
                        onChange={(e) => handleUpdateTask(selectedTask.id, { responsavel_id: e.target.value || null })}
                        className="bg-transparent border-none text-[11px] font-medium text-lumos-text-primary outline-none cursor-pointer w-full py-0.5"
                      >
                        <option value="">Sem responsável</option>
                        {teamUsers.map(user => (
                          <option key={user.id} value={user.id}>{user.full_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Prazo */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-wider block">Prazo</span>
                    <input
                      type="date"
                      value={selectedTask.data_fim || ''}
                      disabled={!canManage}
                      onChange={(e) => handleUpdateTask(selectedTask.id, { data_fim: e.target.value || null })}
                      className="bg-transparent border border-lumos-border/40 rounded text-[10px] font-bold text-lumos-text-primary px-2.5 py-1.5 outline-none cursor-pointer focus:border-lumos-yellow w-full"
                    />
                  </div>

                </div>

                {/* Description */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-widest">
                      Descrição da Tarefa
                    </span>
                    
                    {canManage && descHTML !== (selectedTask.descricao || '') && (
                      <button
                        onClick={handleSaveDescription}
                        disabled={isSavingDesc}
                        className="text-[10px] font-bold bg-lumos-yellow text-black px-2.5 py-1 rounded hover:bg-yellow-400 disabled:opacity-50 transition-all flex items-center gap-1 shadow-md shadow-lumos-yellow/10"
                      >
                        {isSavingDesc ? (
                          <>
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            Salvando...
                          </>
                        ) : (
                          'Salvar Descrição'
                        )}
                      </button>
                    )}
                  </div>

                  {canManage ? (
                    <TipTapEditor
                      content={descHTML}
                      onChange={(html) => setDescHTML(html)}
                      editable={true}
                    />
                  ) : (
                    <div 
                      className="p-3 border border-lumos-border rounded-lumos bg-lumos-bg/20 text-xs text-lumos-text-primary leading-relaxed max-h-[300px] overflow-y-auto custom-scrollbar ProseMirror"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedTask.descricao || '<p className="italic text-lumos-text-secondary">Sem descrição cadastrada.</p>', DOM_PURIFY_CONFIG) }}
                    />
                  )}
                </div>

              </div>

              {/* Right Column (Comments Sidebar - 1/3 width) */}
              <div className="lg:col-span-1 bg-lumos-surface/30 p-6 flex flex-col justify-between overflow-hidden h-full border-l border-lumos-border/40 relative">
                <div className="flex items-center gap-1.5 pb-3 border-b border-lumos-border/50 flex-shrink-0">
                  <MessageSquare className="w-4 h-4 text-lumos-text-secondary opacity-60" />
                  <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-widest">
                    Comentários
                  </span>
                </div>
                
                {/* Scrollable comments list with highlights */}
                <div className="flex-grow overflow-y-auto custom-scrollbar py-4 space-y-4 min-h-0 text-xs">
                  {commentsLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" />
                    </div>
                  ) : comments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center text-lumos-text-secondary/50">
                      <MessageSquare className="w-6 h-6 mb-2 opacity-20" />
                      <p className="text-[10px] font-bold uppercase tracking-wider">Nenhum comentário ainda</p>
                      <p className="text-[9px] mt-0.5">Seja o primeiro a comentar.</p>
                    </div>
                  ) : (
                    comments.map((comment) => {
                      const isOwner = profile && profile.id === comment.user_id;
                      return (
                        <div key={comment.id} className="space-y-1.5 group/comment">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {/* Initials Avatar */}
                              <div className="w-6 h-6 rounded-full bg-lumos-yellow/10 border border-lumos-yellow/20 flex items-center justify-center text-[10px] font-black text-lumos-yellow">
                                {getInitials(comment.user?.full_name || 'Usuário')}
                              </div>
                              <span className="font-bold text-lumos-text-primary">
                                {comment.user?.full_name || 'Usuário'}
                              </span>
                              <span className="text-[9px] text-lumos-text-secondary opacity-60">
                                {formatCommentDate(comment.created_at)}
                              </span>
                            </div>

                            {/* Comment edit/delete actions */}
                            {(isOwner || isAdmin) && (
                              <div className="flex items-center gap-1 opacity-0 group-hover/comment:opacity-100 transition-all">
                                <button
                                  type="button"
                                  onClick={() => handleEditComment(comment)}
                                  className="p-0.5 text-lumos-text-secondary hover:text-lumos-yellow rounded transition-all"
                                  title="Editar"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteComment(comment.id)}
                                  className="p-0.5 text-lumos-text-secondary hover:text-red-500 rounded transition-all"
                                  title="Excluir"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="pl-8 text-lumos-text-secondary leading-relaxed break-words bg-lumos-bg/20 p-2 rounded border border-lumos-border/20">
                            {renderCommentTextWithMentions(comment.content, teamUsers)}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Autocomplete Mention Popover overlay inside comments wrapper */}
                {mentionAutocomplete && filteredMentionUsers.length > 0 && (
                  <div className="absolute bottom-16 left-6 right-6 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1 flex flex-col max-h-40 overflow-y-auto custom-scrollbar z-50 animate-in slide-in-from-bottom-2 duration-100">
                    {filteredMentionUsers.map((user, idx) => {
                      const isSelected = idx === selectedMentionIdx;
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => handleSelectMention(user)}
                          className={clsx(
                            "px-3 py-1.5 rounded text-[11px] font-semibold text-left transition-all w-full flex items-center gap-2",
                            isSelected ? "bg-lumos-yellow text-black font-bold" : "text-lumos-text-primary hover:bg-lumos-bg"
                          )}
                        >
                          <span className={clsx(
                            "w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold",
                            isSelected ? "bg-black/15 text-black" : "bg-lumos-border/50 text-lumos-text-secondary"
                          )}>
                            @
                          </span>
                          <span>{user.full_name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Submit new comment form at bottom with autocomplete listeners */}
                {profile && (
                  <form onSubmit={handleSendComment} className="flex items-center gap-2 pt-3 border-t border-lumos-border/50 flex-shrink-0">
                    <input
                      ref={commentInputRef}
                      type="text"
                      placeholder="Adicionar comentário... (Use @ para marcar alguém)"
                      value={newCommentText}
                      onKeyDown={handleCommentInputKeyDown}
                      onChange={handleCommentInputChange}
                      className="input-lumos flex-grow h-10 text-xs font-semibold"
                    />
                    <button
                      type="submit"
                      disabled={!newCommentText.trim()}
                      className="btn-primary h-10 px-4 text-xs font-bold shadow-md disabled:opacity-40 disabled:scale-100 disabled:cursor-not-allowed"
                    >
                      Enviar
                    </button>
                  </form>
                )}
              </div>

            </div>
          </div>
        </>
      )}

      {/* ================= RIGHT-CLICK TASK CONTEXT MENU ================= */}
      {contextMenu && (
        <div 
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-[200] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-1 flex flex-col min-w-[120px]"
          onClick={(e) => e.stopPropagation()} // Prevent closing instantly
        >
          <button
            onClick={() => {
              setRenamingTaskId(contextMenu.taskId);
              setContextMenu(null);
            }}
            className="px-3 py-1.5 text-[11px] font-semibold text-left text-lumos-text-primary hover:bg-lumos-bg rounded transition-all flex items-center gap-1.5"
          >
            <Edit2 className="w-3.5 h-3.5 text-lumos-yellow" />
            Renomear
          </button>
          
          {canManage && (
            <button
              onClick={() => {
                handleDeleteTask(contextMenu.taskId);
                setContextMenu(null);
              }}
              className="px-3 py-1.5 text-[11px] font-semibold text-left text-red-400 hover:bg-red-500/10 rounded transition-all flex items-center gap-1.5 border-t border-lumos-border/10 mt-0.5"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              Excluir
            </button>
          )}
        </div>
      )}

      {/* ================= MANUAL CREATE MODAL ================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-lg bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-6 space-y-6 text-lumos-text-primary">
            
            <div className="flex items-center justify-between pb-3 border-b border-lumos-border">
              <h3 className="text-lg font-black uppercase tracking-tight text-lumos-yellow flex items-center gap-2">
                <Briefcase className="w-5 h-5" />
                Cadastrar Projeto Manual
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-lumos-text-secondary hover:text-lumos-yellow transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-4">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                    Nome do Projeto *
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="Ex: Comercial de Inverno"
                    value={newProjName}
                    onChange={e => setNewProjName(e.target.value)}
                    className="input-lumos w-full h-11 text-sm font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                    Cliente *
                  </label>
                  <select
                    required
                    value={newProjClient}
                    onChange={e => setNewProjClient(e.target.value)}
                    className="input-lumos w-full h-11 text-xs font-semibold"
                  >
                    <option value="">Selecione um Cliente</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                    Segmento *
                  </label>
                  <select
                    value={newProjCategory}
                    onChange={e => setNewProjCategory(e.target.value as any)}
                    className="input-lumos w-full h-11 text-xs font-semibold"
                  >
                    <option value="digital">Digital</option>
                    <option value="filme">Filme</option>
                    <option value="live">Live</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                    Código do Projeto (Opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 0184"
                    value={newProjCode}
                    onChange={e => setNewProjCode(e.target.value)}
                    className="input-lumos w-full h-11 text-sm font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                    Data de Início (Opcional)
                  </label>
                  <input
                    type="date"
                    value={newProjStart}
                    onChange={e => setNewProjStart(e.target.value)}
                    className="input-lumos w-full h-11 text-xs font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                    Data de Término (Opcional)
                  </label>
                  <input
                    type="date"
                    value={newProjEnd}
                    onChange={e => setNewProjEnd(e.target.value)}
                    className="input-lumos w-full h-11 text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                  Descrição / Notas do Projeto
                </label>
                <textarea
                  placeholder="Informações adicionais da produção..."
                  value={newProjDesc}
                  onChange={e => setNewProjDesc(e.target.value)}
                  className="input-lumos w-full p-3 h-24 text-xs font-semibold resize-none"
                />
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <input
                  type="checkbox"
                  id="applyTemplate"
                  checked={applyTemplate}
                  onChange={e => setApplyTemplate(e.target.checked)}
                  className="rounded border-lumos-border text-lumos-yellow focus:ring-lumos-yellow h-4 w-4 bg-lumos-bg"
                />
                <label htmlFor="applyTemplate" className="text-xs text-lumos-text-secondary font-semibold cursor-pointer select-none">
                  Gerar as tarefas-padrão do segmento automaticamente
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-lumos-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn-secondary py-2.5 px-4 text-xs font-bold"
                  disabled={modalLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary py-2.5 px-5 text-xs font-bold flex items-center gap-2"
                  disabled={modalLoading}
                >
                  {modalLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Salvar Projeto
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ================= CONFIRM APPLY TEMPLATE MODAL ================= */}
      {/* Confirmação de exclusão DEFINITIVA de projeto (admin) */}
      {isDeleteProjectModalOpen && selectedProject && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-lumos-surface border border-red-500/30 rounded-lumos shadow-2xl p-6 space-y-4 text-lumos-text-primary text-center">
            <div className="mx-auto w-12 h-12 bg-red-500/10 border border-red-500/20 text-red-500 rounded-full flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-base font-bold uppercase tracking-tight text-lumos-text-primary">
                Excluir "{selectedProject.name}"?
              </h3>
              <p className="text-xs text-lumos-text-secondary leading-relaxed">
                Esta ação é <span className="font-bold text-red-400">definitiva</span> e apaga junto:
              </p>
              <ul className="text-xs text-lumos-text-secondary text-left mx-auto max-w-[280px] space-y-1 pt-1">
                <li>• Todas as <b>tarefas</b> e <b>comentários</b> do projeto</li>
                <li>• O <b>registro financeiro</b> vinculado (projetos_financeiro)</li>
              </ul>
              <p className="text-[11px] text-lumos-text-secondary/70 leading-relaxed pt-1.5">
                A pasta no <b>Google Drive não</b> é apagada — se precisar, remova-a manualmente. Custos já lançados permanecem no financeiro (vinculados ao orçamento).
              </p>
            </div>

            <div className="flex items-center justify-center gap-2.5 pt-3">
              <button
                onClick={() => setIsDeleteProjectModalOpen(false)}
                disabled={deletingProject}
                className="btn-secondary text-xs w-full py-2.5 font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={deletingProject}
                className="w-full py-2.5 text-xs font-bold rounded-lumos bg-red-500 hover:bg-red-600 text-white transition-all flex items-center justify-center gap-2"
              >
                {deletingProject
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : 'Sim, excluir definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isConfirmTemplateOpen && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-6 space-y-4 text-lumos-text-primary text-center">
            <div className="mx-auto w-12 h-12 bg-lumos-yellow/10 border border-lumos-yellow/20 text-lumos-yellow rounded-full flex items-center justify-center">
              <HelpCircle className="w-6 h-6" />
            </div>
            
            <div className="space-y-1.5">
              <h3 className="text-base font-bold uppercase tracking-tight text-lumos-text-primary">
                Este projeto já possui tarefas
              </h3>
              <p className="text-xs text-lumos-text-secondary leading-relaxed">
                Você deseja carregar o template padrão deste segmento? Escolha se quer acumular as novas tarefas ou substituir todo o workflow atual.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-3">
              <button
                onClick={() => executeApplyTemplate(true)}
                className="btn-primary text-xs w-full py-2.5 font-bold"
              >
                Acumular / Adicionar
              </button>
              <button
                onClick={() => executeApplyTemplate(false, true)}
                className="btn-secondary text-xs w-full py-2.5 font-bold hover:bg-red-500/10 hover:border-red-500/30 text-white"
              >
                Substituir Existentes
              </button>
              <button
                onClick={() => setIsConfirmTemplateOpen(false)}
                className="btn-secondary text-xs w-full py-2.5 font-bold text-lumos-text-secondary"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
