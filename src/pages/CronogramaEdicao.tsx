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
  ChevronRight,
  TrendingUp,
  Inbox
} from 'lucide-react';
import { format, isPast, isToday, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';

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
  projects?: Project | null;
  editores?: {
    id: string;
    nome: string;
  } | null;
}

export default function CronogramaEdicao() {
  const { user, profile } = useAuth();
  const toast = useToast();

  // Permissão de escrita (Gestão)
  const canManage = profile?.role === 'admin' || profile?.role === 'producao';

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
    observacoes: ''
  });

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
        observacoes: task.observacoes || ''
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
        observacoes: ''
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
        return 'bg-red-500/10 text-red-500 border border-red-500/20';
      case 'baixa':
        return 'bg-green-500/10 text-green-400 border border-green-500/20';
      case 'media':
      default:
        return 'bg-yellow-500/10 text-lumos-yellow border border-lumos-yellow/20';
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
      case 'concluido': return 'text-green-400 bg-green-500/10 border-green-500/20';
      case 'aprovacao_cliente': return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
      case 'revisao_interna': return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
      case 'em_andamento': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
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
        isUrgent ? "text-red-500" : isWarning ? "text-orange-400" : "text-lumos-text-secondary"
      )}>
        <Clock className="w-3.5 h-3.5" />
        Prazo: {formatted}
        {isUrgent && <AlertTriangle className="w-3 h-3 text-red-500 animate-pulse" />}
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

  if (loading && edicoes.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-lumos-yellow"></div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 text-white max-w-7xl mx-auto font-work-sans">
      
      {/* CABEÇALHO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-lumos-border pb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Calendar className="w-8 h-8 text-lumos-yellow" />
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
              <Users className="w-4 h-4 text-lumos-yellow" />
              Gerenciar Editores
            </button>
            <button
              onClick={() => openTaskForm()}
              className="px-4 py-2 bg-lumos-yellow hover:bg-lumos-yellow/90 text-lumos-bg rounded-lumos font-bold text-xs lg:text-sm transition-all cursor-pointer flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Nova Edição
            </button>
          </div>
        )}
      </div>

      {/* ÁREA PRINCIPAL: GRID DE 2 COLUNAS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* COLUNA ESQUERDA: BACKLOG / ITENS EM ESPERA (LARGURA 2 COLUNAS) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-black text-white tracking-tight flex items-center gap-2 uppercase">
              <Inbox className="w-5 h-5 text-lumos-yellow" />
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
            <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-12 text-center space-y-3">
              <div className="w-12 h-12 bg-lumos-text-secondary/5 rounded-full flex items-center justify-center mx-auto border border-lumos-border/40">
                <Sparkles className="w-5 h-5 text-lumos-text-secondary/50" />
              </div>
              <h3 className="text-sm font-bold text-lumos-text-primary">Nenhum item pendente</h3>
              <p className="text-xs text-lumos-text-secondary max-w-sm mx-auto">
                {searchBacklog ? 'Nenhuma edição corresponde ao termo pesquisado.' : 'Todas as tarefas de edição cadastradas já estão vinculadas a um editor e a uma semana de início no cronograma.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {backlogEditions.map((task) => (
                <div 
                  key={task.id} 
                  className="bg-lumos-surface border border-lumos-border hover:border-lumos-yellow/20 rounded-lumos p-5 transition-all flex flex-col justify-between space-y-4 hover:shadow-xl hover:shadow-black/20"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="text-sm font-bold text-white leading-snug tracking-tight">
                        {task.titulo}
                      </h4>
                      {canManage && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button 
                            onClick={() => openTaskForm(task)}
                            className="p-1.5 text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/10 rounded-lumos transition-colors cursor-pointer"
                            title="Editar Edição"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => handleTaskDelete(task.id)}
                            className="p-1.5 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-lumos transition-colors cursor-pointer"
                            title="Excluir Edição"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Vínculo de Projeto */}
                    {task.projects && (
                      <div className="text-xs text-lumos-text-secondary flex flex-wrap items-center gap-1 bg-lumos-bg/30 px-2.5 py-1.5 rounded border border-lumos-border/30 w-fit">
                        <span className="font-bold text-lumos-yellow">
                          {task.projects.code ? `#${task.projects.code}` : 'PROJETO'}:
                        </span>
                        <span>{task.projects.name}</span>
                        {task.projects.clients && (
                          <span className="opacity-60">
                            ({task.projects.clients.name})
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Detalhes do Card */}
                  <div className="border-t border-lumos-border/50 pt-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      {formatDeadline(task.prazo)}
                      <span className={clsx(
                        "text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider",
                        getPriorityBadge(task.prioridade)
                      )}>
                        {task.prioridade}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-lumos-text-secondary pt-1">
                      <span className="flex items-center gap-1">
                        Status: 
                        <span className={clsx(
                          "px-2 py-0.5 rounded border text-[10px] font-bold", 
                          getStatusColor(task.status)
                        )}>
                          {getStatusLabel(task.status)}
                        </span>
                      </span>
                    </div>

                    {task.observacoes && (
                      <p className="text-[11px] text-lumos-text-secondary italic leading-relaxed border-l-2 border-lumos-border pl-2 mt-1">
                        "{task.observacoes}"
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COLUNA DIREITA: RECURSOS / EDITORES CADASTRADOS (LARGURA 1 COLUNA) */}
        <div className="space-y-4">
          <h2 className="text-lg font-black text-white tracking-tight uppercase flex items-center gap-2">
            <Users className="w-5 h-5 text-lumos-yellow" />
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
              <div className="divide-y divide-lumos-border/50">
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
                          ed.status === 'ativo' ? "text-white" : "text-lumos-text-secondary/60 line-through"
                        )}>
                          {ed.nome}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        <span className={clsx(
                          "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                          ed.tipo === 'interno' 
                            ? "bg-lumos-yellow/10 text-lumos-yellow border border-lumos-yellow/20" 
                            : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                        )}>
                          {ed.tipo}
                        </span>
                        
                        {ed.tipo === 'interno' && ed.auth_user_id && (
                          <span className="text-[10px] text-lumos-text-secondary flex items-center gap-1 opacity-70">
                            <Link2 className="w-2.5 h-2.5 text-lumos-yellow/50" />
                            Usuário Vinculado
                          </span>
                        )}
                      </div>
                    </div>

                    {canManage && (
                      <button
                        onClick={() => openEditorForm(ed)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/10 rounded transition-all cursor-pointer flex-shrink-0"
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
                className="px-3 py-1.5 bg-lumos-yellow text-lumos-bg rounded-lumos font-bold text-xs flex items-center gap-1 hover:bg-lumos-yellow/90 transition-colors cursor-pointer"
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
                <tbody className="divide-y divide-lumos-border/30">
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
                          <td className="py-3 px-3 font-bold text-white">{ed.nome}</td>
                          <td className="py-3 px-3">
                            <span className={clsx(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                              ed.tipo === 'interno' ? "text-lumos-yellow bg-lumos-yellow/10" : "text-blue-400 bg-blue-500/10"
                            )}>
                              {ed.tipo}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-lumos-text-secondary">
                            {ed.tipo === 'interno' ? (
                              associatedUser ? (
                                <span className="flex flex-col">
                                  <span className="text-white font-bold">{associatedUser.full_name}</span>
                                  <span className="text-[10px] opacity-70">{associatedUser.email}</span>
                                </span>
                              ) : (
                                <span className="text-red-400 italic">Usuário não vinculado</span>
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
                              className="p-1.5 text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/10 rounded cursor-pointer transition-colors"
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
              <div className="space-y-2 border-t border-lumos-border/50 pt-4">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-lumos-yellow" />
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
            <div className="flex items-center justify-end gap-2 border-t border-lumos-border/50 pt-4 mt-6">
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
                className="px-4 py-2 bg-lumos-yellow text-lumos-bg rounded-lumos font-bold hover:bg-lumos-yellow/90 transition-all text-xs"
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
          maxWidth="max-w-lg"
        >
          <form onSubmit={handleTaskSubmit} className="space-y-4">
            
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

            {/* Editor Responsável & Semana de Início */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
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

              <div className="space-y-2">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase">Semana de Início (Opcional)</label>
                <input
                  type="date"
                  className="input-lumos w-full"
                  value={taskFormData.semana_inicio}
                  onChange={(e) => setTaskFormData({ ...taskFormData, semana_inicio: e.target.value })}
                />
              </div>
            </div>

            {/* Prazo Final, Prioridade, Status */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2 col-span-1">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase">Prazo Final</label>
                <input
                  required
                  type="date"
                  className="input-lumos w-full"
                  value={taskFormData.prazo}
                  onChange={(e) => setTaskFormData({ ...taskFormData, prazo: e.target.value })}
                />
              </div>

              <div className="space-y-2 col-span-1">
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

              <div className="space-y-2 col-span-1">
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

            {/* Observações */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Observações / Direcionamentos</label>
              <textarea
                placeholder="Insira detalhes da edição, link de referências, etc."
                className="input-lumos w-full h-24 resize-none"
                value={taskFormData.observacoes}
                onChange={(e) => setTaskFormData({ ...taskFormData, observacoes: e.target.value })}
              />
            </div>

            {/* Botões do Rodapé */}
            <div className="flex items-center justify-end gap-2 border-t border-lumos-border/50 pt-4 mt-6">
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
                className="px-4 py-2 bg-lumos-yellow text-lumos-bg rounded-lumos font-bold hover:bg-lumos-yellow/90 transition-all text-xs"
              >
                {selectedTask ? "Atualizar" : "Salvar"}
              </button>
            </div>
          </form>
        </Modal>
      )}

    </div>
  );
}
