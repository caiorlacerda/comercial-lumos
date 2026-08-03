import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import VideoReviewPanel from '@/components/producao/VideoReviewPanel';
import TaskVideoReview from '@/components/producao/TaskVideoReview';
import ProjectDocuments from '@/components/producao/ProjectDocuments';
import ProjectNotes from '@/components/producao/ProjectNotes';
import Select from '@/components/ui/Select';
import { useConfirm } from '@/components/ui/useConfirm';
import { TagPicker, TagChip, type Tag } from '@/components/producao/TaskTags';
import TaskCollaborators from '@/components/producao/TaskCollaborators';
import { supabase } from '@/lib/supabase';

const STATUS_OPTIONS = [
  { value: 'na_fila', label: 'Na fila' },
  { value: 'em_progresso', label: 'Em andamento' },
  { value: 'revisao_interna', label: 'Revisão interna' },
  { value: 'revisao_cliente', label: 'Com o cliente' },
  { value: 'alteracoes', label: 'Ajustes' },
  { value: 'concluido', label: 'Concluído' },
  { value: 'pausado', label: 'Pausado' },
];
const PRIORITY_OPTIONS = [
  { value: 'baixa', label: 'Baixa' }, { value: 'media', label: 'Média' }, { value: 'alta', label: 'Alta' },
];

// ── Histórico de atividade: transforma um registro em frase legível ──────────
const statusLabelOf = (v: string | null) => STATUS_OPTIONS.find(o => o.value === v)?.label || v || '—';
const priorityLabelOf = (v: string | null) => PRIORITY_OPTIONS.find(o => o.value === v)?.label || v || '—';
const fmtActDate = (d: string | null) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return (y && m && day) ? `${day}/${m}/${y.slice(2)}` : d;
};
// Compara descrições ignorando o "ruído" do editor (parágrafos vazios que o
// TipTap gera para conteúdo vazio), pra não acusar "alteração não salva" quando
// nada foi realmente editado.
const normalizeDesc = (h: string | null | undefined) =>
  (h || '').replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '').trim();
