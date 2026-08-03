import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import { Search, Flag, CalendarDays, Columns3, ExternalLink, X } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import Select from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import UserAvatar from '@/components/common/UserAvatar';
import { useToast } from '@/context/ToastContext';
import { TASK_STATUS_GROUPS } from '@/pages/Projetos';

// -------------------------------------------------------------
// Tipos
// -------------------------------------------------------------
interface BoardTask {
  id: string;
  project_id: string;
  titulo: string;
  status: string;
  prioridade: 'baixa' | 'media' | 'alta' | null;
  data_fim: string | null;
  responsavel_id: string | null;
  ordem: number | null;
  project: {
    id: string;
    name: string;
    status: string;
    client_id: string | null;
    client: { id: string; name: string } | null;
  } | null;
}

interface TeamUser {
  id: string;
  full_name: string;
  avatar_url?: string | null;
}

// Colunas do board = todos os status de tarefa, na ordem do fluxo.
const BOARD_COLUMNS = [
  ...TASK_STATUS_GROUPS.nao_iniciado,
  ...TASK_STATUS_GROUPS.ativo,
  ...TASK_STATUS_GROUPS.concluido,
];

const CONCLUDED_STATUSES = new Set(TASK_STATUS_GROUPS.concluido.map(s => s.value));

const getInitials = (name: string) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
};

const todayStr = () => new Date().toISOString().split('T')[0];

// -------------------------------------------------------------
// Conteúdo visual do card (usado no board e no DragOverlay)
// -------------------------------------------------------------
function BoardCardContent({ task, responsavel }: { task: BoardTask; responsavel: TeamUser | null }) {
  const isOverdue = !!task.data_fim && task.data_fim < todayStr() && !CONCLUDED_STATUSES.has(task.status);

  return (
    <>
      {/* Projeto / Cliente */}
      <p className="text-[9px] font-bold uppercase tracking-wider text-lumos-text-secondary/70 mb-1 line-clamp-1">
        {task.project?.client?.name ? `${task.project.client.name} · ` : ''}{task.project?.name || 'Projeto'}
      </p>

      {/* Título */}
      <p className="text-xs font-bold text-lumos-text-primary leading-snug line-clamp-3">
        {task.titulo}
        <ExternalLink className="w-3 h-3 inline-block ml-1 opacity-0 group-hover:opacity-50 transition-opacity" />
      </p>

      {/* Rodapé do card */}
      <div className="flex items-center justify-between mt-2.5 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {task.data_fim && (
            <span
              className={clsx(
                'flex items-center gap-1 text-[9px] font-bold whitespace-nowrap',
                isOverdue ? 'text-red-500' : 'text-lumos-text-secondary'
              )}
            >
              <CalendarDays className="w-3 h-3" />
              {new Date(task.data_fim + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </span>
          )}
          {task.prioridade === 'alta' && <Flag className="w-3 h-3 text-red-500 fill-red-500/30" />}
          {task.prioridade === 'media' && <Flag className="w-3 h-3 text-amber-500 fill-amber-500/20" />}
        </div>
        {responsavel && <UserAvatar user={responsavel} size={22} showStatus />}
      </div>
    </>
  );
}

// -------------------------------------------------------------
// Card arrastável (o visual "voa" via DragOverlay; aqui fica o fantasma)
// -------------------------------------------------------------
function BoardCard({
  task,
  responsavel,
  disabled,
  onOpen,
}: {
  task: BoardTask;
  responsavel: TeamUser | null;
  disabled: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => { if (!isDragging) onOpen(); }}
      className={clsx(
        'group bg-lumos-bg border border-lumos-border rounded-lumos p-3 cursor-pointer select-none transition-shadow',
        'hover:border-lumos-yellow/40 hover:shadow-md',
        isDragging && 'opacity-30 border-dashed',
        !disabled && 'touch-none'
      )}
    >
      <BoardCardContent task={task} responsavel={responsavel} />
    </div>
  );
}

