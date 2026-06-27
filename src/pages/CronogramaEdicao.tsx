import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import { 
  Users, 
  Plus, 
  Edit2, 
  Trash2, 
  Calendar, 
  Clock, 
  AlertTriangle, 
  FileText, 
  UserPlus, 
  Search, 
  Sparkles,
  Link2,
  CheckCircle,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Inbox
} from 'lucide-react';
import { format, isPast, isToday, addDays, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isSameDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import {
  DndContext,
  useSensor,
  useSensors,
  PointerSensor,
  DragEndEvent,
  useDraggable,
  useDroppable
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

interface Editor {
  id: string;
  nome: string;
  tipo: 'interno' | 'freelancer';
  auth_user_id: string | null;
  status: 'ativo' | 'inativo';
  created_at: string;
}

interface UserProfile {
  auth_user_id: string;
  full_name: string;
  email: string;
}

interface Project {
  id: string;
  name: string;
  code: string | null;
  client_id: string | null;
  clients?: {
    id: string;
    name: string;
  } | null;
}

interface Edicao {
  id: string;
  titulo: string;
  project_id: string | null;
  editor_id: string | null;
  semana_inicio: string | null;
  prazo: string;
  status: 'nao_iniciado' | 'em_andamento' | 'revisao_interna' | 'aprovacao_cliente' | 'concluido';
  prioridade: 'baixa' | 'media' | 'alta';
  observacoes: string | null;
  created_by: string | null;
  created_at: string;
  formato: string | null;
  duracao: string | null;
  legenda: boolean | null;
  link_editado: string | null;
  link_referencia: string | null;
  link_roteiro: string | null;
  link_brutos: string | null;
  link_artes: string | null;
  projects?: Project | null;
  editores?: {
    id: string;
    nome: string;
  } | null;
}

interface DraggableCardProps {
  task: Edicao;
  canManage: boolean;
  onOpenBriefing: (task: Edicao) => void;
  getPriorityBadge: (prio: Edicao['prioridade']) => string;
  getStatusLabel: (st: Edicao['status']) => string;
  formatDeadline: (dateStr: string) => React.ReactNode;
  showActions?: boolean;
  onEdit?: (task: Edicao) => void;
  onDelete?: (id: string) => void;
}

function DraggableCard({ 
  task, 
  canManage, 
  onOpenBriefing, 
  getPriorityBadge, 
  getStatusLabel, 
  formatDeadline,
  showActions = false,
  onEdit,
  onDelete
}: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !canManage,
  });

  const style = transform ? {
    transform: CSS.Transform.toString(transform),
  } : undefined;

  const isTaskConcluida = task.status === 'concluido';
  const isOverdue = !isTaskConcluida && isPast(parseISO(task.prazo)) && !isToday(parseISO(task.prazo));

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(canManage ? attributes : {})}
      {...(canManage ? listeners : {})}
      onClick={() => onOpenBriefing(task)}
      className={clsx(
        "text-left w-full p-2.5 rounded border transition-all select-none relative group/card hover:shadow-lg hover:scale-[1.02]",
        canManage ? "cursor-grab active:cursor-grabbing touch-none animate-none" : "cursor-pointer",
        isDragging ? "opacity-45 scale-95 shadow-none border-dashed border-amber-500/50 dark:border-lumos-yellow/50 bg-lumos-surface/40 z-50 pointer-events-none" : "",
        !isDragging && (
          isTaskConcluida 
            ? "bg-green-500/5 hover:bg-green-500/10 border-green-500/30 hover:border-green-500/50" 
            : task.status === 'aprovacao_cliente'
            ? "bg-purple-500/5 hover:bg-purple-500/10 border-purple-500/30 hover:border-purple-500/50"
            : task.status === 'revisao_interna'
            ? "bg-orange-500/5 hover:bg-orange-500/10 border-orange-500/30 hover:border-orange-500/50"
            : task.status === 'em_andamento'
            ? "bg-blue-500/5 hover:bg-blue-500/10 border-blue-500/30 hover:border-blue-500/50"
            : "bg-lumos-surface hover:bg-lumos-surface/90 border-lumos-border hover:border-amber-500/30 dark:hover:border-lumos-yellow/30"
        ),
        isOverdue && "border-red-500/40 bg-red-500/[0.02] hover:bg-red-500/[0.05]"
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {isOverdue && (
            <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-500 flex-shrink-0 animate-pulse" />
          )}
          <span className={clsx(
            "text-[10px] font-black leading-tight tracking-tight block break-words truncate",
            isTaskConcluida ? "text-green-600 dark:text-green-400 line-through opacity-85" : "text-lumos-text-primary"
          )}>
            {task.titulo}
          </span>
        </div>
        
        {showActions && canManage && (
          <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (onEdit) onEdit(task);
              }}
              className="p-1 text-lumos-text-secondary hover:text-amber-600 dark:hover:text-lumos-yellow hover:bg-amber-500/10 dark:hover:bg-lumos-yellow/10 rounded transition-colors cursor-pointer"
              title="Editar Edição"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (onDelete) onDelete(task.id);
              }}
              className="p-1 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded transition-colors cursor-pointer"
              title="Excluir Edição"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {isTaskConcluida && !showActions && (
          <CheckCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
        )}
      </div>

      {task.projects && (
        <div className="text-[9px] text-lumos-text-secondary mt-1 font-semibold truncate">
          {task.projects.code ? `#${task.projects.code} ` : ''}
          {task.projects.name}
          {task.projects.clients ? ` (${task.projects.clients.name})` : ''}
        </div>
      )}

      {showActions && task.observacoes && (
        <p className="text-[10px] text-lumos-text-secondary italic leading-relaxed border-l-2 border-lumos-border pl-2 mt-2 truncate max-w-full">
          "{task.observacoes}"
        </p>
      )}

      <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-lumos-border">
        {showActions ? (
          <div className="flex items-center justify-between">
            {formatDeadline(task.prazo)}
            <span className={clsx(
              "text-[8px] px-1.5 py-0.2 rounded font-black uppercase tracking-wide",
              getPriorityBadge(task.prioridade)
            )}>
              {task.prioridade}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1">
            <span className={clsx(
              "text-[8px] px-1 py-0.2 rounded font-black uppercase tracking-wide",
              getPriorityBadge(task.prioridade)
            )}>
              {task.prioridade}
            </span>
            <span className={clsx(
              "text-[8px] font-bold",
              isTaskConcluida ? "text-green-600 dark:text-green-400" : "text-lumos-text-secondary"
            )}>
              {getStatusLabel(task.status)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface DroppableCellProps {
  id: string;
  className?: string;
  children: React.ReactNode;
  canManage: boolean;
}

function DroppableCell({ id, className, children, canManage }: DroppableCellProps) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    disabled: !canManage,
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        className,
        isOver && "bg-amber-500/10 dark:bg-lumos-yellow/10 border-2 border-dashed border-amber-500/50 dark:border-lumos-yellow/50 rounded-lumos scale-[0.99] transition-all"
      )}
    >
      {children}
    </div>
  );
}

