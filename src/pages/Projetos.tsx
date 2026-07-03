import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { ServiceOrderPDF } from '@/components/editor/ServiceOrderPDF';
import { pdf } from '@react-pdf/renderer';
import { 
  FolderClosed, 
  FolderOpen,
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
  Loader2
} from 'lucide-react';
import { clsx } from 'clsx';

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

export default function Projetos() {
  const { can, isAdmin } = useAuth();
  const toast = useToast();
  
  // Permissions
  const canManage = isAdmin || can('ordem_do_dia');

  // Database States
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // UI Selection States
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({});
  const [showConcludedProjects, setShowConcludedProjects] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // PDF Generation State
  const [isGeneratingOS, setIsGeneratingOS] = useState<string | null>(null);

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

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      // 1. Fetch Clients
      const { data: clientsData, error: cErr } = await supabase
        .from('clients')
        .select('id, name')
        .order('name', { ascending: true });
      if (cErr) throw cErr;

      // 2. Fetch Projects (resolving original budget category too)
      const { data: projectsData, error: pErr } = await supabase
        .from('projects')
        .select('*, budget:budgets(category)')
        .order('created_at', { ascending: false });
      if (pErr) throw pErr;

      // 3. Fetch Tasks summary
      const { data: tasksData, error: tErr } = await supabase
        .from('project_tasks')
        .select('id, project_id, status');
      if (tErr) throw tErr;

      setClients(clientsData || []);
      setProjects(projectsData || []);
      setTasks(tasksData || []);
    } catch (err: any) {
      console.error('Error fetching project data:', err);
      toast.error('Erro ao carregar dados dos projetos.');
    } finally {
      setLoading(false);
    }
  }

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
      // 1. Insert Project
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

      // 2. Auto template population (Phase 2 feature integrated)
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
            status: 'a_fazer',
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
      
      // Reset Form
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

  // Filter clients and projects based on search query
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
    const projectTasks = tasks.filter(t => t.project_id === projectId);
    const total = projectTasks.length;
    const completed = projectTasks.filter(t => t.status === 'concluido').length;
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

  const selectedClient = clients.find(c => c.id === selectedClientId);
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  // Projects to display in grid for selected client (filtering status)
  const clientProjectsFiltered = projects.filter(p => {
    if (p.client_id !== selectedClientId) return false;
    if (!showConcludedProjects && p.status === 'concluido') return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight uppercase">
            Gerenciador de Projetos
          </h1>
          <p className="text-sm font-medium text-lumos-text-secondary mt-1">
            Visualização hierárquica e controle dos fluxos operacionais da Lumos.
          </p>
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
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-[600px] items-start">
          
          {/* Panel 1: Collapsible Folders (Lateral Esquerda) */}
          <div className="lg:col-span-1 card border border-lumos-border bg-lumos-surface/40 flex flex-col p-4 space-y-4 h-[600px]">
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
              <span className="text-[9px] font-black tracking-widest text-lumos-text-secondary uppercase opacity-50 px-2 block mb-2">
                Pastas de Clientes
              </span>

              {filteredClients.length === 0 ? (
                <p className="text-xs text-lumos-text-secondary italic text-center py-8">Nenhum cliente encontrado.</p>
              ) : (
                filteredClients.map((client) => {
                  const clientProjects = projects.filter(p => p.client_id === client.id);
                  const activeProjects = clientProjects.filter(p => p.status === 'ativo');
                  const isExpanded = !!expandedClients[client.id] || searchTerm.length > 0;
                  const isClientSelected = selectedClientId === client.id && !selectedProjectId;

                  return (
                    <div key={client.id} className="space-y-1">
                      {/* Client Header Item */}
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
                          {clientProjects.length === 0 ? (
                            <span className="text-[10px] text-lumos-text-secondary/50 italic block py-1">Sem projetos</span>
                          ) : (
                            clientProjects.map((proj) => {
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
                                      : proj.status === 'concluido' 
                                        ? "text-lumos-text-secondary/40 line-through" 
                                        : "text-lumos-text-secondary"
                                  )}
                                >
                                  <span className="truncate max-w-[80%]">{proj.name}</span>
                                  {proj.code && (
                                    <span className="text-[8px] font-bold px-1 py-0.2 bg-lumos-border/30 rounded text-lumos-text-secondary tracking-tight">
                                      {proj.code}
                                    </span>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Panel 2 & 3: Selected client grid OR Selected project detail (Centro/Direita) */}
          <div className="lg:col-span-3 space-y-6 min-h-[600px]">
            
            {selectedProjectId && selectedProject ? (
              /* ================= SELECTED PROJECT DETAILS ================= */
              <div className="card border border-lumos-border bg-lumos-surface flex flex-col p-6 space-y-6">
                
                {/* Project Detail Header */}
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 pb-5 border-b border-lumos-border/50">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={clsx(
                        "text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wider border",
                        getCategoryTheme(selectedProject.category || selectedProject.budget?.category || null)
                      )}>
                        {selectedProject.category || selectedProject.budget?.category || 'Sem Segmento'}
                      </span>
                      {selectedProject.code && (
                        <span className="text-[9px] font-black bg-lumos-border/40 text-lumos-text-secondary px-2 py-0.5 rounded tracking-wider uppercase">
                          Cód: {selectedProject.code}
                        </span>
                      )}
                      <span className={clsx(
                        "text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wider",
                        selectedProject.status === 'concluido' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'
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
                    {/* Dynamic OS download */}
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
                        onClick={() => handleToggleProjectStatus(selectedProject.id, selectedProject.status)}
                        className={clsx(
                          "btn-secondary py-2 px-3 flex items-center gap-2 text-xs font-semibold text-white",
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
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-lumos-text-secondary">Progresso do Workflow</span>
                    <span className="text-lumos-text-primary">
                      {getProjectTasksStats(selectedProject.id).completed} de {getProjectTasksStats(selectedProject.id).total} concluídas ({getProjectTasksStats(selectedProject.id).pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-lumos-border/30 h-2.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-lumos-yellow h-full transition-all duration-500" 
                      style={{ width: `${getProjectTasksStats(selectedProject.id).pct}%` }}
                    ></div>
                  </div>
                </div>

                {/* Placeholder of Tasks List (Phase 5) */}
                <div className="flex-1 border border-dashed border-lumos-border/50 rounded-lumos flex flex-col justify-center items-center text-center p-8 bg-lumos-bg/25">
                  <Clock className="w-8 h-8 text-lumos-text-secondary opacity-50 mb-3" />
                  <h4 className="text-sm font-bold text-lumos-text-primary uppercase tracking-wider">Visualização de Tarefas</h4>
                  <p className="text-xs text-lumos-text-secondary mt-1 max-w-sm">
                    A listagem de tarefas interativa deste projeto (Fase 5) será exibida aqui, permitindo preencher os prazos manuais e delegar responsáveis.
                  </p>
                </div>

              </div>
            ) : selectedClientId && selectedClient ? (
              /* ================= DOCK PROJECTS OF SELECTED CLIENT ================= */
              <div className="space-y-6">
                
                {/* Client Folder header info */}
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

                {/* Projects Grid list */}
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
                                Código: <span className="text-lumos-text-primary">{proj.code}</span>
                              </p>
                            )}

                            {proj.descricao && (
                              <p className="text-xs text-lumos-text-secondary line-clamp-2 leading-relaxed">
                                {proj.descricao}
                              </p>
                            )}
                          </div>

                          {/* Progress bar */}
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
              /* ================= DEFAULT WORKSPACE LANDING ================= */
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

      {/* ================= MANUAL CREATE MODAL ================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-lg bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-6 space-y-6 text-lumos-text-primary">
            
            {/* Modal Header */}
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

            {/* Modal Form */}
            <form onSubmit={handleCreateProject} className="space-y-4">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Project Name */}
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

                {/* Client Select */}
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

                {/* Segment Selector */}
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

                {/* Project Code */}
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

                {/* Data Início */}
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

                {/* Data Fim */}
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

              {/* Description */}
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

              {/* Apply Template Checkbox */}
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

              {/* Form Actions */}
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

    </div>
  );
}