// -------------------------------------------------------------
// Coluna droppable
// -------------------------------------------------------------
function BoardColumn({
  status,
  label,
  color,
  count,
  children,
}: {
  status: string;
  label: string;
  color: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status}` });

  return (
    <div className="w-[272px] flex-shrink-0 flex flex-col">
      {/* Cabeçalho */}
      <div className={clsx('flex items-center justify-between px-3 py-2 rounded-t-lumos border', color)}>
        <span className="text-[10px] font-black uppercase tracking-wider">{label}</span>
        <span className="text-[9px] font-black bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded-full">{count}</span>
      </div>

      {/* Corpo (drop target) */}
      <div
        ref={setNodeRef}
        className={clsx(
          'flex-1 space-y-2 p-2 bg-lumos-surface/40 border border-t-0 border-lumos-border/50 rounded-b-lumos min-h-[120px] max-h-[calc(100vh-320px)] overflow-y-auto custom-scrollbar transition-colors',
          isOver && 'bg-lumos-yellow/5 border-lumos-yellow/30'
        )}
      >
        {children}
        {count === 0 && (
          <div className="text-center text-[9px] text-lumos-text-secondary/40 italic py-6 border border-dashed border-lumos-border/40 rounded-lumos">
            Solte um card aqui
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Página
// -------------------------------------------------------------
export default function ProducaoBoard() {
  const { isAdmin, can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros (?projectId= permite chegar já filtrado, ex.: vindo da tab do projeto)
  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>(() => searchParams.get('projectId') || 'all');
  // ?resp= permite chegar já filtrado por pessoa (ex.: Carga por Pessoa da
  // Visão Geral); 'none' = tarefas sem responsável.
  const [responsavelFilter, setResponsavelFilter] = useState<string>(() => searchParams.get('resp') || 'all');
  const [prioridadeFilter, setPrioridadeFilter] = useState<string>('all');
  const [showConcluded, setShowConcluded] = useState(true);

  // Card em arrasto (renderizado no DragOverlay, acima de todas as colunas)
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);

  // Mesma regra do calendário: admin e produção movem cards
  // Editores/atendimento também movem cards (mesma regra do gerenciador)
  const canMove = isAdmin || can('ordem_do_dia');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    fetchBoard();
  }, []);

  // Tempo real: mudanças de outros usuários atualizam o board sem spinner
  useRealtimeRefetch(['projects', 'project_tasks'], () => fetchBoard(true));

  async function fetchBoard(silent = false) {
    try {
      if (!silent) setLoading(true);
      const [tasksRes, usersRes] = await Promise.all([
        supabase
          .from('project_tasks')
          .select(`
            id, project_id, titulo, status, prioridade, data_fim, responsavel_id, ordem,
            project:projects!inner ( id, name, status, client_id, client:clients ( id, name ) )
          `)
          .eq('project.status', 'ativo'),
        supabase.from('app_users').select('id, full_name, avatar_url').eq('status', 'ativo').order('full_name'),
      ]);

      if (tasksRes.error) throw tasksRes.error;
      if (usersRes.error) throw usersRes.error;

      setTasks((tasksRes.data as any[]) || []);
      setTeamUsers(usersRes.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar board:', err);
      toast.error('Erro ao carregar o board de produção.');
    } finally {
      setLoading(false);
    }
  }

  const userById = useMemo(() => {
    const map: Record<string, TeamUser> = {};
    teamUsers.forEach(u => { map[u.id] = u; });
    return map;
  }, [teamUsers]);

  // Lista de projetos ativos presentes no board (para o filtro)
  const boardProjects = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach(t => {
      if (t.project) {
        const label = t.project.client?.name
          ? `${t.project.client.name} · ${t.project.name}`
          : t.project.name;
        map.set(t.project.id, label);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return tasks.filter(t => {
      if (projectFilter !== 'all' && t.project_id !== projectFilter) return false;
      if (responsavelFilter === 'none') { if (t.responsavel_id) return false; }
      else if (responsavelFilter !== 'all' && t.responsavel_id !== responsavelFilter) return false;
      if (prioridadeFilter !== 'all' && t.prioridade !== prioridadeFilter) return false;
      if (term) {
        const haystack = `${t.titulo} ${t.project?.name || ''} ${t.project?.client?.name || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [tasks, searchTerm, projectFilter, responsavelFilter, prioridadeFilter]);

  const columns = useMemo(
    () => (showConcluded ? BOARD_COLUMNS : BOARD_COLUMNS.filter(c => !CONCLUDED_STATUSES.has(c.value))),
    [showConcluded]
  );

  const tasksByStatus = useMemo(() => {
    const map: Record<string, BoardTask[]> = {};
    columns.forEach(c => { map[c.value] = []; });
    filteredTasks.forEach(t => {
      if (map[t.status]) map[t.status].push(t);
    });
    // Ordena: prazo mais próximo primeiro (sem prazo por último), depois ordem
    Object.values(map).forEach(list =>
      list.sort((a, b) => {
        if (a.data_fim && b.data_fim) return a.data_fim.localeCompare(b.data_fim);
        if (a.data_fim) return -1;
        if (b.data_fim) return 1;
        return (a.ordem ?? 0) - (b.ordem ?? 0);
      })
    );
    return map;
  }, [filteredTasks, columns]);

  const handleDragStart = (event: DragStartEvent) => {
    const taskId = event.active.id.toString().replace('task-', '');
    setActiveTask(tasks.find(t => t.id === taskId) ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id.toString().replace('task-', '');
    const newStatus = over.id.toString().replace('col-', '');

    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;

    if (!canMove) {
      toast.error('Você não tem permissão para mover tarefas.');
      return;
    }

    const oldStatus = task.status;

    // Atualização otimista
    setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, status: newStatus } : t)));

    try {
      const { error } = await supabase
        .from('project_tasks')
        .update({ status: newStatus })
        .eq('id', taskId);
      if (error) throw error;
    } catch (err: any) {
      console.error('Erro ao mover tarefa:', err);
      toast.error(`Falha ao mover tarefa: ${err.message}`);
      // Rollback
      setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, status: oldStatus } : t)));
    }
  };

  const openTask = (task: BoardTask) => {
    navigate(`/producao/projetos?projectId=${task.project_id}&taskId=${task.id}`);
  };

  const hasActiveFilters =
    searchTerm.trim() !== '' || projectFilter !== 'all' || responsavelFilter !== 'all' || prioridadeFilter !== 'all';

  const clearFilters = () => {
    setSearchTerm('');
    setProjectFilter('all');
    setResponsavelFilter('all');
    setPrioridadeFilter('all');
  };

  return (
    <div className="space-y-5 font-work-sans">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight flex items-center gap-2.5">
            <Columns3 className="w-7 h-7 text-lumos-yellow" />
            Board de Produção
          </h1>
          <p className="text-lumos-text-secondary font-medium mt-1 text-sm">
            Todas as tarefas dos projetos ativos, por status. {canMove ? 'Arraste um card para mudar o status.' : ''}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input
            type="text"
            placeholder="Buscar tarefa, projeto ou cliente..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="input-lumos pl-9 w-full h-9 text-xs"
          />
        </div>

        <Select value={projectFilter} onChange={setProjectFilter} className="input-lumos h-9 text-xs w-auto max-w-[220px]"
          options={[{ value: 'all', label: 'Todos os projetos' }, ...boardProjects.map(([id, label]) => ({ value: id, label }))]} />

        <Select value={responsavelFilter} onChange={setResponsavelFilter} className="input-lumos h-9 text-xs w-auto max-w-[180px]"
          options={[{ value: 'all', label: 'Todos os responsáveis' }, { value: 'none', label: 'Sem responsável' }, ...teamUsers.map(u => ({ value: u.id, label: u.full_name }))]} />

        <Select value={prioridadeFilter} onChange={setPrioridadeFilter} className="input-lumos h-9 text-xs w-auto"
          options={[{ value: 'all', label: 'Toda prioridade' }, { value: 'alta', label: 'Alta' }, { value: 'media', label: 'Média' }, { value: 'baixa', label: 'Baixa' }]} />

        <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-lumos-text-secondary cursor-pointer select-none px-2">
          <input
            type="checkbox"
            checked={showConcluded}
            onChange={e => setShowConcluded(e.target.checked)}
            className="accent-[#EFC700]"
          />
          Concluídas
        </label>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-lumos-text-secondary hover:text-lumos-yellow transition-colors px-2 py-1.5 border border-lumos-border rounded-full"
          >
            <X className="w-3 h-3" /> Limpar
          </button>
        )}
      </div>

      {/* Board */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-lumos-yellow" />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveTask(null)}
        >
          <div className="flex gap-3 overflow-x-auto pb-4 custom-scrollbar items-start">
            {columns.map(col => {
              const colTasks = tasksByStatus[col.value] || [];
              return (
                <BoardColumn
                  key={col.value}
                  status={col.value}
                  label={col.label}
                  color={col.color}
                  count={colTasks.length}
                >
                  {colTasks.map(task => (
                    <BoardCard
                      key={task.id}
                      task={task}
                      responsavel={task.responsavel_id ? userById[task.responsavel_id] || null : null}
                      disabled={!canMove}
                      onOpen={() => openTask(task)}
                    />
                  ))}
                </BoardColumn>
              );
            })}
          </div>

          {/* Card "voando" acima de todas as colunas durante o arrasto */}
          <DragOverlay dropAnimation={null}>
            {activeTask ? (
              <div className="w-[256px] bg-lumos-bg border border-lumos-yellow/50 rounded-lumos p-3 shadow-2xl ring-1 ring-lumos-yellow/30 rotate-2 cursor-grabbing">
                <BoardCardContent
                  task={activeTask}
                  responsavel={activeTask.responsavel_id ? userById[activeTask.responsavel_id] || null : null}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