function describeActivity(a: { action: string; old_value: string | null; new_value: string | null }): string {
  switch (a.action) {
    case 'created': return 'criou a tarefa';
    case 'status':
      return a.old_value
        ? `mudou o status de ${statusLabelOf(a.old_value)} para ${statusLabelOf(a.new_value)}`
        : `definiu o status: ${statusLabelOf(a.new_value)}`;
    case 'prioridade':
      return a.old_value
        ? `mudou a prioridade de ${priorityLabelOf(a.old_value)} para ${priorityLabelOf(a.new_value)}`
        : `definiu a prioridade: ${priorityLabelOf(a.new_value)}`;
    case 'titulo': return `renomeou para "${a.new_value ?? ''}"`;
    case 'descricao': return 'editou a descrição';
    case 'prazo':
      if (!a.new_value) return 'removeu o prazo';
      if (!a.old_value) return `definiu o prazo para ${fmtActDate(a.new_value)}`;
      return `mudou o prazo de ${fmtActDate(a.old_value)} para ${fmtActDate(a.new_value)}`;
    case 'data_inicio':
      if (!a.new_value) return 'removeu a data de início';
      if (!a.old_value) return `definiu o início para ${fmtActDate(a.new_value)}`;
      return `mudou o início de ${fmtActDate(a.old_value)} para ${fmtActDate(a.new_value)}`;
    case 'responsavel':
      if (!a.new_value) return `removeu o responsável${a.old_value ? ` (${a.old_value})` : ''}`;
      return `atribuiu para ${a.new_value}`;
    case 'tag_added': return `adicionou a tag "${a.new_value ?? ''}"`;
    case 'tag_removed': return `removeu a tag "${a.old_value ?? ''}"`;
    default: return a.action;
  }
}
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import UserAvatar from '@/components/common/UserAvatar';
import AssigneePicker, { type AssigneeValue, type PickableUser } from '@/components/common/AssigneePicker';
import { useToast } from '@/context/ToastContext';
import { useSaveOsToDrive } from '@/hooks/useSaveOsToDrive';
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
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  List as ListIcon,
  ListOrdered,
  ListChecks,
  Quote,
  Minus,
  Link2,
  AlertTriangle,
  Trash2,
  Columns,
  Layers,
  MoreVertical,
  User,
  PlusCircle,
  HelpCircle,
  CornerDownRight,
  MessageSquare,
  History,
  Edit2,
  Menu,
  FolderUp
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
  drive_folder_id: string | null;
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
    { value: 'na_fila', label: 'Na fila', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
    { value: 'pausado', label: 'Pausado', color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' }
  ],
  ativo: [
    { value: 'em_progresso', label: 'Em andamento', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
    { value: 'revisao_interna', label: 'Revisão interna', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
    { value: 'revisao_cliente', label: 'Com o cliente', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    { value: 'alteracoes', label: 'Ajustes', color: 'bg-red-500/10 text-red-400 border-red-500/20' }
  ],
  concluido: [
    { value: 'concluido', label: 'Concluído', color: 'bg-green-500/10 text-green-400 border-green-500/20' }
  ]
};

// Tema visual dos cabeçalhos de etapa na lista agrupada (barra + label coloridos).
// Exportado: a Visão Geral usa as mesmas cores no pipeline.
export const STAGE_THEME: Record<string, { bar: string; text: string }> = {
  na_fila: { bar: 'bg-slate-400', text: 'text-slate-400' },
  pausado: { bar: 'bg-neutral-400', text: 'text-neutral-400' },
  em_progresso: { bar: 'bg-orange-400', text: 'text-orange-400' },
  revisao_interna: { bar: 'bg-purple-400', text: 'text-purple-400' },
  revisao_cliente: { bar: 'bg-amber-400', text: 'text-amber-400' },
  alteracoes: { bar: 'bg-red-400', text: 'text-red-400' },
  concluido: { bar: 'bg-green-500', text: 'text-green-500' },
};
export const stageTheme = (s: string) => STAGE_THEME[s] || { bar: 'bg-neutral-400', text: 'text-neutral-400' };

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
  data_entrega_cliente: string | null;
  responsavel_id: string | null;
  responsavel_freela_id: string | null;
}

interface TeamUser {
  id: string;
  full_name: string;
  avatar_url?: string | null;
}

interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  user?: {
    id?: string;
    full_name: string;
    email: string;
    role: string;
    avatar_url?: string | null;
  } | null;
}

interface TaskActivity {
  id: string;
  task_id: string;
  actor_name: string | null;
  action: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
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

// Botão da toolbar do editor (ícone), com estado ativo
function TBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={clsx('p-1.5 rounded-md transition-colors flex items-center justify-center',
        active ? 'bg-lumos-yellow/20 text-lumos-yellow' : 'text-lumos-text-secondary hover:bg-lumos-text-secondary/10 hover:text-lumos-text-primary')}>
      {children}
    </button>
  );
}
const TBSep = () => <span className="w-px h-4 bg-lumos-border/70 mx-1" />;
const HEADING_OPTS = [
  { value: 'p', label: 'Texto' }, { value: '1', label: 'Título 1' }, { value: '2', label: 'Título 2' },
  { value: '3', label: 'Título 3' }, { value: '4', label: 'Título 4' }, { value: '5', label: 'Título 5' },
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
        <div className="flex flex-wrap items-center gap-0.5 p-1.5 bg-lumos-surface border-b border-lumos-border rounded-t-lumos">
          <Select
            value={editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : editor.isActive('heading', { level: 4 }) ? '4' : editor.isActive('heading', { level: 5 }) ? '5' : 'p'}
            onChange={(v) => { const c = editor.chain().focus(); if (v === 'p') c.setParagraph().run(); else c.setHeading({ level: Number(v) as any }).run(); }}
            options={HEADING_OPTS}
            className="input-lumos h-7 text-[11px] py-0 w-28"
          />
          <TBSep />
          <TBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito (⌘B)"><BoldIcon className="w-3.5 h-3.5" /></TBtn>
          <TBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico (⌘I)"><ItalicIcon className="w-3.5 h-3.5" /></TBtn>
          <TBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado (⌘U)"><UnderlineIcon className="w-3.5 h-3.5" /></TBtn>
          <TBSep />
          <TBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista"><ListIcon className="w-3.5 h-3.5" /></TBtn>
          <TBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada"><ListOrdered className="w-3.5 h-3.5" /></TBtn>
          <TBtn active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Checklist"><ListChecks className="w-3.5 h-3.5" /></TBtn>
          <TBSep />
          <TBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Citação"><Quote className="w-3.5 h-3.5" /></TBtn>
          <TBtn active={editor.isActive('callout')} onClick={() => (editor.chain().focus() as any).toggleCallout().run()} title="Banner de destaque"><AlertTriangle className="w-3.5 h-3.5" /></TBtn>
          <TBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divisória"><Minus className="w-3.5 h-3.5" /></TBtn>
          <TBtn active={editor.isActive('link')} onClick={addLink} title="Link"><Link2 className="w-3.5 h-3.5" /></TBtn>
          <TBSep />
          <button type="button" onClick={() => editor.chain().focus().setColor('#facc15').run()} className="w-3.5 h-3.5 rounded-full bg-yellow-400 border border-black/20 hover:scale-110 transition-transform" title="Amarelo" />
          <button type="button" onClick={() => editor.chain().focus().setColor('#f87171').run()} className="w-3.5 h-3.5 rounded-full bg-red-400 border border-black/20 hover:scale-110 transition-transform" title="Vermelho" />
          <button type="button" onClick={() => editor.chain().focus().setColor('#60a5fa').run()} className="w-3.5 h-3.5 rounded-full bg-blue-400 border border-black/20 hover:scale-110 transition-transform" title="Azul" />
          <button type="button" onClick={() => editor.chain().focus().unsetColor().run()} className="text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary px-1" title="Limpar cor">×</button>
        </div>
      )}

      <div className="p-4 min-h-[160px] text-sm leading-relaxed text-lumos-text-primary focus-within:outline-none bg-transparent">
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
  const { confirm, dialog: confirmDialog } = useConfirm();
  
  // Permissions
  const canManage = isAdmin || can('ordem_do_dia');
  // Prazo de entrega ao cliente: só admin, produção e atendimento veem (edição não).
  const canSeeClientDeadline = ['admin', 'producao', 'time', 'atendimento'].includes(profile?.role || '');

  // Database States
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  // Freelancers = fornecedores, disponíveis como responsável externo de tarefas.
  const [freelancers, setFreelancers] = useState<TeamUser[]>([]);
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
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [taskTags, setTaskTags] = useState<Record<string, string[]>>({}); // taskId -> tagIds
  // Colaboradores por tarefa (além do responsável): taskId -> userIds
  const [taskCollabs, setTaskCollabs] = useState<Record<string, string[]>>({});
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [selTaskIds, setSelTaskIds] = useState<Set<string>>(new Set()); // seleção em lote
  const [tasksLoading, setTasksLoading] = useState(false);
  // ── Hub do projeto (Fase 1 do redesign): abas + ferramentas da lista ──
  const [projTab, setProjTab] = useState<'geral' | 'tarefas' | 'entregas' | 'arquivos'>('tarefas');
  const [taskSearch, setTaskSearch] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState('all');
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [showDone, setShowDone] = useState(false); // grupo "Concluídas" visível?
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  // Contadores das abas Entregas/Arquivos (consultas leves ao trocar de projeto).
  const [entregasCount, setEntregasCount] = useState<number | null>(null);
  const [docsCount, setDocsCount] = useState<number | null>(null);
  // Atividade recente do projeto (últimos registros de task_activity).
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  // Lixeira: tarefas com soft delete (recuperáveis por 30 dias).
  const [trashCount, setTrashCount] = useState(0);
  const [showTrash, setShowTrash] = useState(false);
  const [trashedTasks, setTrashedTasks] = useState<any[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const quickAddInputRef = useRef<HTMLInputElement>(null);
  const [isConfirmTemplateOpen, setIsConfirmTemplateOpen] = useState(false);

  // Task Details Modal States
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [descHTML, setDescHTML] = useState('');
  const [isSavingDesc, setIsSavingDesc] = useState(false);

  // Task Comments & Mentions States
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');

  // Histórico de atividade da tarefa (estilo ClickUp) + aba do painel direito
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [rightTab, setRightTab] = useState<'comments' | 'activity'>('comments');

  // Comment @mention Autocomplete States
  const [mentionAutocomplete, setMentionAutocomplete] = useState<{ query: string; start: number; end: number } | null>(null);
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);
  const commentInputRef = useRef<HTMLInputElement>(null);

  // Right-click context menu states
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null);

  // PDF Generation State
  const [isGeneratingOS, setIsGeneratingOS] = useState<string | null>(null);
  const [savingOs, setSavingOs] = useState(false);
  const [osUrl, setOsUrl] = useState<string | null>(null); // OS já salva no Drive?
  const { saveOsToDrive } = useSaveOsToDrive();

  // Modal State for Manual Creation
  const [isModalOpen, setIsModalOpen] = useState(false);

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
    setSelTaskIds(new Set());
    // Reset do hub ao trocar de projeto (aba, busca e filtros voltam ao padrão).
    setProjTab('tarefas');
    setTaskSearch('');
    setTaskStatusFilter('all');
    setTaskAssigneeFilter('all');
    setOnlyMine(false);
    setShowDone(false);
    setHeaderMenuOpen(false);
    // Verifica se a OS já está no Drive (documento "OS …" registrado no projeto).
    if (selectedProjectId) {
      supabase.from('project_documents').select('url').eq('project_id', selectedProjectId)
        .ilike('name', 'OS %').order('created_at', { ascending: false }).limit(1)
        .then(({ data }) => setOsUrl(data?.[0]?.url || null));
      // Contadores leves das abas Entregas (vídeos = grupos) e Arquivos.
      supabase.from('video_versions').select('group_id').eq('project_id', selectedProjectId)
        .then(({ data }) => setEntregasCount(data ? new Set(data.map((v: any) => v.group_id)).size : null));
      supabase.from('project_documents').select('id', { count: 'exact', head: true }).eq('project_id', selectedProjectId)
        .then(({ count }) => setDocsCount(count ?? null));
    } else {
      setOsUrl(null);
      setEntregasCount(null);
      setDocsCount(null);
    }
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
      // ?tab= abre direto numa aba do hub (ex.: Visão Geral → Entregas).
      // Depois do reset do effect de troca de projeto, então usa timeout 0.
      const tab = searchParams.get('tab');
      if (tab && ['geral', 'tarefas', 'entregas', 'arquivos'].includes(tab)) {
        setTimeout(() => setProjTab(tab as any), 0);
      }
    }
    // Mantém projectId na URL (reflete o projeto aberto → destaque na sidebar e
    // sobrevive a refresh). Remove só taskId/new/tab, e apenas quando existem,
    // para não reprocessar em loop.
    if (searchParams.get('taskId') || searchParams.get('new') || searchParams.get('tab')) {
      const keep = new URLSearchParams();
      if (pid) keep.set('projectId', pid);
      setSearchParams(keep, { replace: true });
    }
  }, [projects, searchParams]);

  // Quando as tarefas do projeto deep-linkado chegam, abre a tarefa pendente
  useEffect(() => {
    const tid = pendingTaskIdRef.current;
    if (tid && projectTasks.some(t => t.id === tid)) {
      pendingTaskIdRef.current = null;
      setSelectedTaskId(tid);
    }
  }, [projectTasks]);

  // "+ Novo projeto" da sidebar (?new=1) → abre o modal de criação direto
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setIsModalOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Não existe mais "landing": sem projeto selecionado (e sem estar criando),
  // volta pra Visão Geral da Produção (/producao).
  useEffect(() => {
    if (loading || selectedProjectId || isModalOpen) return;
    if (searchParams.get('projectId') || searchParams.get('new')) return;
    navigate('/producao', { replace: true });
  }, [loading, selectedProjectId, isModalOpen, searchParams, navigate]);

  const selectedTask = projectTasks.find(t => t.id === selectedTaskId);

  // Sincronizar editor de descrição no modal
  useEffect(() => {
    if (selectedTask) {
      setDescHTML(selectedTask.descricao || '');
    } else {
      setDescHTML('');
    }
  }, [selectedTaskId, selectedTask?.id]);

  // Carregar comentários e histórico quando a tarefa for selecionada
  useEffect(() => {
    if (selectedTaskId) {
      fetchTaskComments(selectedTaskId);
      fetchTaskActivity(selectedTaskId);
    } else {
      setComments([]);
      setActivity([]);
      setRightTab('comments');
    }
  }, [selectedTaskId]);

  // Colaboração em tempo real: mudanças feitas por outros usuários aparecem
  // aqui sem reload (refetch silencioso — sem spinner).
  useRealtimeRefetch(
    ['projects', 'project_tasks', 'task_comments', 'project_task_tags', 'task_tags', 'task_activity', 'task_collaborators'],
    () => {
      fetchData(true);
      if (selectedProjectId) fetchProjectTasks(selectedProjectId, true);
      if (selectedTaskId) {
        fetchTaskComments(selectedTaskId, true);
        fetchTaskActivity(selectedTaskId, true);
      }
    }
  );

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
          if (taskObj && normalizeDesc(descHTML) !== normalizeDesc(taskObj.descricao)) {
            confirm({ title: 'Alterações não salvas', message: 'Você tem alterações não salvas na descrição. Deseja realmente fechar?', confirmLabel: 'Fechar sem salvar', danger: true })
              .then(ok => { if (ok) setSelectedTaskId(null); });
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

  // silent = refetch sem spinner (realtime): os dados antigos ficam na tela
  async function fetchData(silent = false) {
    if (!silent) setLoading(true);
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
        .select('id, project_id, status')
        .is('deleted_at', null);
      if (tErr) throw tErr;

      const { data: usersData, error: uErr } = await supabase
        .from('app_users')
        .select('*')
        .eq('status', 'ativo')
        .order('full_name', { ascending: true });
      if (uErr) throw uErr;

      const { data: tagsData } = await supabase
        .from('task_tags')
        .select('id, name, color, ordem')
        .order('ordem', { ascending: true });

      // Freelancers/parceiros = fornecedores (mapeados para o formato do picker).
      const { data: freelaData } = await supabase
        .from('fornecedores')
        .select('id, nome')
        .order('nome', { ascending: true });

      setClients(clientsData || []);
      setProjects(projectsData || []);
      setTasks(tasksData || []);
      // Contas ocultas não entram no seletor de responsável.
      setTeamUsers(((usersData as any[]) || []).filter(u => !u.hidden));
      setFreelancers(((freelaData as any[]) || []).map(f => ({ id: f.id, full_name: f.nome, avatar_url: null })));
      setAllTags((tagsData as Tag[]) || []);
    } catch (err: any) {
      console.error('Error fetching project data:', err);
      toast.error('Erro ao carregar dados dos projetos.');
    } finally {
      setLoading(false);
    }
  }

  const fetchProjectTasks = async (projectId: string, silent = false) => {
    if (!silent) setTasksLoading(true);
    try {
      const { data, error } = await supabase
        .from('project_tasks')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)                 // não traz as que estão na lixeira
        .order('ordem', { ascending: true });
      if (error) throw error;
      setProjectTasks(data || []);

      // Contagem da lixeira (badge do botão), sem trazer as linhas.
      const { count } = await supabase
        .from('project_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .not('deleted_at', 'is', null);
      setTrashCount(count || 0);

      // Tags das tarefas do projeto
      const ids = (data || []).map((t: any) => t.id);
      if (ids.length) {
        const { data: ptt } = await supabase.from('project_task_tags').select('task_id, tag_id').in('task_id', ids);
        const map: Record<string, string[]> = {};
        (ptt || []).forEach((r: any) => { (map[r.task_id] = map[r.task_id] || []).push(r.tag_id); });
        setTaskTags(map);

        // Colaboradores das tarefas do projeto
        const { data: tc } = await supabase.from('task_collaborators').select('task_id, user_id').in('task_id', ids);
        const cmap: Record<string, string[]> = {};
        (tc || []).forEach((r: any) => { (cmap[r.task_id] = cmap[r.task_id] || []).push(r.user_id); });
        setTaskCollabs(cmap);
        // Atividade recente do projeto (aba Visão geral) — últimos 8 registros.
        const { data: act } = await supabase.from('task_activity')
          .select('*').in('task_id', ids)
          .order('created_at', { ascending: false }).limit(8);
        const titleOf: Record<string, string> = {};
        (data || []).forEach((t: any) => { titleOf[t.id] = t.titulo; });
        setRecentActivity((act || []).map((a: any) => ({ ...a, taskTitle: titleOf[a.task_id] || '' })));
      } else {
        setTaskTags({});
        setTaskCollabs({});
        setRecentActivity([]);
      }
    } catch (err: any) {
      console.error('Error fetching tasks:', err);
      toast.error('Erro ao carregar tarefas.');
    } finally {
      setTasksLoading(false);
    }
  };

  // Adiciona/remove uma tag de uma tarefa
  const toggleTaskTag = async (taskId: string, tagId: string) => {
    const has = (taskTags[taskId] || []).includes(tagId);
    setTaskTags(prev => {
      const cur = prev[taskId] || [];
      return { ...prev, [taskId]: has ? cur.filter(id => id !== tagId) : [...cur, tagId] };
    });
    if (has) {
      await supabase.from('project_task_tags').delete().eq('task_id', taskId).eq('tag_id', tagId);
    } else {
      await supabase.from('project_task_tags').insert({ task_id: taskId, tag_id: tagId });
    }
    if (taskId === selectedTaskId) fetchTaskActivity(taskId);
  };

  const tagById = (id: string) => allTags.find(t => t.id === id);

  // ── Colaboradores da tarefa (além do responsável) ──────────────────────────
  const addCollaborator = async (taskId: string, userId: string) => {
    setTaskCollabs(prev => ({ ...prev, [taskId]: [...(prev[taskId] || []), userId] }));
    const { error } = await supabase.from('task_collaborators').insert({ task_id: taskId, user_id: userId, added_by: profile?.id ?? null });
    if (error) {
      setTaskCollabs(prev => ({ ...prev, [taskId]: (prev[taskId] || []).filter(id => id !== userId) }));
      toast.error('Não foi possível adicionar a pessoa na tarefa.');
    }
  };

  const removeCollaborator = async (taskId: string, userId: string) => {
    setTaskCollabs(prev => ({ ...prev, [taskId]: (prev[taskId] || []).filter(id => id !== userId) }));
    const { error } = await supabase.from('task_collaborators').delete().eq('task_id', taskId).eq('user_id', userId);
    if (error) {
      setTaskCollabs(prev => ({ ...prev, [taskId]: [...(prev[taskId] || []), userId] }));
      toast.error('Não foi possível tirar a pessoa da tarefa.');
    }
  };

  // Lista de tarefas exibida: busca (sem acento) + filtros de tag (OR), status,
  // responsável e "só minhas". Não altera nada no banco — é só exibição.
  const isTaskDone = (t: any) => t.status === 'concluido' || t.status === 'entregue';
  const normTxt = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const filteredTasks = projectTasks.filter(t => {
    if (tagFilter.length && !(taskTags[t.id] || []).some(id => tagFilter.includes(id))) return false;
    if (taskSearch.trim() && !normTxt(t.titulo).includes(normTxt(taskSearch))) return false;
    if (taskStatusFilter !== 'all' && t.status !== taskStatusFilter) return false;
    // Filtros de pessoa consideram também os colaboradores da tarefa.
    const collabs = taskCollabs[t.id] || [];
    if (taskAssigneeFilter === 'none') {
      if (t.responsavel_id || t.responsavel_freela_id || collabs.length) return false;
    } else if (taskAssigneeFilter !== 'all' && t.responsavel_id !== taskAssigneeFilter && t.responsavel_freela_id !== taskAssigneeFilter && !collabs.includes(taskAssigneeFilter)) {
      return false;
    }
    if (onlyMine && t.responsavel_id !== profile?.id && !(profile?.id && collabs.includes(profile.id))) return false;
    return true;
  });
  const activeCount = filteredTasks.filter(t => !isTaskDone(t)).length;
  const doneCount = filteredTasks.filter(t => isTaskDone(t)).length;

  // Agrupamento por status na ordem do fluxo. Status legados não listados
  // (iniciar, aguard_*) entram no primeiro grupo; 'entregue' conta como concluído.
  // O grupo Concluídas só aparece com o toggle (showDone).
  const GROUP_ORDER = ['na_fila', 'pausado', 'em_progresso', 'revisao_interna', 'revisao_cliente', 'alteracoes', 'concluido'];
  const groupKeyOf = (t: any) => isTaskDone(t) ? 'concluido' : (GROUP_ORDER.includes(t.status) ? t.status : 'na_fila');
  const taskGroups = GROUP_ORDER
    .filter(s => showDone || s !== 'concluido')
    .map(s => ({ status: s, tasks: filteredTasks.filter(t => groupKeyOf(t) === s) }))
    .filter(g => g.tasks.length > 0);
  const visibleTasks = taskGroups.flatMap(g => g.tasks);
  const hasActiveFilters = !!taskSearch.trim() || taskStatusFilter !== 'all' || taskAssigneeFilter !== 'all' || onlyMine || tagFilter.length > 0;

  // ── Lixeira ────────────────────────────────────────────────────────────────
  const openTrash = async () => {
    if (!selectedProjectId) return;
    setShowTrash(true);
    setTrashLoading(true);
    const { data } = await supabase
      .from('project_tasks')
      .select('id, titulo, status, deleted_at')
      .eq('project_id', selectedProjectId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    setTrashedTasks(data || []);
    setTrashCount((data || []).length);
    setTrashLoading(false);
  };

  const restoreTask = async (taskId: string) => {
    const { error } = await supabase
      .from('project_tasks')
      .update({ deleted_at: null })
      .eq('id', taskId);
    if (error) { toast.error('Não foi possível restaurar a tarefa.'); return; }
    setTrashedTasks(prev => prev.filter(t => t.id !== taskId));
    setTrashCount(c => Math.max(0, c - 1));
    toast.success('Tarefa restaurada ✓');
    if (selectedProjectId) fetchProjectTasks(selectedProjectId, true);
  };

  // Quantos dias faltam até a purga definitiva (30 dias após o delete).
  const daysUntilPurge = (deletedAt: string) => {
    const ms = new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now();
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  };

  // Carregar comentários da tarefa
  const fetchTaskComments = async (taskId: string, silent = false) => {
    if (!silent) setCommentsLoading(true);
    try {
      const { data, error } = await supabase
        .from('task_comments')
        .select('*, user:app_users(id, full_name, email, role, avatar_url)')
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

  // Carregar histórico de atividade da tarefa (mais recente primeiro)
  const fetchTaskActivity = async (taskId: string, silent = false) => {
    if (!silent) setActivityLoading(true);
    try {
      const { data, error } = await supabase
        .from('task_activity')
        .select('id, task_id, actor_name, action, old_value, new_value, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setActivity(data || []);
    } catch (err: any) {
      console.error('Error fetching activity:', err);
    } finally {
      setActivityLoading(false);
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
        .select('*, user:app_users(id, full_name, email, role, avatar_url)')
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
    if (!(await confirm({ message: 'Tem certeza que deseja excluir este comentário?', confirmLabel: 'Excluir', danger: true }))) return;

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

      // Atualiza o histórico ao vivo se a tarefa aberta foi a alterada
      if (taskId === selectedTaskId) fetchTaskActivity(taskId);
    } catch (err: any) {
      console.error('Error updating task:', err);
      toast.error('Erro ao atualizar tarefa.');
      if (selectedProjectId) fetchProjectTasks(selectedProjectId);
    }
  };

  // Responsável (interno ou freelancer) → valor do picker. Só um dos dois é
  // usado por vez; o interno tem precedência caso ambos estejam preenchidos.
  const assigneeOf = (t: { responsavel_id: string | null; responsavel_freela_id: string | null }): AssigneeValue =>
    t.responsavel_id ? { type: 'user', id: t.responsavel_id }
      : t.responsavel_freela_id ? { type: 'freela', id: t.responsavel_freela_id }
        : null;

  const setAssignee = (taskId: string, sel: AssigneeValue) =>
    handleUpdateTask(taskId, {
      responsavel_id: sel?.type === 'user' ? sel.id : null,
      responsavel_freela_id: sel?.type === 'freela' ? sel.id : null,
    });

  // Cadastro rápido de freelancer a partir do picker: cria um fornecedor só com
  // o nome (aprovado) e o disponibiliza na lista na hora.
  const quickAddFreela = async (nome: string): Promise<PickableUser | null> => {
    try {
      const { data, error } = await supabase
        .from('fornecedores')
        .insert([{ nome: nome.trim(), status_cadastro: 'aprovado', created_by: profile?.id }])
        .select('id, nome')
        .single();
      if (error || !data) throw error;
      const novo: PickableUser = { id: data.id, full_name: data.nome, avatar_url: null };
      setFreelancers(prev => [...prev, novo].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR')));
      toast.success('Freelancer adicionado ✓');
      return novo;
    } catch (err: any) {
      toast.error('Não foi possível adicionar o freelancer.');
      return null;
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
          status: 'na_fila',
          prioridade: 'media',
          ordem: nextOrder,
          data_inicio: null,
          data_fim: null
        })
        .select()
        .single();

      if (error) throw error;

      // Fluxo rápido: sem toast e sem recarregar o painel. A tarefa entra direto
      // na lista (otimista) e o input mantém o foco para criação em sequência.
      setNewTaskTitle('');
      setProjectTasks(prev => [...prev, newTask]);
      setTasks(prev => [...prev, { id: newTask.id, project_id: selectedProjectId, status: newTask.status }]);
      quickAddInputRef.current?.focus();
    } catch (err: any) {
      console.error('Error adding task:', err);
      toast.error('Erro ao adicionar tarefa.');
    }
  };

  // Delete task
  const handleDeleteTask = async (taskId: string) => {
    if (!(await confirm({ title: 'Excluir tarefa', message: 'Tem certeza que deseja excluir esta tarefa? Ela vai para a lixeira e pode ser recuperada por 30 dias.', confirmLabel: 'Excluir', danger: true }))) return;

    try {
      // Soft delete: marca deleted_at em vez de apagar (recuperável na lixeira).
      const { error } = await supabase
        .from('project_tasks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', taskId);

      if (error) throw error;

      toast.success('Tarefa movida para a lixeira.');
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
      }
      setProjectTasks(prev => prev.filter(t => t.id !== taskId));
      setTasks(prev => prev.filter(t => t.id !== taskId));
      setTrashCount(c => c + 1);
    } catch (err: any) {
      console.error('Error deleting task:', err);
      toast.error('Erro ao excluir tarefa.');
    }
  };

  // ── Ações em lote ──────────────────────────────────────────────────────────
  const toggleSelTask = (taskId: string) => {
    setSelTaskIds(prev => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };
  const toggleSelAll = () => {
    setSelTaskIds(prev => {
      const ids = visibleTasks.map(t => t.id);
      const allSel = ids.length > 0 && ids.every(id => prev.has(id));
      return allSel ? new Set() : new Set(ids);
    });
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selTaskIds);
    if (ids.length === 0) return;
    if (!(await confirm({ title: 'Excluir tarefas', message: `Excluir ${ids.length} tarefa(s)? Elas vão para a lixeira e podem ser recuperadas por 30 dias.`, confirmLabel: 'Excluir', danger: true }))) return;
    const { error } = await supabase.from('project_tasks').update({ deleted_at: new Date().toISOString() }).in('id', ids);
    if (error) { console.error(error); toast.error('Erro ao excluir as tarefas.'); return; }
    setProjectTasks(prev => prev.filter(t => !selTaskIds.has(t.id)));
    setTasks(prev => prev.filter(t => !selTaskIds.has(t.id)));
    if (selectedTaskId && selTaskIds.has(selectedTaskId)) setSelectedTaskId(null);
    setTrashCount(c => c + ids.length);
    setSelTaskIds(new Set());
    toast.success(`${ids.length} tarefa(s) movida(s) para a lixeira.`);
  };

  const handleBatchStatus = async (status: string) => {
    const ids = Array.from(selTaskIds);
    if (ids.length === 0) return;
    const { error } = await supabase.from('project_tasks').update({ status, updated_at: new Date().toISOString() }).in('id', ids);
    if (error) { toast.error('Erro ao atualizar as tarefas.'); return; }
    if (selectedProjectId) fetchProjectTasks(selectedProjectId, true);
    setSelTaskIds(new Set());
    toast.success(`${ids.length} tarefa(s) atualizada(s).`);
  };

  // Lote: atribuir responsável interno (zera o freela, mesma regra do individual).
  const handleBatchAssign = async (userId: string) => {
    const ids = Array.from(selTaskIds);
    if (ids.length === 0) return;
    const { error } = await supabase.from('project_tasks')
      .update({ responsavel_id: userId || null, responsavel_freela_id: null, updated_at: new Date().toISOString() })
      .in('id', ids);
    if (error) { toast.error('Erro ao atribuir as tarefas.'); return; }
    if (selectedProjectId) fetchProjectTasks(selectedProjectId, true);
    setSelTaskIds(new Set());
    toast.success(`${ids.length} tarefa(s) atribuída(s).`);
  };

  // Lote: mudar o prazo de edição (data_fim).
  const handleBatchDue = async (date: string) => {
    const ids = Array.from(selTaskIds);
    if (ids.length === 0 || !date) return;
    const { error } = await supabase.from('project_tasks')
      .update({ data_fim: date, updated_at: new Date().toISOString() })
      .in('id', ids);
    if (error) { toast.error('Erro ao mudar o prazo.'); return; }
    if (selectedProjectId) fetchProjectTasks(selectedProjectId, true);
    setSelTaskIds(new Set());
    toast.success(`Prazo atualizado em ${ids.length} tarefa(s).`);
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
        status: 'na_fila',
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
    // Abre a aba JÁ no clique (dentro do gesto do usuário) pra não ser bloqueada
    // pelo popup blocker; depois aponta ela pro PDF gerado.
    const win = window.open('', '_blank');
    setIsGeneratingOS(projectId);
    try {
      const { data: budget, error: bErr } = await supabase
        .from('budgets')
        .select('*, clients(*)')
        .eq('id', budgetId)
        .single();
      if (bErr || !budget) throw new Error('Budget not found');

      if (!budget.active_version_id) {
        win?.close();
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

      const blob = await pdf(
        <ServiceOrderPDF
          budget={budget}
          version={version}
          contact={null}
          items={items}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url; else window.open(url, '_blank');
      // dá tempo do PDF carregar na aba antes de liberar o blob
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success('Ordem de Serviço aberta em nova aba!');
    } catch (err: any) {
      console.error('Error generating OS:', err);
      win?.close();
      toast.error('Erro ao gerar Ordem de Serviço PDF.');
    } finally {
      setIsGeneratingOS(null);
    }
  };

  const handleSaveOs = async (projectId: string, budgetId: string) => {
    setSavingOs(true);
    try {
      const r = await saveOsToDrive({ budgetId, projectId, interactive: true });
      if (r.ok) { toast.success('OS salva na pasta OS do projeto no Drive!'); if (r.url) setOsUrl(r.url); }
      else if (!r.skipped) toast.error(r.error || 'Não foi possível salvar a OS.');
    } finally {
      setSavingOs(false);
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
            status: 'na_fila',
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

  const descDirty = !!selectedTask && normalizeDesc(descHTML) !== normalizeDesc(selectedTask.descricao);

  // Fecha o modal da tarefa. Só pede confirmação se houver descrição não salva
  // de verdade; sem alteração, fecha direto.
  const requestCloseTask = () => {
    if (!canManage || !descDirty) { setSelectedTaskId(null); return; }
    confirm({ title: 'Alterações não salvas', message: 'Você tem alterações não salvas na descrição. Deseja realmente fechar?', confirmLabel: 'Fechar sem salvar', danger: true })
      .then(ok => { if (ok) setSelectedTaskId(null); });
  };

  const clientProjectsFiltered = projects.filter(p => {
    if (p.client_id !== selectedClientId) return false;
    if (!showConcludedProjects && p.status === 'concluido') return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header — some quando um projeto está aberto ou durante o carregamento */}
      {!selectedProjectId && !loading && (
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
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
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <Loader2 className="w-10 h-10 animate-spin text-lumos-yellow mb-4" />
          <p className="text-xs text-lumos-text-secondary font-semibold uppercase tracking-wider">Carregando painel...</p>
        </div>
      ) : (
        <div className="min-h-[600px]">
          
          {/* Detalhe do projeto — a seleção vem da árvore de Projetos na sidebar */}
          <div className="space-y-6 min-h-[600px]">
            
            {selectedProjectId && selectedProject ? (
              /* ================= SELECTED PROJECT DETAILS & TASKS ================= */
              <div className="space-y-5">

                {/* ================= HEADER DO PROJETO (hub em abas) ================= */}
                <div className="card p-5 md:p-6 pb-0 space-y-3">
                  {/* Breadcrumb: cliente e código */}
                  <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">
                    {selectedClient?.name || 'Sem cliente'}{selectedProject.code ? <> · <span className="text-lumos-text-primary">{formatBudgetCode(selectedProject.code)}</span></> : null}
                  </p>

                  {/* Nome + chips + ações */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-2xl md:text-[26px] font-black text-lumos-text-primary uppercase tracking-tight leading-tight">
                      {selectedProject.name}
                    </h2>
                    <span className={clsx(
                      "text-[9px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider border",
                      selectedProject.status === 'concluido' ? 'bg-red-500/10 text-red-400 border-red-500/25' : 'bg-green-500/10 text-green-400 border-green-500/25'
                    )}>
                      {selectedProject.status === 'concluido' ? 'Encerrado' : 'Ativo'}
                    </span>
                      {canManage ? (
                        <Select
                          value={selectedProject.category || selectedProject.budget?.category || ''}
                          onChange={async (v) => {
                            try {
                              const { error } = await supabase
                                .from('projects')
                                .update({ category: v as 'digital' | 'filme' | 'live' })
                                .eq('id', selectedProject.id);
                              if (error) throw error;
                              toast.success('Segmento do projeto atualizado!');
                              await fetchData();
                            } catch (err: any) {
                              console.error('Error updating project category:', err);
                              toast.error('Erro ao atualizar segmento.');
                            }
                          }}
                          options={[{ value: '', label: 'Sem Segmento' }, { value: 'digital', label: 'Digital' }, { value: 'filme', label: 'Filme' }, { value: 'live', label: 'Live' }]}
                          className={clsx(
                            "text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wider border hover:border-lumos-yellow/40 max-w-[160px]",
                            getCategoryTheme(selectedProject.category || selectedProject.budget?.category || null)
                          )}
                        />
                      ) : (
                        <span className={clsx(
                          "text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wider border",
                          getCategoryTheme(selectedProject.category || selectedProject.budget?.category || null)
                        )}>
                          {selectedProject.category || selectedProject.budget?.category || 'Sem Segmento'}
                        </span>
                      )}

                    <div className="flex items-center gap-2 flex-wrap ml-auto">
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
                            Abrir OS (PDF)
                          </>
                        )}
                      </button>
                    )}

                    {canManage && selectedProject.budget_id && (
                      osUrl ? (
                        <a
                          href={osUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2 px-3 flex items-center gap-2 text-xs font-semibold rounded-lumos border border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/15 transition-colors"
                          title="OS já está no Drive — clique para abrir"
                        >
                          <Check className="w-3.5 h-3.5" /> OS no Drive
                        </a>
                      ) : (
                        <button
                          onClick={() => handleSaveOs(selectedProject.id, selectedProject.budget_id!)}
                          disabled={savingOs}
                          className="btn-secondary py-2 px-3 flex items-center gap-2 text-xs font-semibold"
                          title="Gera a OS e salva na subpasta OS do projeto no Drive"
                        >
                          {savingOs ? <Loader2 className="w-3.5 h-3.5 animate-spin text-lumos-yellow" /> : <FolderUp className="w-3.5 h-3.5" />}
                          {savingOs ? 'Salvando...' : 'Salvar OS no Drive'}
                        </button>
                      )
                    )}

                      {/* Menu ⋯ com as ações menos frequentes */}
                      <div className="relative">
                        <button onClick={() => setHeaderMenuOpen(o => !o)} className="btn-secondary py-2 px-3 text-xs font-black" title="Mais ações do projeto">⋯</button>
                        {headerMenuOpen && (<>
                          <div className="fixed inset-0 z-[60]" onClick={() => setHeaderMenuOpen(false)} />
                          <div className="absolute right-0 top-full mt-1 w-60 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-[61] py-1">
                            <button onClick={() => { setHeaderMenuOpen(false); navigate(`/producao/board?projectId=${selectedProjectId}`); }} className="w-full text-left px-3 py-2 text-xs font-bold text-lumos-text-primary hover:bg-lumos-text-primary/5">Ver no Board (Kanban)</button>
                            <button onClick={() => { setHeaderMenuOpen(false); navigate(`/producao/schedule?projectId=${selectedProjectId}`); }} className="w-full text-left px-3 py-2 text-xs font-bold text-lumos-text-primary hover:bg-lumos-text-primary/5">Ver na Timeline (Gantt)</button>
                            {canManage && <div className="h-px bg-lumos-border my-1" />}
                            {canManage && (
                              <button onClick={() => { setHeaderMenuOpen(false); handleApplyTemplateTrigger(); }} className="w-full text-left px-3 py-2 text-xs font-bold text-lumos-text-primary hover:bg-lumos-text-primary/5 flex items-center gap-2">
                                <Layers className="w-3.5 h-3.5 text-lumos-yellow" /> Aplicar template do segmento
                              </button>
                            )}
                            {canManage && (
                              <button onClick={() => { setHeaderMenuOpen(false); handleToggleProjectStatus(selectedProject.id, selectedProject.status); }} className={clsx("w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2", selectedProject.status === 'ativo' ? 'text-red-400 hover:bg-red-500/10' : 'text-green-500 hover:bg-green-500/10')}>
                                {selectedProject.status === 'ativo' ? (<><Check className="w-3.5 h-3.5" /> Encerrar projeto</>) : (<><RotateCcw className="w-3.5 h-3.5" /> Reativar projeto</>)}
                              </button>
                            )}
                          </div>
                        </>)}
                      </div>
                    </div>
                  </div>

                  {/* Progresso + término */}
                  <div className="flex items-center gap-3 flex-wrap text-[11px] font-semibold text-lumos-text-secondary">
                    <div className="w-full max-w-[240px] bg-lumos-border/30 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-lumos-yellow h-full transition-all duration-500" style={{ width: `${getProjectTasksStats(selectedProject.id).pct}%` }} />
                    </div>
                    <span>{getProjectTasksStats(selectedProject.id).pct}% · {getProjectTasksStats(selectedProject.id).completed} de {getProjectTasksStats(selectedProject.id).total} concluídas</span>
                    {selectedProject.data_fim && (
                      <span className="ml-auto">Término: <b className="text-lumos-text-primary">{new Date(selectedProject.data_fim + 'T12:00:00').toLocaleDateString('pt-BR')}</b></span>
                    )}
                  </div>

                  {/* Abas do hub */}
                  <div className="flex gap-1 border-t border-lumos-border/50 -mx-5 md:-mx-6 px-5 md:px-6 overflow-x-auto no-scrollbar">
                    {([
                      { key: 'geral' as const, label: 'Visão geral', count: null as number | null },
                      { key: 'tarefas' as const, label: 'Tarefas', count: activeCount },
                      { key: 'entregas' as const, label: 'Entregas', count: entregasCount },
                      { key: 'arquivos' as const, label: 'Arquivos', count: docsCount },
                    ]).map(t => (
                      <button key={t.key} onClick={() => setProjTab(t.key)}
                        className={clsx('px-4 py-2.5 text-xs font-black uppercase tracking-wider border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors',
                          projTab === t.key ? 'border-lumos-yellow text-lumos-yellow' : 'border-transparent text-lumos-text-secondary hover:text-lumos-text-primary')}>
                        {t.label}
                        {t.count != null && <span className={clsx('text-[10px] font-black rounded-full px-1.5 py-0.5', projTab === t.key ? 'bg-lumos-yellow/15' : 'bg-lumos-text-secondary/15')}>{t.count}</span>}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ================= ABA: VISÃO GERAL ================= */}
                {projTab === 'geral' && (
                <div className="space-y-5">

                  {/* Resumo rápido */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="card p-4">
                      <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary">Progresso</p>
                      <p className="text-xl font-black text-lumos-text-primary mt-0.5">{getProjectTasksStats(selectedProject.id).pct}%</p>
                      <p className="text-[11px] text-lumos-text-secondary">{getProjectTasksStats(selectedProject.id).completed} de {getProjectTasksStats(selectedProject.id).total} tarefas</p>
                    </div>
                    <div className="card p-4">
                      <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary">Em andamento</p>
                      <p className="text-xl font-black text-orange-400 mt-0.5">{projectTasks.filter(t => ['em_progresso', 'revisao_interna'].includes(t.status)).length}</p>
                      <p className="text-[11px] text-lumos-text-secondary">edição + revisão interna</p>
                    </div>
                    <div className="card p-4">
                      <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary">Com o cliente</p>
                      <p className="text-xl font-black text-amber-400 mt-0.5">{projectTasks.filter(t => t.status === 'revisao_cliente').length}</p>
                      <p className="text-[11px] text-lumos-text-secondary">aguardando retorno</p>
                    </div>
                    <div className="card p-4">
                      <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary">Ajustes</p>
                      <p className="text-xl font-black text-red-400 mt-0.5">{projectTasks.filter(t => t.status === 'alteracoes').length}</p>
                      <p className="text-[11px] text-lumos-text-secondary">pedidos de alteração</p>
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

                {/* Próximos prazos + atividade recente */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="card p-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-lumos-border">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-lumos-text-primary">Próximos prazos</h3>
                    </div>
                    {(() => {
                      const ups = projectTasks.filter(t => !isTaskDone(t) && t.data_fim).sort((a, b) => (a.data_fim!).localeCompare(b.data_fim!)).slice(0, 6);
                      const today = new Date().toISOString().slice(0, 10);
                      return ups.length === 0 ? (
                        <p className="px-4 py-6 text-xs text-lumos-text-secondary italic text-center">Nenhuma tarefa aberta com prazo definido.</p>
                      ) : ups.map(t => (
                        <button key={t.id} onClick={() => setSelectedTaskId(t.id)} className="w-full flex items-center gap-2.5 px-4 py-2.5 border-t border-lumos-border/40 first:border-t-0 hover:bg-lumos-text-secondary/5 text-left">
                          <span className={clsx('text-[10px] font-black w-14 flex-shrink-0', t.data_fim! < today ? 'text-red-400' : 'text-lumos-text-secondary')}>{fmtActDate(t.data_fim)}</span>
                          <span className={clsx('border rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider flex-shrink-0', getStatusDetails(t.status).color)}>{getStatusDetails(t.status).label}</span>
                          <span className="text-xs font-bold text-lumos-text-primary truncate">{t.titulo}</span>
                        </button>
                      ));
                    })()}
                  </div>
                  <div className="card p-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-lumos-border">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-lumos-text-primary">Atividade recente</h3>
                    </div>
                    {recentActivity.length === 0 ? (
                      <p className="px-4 py-6 text-xs text-lumos-text-secondary italic text-center">Sem atividade registrada ainda.</p>
                    ) : recentActivity.map((a: any) => (
                      <div key={a.id} className="flex items-start gap-2 px-4 py-2 border-t border-lumos-border/40 first:border-t-0 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-lumos-yellow mt-1.5 flex-shrink-0" />
                        <span className="text-lumos-text-secondary leading-snug min-w-0">
                          <b className="text-lumos-text-primary">{a.actor_name || 'Alguém'}</b> {describeActivity(a)}
                          {a.taskTitle && <> em <b className="text-lumos-text-primary/80">{a.taskTitle}</b></>}
                        </span>
                        <span className="text-[10px] text-lumos-text-secondary/70 flex-shrink-0 ml-auto">{new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ============ ANOTAÇÕES DO PROJETO (rich text + menções) ============ */}
                {/* key por projeto: remonta o editor ao trocar de projeto, evitando
                    que o autosave (closure) salve no projeto errado. */}
                <ProjectNotes key={selectedProject.id} projectId={selectedProject.id} canManage={canManage} />
                </div>
                )}

                {/* ================= ABA: TAREFAS ================= */}
                {projTab === 'tarefas' && (
                <div className="card p-5 md:p-6 space-y-4">

                  {/* Toolbar em linha única: busca + chips de filtro (estilo do mockup) */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[170px] max-w-md">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-lumos-text-secondary pointer-events-none" />
                      <input value={taskSearch} onChange={e => setTaskSearch(e.target.value)} placeholder="Buscar tarefa…" className="input-lumos w-full h-9 pl-9 text-xs" />
                    </div>
                    <div className="w-36 flex-shrink-0">
                      <Select value={taskStatusFilter} onChange={setTaskStatusFilter} ariaLabel="Filtrar por etapa" menuClassName="min-w-[160px]"
                        className={clsx('w-full h-9 px-3 rounded-lumos border bg-lumos-surface text-[11px] font-bold transition-colors',
                          taskStatusFilter !== 'all' ? 'border-lumos-yellow/60 text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/40')}
                        options={[{ value: 'all', label: 'Etapa: todas' }, ...STATUS_OPTIONS]} />
                    </div>
                    <div className="w-40 flex-shrink-0">
                      <Select value={taskAssigneeFilter} onChange={setTaskAssigneeFilter} ariaLabel="Filtrar por responsável" menuClassName="min-w-[190px]" searchable searchPlaceholder="Filtrar pessoa…"
                        className={clsx('w-full h-9 px-3 rounded-lumos border bg-lumos-surface text-[11px] font-bold transition-colors',
                          taskAssigneeFilter !== 'all' ? 'border-lumos-yellow/60 text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/40')}
                        options={[{ value: 'all', label: 'Responsável' }, { value: 'none', label: 'Sem responsável' }, ...teamUsers.map(u => ({ value: u.id, label: u.full_name })), ...freelancers.map(f => ({ value: f.id, label: `${f.full_name} (freela)` }))]} />
                    </div>
                    {allTags.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <TagPicker
                          allTags={allTags}
                          selectedIds={tagFilter}
                          addLabel={tagFilter.length ? `Tags · ${tagFilter.length}` : 'Tags'}
                          onToggle={(id) => setTagFilter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                        />
                        {tagFilter.length > 0 && <button onClick={() => setTagFilter([])} className="text-[9px] font-bold text-lumos-text-secondary hover:text-red-400 underline">limpar</button>}
                      </div>
                    )}
                    <button onClick={() => setOnlyMine(v => !v)}
                      className={clsx('h-9 px-3 rounded-lumos border text-[11px] font-bold transition-colors flex-shrink-0', onlyMine ? 'border-lumos-yellow/60 text-lumos-yellow bg-lumos-yellow/10' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/40')}>
                      Só minhas
                    </button>
                    {canManage && (
                      <button onClick={openTrash} className="h-9 px-3 rounded-lumos border border-lumos-border text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary flex items-center gap-1.5 ml-auto flex-shrink-0" title="Tarefas excluídas (recuperáveis por 30 dias)">
                        <Trash2 className="w-3.5 h-3.5" /> Lixeira
                        {trashCount > 0 && <span className="text-[9px] font-black bg-red-500/15 text-red-400 rounded-full px-1.5 py-0.5">{trashCount}</span>}
                      </button>
                    )}
                  </div>

                {/* Tab Content */}
                <div className="flex-1 min-h-[300px] flex flex-col">
                  {tasksLoading ? (
                    <div className="flex-grow flex items-center justify-center py-16">
                      <Loader2 className="w-8 h-8 animate-spin text-lumos-yellow" />
                    </div>
                  ) : (
                    /* ================= LIST VIEW (Ativas / Finalizadas) ================= */
                    <div className="space-y-4 flex-grow flex flex-col justify-between">

                      {projectTasks.length === 0 ? (
                        <div className="flex-grow border border-dashed border-lumos-border/50 rounded-lumos flex flex-col justify-center items-center text-center p-8 bg-lumos-bg/10 py-16">
                          <ClipboardList className="w-8 h-8 text-lumos-text-secondary opacity-30 mb-3" />
                          <h4 className="text-sm font-bold text-lumos-text-primary uppercase tracking-wider">Nenhuma tarefa</h4>
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
                        <>
                        {visibleTasks.length === 0 && (
                          <div className="text-center py-10 text-xs text-lumos-text-secondary/70">
                            {hasActiveFilters ? 'Nenhuma tarefa bate com a busca e os filtros.' : 'Tudo em dia por aqui, nenhuma tarefa ativa. 🎉'}
                          </div>
                        )}
                        {visibleTasks.length > 0 && (<>
                        <div className="overflow-x-auto hidden lg:block">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-lumos-border/40 text-lumos-text-secondary font-black uppercase tracking-wider text-[9px] opacity-70">
                                {canManage && (
                                  <th className="py-2.5 px-2 w-8 text-center">
                                    <input
                                      type="checkbox"
                                      checked={visibleTasks.length > 0 && visibleTasks.every(t => selTaskIds.has(t.id))}
                                      onChange={toggleSelAll}
                                      title="Selecionar todas"
                                      className="rounded border-lumos-border text-lumos-yellow focus:ring-lumos-yellow h-3.5 w-3.5 bg-lumos-bg cursor-pointer"
                                    />
                                  </th>
                                )}
                                <th className="py-2.5 px-2 min-w-[250px]">Título da Tarefa</th>
                                <th className="py-2.5 px-2 w-36">Status</th>
                                <th className="py-2.5 px-2 w-28">Prioridade</th>
                                <th className="py-2.5 px-2 w-44">Responsável</th>
                                <th className="py-2.5 px-2 w-32">Prazo edição</th>
                                {canSeeClientDeadline && <th className="py-2.5 px-2 w-32">Entrega cliente</th>}
                                <th className="py-2.5 px-2 w-16 text-center">Ações</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-lumos-border/20">
                              {taskGroups.map(group => (<React.Fragment key={group.status}>
                              {/* Cabeçalho do grupo (etapa do fluxo): barra + label coloridos */}
                              <tr className="bg-lumos-bg/40">
                                <td colSpan={6 + (canManage ? 1 : 0) + (canSeeClientDeadline ? 1 : 0)} className="pt-3 pb-2 px-2">
                                  <div className="flex items-center gap-2">
                                    <span className={clsx('w-1 h-3.5 rounded-full flex-shrink-0', stageTheme(group.status).bar)} />
                                    <span className={clsx('text-[10px] font-black uppercase tracking-widest', stageTheme(group.status).text)}>{getStatusDetails(group.status).label}</span>
                                    <span className="text-[10px] font-bold text-lumos-text-secondary/70">{group.tasks.length}</span>
                                  </div>
                                </td>
                              </tr>
                              {group.tasks.map((task) => {
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
                                      selTaskIds.has(task.id) && "bg-lumos-yellow/[0.05]",
                                      selectedTaskId === task.id && "bg-lumos-yellow/[0.03]"
                                    )}
                                  >
                                    {/* Batch select checkbox */}
                                    {canManage && (
                                      <td className="py-2 px-2 text-center">
                                        <input
                                          type="checkbox"
                                          checked={selTaskIds.has(task.id)}
                                          onChange={() => toggleSelTask(task.id)}
                                          onClick={(e) => e.stopPropagation()}
                                          className="rounded border-lumos-border text-lumos-yellow focus:ring-lumos-yellow h-3.5 w-3.5 bg-lumos-bg cursor-pointer"
                                        />
                                      </td>
                                    )}

                                    {/* Título, com o círculo de concluir à esquerda do nome */}
                                    <td className="py-2 px-2">
                                      <div className="flex items-start gap-2.5">
                                        <button
                                          type="button"
                                          disabled={!canManage}
                                          onClick={(e) => { e.stopPropagation(); handleUpdateTask(task.id, { status: isTaskCompleted ? 'na_fila' : 'concluido' }); }}
                                          title={isTaskCompleted ? 'Reabrir tarefa' : 'Concluir tarefa'}
                                          className={clsx(
                                            'mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors',
                                            isTaskCompleted ? 'bg-green-500 border-green-500 text-white' : 'border-lumos-border text-transparent hover:border-green-500 hover:text-green-500/60',
                                            !canManage && 'cursor-not-allowed opacity-40',
                                          )}
                                        >
                                          <Check className="w-3 h-3" />
                                        </button>
                                        <div
                                          className="min-w-0 flex-1 cursor-pointer"
                                          onClick={() => { if (renamingTaskId !== task.id) setSelectedTaskId(task.id); }}
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
                                      {(taskTags[task.id]?.length ?? 0) > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {(taskTags[task.id] || []).map(id => tagById(id)).filter(Boolean).sort((a, b) => a!.name.localeCompare(b!.name, 'pt-BR')).map(t => <TagChip key={t!.id} tag={t!} small />)}
                                        </div>
                                      )}
                                        </div>
                                      </div>
                                    </td>

                                    {/* Status Badge Dropdown */}
                                    <td className="py-2 px-2">
                                      <Select
                                        value={task.status}
                                        disabled={!canManage}
                                        onChange={(v) => handleUpdateTask(task.id, { status: v })}
                                        options={STATUS_OPTIONS}
                                        className={clsx(
                                          "border border-transparent rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider hover:border-lumos-border/40 max-w-[150px]",
                                          getStatusDetails(task.status).color
                                        )}
                                      />
                                    </td>

                                    {/* Priority Badge Dropdown */}
                                    <td className="py-2 px-2">
                                      <Select
                                        value={task.prioridade}
                                        disabled={!canManage}
                                        onChange={(v) => handleUpdateTask(task.id, { prioridade: v as any })}
                                        options={PRIORITY_OPTIONS}
                                        className={clsx(
                                          "border border-transparent rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider hover:border-lumos-border/40 max-w-[105px]",
                                          getPriorityTheme(task.prioridade)
                                        )}
                                      />
                                    </td>

                                    {/* Responsável (dono) + colaboradores */}
                                    <td className="py-2 px-2">
                                      <div className="flex items-center gap-1.5 min-w-[140px] border border-transparent hover:border-lumos-border/30 rounded px-1">
                                        <AssigneePicker
                                          value={assigneeOf(task)}
                                          disabled={!canManage}
                                          onChange={(v) => setAssignee(task.id, v)}
                                          className="text-[11px] font-medium text-lumos-text-primary py-0.5"
                                          users={teamUsers as any}
                                          freelancers={freelancers as PickableUser[]}
                                          onQuickAddFreela={quickAddFreela}
                                        />
                                        <TaskCollaborators
                                          value={taskCollabs[task.id] || []}
                                          onAdd={(uid) => addCollaborator(task.id, uid)}
                                          onRemove={(uid) => removeCollaborator(task.id, uid)}
                                          users={teamUsers as any}
                                          ownerId={task.responsavel_id}
                                          canManage={canManage}
                                        />
                                      </div>
                                    </td>

                                    {/* Date Picker End (Prazo de edição) */}
                                    <td className="py-2 px-2">
                                      <input
                                        type="date"
                                        value={task.data_fim || ''}
                                        disabled={!canManage}
                                        onChange={(e) => handleUpdateTask(task.id, { data_fim: e.target.value || null })}
                                        className="bg-transparent border border-transparent hover:border-lumos-border/30 rounded text-[10px] font-bold text-lumos-text-primary px-1.5 py-0.5 outline-none cursor-pointer focus:border-lumos-yellow w-full"
                                      />
                                    </td>

                                    {/* Entrega ao cliente (só admin/produção/atendimento) */}
                                    {canSeeClientDeadline && (
                                      <td className="py-2 px-2">
                                        <input
                                          type="date"
                                          value={task.data_entrega_cliente || ''}
                                          disabled={!canManage}
                                          onChange={(e) => handleUpdateTask(task.id, { data_entrega_cliente: e.target.value || null })}
                                          className="bg-transparent border border-transparent hover:border-lumos-border/30 rounded text-[10px] font-bold text-amber-600 dark:text-amber-400 px-1.5 py-0.5 outline-none cursor-pointer focus:border-lumos-yellow w-full"
                                        />
                                      </td>
                                    )}

                                    {/* Actions cell */}
                                    <td className="py-2 px-2 text-center">
                                      <div className="flex items-center justify-center">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                            setContextMenu({ x: Math.max(8, r.right - 150), y: r.bottom + 4, taskId: task.id });
                                          }}
                                          className="p-1 text-lumos-text-secondary hover:text-lumos-text-primary rounded hover:bg-lumos-border/20 transition-all"
                                          title="Ações da tarefa"
                                        >
                                          <MoreVertical className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                              </React.Fragment>))}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile: cartões de tarefa (a tabela acima fica só no desktop) */}
                        <div className="lg:hidden divide-y divide-lumos-border/40">
                          {taskGroups.map(group => (<React.Fragment key={group.status}>
                          <div className="pt-4 pb-1.5 flex items-center gap-2">
                            <span className={clsx('w-1 h-3.5 rounded-full flex-shrink-0', stageTheme(group.status).bar)} />
                            <span className={clsx('text-[10px] font-black uppercase tracking-widest', stageTheme(group.status).text)}>{getStatusDetails(group.status).label}</span>
                            <span className="text-[10px] font-bold text-lumos-text-secondary/70">{group.tasks.length}</span>
                          </div>
                          {group.tasks.map((task) => {
                            const isTaskCompleted = task.status === 'concluido' || task.status === 'entregue';
                            const tags = (taskTags[task.id] || []).map(id => tagById(id)).filter(Boolean).sort((a, b) => a!.name.localeCompare(b!.name, 'pt-BR'));
                            return (
                              <div
                                key={task.id}
                                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, taskId: task.id }); }}
                                className={clsx('py-3', selTaskIds.has(task.id) && 'bg-lumos-yellow/[0.05]')}
                              >
                                <div className="flex items-start gap-2.5">
                                  {canManage && (
                                    <input
                                      type="checkbox"
                                      checked={selTaskIds.has(task.id)}
                                      onChange={() => toggleSelTask(task.id)}
                                      className="mt-1 rounded border-lumos-border text-lumos-yellow focus:ring-lumos-yellow h-4 w-4 bg-lumos-bg cursor-pointer flex-shrink-0"
                                    />
                                  )}
                                  <button
                                    type="button"
                                    disabled={!canManage}
                                    onClick={() => handleUpdateTask(task.id, { status: isTaskCompleted ? 'na_fila' : 'concluido' })}
                                    className={clsx(
                                      'mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors',
                                      isTaskCompleted ? 'bg-green-500 border-green-500 text-white' : 'border-lumos-border text-transparent',
                                      !canManage && 'opacity-40'
                                    )}
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedTaskId(task.id)}
                                    className="min-w-0 flex-1 text-left"
                                  >
                                    <span className={clsx('font-semibold text-sm text-lumos-text-primary', isTaskCompleted && 'line-through text-lumos-text-secondary/50')}>
                                      {task.titulo}
                                    </span>
                                    {tags.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {tags.map(t => <TagChip key={t!.id} tag={t!} small />)}
                                      </div>
                                    )}
                                  </button>
                                  {canManage && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                        setContextMenu({ x: Math.max(8, r.right - 150), y: r.bottom + 4, taskId: task.id });
                                      }}
                                      className="p-1 text-lumos-text-secondary hover:text-lumos-text-primary rounded flex-shrink-0"
                                      title="Ações da tarefa"
                                    >
                                      <MoreVertical className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                                <div className="flex items-center flex-wrap gap-2 mt-2.5 pl-[30px]">
                                  <Select
                                    value={task.status}
                                    disabled={!canManage}
                                    onChange={(v) => handleUpdateTask(task.id, { status: v })}
                                    options={STATUS_OPTIONS}
                                    className={clsx('border border-transparent rounded px-1.5 py-1 text-[10px] font-black uppercase tracking-wider', getStatusDetails(task.status).color)}
                                  />
                                  <Select
                                    value={task.prioridade}
                                    disabled={!canManage}
                                    onChange={(v) => handleUpdateTask(task.id, { prioridade: v as any })}
                                    options={PRIORITY_OPTIONS}
                                    className={clsx('border border-transparent rounded px-1.5 py-1 text-[10px] font-black uppercase tracking-wider', getPriorityTheme(task.prioridade))}
                                  />
                                </div>
                                <div className="flex items-center justify-between gap-3 mt-2 pl-[30px]">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <AssigneePicker
                                      value={assigneeOf(task)}
                                      disabled={!canManage}
                                      onChange={(v) => setAssignee(task.id, v)}
                                      className="text-[11px] font-medium text-lumos-text-primary"
                                      users={teamUsers as any}
                                      freelancers={freelancers as PickableUser[]}
                                      onQuickAddFreela={quickAddFreela}
                                    />
                                    <TaskCollaborators
                                      value={taskCollabs[task.id] || []}
                                      onAdd={(uid) => addCollaborator(task.id, uid)}
                                      onRemove={(uid) => removeCollaborator(task.id, uid)}
                                      users={teamUsers as any}
                                      ownerId={task.responsavel_id}
                                      canManage={canManage}
                                    />
                                  </div>
                                  <input
                                    type="date"
                                    value={task.data_fim || ''}
                                    disabled={!canManage}
                                    onChange={(e) => handleUpdateTask(task.id, { data_fim: e.target.value || null })}
                                    className="bg-transparent border border-lumos-border/40 rounded text-[11px] font-bold text-lumos-text-primary px-2 py-1 outline-none cursor-pointer focus:border-lumos-yellow"
                                    title="Prazo de edição"
                                  />
                                </div>
                                {canSeeClientDeadline && (
                                  <div className="flex items-center justify-between gap-3 mt-2 pl-[30px]">
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Entrega cliente</span>
                                    <input
                                      type="date"
                                      value={task.data_entrega_cliente || ''}
                                      disabled={!canManage}
                                      onChange={(e) => handleUpdateTask(task.id, { data_entrega_cliente: e.target.value || null })}
                                      className="bg-transparent border border-lumos-border/40 rounded text-[11px] font-bold text-amber-600 dark:text-amber-400 px-2 py-1 outline-none cursor-pointer focus:border-lumos-yellow"
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          </React.Fragment>))}
                        </div>
                        </>)}

                        {/* Toggle do grupo Concluídas */}
                        {doneCount > 0 && (
                          <button onClick={() => setShowDone(v => !v)} className="self-start text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary underline underline-offset-2">
                            {showDone ? 'Ocultar concluídas' : `Mostrar concluídas (${doneCount})`}
                          </button>
                        )}
                        </>
                      )}

                      {/* Barra de ações em lote */}
                      {canManage && selTaskIds.size > 0 && (
                        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
                          <div className="bg-lumos-surface border border-lumos-yellow/30 shadow-2xl rounded-full px-5 py-3 flex items-center gap-4 backdrop-blur-xl">
                            <div className="flex items-center gap-2 pr-3 border-r border-lumos-border">
                              <span className="w-7 h-7 rounded-full bg-lumos-yellow/20 flex items-center justify-center font-black text-lumos-yellow text-xs">{selTaskIds.size}</span>
                              <span className="text-xs font-bold text-lumos-text-primary uppercase tracking-tight">{selTaskIds.size === 1 ? 'tarefa' : 'tarefas'}</span>
                            </div>
                            <Select value="" onChange={handleBatchStatus} placeholder="Mover status" ariaLabel="Mover status em lote" menuClassName="min-w-[150px]"
                              className="px-3 py-1.5 rounded-full bg-lumos-text-secondary/10 text-[10px] font-black uppercase text-lumos-text-primary hover:bg-lumos-text-secondary/20"
                              options={STATUS_OPTIONS} />
                            <Select value="" onChange={handleBatchAssign} placeholder="Atribuir" ariaLabel="Atribuir responsável em lote" menuClassName="min-w-[170px]" searchable searchPlaceholder="Filtrar pessoa…"
                              className="px-3 py-1.5 rounded-full bg-lumos-text-secondary/10 text-[10px] font-black uppercase text-lumos-text-primary hover:bg-lumos-text-secondary/20"
                              options={teamUsers.map(u => ({ value: u.id, label: u.full_name }))} />
                            <label className="relative px-3 py-1.5 rounded-full bg-lumos-text-secondary/10 text-[10px] font-black uppercase text-lumos-text-primary hover:bg-lumos-text-secondary/20 cursor-pointer" title="Mudar o prazo de edição">
                              Prazo
                              <input type="date" onChange={e => { if (e.target.value) handleBatchDue(e.target.value); e.target.value = ''; }} className="absolute inset-0 opacity-0 cursor-pointer" />
                            </label>
                            <button onClick={() => handleBatchStatus('concluido')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 text-green-500 font-black text-[10px] uppercase hover:bg-green-500 hover:text-white transition-all active:scale-95">
                              <Check className="w-3.5 h-3.5" /> Concluir
                            </button>
                            <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/10 text-red-500 font-black text-[10px] uppercase hover:bg-red-500 hover:text-white transition-all active:scale-95">
                              <Trash2 className="w-3.5 h-3.5" /> Excluir
                            </button>
                            <button onClick={() => setSelTaskIds(new Set())} className="text-[10px] font-bold uppercase text-lumos-text-secondary hover:text-lumos-text-primary transition-colors">Cancelar</button>
                          </div>
                        </div>
                      )}

                      {/* Quick Add Row */}
                      {canManage && (
                        <form onSubmit={handleQuickAddTask} className="flex items-center gap-3 pt-3 border-t border-lumos-border/40 mt-2">
                          <input
                            ref={quickAddInputRef}
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
                  )}
                </div>

                </div>
                )}

                {/* ================= ABA: ENTREGAS (revisão de vídeo) ================= */}
                {projTab === 'entregas' && (
                  <VideoReviewPanel projectId={selectedProject.id} tasks={projectTasks} />
                )}

                {/* ================= ABA: ARQUIVOS (documentos) ================= */}
                {projTab === 'arquivos' && (
                  <ProjectDocuments
                    projectId={selectedProject.id}
                    driveFolderId={selectedProject.drive_folder_id}
                    canManage={canManage}
                  />
                )}

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
                                  title="Abrir Ordem de Serviço (PDF)"
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
                      Selecione um Projeto
                    </h3>
                    <p className="text-xs text-lumos-text-secondary leading-relaxed">
                      Escolha um projeto na árvore de <b>Projetos</b> na barra lateral para ver as tarefas e a revisão de vídeo, ou clique em <b>Criar Projeto</b> pra cadastrar um novo.
                    </p>
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>
      )}

      {/* ================= MODAL CENTRAL: DETALHES DA TAREFA (STYLE CLICKUP) ================= */}
      {selectedTaskId && selectedTask && createPortal(
        <>
          {/* Backdrop Overlay */}
          <div
            onClick={requestCloseTask}
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
              
              <div className="flex items-center gap-2">
                {canManage && descDirty && (
                  <button
                    onClick={handleSaveDescription}
                    disabled={isSavingDesc}
                    className="text-[11px] font-black uppercase tracking-wider bg-lumos-yellow text-black px-3 py-1.5 rounded-lumos hover:bg-yellow-400 disabled:opacity-50 transition-all flex items-center gap-1.5"
                  >
                    {isSavingDesc ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Salvando…</>
                    ) : (
                      'Salvar'
                    )}
                  </button>
                )}
                <button
                  onClick={requestCloseTask}
                  className="p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow transition-all"
                  title="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
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
                    <Select
                      value={selectedTask.status}
                      disabled={!canManage}
                      onChange={(v) => handleUpdateTask(selectedTask.id, { status: v })}
                      options={STATUS_OPTIONS}
                      className={clsx(
                        "border border-lumos-border/40 rounded px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider w-full",
                        getStatusDetails(selectedTask.status).color
                      )}
                    />
                  </div>

                  {/* Priority */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-wider block">Prioridade</span>
                    <Select
                      value={selectedTask.prioridade}
                      disabled={!canManage}
                      onChange={(v) => handleUpdateTask(selectedTask.id, { prioridade: v as any })}
                      options={PRIORITY_OPTIONS}
                      className={clsx(
                        "border border-lumos-border/40 rounded px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider w-full",
                        getPriorityTheme(selectedTask.prioridade)
                      )}
                    />
                  </div>

                  {/* Responsável — busca por nome com foto + status */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-wider block">Responsável</span>
                    <div className="flex items-center gap-1.5 border border-lumos-border/40 rounded px-2.5 py-1.5">
                      <AssigneePicker
                        value={assigneeOf(selectedTask)}
                        disabled={!canManage}
                        onChange={(v) => setAssignee(selectedTask.id, v)}
                        className="text-[11px] font-medium text-lumos-text-primary py-0.5"
                        users={teamUsers as any}
                        freelancers={freelancers as PickableUser[]}
                        onQuickAddFreela={quickAddFreela}
                      />
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

                {/* Quem mais está na tarefa (colaboradores) */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                    Também na tarefa
                    <span className="normal-case tracking-normal font-bold text-lumos-text-secondary/60 ml-1.5">além do responsável</span>
                  </span>
                  <TaskCollaborators
                    value={taskCollabs[selectedTask.id] || []}
                    onAdd={(uid) => addCollaborator(selectedTask.id, uid)}
                    onRemove={(uid) => removeCollaborator(selectedTask.id, uid)}
                    users={teamUsers as any}
                    ownerId={selectedTask.responsavel_id}
                    canManage={canManage}
                    variant="full"
                  />
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-wider block">Tags</span>
                  <TagPicker
                    allTags={allTags}
                    selectedIds={taskTags[selectedTask.id] || []}
                    onToggle={(tagId) => toggleTaskTag(selectedTask.id, tagId)}
                    disabled={!canManage}
                  />
                </div>

                {/* Revisão de vídeo vinculada a esta tarefa (ver status/comentários e vincular) */}
                <TaskVideoReview
                  projectId={selectedTask.project_id}
                  task={{ id: selectedTask.id, status: selectedTask.status }}
                  canManage={canManage}
                />

                {/* Description */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-widest">
                      Descrição da Tarefa
                    </span>
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
                <div className="flex items-center gap-1 pb-3 border-b border-lumos-border/50 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setRightTab('comments')}
                    className={clsx(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all",
                      rightTab === 'comments'
                        ? "bg-lumos-yellow/15 text-lumos-yellow"
                        : "text-lumos-text-secondary hover:text-lumos-text-primary"
                    )}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Comentários
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab('activity')}
                    className={clsx(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all",
                      rightTab === 'activity'
                        ? "bg-lumos-yellow/15 text-lumos-yellow"
                        : "text-lumos-text-secondary hover:text-lumos-text-primary"
                    )}
                  >
                    <History className="w-3.5 h-3.5" />
                    Atividade
                  </button>
                </div>

                {/* Timeline de atividade (estilo ClickUp) */}
                {rightTab === 'activity' && (
                  <div className="flex-grow overflow-y-auto custom-scrollbar py-4 min-h-0 text-xs">
                    {activityLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" />
                      </div>
                    ) : activity.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center text-lumos-text-secondary/50">
                        <History className="w-6 h-6 mb-2 opacity-20" />
                        <p className="text-[10px] font-bold uppercase tracking-wider">Sem atividade ainda</p>
                        <p className="text-[9px] mt-0.5">As ações na tarefa aparecem aqui.</p>
                      </div>
                    ) : (
                      <ul className="space-y-3">
                        {activity.map((a) => (
                          <li key={a.id} className="flex items-start gap-2.5">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-lumos-yellow/60 flex-shrink-0" />
                            <div className="min-w-0 flex-grow">
                              <p className="text-[11px] text-lumos-text-primary leading-snug break-words">
                                <span className="font-bold">{a.actor_name || 'Alguém'}</span>{' '}
                                <span className="text-lumos-text-secondary">{describeActivity(a)}</span>
                              </p>
                              <p className="text-[9px] text-lumos-text-secondary/60 mt-0.5">
                                {formatCommentDate(a.created_at)}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Scrollable comments list with highlights */}
                {rightTab === 'comments' && (
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
                              <UserAvatar
                                user={{ id: comment.user?.id || comment.user_id, full_name: comment.user?.full_name, avatar_url: comment.user?.avatar_url }}
                                size={24}
                                showStatus
                              />
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
                )}

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
                {rightTab === 'comments' && profile && (
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
        </>,
        document.body,
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
              setSelectedTaskId(contextMenu.taskId);
              setContextMenu(null);
            }}
            className="px-3 py-1.5 text-[11px] font-semibold text-left text-lumos-text-primary hover:bg-lumos-bg rounded transition-all flex items-center gap-1.5"
          >
            <ChevronRight className="w-3.5 h-3.5 text-lumos-yellow" />
            Ver detalhes
          </button>
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

      {/* ================= LIXEIRA (tarefas excluídas) ================= */}
      {showTrash && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setShowTrash(false)}>
          <div className="w-full max-w-lg bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-6 space-y-4 text-lumos-text-primary max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-lumos-border">
              <h3 className="text-lg font-black uppercase tracking-tight text-lumos-yellow flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Lixeira
              </h3>
              <button onClick={() => setShowTrash(false)} className="text-lumos-text-secondary hover:text-lumos-text-primary"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-[11px] text-lumos-text-secondary">
              Tarefas excluídas ficam aqui por <span className="font-bold text-lumos-text-primary">30 dias</span> e depois são apagadas de vez. Clique em restaurar para trazer de volta.
            </p>
            <div className="flex-1 overflow-y-auto custom-scrollbar -mx-1 px-1">
              {trashLoading ? (
                <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" /></div>
              ) : trashedTasks.length === 0 ? (
                <div className="text-center py-10 text-xs text-lumos-text-secondary/70">A lixeira está vazia.</div>
              ) : (
                <div className="divide-y divide-lumos-border/40">
                  {trashedTasks.map(t => (
                    <div key={t.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-lumos-text-primary truncate">{t.titulo}</p>
                        <p className="text-[10px] text-lumos-text-secondary">
                          Excluída {t.deleted_at ? fmtActDate(t.deleted_at) : ''} · apaga de vez em {daysUntilPurge(t.deleted_at)} dia(s)
                        </p>
                      </div>
                      <button
                        onClick={() => restoreTask(t.id)}
                        className="btn-secondary text-[11px] py-1 px-2.5 flex items-center gap-1.5 flex-shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-green-400" /> Restaurar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
                  <Select
                    value={newProjClient}
                    onChange={setNewProjClient}
                    placeholder="Selecione um Cliente"
                    className="input-lumos w-full h-11 text-xs font-semibold"
                    menuClassName="max-h-72"
                    options={clients.map(c => ({ value: c.id, label: c.name }))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                    Segmento *
                  </label>
                  <Select
                    value={newProjCategory}
                    onChange={v => setNewProjCategory(v as any)}
                    className="input-lumos w-full h-11 text-xs font-semibold"
                    options={[{ value: 'digital', label: 'Digital' }, { value: 'filme', label: 'Filme' }, { value: 'live', label: 'Live' }]}
                  />
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

      {confirmDialog}
    </div>
  );
}