export default function CronogramaEdicao() {
  const { user, profile } = useAuth();
  const toast = useToast();

  // Permissão de escrita (Gestão)
  const canManage = profile?.role === 'admin' || profile?.role === 'producao';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!canManage) return;

    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    const task = edicoes.find(e => e.id === taskId);
    if (!task) return;

    const previousEdicoes = [...edicoes];
    let updatedPayload: any = {};

    if (overId === 'droppable-backlog') {
      if (!task.editor_id || !task.semana_inicio) return;
      updatedPayload = {
        editor_id: null,
        semana_inicio: null,
      };
    } else if (overId.startsWith('cell__')) {
      const parts = overId.split('__');
      const newEditorId = parts[1];
      const newPrazo = parts[2];
      
      const targetDate = parseISO(newPrazo);
      const targetWeekStart = startOfWeek(targetDate, { weekStartsOn: 1 });
      const newSemanaInicio = format(targetWeekStart, 'yyyy-MM-dd');

      if (
        task.editor_id === newEditorId &&
        task.prazo === newPrazo &&
        task.semana_inicio === newSemanaInicio
      ) {
        return;
      }

      updatedPayload = {
        editor_id: newEditorId,
        prazo: newPrazo,
        semana_inicio: newSemanaInicio,
      };
    } else {
      return;
    }

    try {
      // 1. Atualização Otimista
      setEdicoes(prev => 
        prev.map(e => 
          e.id === taskId 
            ? { 
                ...e, 
                ...updatedPayload, 
                editores: updatedPayload.editor_id 
                  ? editores.find(ed => ed.id === updatedPayload.editor_id) || null
                  : null
              } 
            : e
        )
      );

      // 2. Persistência
      const { error } = await supabase
        .from('edicoes_cronograma')
        .update(updatedPayload)
        .eq('id', taskId);

      if (error) throw error;
      toast.success('Cronograma atualizado com sucesso!');
      
      // Sincroniza em background
      fetchData();
    } catch (err: any) {
      console.error('Error handling drag end:', err);
      toast.error('Erro ao mover a tarefa no banco de dados. Revertendo...');
      setEdicoes(previousEdicoes);
    }
  };

  // Estados de Dados
  const [editores, setEditores] = useState<Editor[]>([]);
  const [edicoes, setEdicoes] = useState<Edicao[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [searchBacklog, setSearchBacklog] = useState('');

  // Modais de Cadastro de Editores
  const [isEditorListOpen, setIsEditorListOpen] = useState(false);
  const [isEditorFormOpen, setIsEditorFormOpen] = useState(false);
  const [selectedEditor, setSelectedEditor] = useState<Editor | null>(null);
  const [editorFormData, setEditorFormData] = useState({
    nome: '',
    tipo: 'interno' as 'interno' | 'freelancer',
    auth_user_id: '',
    status: 'ativo' as 'ativo' | 'inativo'
  });

  // Modais de Cadastro de Tarefas (Edições)
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Edicao | null>(null);
  const [taskFormData, setTaskFormData] = useState({
    titulo: '',
    project_id: '',
    editor_id: '',
    semana_inicio: '',
    prazo: '',
    status: 'nao_iniciado' as Edicao['status'],
    prioridade: 'media' as Edicao['prioridade'],
    observacoes: '',
    formato: '',
    duracao: '',
    legenda: false,
    link_editado: '',
    link_referencia: '',
    link_roteiro: '',
    link_brutos: '',
    link_artes: ''
  });

  // Controle de Semana Ativa
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => {
    return startOfWeek(new Date(), { weekStartsOn: 1 }); // 1 = Segunda-feira
  });

  // Modal de Briefing e Entrega (Visualização / Editor)
  const [isBriefingModalOpen, setIsBriefingModalOpen] = useState(false);
  const [briefingTask, setBriefingTask] = useState<Edicao | null>(null);
  const [briefingFormData, setBriefingFormData] = useState({
    status: 'nao_iniciado' as Edicao['status'],
    observacoes: '',
    link_editado: ''
  });

  // Busca o editor associado ao usuário atual (caso seja da role editor)
  const currentEditor = editores.find(ed => ed.auth_user_id === user?.id);
  
  // Permissão para salvar entrega
  const canEditDelivery = canManage || (profile?.role === 'editor' && briefingTask?.editor_id === currentEditor?.id);

  // 1. CARREGAR DADOS
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Buscar Editores
      const { data: dataEditores, error: errEditores } = await supabase
        .from('editores')
        .select('*')
        .order('nome', { ascending: true });
      if (errEditores) throw errEditores;
      setEditores(dataEditores || []);

      // Buscar Edições (Puxamos todas, filtramos backlog no frontend)
      const { data: dataEdicoes, error: errEdicoes } = await supabase
        .from('edicoes_cronograma')
        .select('*, projects(id, name, code, client_id, clients(id, name)), editores(id, nome)')
        .order('prazo', { ascending: true });
      if (errEdicoes) throw errEdicoes;
      
      // Mapear retorno para corresponder à interface
      const mappedEdicoes = (dataEdicoes || []).map((e: any) => ({
        ...e,
        projects: e.projects ? {
          id: e.projects.id,
          name: e.projects.name,
          code: e.projects.code,
          client_id: e.projects.client_id,
          clients: Array.isArray(e.projects.clients) ? e.projects.clients[0] : (e.projects.clients || null)
        } : null
      }));
      setEdicoes(mappedEdicoes);

      // Se gestor, carrega usuários do sistema e projetos para os seletores
      if (canManage) {
        const { data: dataUsers, error: errUsers } = await supabase
          .from('app_users')
          .select('auth_user_id, full_name, email')
          .eq('status', 'ativo')
          .order('full_name', { ascending: true });
        if (errUsers) throw errUsers;
        setUsers(dataUsers || []);

        const { data: dataProjects, error: errProjects } = await supabase
          .from('projects')
          .select('id, name, code, client_id, clients(id, name)')
          .order('created_at', { ascending: false });
        if (errProjects) throw errProjects;

        const mappedProjects = (dataProjects || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          client_id: p.client_id,
          clients: Array.isArray(p.clients) ? p.clients[0] : (p.clients || null)
        }));
        setProjects(mappedProjects);
      }
    } catch (err: any) {
      console.error('Error fetching cronograma data:', err);
      toast.error('Não foi possível carregar os dados do cronograma.');
    } finally {
      setLoading(false);
    }
  }, [canManage, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 2. SUBMIT EDITOR (Criar / Editar)
  const handleEditorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    try {
      const payload = {
        nome: editorFormData.nome,
        tipo: editorFormData.tipo,
        auth_user_id: editorFormData.tipo === 'interno' && editorFormData.auth_user_id ? editorFormData.auth_user_id : null,
        status: editorFormData.status
      };

      if (selectedEditor) {
        const { error } = await supabase
          .from('editores')
          .update(payload)
          .eq('id', selectedEditor.id);
        if (error) throw error;
        toast.success('Editor atualizado com sucesso!');
      } else {
        const { error } = await supabase
          .from('editores')
          .insert([payload]);
        if (error) throw error;
        toast.success('Editor cadastrado com sucesso!');
      }

      setIsEditorFormOpen(false);
      setSelectedEditor(null);
      fetchData();
    } catch (err: any) {
      console.error('Error saving editor:', err);
      toast.error('Erro ao salvar o editor. Verifique se o usuário já está associado.');
    }
  };

  // Abrir Formulário de Editor
  const openEditorForm = (editor: Editor | null = null) => {
    if (editor) {
      setSelectedEditor(editor);
      setEditorFormData({
        nome: editor.nome,
        tipo: editor.tipo,
        auth_user_id: editor.auth_user_id || '',
        status: editor.status
      });
    } else {
      setSelectedEditor(null);
      setEditorFormData({
        nome: '',
        tipo: 'interno',
        auth_user_id: '',
        status: 'ativo'
      });
    }
    setIsEditorFormOpen(true);
  };

  // 3. SUBMIT TAREFA / EDIÇÃO (Criar / Editar)
  const handleTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    try {
      const payload = {
        titulo: taskFormData.titulo,
        project_id: taskFormData.project_id || null,
        editor_id: taskFormData.editor_id || null,
        semana_inicio: taskFormData.semana_inicio || null,
        prazo: taskFormData.prazo,
        status: taskFormData.status,
        prioridade: taskFormData.prioridade,
        observacoes: taskFormData.observacoes || null,
        formato: taskFormData.formato || null,
        duracao: taskFormData.duracao || null,
        legenda: taskFormData.legenda,
        link_editado: taskFormData.link_editado || null,
        link_referencia: taskFormData.link_referencia || null,
        link_roteiro: taskFormData.link_roteiro || null,
        link_brutos: taskFormData.link_brutos || null,
        link_artes: taskFormData.link_artes || null,
        ...(selectedTask ? {} : { created_by: user?.id })
      };

      if (selectedTask) {
        const { error } = await supabase
          .from('edicoes_cronograma')
          .update(payload)
          .eq('id', selectedTask.id);
        if (error) throw error;
        toast.success('Edição de cronograma atualizada!');
      } else {
        const { error } = await supabase
          .from('edicoes_cronograma')
          .insert([payload]);
        if (error) throw error;
        toast.success('Edição de cronograma criada!');
      }

      setIsTaskFormOpen(false);
      setSelectedTask(null);
      fetchData();
    } catch (err: any) {
      console.error('Error saving task:', err);
      toast.error('Erro ao salvar a tarefa de edição.');
    }
  };

  // Abrir Formulário de Edição
  const openTaskForm = (task: Edicao | null = null) => {
    if (task) {
      setSelectedTask(task);
      setTaskFormData({
        titulo: task.titulo,
        project_id: task.project_id || '',
        editor_id: task.editor_id || '',
        semana_inicio: task.semana_inicio || '',
        prazo: task.prazo,
        status: task.status,
        prioridade: task.prioridade,
        observacoes: task.observacoes || '',
        formato: task.formato || '',
        duracao: task.duracao || '',
        legenda: task.legenda === null ? false : task.legenda,
        link_editado: task.link_editado || '',
        link_referencia: task.link_referencia || '',
        link_roteiro: task.link_roteiro || '',
        link_brutos: task.link_brutos || '',
        link_artes: task.link_artes || ''
      });
    } else {
      setSelectedTask(null);
      setTaskFormData({
        titulo: '',
        project_id: '',
        editor_id: '',
        semana_inicio: '',
        prazo: '',
        status: 'nao_iniciado',
        prioridade: 'media',
        observacoes: '',
        formato: '',
        duracao: '',
        legenda: false,
        link_editado: '',
        link_referencia: '',
        link_roteiro: '',
        link_brutos: '',
        link_artes: ''
      });
    }
    setIsTaskFormOpen(true);
  };

  // Excluir Edição
  const handleTaskDelete = async (id: string) => {
    if (!canManage) return;
    if (!window.confirm('Tem certeza que deseja excluir esta edição?')) return;

    try {
      const { error } = await supabase
        .from('edicoes_cronograma')
        .delete()
        .eq('id', id);
      if (error) throw error;
      toast.success('Edição excluída com sucesso.');
      fetchData();
    } catch (err: any) {
      console.error('Error deleting task:', err);
      toast.error('Não foi possível excluir a tarefa.');
    }
  };

  // Abrir Modal de Briefing & Entrega (Editor / Visualização)
  const openBriefingModal = (task: Edicao) => {
    setBriefingTask(task);
    setBriefingFormData({
      status: task.status,
      observacoes: task.observacoes || '',
      link_editado: task.link_editado || ''
    });
    setIsBriefingModalOpen(true);
  };

  // Submit da Entrega / Status no Modal de Briefing
  const handleBriefingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!briefingTask) return;

    try {
      const payload = {
        status: briefingFormData.status,
        observacoes: briefingFormData.observacoes || null,
        link_editado: briefingFormData.link_editado || null
      };

      const { error } = await supabase
        .from('edicoes_cronograma')
        .update(payload)
        .eq('id', briefingTask.id);

      if (error) throw error;
      toast.success('Edição atualizada com sucesso!');
      setIsBriefingModalOpen(false);
      setBriefingTask(null);
      fetchData();
    } catch (err: any) {
      console.error('Error saving briefing/delivery update:', err);
      toast.error('Erro ao atualizar a entrega da edição.');
    }
  };

  // Alternar do modal de briefing para o modal completo de edição (admin/producao)
  const handleEditFromBriefing = () => {
    if (!briefingTask) return;
    const taskToEdit = briefingTask;
    setIsBriefingModalOpen(false);
    setBriefingTask(null);
    openTaskForm(taskToEdit);
  };

  // Filtragem e Agrupamento do Backlog (Gaveta/Coluna)
  // Itens em Espera = editor_id IS NULL OR semana_inicio IS NULL
  const backlogEditions = edicoes.filter(e => {
    const isBacklog = !e.editor_id || !e.semana_inicio;
    if (!isBacklog) return false;
    if (searchBacklog.trim() === '') return true;
    
    const search = searchBacklog.toLowerCase();
    const matchesTitle = e.titulo.toLowerCase().includes(search);
    const matchesProject = e.projects?.name.toLowerCase().includes(search) || false;
    const matchesClient = e.projects?.clients?.name.toLowerCase().includes(search) || false;
    
    return matchesTitle || matchesProject || matchesClient;
  });

  // Auxiliares de Visualização
  const getPriorityBadge = (prio: Edicao['prioridade']) => {
    switch (prio) {
      case 'alta':
        return 'bg-red-500/10 text-red-600 dark:text-red-500 border border-red-500/20';
      case 'baixa':
        return 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20';
      case 'media':
      default:
        return 'bg-amber-500/10 dark:bg-yellow-500/10 text-amber-600 dark:text-lumos-yellow border border-amber-500/20 dark:border-lumos-yellow/20';
    }
  };

  const getStatusLabel = (st: Edicao['status']) => {
    switch (st) {
      case 'nao_iniciado': return 'Fila';
      case 'em_andamento': return 'Editando';
      case 'revisao_interna': return 'Rev. Interna';
      case 'aprovacao_cliente': return 'Rev. Cliente';
      case 'concluido': return 'Aprovado';
      default: return st;
    }
  };

  const getStatusColor = (st: Edicao['status']) => {
    switch (st) {
      case 'concluido': return 'text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20';
      case 'aprovacao_cliente': return 'text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20';
      case 'revisao_interna': return 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/20';
      case 'em_andamento': return 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'nao_iniciado':
      default:
        return 'text-lumos-text-secondary bg-lumos-text-secondary/10 border-lumos-border';
    }
  };

  const formatDeadline = (dateStr: string) => {
    const d = new Date(dateStr);
    const formatted = format(d, "dd 'de' MMM", { locale: ptBR });
    
    let isUrgent = isPast(d) || isToday(d);
    let isWarning = !isUrgent && isPast(addDays(new Date(), -2)); // Próximos 2 dias

    return (
      <span className={clsx(
        "flex items-center gap-1.5 text-xs font-bold",
        isUrgent ? "text-red-600 dark:text-red-500" : isWarning ? "text-orange-600 dark:text-orange-400" : "text-lumos-text-secondary"
      )}>
        <Clock className="w-3.5 h-3.5" />
        Prazo: {formatted}
        {isUrgent && <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-500 animate-pulse" />}
      </span>
    );
  };

  // Seletor de Projeto Handler: Autopreencher título da tarefa
  const handleProjectChange = (projId: string) => {
    setTaskFormData(prev => {
      const selected = projects.find(p => p.id === projId);
      if (selected && prev.titulo.trim() === '') {
        const clientName = selected.clients?.name ? ` [${selected.clients.name}]` : '';
        return {
          ...prev,
          project_id: projId,
          titulo: `Edição - ${selected.name}${clientName}`
        };
      }
      return { ...prev, project_id: projId };
    });
  };

  // Dias da Semana visualizada baseados na currentWeekStart
  const weekDays = eachDayOfInterval({
    start: currentWeekStart,
    end: endOfWeek(currentWeekStart, { weekStartsOn: 1 })
  });

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
  const formatWeekPeriod = () => {
    const startStr = format(currentWeekStart, "dd 'de' MMM", { locale: ptBR });
    const endStr = format(weekEnd, "dd 'de' MMM", { locale: ptBR });
    const yearStr = format(currentWeekStart, "yyyy");
    return `Semana de ${startStr} a ${endStr} de ${yearStr}`;
  };

  // Filtragem de edições pertencentes à grade do cronograma (que têm editor_id e semana_inicio)
  const cronogramaEdicoes = edicoes.filter(e => e.editor_id && e.semana_inicio);

  const isEdicaoOnDay = (ed: Edicao, day: Date) => {
    if (!ed.prazo) return false;
    const taskDate = parseISO(ed.prazo);
    return isSameDay(taskDate, day);
  };

  if (loading && edicoes.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-lumos-yellow"></div>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="p-4 lg:p-8 space-y-6 text-lumos-text-primary max-w-7xl mx-auto font-work-sans">
      
      {/* CABEÇALHO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-lumos-border pb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black tracking-tight text-lumos-text-primary flex items-center gap-3">
            <Calendar className="w-8 h-8 text-amber-600 dark:text-lumos-yellow" />
            Cronograma de Edição
          </h1>
          <p className="text-lumos-text-secondary text-sm mt-1">
            Gestão e acompanhamento das tarefas de edição e pós-produção da produtora.
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditorListOpen(true)}
              className="px-4 py-2 bg-lumos-surface border border-lumos-border hover:bg-lumos-text-secondary/5 text-lumos-text-primary rounded-lumos font-bold text-xs lg:text-sm transition-all cursor-pointer flex items-center gap-2"
            >
              <Users className="w-4 h-4 text-amber-600 dark:text-lumos-yellow" />
              Gerenciar Editores
            </button>
            <button
              onClick={() => openTaskForm()}
              className="px-4 py-2 bg-lumos-yellow hover:bg-lumos-yellow/90 text-black rounded-lumos font-bold text-xs lg:text-sm transition-all cursor-pointer flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Nova Edição
            </button>
          </div>
        )}
      </div>

      {/* GRADE SEMANAL (LARGURA COMPLETA) */}
      <div className="bg-lumos-surface border border-lumos-border rounded-lumos overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-lumos-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-lumos-bg/25 font-work-sans">
          <div>
            <h2 className="text-lg font-black text-lumos-text-primary uppercase tracking-tight flex items-center gap-2">
              <Calendar className="w-5 h-5 text-amber-600 dark:text-lumos-yellow" />
              Grade Semanal de Edições
            </h2>
            <p className="text-xs text-lumos-text-secondary mt-1">
              Acompanhamento de entregas por editor por dia da semana (prazo final).
            </p>
          </div>
          
          {/* Navegação de Semanas */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button 
              onClick={() => setCurrentWeekStart(prev => subWeeks(prev, 1))}
              className="p-1.5 bg-lumos-surface border border-lumos-border hover:bg-lumos-text-secondary/5 text-lumos-text-primary rounded-lumos transition-colors cursor-pointer"
              title="Semana Anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
              className="px-3 py-1.5 bg-lumos-surface border border-lumos-border hover:bg-lumos-text-secondary/5 text-lumos-text-primary rounded-lumos font-bold text-xs transition-colors cursor-pointer"
            >
              Hoje
            </button>
            <span className="text-xs font-black px-2.5 py-1.5 rounded uppercase tracking-wide bg-amber-500/10 dark:bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow border border-amber-500/20 dark:border-lumos-yellow/20">
              {formatWeekPeriod()}
            </span>
            <button 
              onClick={() => setCurrentWeekStart(prev => addWeeks(prev, 1))}
              className="p-1.5 bg-lumos-surface border border-lumos-border hover:bg-lumos-text-secondary/5 text-lumos-text-primary rounded-lumos transition-colors cursor-pointer"
              title="Próxima Semana"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="border-b border-lumos-border text-lumos-text-secondary font-black uppercase tracking-wider text-[10px] bg-lumos-bg/50 dark:bg-lumos-bg/25">
                <th className="py-3 px-4 w-48 border-r border-lumos-border">Editor</th>
                {weekDays.map((day, i) => {
                  const isDayToday = isSameDay(day, new Date());
                  return (
                    <th 
                      key={i} 
                      className={clsx(
                        "py-3 px-3 text-center border-r border-lumos-border last:border-r-0",
                        isDayToday && "bg-amber-500/5 dark:bg-lumos-yellow/5 text-amber-600 dark:text-lumos-yellow"
                      )}
                    >
                      <div className="font-black text-xs">
                        {format(day, "EEEE", { locale: ptBR })}
                      </div>
                      <div className="text-[10px] font-medium opacity-60">
                        {format(day, "dd/MM")}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {editores.filter(ed => ed.status === 'ativo').length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-lumos-text-secondary text-xs">
                    Nenhum editor ativo cadastrado. Clique em "Gerenciar Editores" para cadastrar recursos no sistema.
                  </td>
                </tr>
              ) : (
                editores.filter(ed => ed.status === 'ativo').map((editor) => (
                  <tr key={editor.id} className="hover:bg-lumos-text-secondary/[0.02] transition-colors min-h-[120px]">
                    {/* Nome do Editor */}
                    <td className="py-4 px-4 font-bold border-r border-lumos-border align-top bg-lumos-bg/10 dark:bg-lumos-bg/5">
                      <div className="space-y-1 mt-1">
                        <div className="text-lumos-text-primary text-sm leading-tight">{editor.nome}</div>
                        <span className={clsx(
                          "text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider",
                          editor.tipo === 'interno' 
                            ? "bg-amber-500/10 dark:bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow border border-amber-500/20 dark:border-lumos-yellow/20" 
                            : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                        )}>
                          {editor.tipo}
                        </span>
                      </div>
                    </td>
                    
                    {/* Dias da Semana */}
                    {weekDays.map((day, i) => {
                      const isDayToday = isSameDay(day, new Date());
                      const dayEditions = cronogramaEdicoes.filter(
                        ed => ed.editor_id === editor.id && isEdicaoOnDay(ed, day)
                      );
                      
                      return (
                        <td 
                          key={i} 
                          className={clsx(
                            "p-2 border-r border-lumos-border last:border-r-0 align-top min-h-[120px] w-[12%] text-center",
                            isDayToday && "bg-lumos-yellow/[0.01]"
                          )}
                        >
                          <DroppableCell 
                            id={`cell__${editor.id}__${format(day, 'yyyy-MM-dd')}`}
                            className="space-y-2 flex flex-col items-center min-h-[100px] w-full"
                            canManage={canManage}
                          >
                            {dayEditions.map((task) => (
                              <DraggableCard
                                key={task.id}
                                task={task}
                                canManage={canManage}
                                onOpenBriefing={openBriefingModal}
                                getPriorityBadge={getPriorityBadge}
                                getStatusLabel={getStatusLabel}
                                formatDeadline={formatDeadline}
                              />
                            ))}
                          </DroppableCell>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ÁREA PRINCIPAL: GRID DE 2 COLUNAS (ABAIXO DA GRADE) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-6 border-t border-lumos-border">
        
        {/* COLUNA ESQUERDA: BACKLOG / ITENS EM ESPERA (LARGURA 2 COLUNAS) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-black text-lumos-text-primary tracking-tight flex items-center gap-2 uppercase">
              <Inbox className="w-5 h-5 text-amber-600 dark:text-lumos-yellow" />
              Itens em Espera (Backlog)
              <span className="text-xs px-2 py-0.5 rounded-full bg-lumos-text-secondary/15 text-lumos-text-secondary font-bold">
                {backlogEditions.length}
              </span>
            </h2>
            
            {/* Campo de Busca local no Backlog */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
              <input 
                type="text"
                placeholder="Filtrar backlog..."
                value={searchBacklog}
                onChange={(e) => setSearchBacklog(e.target.value)}
                className="input-lumos pl-9 py-1.5 text-xs w-full"
              />
            </div>
          </div>

          {backlogEditions.length === 0 ? (
            <DroppableCell
              id="droppable-backlog"
              className="w-full min-h-[150px]"
              canManage={canManage}
            >
              <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-12 text-center space-y-3 h-full">
                <div className="w-12 h-12 bg-lumos-text-secondary/5 rounded-full flex items-center justify-center mx-auto border border-lumos-border">
                  <Sparkles className="w-5 h-5 text-lumos-text-secondary/50" />
                </div>
                <h3 className="text-sm font-bold text-lumos-text-primary">Nenhum item pendente</h3>
                <p className="text-xs text-lumos-text-secondary max-w-sm mx-auto">
                  {searchBacklog ? 'Nenhuma edição corresponde ao termo pesquisado.' : 'Todas as tarefas de edição cadastradas já estão vinculadas a um editor e a uma semana de início no cronograma.'}
                </p>
              </div>
            </DroppableCell>
          ) : (
            <DroppableCell
              id="droppable-backlog"
              className="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[150px]"
              canManage={canManage}
            >
              {backlogEditions.map((task) => (
                <DraggableCard
                  key={task.id}
                  task={task}
                  canManage={canManage}
                  onOpenBriefing={openBriefingModal}
                  getPriorityBadge={getPriorityBadge}
                  getStatusLabel={getStatusLabel}
                  formatDeadline={formatDeadline}
                  showActions={true}
                  onEdit={openTaskForm}
                  onDelete={handleTaskDelete}
                />
              ))}
            </DroppableCell>
          )}
        </div>

        {/* COLUNA DIREITA: RECURSOS / EDITORES CADASTRADOS (LARGURA 1 COLUNA) */}
        <div className="space-y-4">
          <h2 className="text-lg font-black text-lumos-text-primary tracking-tight uppercase flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-600 dark:text-lumos-yellow" />
            Editores Ativos
            <span className="text-xs px-2 py-0.5 rounded-full bg-lumos-text-secondary/15 text-lumos-text-secondary font-bold">
              {editores.filter(ed => ed.status === 'ativo').length}
            </span>
          </h2>

          <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-5 space-y-4">
            {editores.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary text-center py-4">
                Nenhum editor cadastrado na plataforma.
              </p>
            ) : (
              <div className="divide-y divide-lumos-border">
                {editores.map((ed) => (
                  <div key={ed.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 group">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={clsx(
                          "w-2 h-2 rounded-full",
                          ed.status === 'ativo' ? "bg-green-400 shadow-sm shadow-green-400" : "bg-lumos-text-secondary/30"
                        )} />
                        <span className={clsx(
                          "text-sm font-bold",
                          ed.status === 'ativo' ? "text-lumos-text-primary" : "text-lumos-text-secondary/60 line-through"
                        )}>
                          {ed.nome}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        <span className={clsx(
                          "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                          ed.tipo === 'interno' 
                            ? "bg-amber-500/10 dark:bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow border border-amber-500/20 dark:border-lumos-yellow/20" 
                            : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                        )}>
                          {ed.tipo}
                        </span>
                        
                        {ed.tipo === 'interno' && ed.auth_user_id && (
                          <span className="text-[10px] text-lumos-text-secondary flex items-center gap-1 opacity-70">
                            <Link2 className="w-2.5 h-2.5 text-amber-600/50 dark:text-lumos-yellow/50" />
                            Usuário Vinculado
                          </span>
                        )}
                      </div>
                    </div>

                    {canManage && (
                      <button
                        onClick={() => openEditorForm(ed)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-lumos-text-secondary hover:text-amber-600 dark:hover:text-lumos-yellow hover:bg-amber-500/10 dark:hover:bg-lumos-yellow/10 rounded transition-all cursor-pointer flex-shrink-0"
                        title="Editar Editor"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ==================================================================== */}
      {/* 4. MODAL: GERENCIAR EDITORES (LISTA E CRUD) */}
      {/* ==================================================================== */}
      {canManage && (
        <Modal 
          isOpen={isEditorListOpen} 
          onClose={() => setIsEditorListOpen(false)} 
          title="Gestão de Editores"
          maxWidth="max-w-2xl"
        >
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-lumos-border/50 pb-3">
              <p className="text-xs text-lumos-text-secondary">
                Cadastre freelancers e associe editores internos aos logins da produtora.
              </p>
              <button
                onClick={() => openEditorForm()}
                className="px-3 py-1.5 bg-lumos-yellow text-black rounded-lumos font-bold text-xs flex items-center gap-1 hover:bg-lumos-yellow/90 transition-colors cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Novo Editor
              </button>
            </div>

            <div className="overflow-x-auto max-h-[50vh] custom-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-lumos-border text-lumos-text-secondary font-black uppercase tracking-wider">
                    <th className="py-2 px-3">Nome</th>
                    <th className="py-2 px-3">Tipo</th>
                    <th className="py-2 px-3">Usuário Autenticado</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-lumos-border">
                  {editores.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-lumos-text-secondary">
                        Nenhum editor cadastrado.
                      </td>
                    </tr>
                  ) : (
                    editores.map((ed) => {
                      const associatedUser = users.find(u => u.auth_user_id === ed.auth_user_id);
                      return (
                        <tr key={ed.id} className="hover:bg-lumos-text-secondary/5 transition-colors">
                          <td className="py-3 px-3 font-bold text-lumos-text-primary">{ed.nome}</td>
                          <td className="py-3 px-3">
                            <span className={clsx(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                              ed.tipo === 'interno' 
                                ? "text-amber-600 dark:text-lumos-yellow bg-amber-500/10 dark:bg-lumos-yellow/10" 
                                : "text-blue-600 dark:text-blue-400 bg-blue-500/10"
                            )}>
                              {ed.tipo}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-lumos-text-secondary">
                            {ed.tipo === 'interno' ? (
                              associatedUser ? (
                                <span className="flex flex-col">
                                  <span className="text-lumos-text-primary font-bold">{associatedUser.full_name}</span>
                                  <span className="text-[10px] opacity-70">{associatedUser.email}</span>
                                </span>
                              ) : (
                                <span className="text-red-600 dark:text-red-400 italic">Usuário não vinculado</span>
                              )
                            ) : (
                              <span className="opacity-40">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <span className={clsx(
                              "w-2.5 h-2.5 rounded-full inline-block",
                              ed.status === 'ativo' ? "bg-green-500" : "bg-red-500"
                            )} />
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              onClick={() => openEditorForm(ed)}
                              className="p-1.5 text-lumos-text-secondary hover:text-amber-600 dark:hover:text-lumos-yellow hover:bg-amber-500/10 dark:hover:bg-lumos-yellow/10 rounded cursor-pointer transition-colors"
                              title="Editar"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

      {/* ==================================================================== */}
      {/* 5. MODAL: FORMULÁRIO EDITOR (NOVO / EDITAR) */}
      {/* ==================================================================== */}
      {canManage && (
        <Modal
          isOpen={isEditorFormOpen}
          onClose={() => {
            setIsEditorFormOpen(false);
            setSelectedEditor(null);
          }}
          title={selectedEditor ? "Editar Cadastro de Editor" : "Novo Cadastro de Editor"}
          maxWidth="max-w-md"
        >
          <form onSubmit={handleEditorSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Nome Completo</label>
              <input
                required
                type="text"
                placeholder="Ex: Marcus Vinícius"
                className="input-lumos w-full"
                value={editorFormData.nome}
                onChange={(e) => setEditorFormData({ ...editorFormData, nome: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase">Tipo de Editor</label>
                <select
                  className="input-lumos w-full"
                  value={editorFormData.tipo}
                  onChange={(e) => setEditorFormData({ 
                    ...editorFormData, 
                    tipo: e.target.value as 'interno' | 'freelancer',
                    auth_user_id: '' // reseta vinculo
                  })}
                >
                  <option value="interno">Interno (Equipe)</option>
                  <option value="freelancer">Freelancer</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase">Status</label>
                <select
                  className="input-lumos w-full"
                  value={editorFormData.status}
                  onChange={(e) => setEditorFormData({ ...editorFormData, status: e.target.value as 'ativo' | 'inativo' })}
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
            </div>

            {/* Vínculo de Usuário: Apenas para Editores Internos */}
            {editorFormData.tipo === 'interno' && (
              <div className="space-y-2 border-t border-lumos-border pt-4">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-amber-600 dark:text-lumos-yellow" />
                  Usuário Autenticado do Sistema
                </label>
                <select
                  required
                  className="input-lumos w-full"
                  value={editorFormData.auth_user_id}
                  onChange={(e) => setEditorFormData({ ...editorFormData, auth_user_id: e.target.value })}
                >
                  <option value="">-- Selecione o Usuário --</option>
                  {users.map((u) => (
                    <option key={u.auth_user_id} value={u.auth_user_id}>
                      {u.full_name} ({u.email})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-lumos-text-secondary leading-relaxed mt-1 opacity-70">
                  Os editores internos precisam estar associados a uma conta de acesso do sistema para poderem atualizar as tarefas no cronograma.
                </p>
              </div>
            )}

            {/* Botões do Rodapé */}
            <div className="flex items-center justify-end gap-2 border-t border-lumos-border pt-4 mt-6">
              <button
                type="button"
                onClick={() => {
                  setIsEditorFormOpen(false);
                  setSelectedEditor(null);
                }}
                className="px-4 py-2 bg-lumos-surface border border-lumos-border text-lumos-text-secondary rounded-lumos font-bold hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-lumos-yellow text-black rounded-lumos font-bold hover:bg-lumos-yellow/90 transition-all text-xs"
              >
                {selectedEditor ? "Atualizar" : "Salvar"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ==================================================================== */}
      {/* 6. MODAL: FORMULÁRIO TAREFA / EDIÇÃO (NOVO / EDITAR) */}
      {/* ==================================================================== */}
      {canManage && (
        <Modal
          isOpen={isTaskFormOpen}
          onClose={() => {
            setIsTaskFormOpen(false);
            setSelectedTask(null);
          }}
          title={selectedTask ? "Editar Edição" : "Nova Edição"}
          maxWidth="max-w-4xl"
        >
          <form onSubmit={handleTaskSubmit} className="space-y-6">
            
            {/* Seção 1: Identificação */}
            <div className="space-y-4">
              <span className="text-[10px] text-amber-600 dark:text-lumos-yellow font-black uppercase tracking-wider block border-b border-lumos-border pb-1">1. Identificação</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Vínculo de Projeto */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Vincular a Projeto (Opcional)</label>
                  <select
                    className="input-lumos w-full"
                    value={taskFormData.project_id}
                    onChange={(e) => handleProjectChange(e.target.value)}
                  >
                    <option value="">-- Tarefa Avulsa (Sem Projeto) --</option>
                    {projects.map((p) => {
                      const clientText = p.clients?.name ? ` [${p.clients.name}]` : '';
                      const codeText = p.code ? `#${p.code} - ` : '';
                      return (
                        <option key={p.id} value={p.id}>
                          {codeText}{p.name}{clientText}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Título */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Título da Edição</label>
                  <input
                    required
                    type="text"
                    placeholder="Ex: Edição - Vídeo Corporativo Lumos"
                    className="input-lumos w-full"
                    value={taskFormData.titulo}
                    onChange={(e) => setTaskFormData({ ...taskFormData, titulo: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Seção 2: Atribuição & Prazos */}
            <div className="space-y-4">
              <span className="text-[10px] text-amber-600 dark:text-lumos-yellow font-black uppercase tracking-wider block border-b border-lumos-border pb-1">2. Atribuição & Prazos</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                {/* Editor Responsável */}
                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Designar Editor (Opcional)</label>
                  <select
                    className="input-lumos w-full"
                    value={taskFormData.editor_id}
                    onChange={(e) => setTaskFormData({ ...taskFormData, editor_id: e.target.value })}
                  >
                    <option value="">-- Ficar no Backlog (Sem Designar) --</option>
                    {editores.filter(ed => ed.status === 'ativo').map((ed) => (
                      <option key={ed.id} value={ed.id}>
                        {ed.nome} ({ed.tipo})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Semana de Início */}
                <div className="space-y-2 md:col-span-1">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Semana de Início</label>
                  <input
                    type="date"
                    className="input-lumos w-full"
                    value={taskFormData.semana_inicio}
                    onChange={(e) => setTaskFormData({ ...taskFormData, semana_inicio: e.target.value })}
                  />
                </div>

                {/* Prazo Final */}
                <div className="space-y-2 md:col-span-1">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Prazo Final</label>
                  <input
                    required
                    type="date"
                    className="input-lumos w-full"
                    value={taskFormData.prazo}
                    onChange={(e) => setTaskFormData({ ...taskFormData, prazo: e.target.value })}
                  />
                </div>

                {/* Prioridade */}
                <div className="space-y-2 md:col-span-1">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Prioridade</label>
                  <select
                    className="input-lumos w-full"
                    value={taskFormData.prioridade}
                    onChange={(e) => setTaskFormData({ ...taskFormData, prioridade: e.target.value as Edicao['prioridade'] })}
                  >
                    <option value="baixa">Baixa</option>
                    <option value="media">Média</option>
                    <option value="alta">Alta</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Seção 3: Briefing Detalhado */}
            <div className="space-y-4">
              <span className="text-[10px] text-amber-600 dark:text-lumos-yellow font-black uppercase tracking-wider block border-b border-lumos-border pb-1">3. Briefing Detalhado (Opcional)</span>
              
              {/* Formato, Duração, Legenda, Status */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Formato</label>
                  <input
                    type="text"
                    placeholder="Ex: 16:9, 9:16"
                    className="input-lumos w-full"
                    value={taskFormData.formato}
                    onChange={(e) => setTaskFormData({ ...taskFormData, formato: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Duração Est.</label>
                  <input
                    type="text"
                    placeholder="Ex: 00h02m30s"
                    className="input-lumos w-full"
                    value={taskFormData.duracao}
                    onChange={(e) => setTaskFormData({ ...taskFormData, duracao: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Legenda?</label>
                  <select
                    className="input-lumos w-full"
                    value={taskFormData.legenda ? 'sim' : 'nao'}
                    onChange={(e) => setTaskFormData({ ...taskFormData, legenda: e.target.value === 'sim' })}
                  >
                    <option value="nao">Não</option>
                    <option value="sim">Sim</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Status</label>
                  <select
                    className="input-lumos w-full"
                    value={taskFormData.status}
                    onChange={(e) => setTaskFormData({ ...taskFormData, status: e.target.value as Edicao['status'] })}
                  >
                    <option value="nao_iniciado">Fila (Não Iniciado)</option>
                    <option value="em_andamento">Editando</option>
                    <option value="revisao_interna">Revisão Interna</option>
                    <option value="aprovacao_cliente">Aprovação Cliente</option>
                    <option value="concluido">Aprovado (Concluído)</option>
                  </select>
                </div>
              </div>

              {/* Grid de Links */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Link de Referência</label>
                  <input
                    type="url"
                    placeholder="https://..."
                    className="input-lumos w-full"
                    value={taskFormData.link_referencia}
                    onChange={(e) => setTaskFormData({ ...taskFormData, link_referencia: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Link do Roteiro</label>
                  <input
                    type="url"
                    placeholder="https://..."
                    className="input-lumos w-full"
                    value={taskFormData.link_roteiro}
                    onChange={(e) => setTaskFormData({ ...taskFormData, link_roteiro: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Material Bruto</label>
                  <input
                    type="url"
                    placeholder="https://..."
                    className="input-lumos w-full"
                    value={taskFormData.link_brutos}
                    onChange={(e) => setTaskFormData({ ...taskFormData, link_brutos: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Artes & Assets</label>
                  <input
                    type="url"
                    placeholder="https://..."
                    className="input-lumos w-full"
                    value={taskFormData.link_artes}
                    onChange={(e) => setTaskFormData({ ...taskFormData, link_artes: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Seção 4: Entrega */}
            <div className="space-y-4">
              <span className="text-[10px] text-amber-600 dark:text-lumos-yellow font-black uppercase tracking-wider block border-b border-lumos-border pb-1">4. Entrega (Editor)</span>
              <div className="space-y-2">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase">Link do Vídeo Editado (Entrega)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  className="input-lumos w-full"
                  value={taskFormData.link_editado}
                  onChange={(e) => setTaskFormData({ ...taskFormData, link_editado: e.target.value })}
                />
              </div>
            </div>

            {/* Seção 5: Observações */}
            <div className="space-y-4">
              <span className="text-[10px] text-amber-600 dark:text-lumos-yellow font-black uppercase tracking-wider block border-b border-lumos-border pb-1">5. Notas & Direcionamentos</span>
              <div className="space-y-2">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase">Observações / Direcionamentos</label>
                <textarea
                  placeholder="Insira detalhes da edição, direcionamentos especiais, etc."
                  className="input-lumos w-full h-20 resize-none"
                  value={taskFormData.observacoes}
                  onChange={(e) => setTaskFormData({ ...taskFormData, observacoes: e.target.value })}
                />
              </div>
            </div>

            {/* Botões do Rodapé */}
            <div className="flex items-center justify-between border-t border-lumos-border pt-4 mt-6">
              <div>
                {selectedTask && canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsTaskFormOpen(false);
                      handleTaskDelete(selectedTask.id);
                    }}
                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500 text-red-600 hover:text-white border border-red-500/20 hover:border-red-500 rounded-lumos font-bold transition-all text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Excluir Edição
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsTaskFormOpen(false);
                    setSelectedTask(null);
                  }}
                  className="px-4 py-2 bg-lumos-surface border border-lumos-border text-lumos-text-secondary rounded-lumos font-bold hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-lumos-yellow text-black rounded-lumos font-bold hover:bg-lumos-yellow/90 transition-all text-xs"
                >
                  {selectedTask ? "Atualizar" : "Salvar"}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* ==================================================================== */}
      {/* 7. MODAL: DETALHES DE BRIEFING E ENTREGA (EDITOR / VISUALIZAÇÃO) */}
      {/* ==================================================================== */}
      {isBriefingModalOpen && briefingTask && (
        <Modal
          isOpen={isBriefingModalOpen}
          onClose={() => {
            setIsBriefingModalOpen(false);
            setBriefingTask(null);
          }}
          title="Briefing e Entrega da Tarefa"
          maxWidth="max-w-2xl"
        >
          <form onSubmit={handleBriefingSubmit} className="space-y-6">
            
            {/* Bloco 1: Informações Gerais / Briefing (Somente Leitura para Editores) */}
            <div className="bg-lumos-bg/40 border border-lumos-border rounded-lumos p-5 space-y-4">
              <div className="flex items-start justify-between gap-4 border-b border-lumos-border pb-3">
                <div>
                  <span className="text-[10px] text-amber-600 dark:text-lumos-yellow font-black uppercase tracking-wider block">Briefing da Edição</span>
                  <h3 className="text-base font-bold text-lumos-text-primary mt-1">{briefingTask.titulo}</h3>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={handleEditFromBriefing}
                    className="px-2.5 py-1.5 bg-lumos-surface border border-lumos-border hover:bg-lumos-text-secondary/5 text-amber-600 dark:text-lumos-yellow rounded-lumos font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Editar Briefing
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {/* Projeto */}
                <div className="space-y-1">
                  <span className="text-lumos-text-secondary font-bold uppercase tracking-wider block text-[10px]">Projeto Vinculado</span>
                  <div className="text-lumos-text-primary font-medium">
                    {briefingTask.projects ? (
                      <span className="flex items-center gap-1">
                        <Link2 className="w-3.5 h-3.5 text-amber-600/70 dark:text-lumos-yellow/70" />
                        {briefingTask.projects.code ? `#${briefingTask.projects.code} - ` : ''}
                        {briefingTask.projects.name} 
                        {briefingTask.projects.clients ? ` (${briefingTask.projects.clients.name})` : ''}
                      </span>
                    ) : (
                      <span className="italic text-lumos-text-secondary">Tarefa Avulsa (Sem Projeto)</span>
                    )}
                  </div>
                </div>

                {/* Editor Designado */}
                <div className="space-y-1">
                  <span className="text-lumos-text-secondary font-bold uppercase tracking-wider block text-[10px]">Editor Responsável</span>
                  <div className="text-lumos-text-primary font-medium">
                    {briefingTask.editores?.nome ? briefingTask.editores.nome : <span className="italic text-lumos-text-secondary">Sem Designação (Backlog)</span>}
                  </div>
                </div>

                {/* Prazo Final */}
                <div className="space-y-1">
                  <span className="text-lumos-text-secondary font-bold uppercase tracking-wider block text-[10px]">Prazo Final de Entrega</span>
                  <div className="text-lumos-text-primary font-bold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-lumos-yellow" />
                    {format(new Date(briefingTask.prazo), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  </div>
                </div>

                {/* Prioridade */}
                <div className="space-y-1">
                  <span className="text-lumos-text-secondary font-bold uppercase tracking-wider block text-[10px]">Prioridade</span>
                  <div>
                    <span className={clsx(
                      "text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-wider",
                      getPriorityBadge(briefingTask.prioridade)
                    )}>
                      {briefingTask.prioridade}
                    </span>
                  </div>
                </div>

                {/* Formato, Duração, Legenda */}
                <div className="space-y-1">
                  <span className="text-lumos-text-secondary font-bold uppercase tracking-wider block text-[10px]">Formato & Duração</span>
                  <div className="text-lumos-text-primary font-medium">
                    {briefingTask.formato || 'Não especificado'} | {briefingTask.duracao || 'Não especificada'}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-lumos-text-secondary font-bold uppercase tracking-wider block text-[10px]">Legenda</span>
                  <div className="text-lumos-text-primary font-medium">
                    {briefingTask.legenda === null ? 'Não especificado' : briefingTask.legenda ? 'Sim' : 'Não'}
                  </div>
                </div>
              </div>

              {/* Links de Briefing */}
              <div className="border-t border-lumos-border pt-4 space-y-3">
                <span className="text-lumos-text-secondary font-bold uppercase tracking-wider block text-[10px]">Links e Materiais de Apoio</span>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Link Referência */}
                  <div className="bg-lumos-bg/20 p-2.5 rounded border border-lumos-border flex items-center justify-between gap-2">
                    <div className="truncate">
                      <span className="text-[9px] text-lumos-text-secondary uppercase block">Referência</span>
                      {briefingTask.link_referencia ? (
                        <a href={briefingTask.link_referencia} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-600 dark:text-lumos-yellow hover:underline flex items-center gap-1 font-semibold truncate">
                          Acessar Link <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-lumos-text-secondary italic font-semibold">Sem link</span>
                      )}
                    </div>
                  </div>

                  {/* Link Roteiro */}
                  <div className="bg-lumos-bg/20 p-2.5 rounded border border-lumos-border flex items-center justify-between gap-2">
                    <div className="truncate">
                      <span className="text-[9px] text-lumos-text-secondary uppercase block">Roteiro</span>
                      {briefingTask.link_roteiro ? (
                        <a href={briefingTask.link_roteiro} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-600 dark:text-lumos-yellow hover:underline flex items-center gap-1 font-semibold truncate">
                          Acessar Roteiro <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-lumos-text-secondary italic font-semibold">Sem link</span>
                      )}
                    </div>
                  </div>

                  {/* Link Brutos */}
                  <div className="bg-lumos-bg/20 p-2.5 rounded border border-lumos-border flex items-center justify-between gap-2">
                    <div className="truncate">
                      <span className="text-[9px] text-lumos-text-secondary uppercase block">Material Bruto</span>
                      {briefingTask.link_brutos ? (
                        <a href={briefingTask.link_brutos} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-600 dark:text-lumos-yellow hover:underline flex items-center gap-1 font-semibold truncate">
                          Pasta de Brutos <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-lumos-text-secondary italic font-semibold">Sem link</span>
                      )}
                    </div>
                  </div>

                  {/* Link Artes */}
                  <div className="bg-lumos-bg/20 p-2.5 rounded border border-lumos-border flex items-center justify-between gap-2">
                    <div className="truncate">
                      <span className="text-[9px] text-lumos-text-secondary uppercase block">Artes & Assets</span>
                      {briefingTask.link_artes ? (
                        <a href={briefingTask.link_artes} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-600 dark:text-lumos-yellow hover:underline flex items-center gap-1 font-semibold truncate">
                          Pasta de Artes <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-lumos-text-secondary italic font-semibold">Sem link</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bloco 2: Entrega e Status (Editável pelo Editor) */}
            <div className="space-y-4 border-t border-lumos-border pt-4">
              <span className="text-[10px] text-amber-600 dark:text-lumos-yellow font-black uppercase tracking-wider block">Área de Entrega (Editor)</span>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2 col-span-1">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Status Atual</label>
                  <select
                    disabled={!canEditDelivery}
                    className="input-lumos w-full disabled:opacity-60 disabled:cursor-not-allowed"
                    value={briefingFormData.status}
                    onChange={(e) => setBriefingFormData({ ...briefingFormData, status: e.target.value as Edicao['status'] })}
                  >
                    <option value="nao_iniciado">Fila (Não Iniciado)</option>
                    <option value="em_andamento">Editando</option>
                    <option value="revisao_interna">Revisão Interna</option>
                    <option value="aprovacao_cliente">Aprovação Cliente</option>
                    <option value="concluido">Aprovado (Concluído)</option>
                  </select>
                </div>

                <div className="space-y-2 col-span-2">
                  <label className="text-xs font-bold text-lumos-text-secondary uppercase">Link do Vídeo Editado</label>
                  <input
                    disabled={!canEditDelivery}
                    type="url"
                    placeholder="https://exemplo.com/video-editado"
                    className="input-lumos w-full disabled:opacity-60 disabled:cursor-not-allowed"
                    value={briefingFormData.link_editado}
                    onChange={(e) => setBriefingFormData({ ...briefingFormData, link_editado: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase">Observações / Notas de Entrega</label>
                <textarea
                  disabled={!canEditDelivery}
                  placeholder="Instruções sobre cortes, feedbacks recebidos ou notas do editor..."
                  className="input-lumos w-full h-20 resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                  value={briefingFormData.observacoes}
                  onChange={(e) => setBriefingFormData({ ...briefingFormData, observacoes: e.target.value })}
                />
              </div>
            </div>

            {/* Botões */}
            <div className="flex items-center justify-end gap-2 border-t border-lumos-border pt-4 mt-6">
              <button
                type="button"
                onClick={() => {
                  setIsBriefingModalOpen(false);
                  setBriefingTask(null);
                }}
                className="px-4 py-2 bg-lumos-surface border border-lumos-border text-lumos-text-secondary rounded-lumos font-bold hover:text-lumos-text-primary hover:bg-lumos-text-secondary/5 transition-all text-xs"
              >
                {canEditDelivery ? "Cancelar" : "Fechar"}
              </button>
              {canEditDelivery && (
                <button
                  type="submit"
                  className="px-4 py-2 bg-lumos-yellow text-black rounded-lumos font-bold hover:bg-lumos-yellow/90 transition-all text-xs flex items-center gap-1.5"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Salvar Entrega
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}

      </div>
    </DndContext>
  );
}
