import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChartGantt, ChevronDown, ChevronRight, ChevronLeft, X, Search,
} from 'lucide-react';
import { clsx } from 'clsx';
import { addDays, format, startOfWeek, startOfMonth, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import ProducaoViewsNav from '@/components/producao/ProducaoViewsNav';
import { TASK_STATUS_GROUPS, getStatusDetails } from '@/pages/Projetos';

// -------------------------------------------------------------
// Tipos e helpers
// -------------------------------------------------------------
interface ScheduleTask {
  id: string;
  project_id: string;
  titulo: string;
  status: string;
  prioridade: 'baixa' | 'media' | 'alta' | null;
  data_inicio: string | null;
  data_fim: string | null;
  responsavel_id: string | null;
}

interface ScheduleProject {
  id: string;
  name: string;
  client: { name: string } | null;
}

type ZoomLevel = 'semana' | 'mes' | 'trimestre';

const ZOOM_CONFIG: Record<ZoomLevel, { pxPerDay: number; spanDays: number; navDays: number }> = {
  semana: { pxPerDay: 48, spanDays: 28, navDays: 7 },
  mes: { pxPerDay: 24, spanDays: 56, navDays: 28 },
  trimestre: { pxPerDay: 11, spanDays: 126, navDays: 28 },
};

const NAME_COL_W = 250;
const CONCLUDED_STATUSES = new Set(TASK_STATUS_GROUPS.concluido.map(s => s.value));
const ACTIVE_STATUSES = new Set(TASK_STATUS_GROUPS.ativo.map(s => s.value));

const atNoon = (dateStr: string) => new Date(dateStr + 'T12:00:00');
const toDateStr = (d: Date) => format(d, 'yyyy-MM-dd');
const todayStr = () => toDateStr(new Date());

function defaultRangeStart(zoom: ZoomLevel): Date {
  const today = new Date();
  if (zoom === 'mes') return addDays(startOfMonth(today), -7);
  if (zoom === 'trimestre') return addDays(startOfWeek(today, { weekStartsOn: 0 }), -28);
  return addDays(startOfWeek(today, { weekStartsOn: 0 }), -7);
}

function barClassFor(status: string, overdue: boolean): string {
  if (CONCLUDED_STATUSES.has(status)) return 'bg-green-500/60 border-green-500/80';
  if (overdue) return 'bg-red-500/50 border-red-500/80';
  if (ACTIVE_STATUSES.has(status)) return 'bg-lumos-yellow/70 border-lumos-yellow';
  return 'bg-neutral-400/40 border-neutral-400/60';
}

interface DragState {
  taskId: string;
  mode: 'move' | 'start' | 'end';
  originX: number;
  delta: number; // em dias (snapped)
}

// -------------------------------------------------------------
// Página
// -------------------------------------------------------------
export default function ProducaoSchedule() {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [projects, setProjects] = useState<ScheduleProject[]>([]);
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [teamUsers, setTeamUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [zoom, setZoom] = useState<ZoomLevel>('mes');
  const [rangeStart, setRangeStart] = useState<Date>(() => defaultRangeStart('mes'));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>(() => searchParams.get('projectId') || 'all');
  const [responsavelFilter, setResponsavelFilter] = useState<string>('all');
  const [showConcluded, setShowConcluded] = useState(true);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const suppressClickRef = useRef(false);

  const canMove = profile?.role === 'admin' || profile?.role === 'producao';
  const { pxPerDay, spanDays, navDays } = ZOOM_CONFIG[zoom];

  // -----------------------------------------------------------
  // Dados
  // -----------------------------------------------------------
  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const [projRes, taskRes, usersRes] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, client:clients(name)')
          .eq('status', 'ativo')
          .order('name'),
        supabase
          .from('project_tasks')
          .select('id, project_id, titulo, status, prioridade, data_inicio, data_fim, responsavel_id, project:projects!inner(status)')
          .eq('project.status', 'ativo'),
        supabase.from('app_users').select('id, full_name').eq('status', 'ativo').order('full_name'),
      ]);
      if (projRes.error) throw projRes.error;
      if (taskRes.error) throw taskRes.error;
      if (usersRes.error) throw usersRes.error;

      setProjects((projRes.data as any[]) || []);
      setTasks((taskRes.data as any[]) || []);
      setTeamUsers(usersRes.data || []);

      // Expande todos os projetos por padrão
      const exp: Record<string, boolean> = {};
      ((projRes.data as any[]) || []).forEach(p => { exp[p.id] = true; });
      setExpanded(exp);
    } catch (err: any) {
      console.error('Erro ao carregar timeline:', err);
      toast.error('Erro ao carregar a timeline.');
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------------------------------------
  // Filtros
  // -----------------------------------------------------------
  const filteredTasks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return tasks.filter(t => {
      if (!showConcluded && CONCLUDED_STATUSES.has(t.status)) return false;
      if (responsavelFilter !== 'all' && t.responsavel_id !== responsavelFilter) return false;
      if (term && !t.titulo.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [tasks, searchTerm, responsavelFilter, showConcluded]);

  const visibleProjects = useMemo(() => {
    let list = projects;
    if (projectFilter !== 'all') list = list.filter(p => p.id === projectFilter);
    const term = searchTerm.trim().toLowerCase();
    return list.filter(p => {
      const hasTasks = filteredTasks.some(t => t.project_id === p.id);
      if (term) {
        const nameMatch = `${p.client?.name || ''} ${p.name}`.toLowerCase().includes(term);
        return nameMatch || hasTasks;
      }
      return true;
    });
  }, [projects, projectFilter, filteredTasks, searchTerm]);

  const tasksByProject = useMemo(() => {
    const map: Record<string, ScheduleTask[]> = {};
    filteredTasks.forEach(t => {
      (map[t.project_id] = map[t.project_id] || []).push(t);
    });
    // Ordena por data de início (depois fim), sem data por último
    Object.values(map).forEach(list =>
      list.sort((a, b) => (a.data_inicio || a.data_fim || '9999').localeCompare(b.data_inicio || b.data_fim || '9999'))
    );
    return map;
  }, [filteredTasks]);

  // -----------------------------------------------------------
  // Geometria do gráfico
  // -----------------------------------------------------------
  const days: Date[] = useMemo(
    () => Array.from({ length: spanDays }, (_, i) => addDays(rangeStart, i)),
    [rangeStart, spanDays]
  );
  const chartWidth = spanDays * pxPerDay;
  const todayIdx = differenceInCalendarDays(new Date(), rangeStart);

  const dayIdx = (dateStr: string) => differenceInCalendarDays(atNoon(dateStr), rangeStart);

  // Posição da barra de uma tarefa (com o delta do drag aplicado)
  function taskBarGeometry(t: ScheduleTask) {
    let inicio = t.data_inicio;
    let fim = t.data_fim;
    if (!inicio && !fim) return null;

    if (dragState && dragState.taskId === t.id && dragState.delta !== 0) {
      const d = dragState.delta;
      if (dragState.mode === 'move') {
        if (inicio) inicio = toDateStr(addDays(atNoon(inicio), d));
        if (fim) fim = toDateStr(addDays(atNoon(fim), d));
      } else if (dragState.mode === 'start' && inicio) {
        const cand = toDateStr(addDays(atNoon(inicio), d));
        inicio = fim && cand > fim ? fim : cand;
      } else if (dragState.mode === 'end' && fim) {
        const cand = toDateStr(addDays(atNoon(fim), d));
        fim = inicio && cand < inicio ? inicio : cand;
      }
    }

    const isMilestone = !inicio;
    const startIdx = dayIdx(inicio || fim!);
    const endIdx = dayIdx(fim || inicio!);
    if (endIdx < 0 || startIdx > spanDays - 1) return { off: true } as const;

    const clampedStart = Math.max(startIdx, 0);
    const clampedEnd = Math.min(endIdx, spanDays - 1);
    return {
      off: false,
      isMilestone,
      left: clampedStart * pxPerDay,
      width: Math.max((clampedEnd - clampedStart + 1) * pxPerDay - 3, isMilestone ? 12 : 10),
      clippedLeft: startIdx < 0,
      clippedRight: endIdx > spanDays - 1,
    } as const;
  }

  // -----------------------------------------------------------
  // Drag para mover/redimensionar datas
  // -----------------------------------------------------------
  const beginDrag = (e: React.PointerEvent, task: ScheduleTask, mode: DragState['mode']) => {
    if (!canMove) return;
    e.preventDefault();
    e.stopPropagation();
    setDragState({ taskId: task.id, mode, originX: e.clientX, delta: 0 });
  };

  useEffect(() => {
    if (!dragState) return;

    const onMove = (e: PointerEvent) => {
      const delta = Math.round((e.clientX - dragState.originX) / pxPerDay);
      setDragState(prev => (prev ? { ...prev, delta } : prev));
    };

    const onUp = async () => {
      const { taskId, mode, delta } = dragState;
      setDragState(null);

      if (delta === 0) return;
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 150);

      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      const updates: Partial<ScheduleTask> = {};
      if (mode === 'move') {
        if (task.data_inicio) updates.data_inicio = toDateStr(addDays(atNoon(task.data_inicio), delta));
        if (task.data_fim) updates.data_fim = toDateStr(addDays(atNoon(task.data_fim), delta));
      } else if (mode === 'start' && task.data_inicio) {
        let cand = toDateStr(addDays(atNoon(task.data_inicio), delta));
        if (task.data_fim && cand > task.data_fim) cand = task.data_fim;
        updates.data_inicio = cand;
      } else if (mode === 'end' && task.data_fim) {
        let cand = toDateStr(addDays(atNoon(task.data_fim), delta));
        if (task.data_inicio && cand < task.data_inicio) cand = task.data_inicio;
        updates.data_fim = cand;
      }
      if (Object.keys(updates).length === 0) return;

      const previous = { data_inicio: task.data_inicio, data_fim: task.data_fim };
      // Otimista
      setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, ...updates } : t)));
      try {
        const { error } = await supabase.from('project_tasks').update(updates).eq('id', taskId);
        if (error) throw error;
        toast.success('Datas atualizadas ✓');
      } catch (err: any) {
        console.error('Erro ao atualizar datas:', err);
        toast.error(`Falha ao salvar: ${err.message}`);
        setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, ...previous } : t)));
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragState, pxPerDay, tasks]);

  const openTask = (task: ScheduleTask) => {
    if (suppressClickRef.current) return;
    navigate(`/producao/projetos?projectId=${task.project_id}&taskId=${task.id}`);
  };

  // -----------------------------------------------------------
  // Navegação temporal
  // -----------------------------------------------------------
  const changeZoom = (z: ZoomLevel) => {
    setZoom(z);
    setRangeStart(defaultRangeStart(z));
  };

  const hasActiveFilters =
    searchTerm.trim() !== '' || projectFilter !== 'all' || responsavelFilter !== 'all';

  // -----------------------------------------------------------
  // Render
  // -----------------------------------------------------------
  return (
    <div className="space-y-5 font-work-sans">
      <ProducaoViewsNav />
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight flex items-center gap-2.5">
            <ChartGantt className="w-7 h-7 text-lumos-yellow" />
            Timeline
          </h1>
          <p className="text-lumos-text-secondary font-medium mt-1 text-sm">
            Projetos e tarefas no tempo. {canMove ? 'Arraste as barras para mover prazos; puxe as bordas para esticar.' : ''}
          </p>
        </div>

        {/* Zoom + navegação */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-lumos-surface/40 p-1 border border-lumos-border/50 rounded-full">
            {(['semana', 'mes', 'trimestre'] as const).map(z => (
              <button
                key={z}
                onClick={() => changeZoom(z)}
                className={clsx(
                  'px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all',
                  zoom === z ? 'bg-lumos-yellow text-lumos-bg shadow-md' : 'text-lumos-text-secondary hover:text-lumos-text-primary'
                )}
              >
                {z === 'semana' ? 'Semana' : z === 'mes' ? 'Mês' : 'Trimestre'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setRangeStart(prev => addDays(prev, -navDays))}
              className="p-2 rounded-full border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow/40 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setRangeStart(defaultRangeStart(zoom))}
              className="px-3 py-1.5 rounded-full border border-lumos-border text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow/40 transition-all"
            >
              Hoje
            </button>
            <button
              onClick={() => setRangeStart(prev => addDays(prev, navDays))}
              className="p-2 rounded-full border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow/40 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input
            type="text"
            placeholder="Buscar tarefa ou projeto..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="input-lumos pl-9 w-full h-9 text-xs"
          />
        </div>
        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="input-lumos h-9 text-xs w-auto max-w-[220px]">
          <option value="all">Todos os projetos</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.client?.name ? `${p.client.name} · ` : ''}{p.name}</option>
          ))}
        </select>
        <select value={responsavelFilter} onChange={e => setResponsavelFilter(e.target.value)} className="input-lumos h-9 text-xs w-auto max-w-[180px]">
          <option value="all">Todos os responsáveis</option>
          {teamUsers.map(u => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-lumos-text-secondary cursor-pointer select-none px-2">
          <input type="checkbox" checked={showConcluded} onChange={e => setShowConcluded(e.target.checked)} className="accent-[#EFC700]" />
          Concluídas
        </label>
        {hasActiveFilters && (
          <button
            onClick={() => { setSearchTerm(''); setProjectFilter('all'); setResponsavelFilter('all'); }}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-lumos-text-secondary hover:text-lumos-yellow transition-colors px-2 py-1.5 border border-lumos-border rounded-full"
          >
            <X className="w-3 h-3" /> Limpar
          </button>
        )}
      </div>

      {/* Gráfico */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-lumos-yellow" />
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="text-center py-24 text-sm text-lumos-text-secondary italic border border-dashed border-lumos-border/50 rounded-lumos">
          Nenhum projeto ativo encontrado.
        </div>
      ) : (
        <div className="border border-lumos-border rounded-lumos overflow-auto custom-scrollbar max-h-[calc(100vh-300px)] bg-lumos-surface/20 select-none">
          <div style={{ width: NAME_COL_W + chartWidth, minWidth: '100%' }}>
            {/* Cabeçalho de datas */}
            <div className="flex sticky top-0 z-30 bg-lumos-surface border-b border-lumos-border">
              <div
                className="sticky left-0 z-10 bg-lumos-surface border-r border-lumos-border px-3 py-2 text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary flex items-end"
                style={{ width: NAME_COL_W, minWidth: NAME_COL_W }}
              >
                Projeto / Tarefa
              </div>
              <div className="relative" style={{ width: chartWidth, height: 38 }}>
                {days.map((d, i) => {
                  const isMonday = d.getDay() === 1;
                  const isFirstOfMonth = d.getDate() === 1;
                  const showLabel = zoom === 'trimestre' ? isMonday : true;
                  if (!showLabel && !isFirstOfMonth) return null;
                  return (
                    <div
                      key={i}
                      className="absolute bottom-0 top-0 flex flex-col items-center justify-end pb-1"
                      style={{ left: i * pxPerDay, width: zoom === 'trimestre' ? pxPerDay * 7 : pxPerDay }}
                    >
                      {(isFirstOfMonth || i === 0) && (
                        <span className="text-[8px] font-black uppercase text-lumos-yellow absolute top-0.5 left-1 whitespace-nowrap">
                          {format(d, 'MMM', { locale: ptBR })}
                        </span>
                      )}
                      <span className={clsx(
                        'text-[8px] font-bold',
                        differenceInCalendarDays(d, new Date()) === 0 ? 'text-lumos-yellow' : 'text-lumos-text-secondary/70'
                      )}>
                        {zoom === 'semana'
                          ? format(d, 'EEEEEE dd', { locale: ptBR })
                          : format(d, 'dd')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Linhas */}
            {visibleProjects.map(proj => {
              const projTasks = tasksByProject[proj.id] || [];
              const datedTasks = projTasks.filter(t => t.data_inicio || t.data_fim);
              const undatedCount = projTasks.length - datedTasks.length;
              const isExpanded = expanded[proj.id] ?? true;

              // Barra agregada do projeto (min início → max fim das tarefas)
              const allDates = datedTasks.flatMap(t => [t.data_inicio, t.data_fim].filter(Boolean) as string[]);
              const projStart = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : null;
              const projEnd = allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : null;

              return (
                <div key={proj.id}>
                  {/* Linha do projeto */}
                  <div className="flex border-b border-lumos-border/40 bg-lumos-surface/60">
                    <button
                      onClick={() => setExpanded(prev => ({ ...prev, [proj.id]: !isExpanded }))}
                      className="sticky left-0 z-10 bg-lumos-surface border-r border-lumos-border px-2 py-2 flex items-center gap-1.5 text-left hover:bg-lumos-text-secondary/5 transition-colors"
                      style={{ width: NAME_COL_W, minWidth: NAME_COL_W }}
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />}
                      <span className="min-w-0">
                        <span className="block text-[11px] font-black text-lumos-text-primary truncate">{proj.name}</span>
                        <span className="block text-[9px] text-lumos-text-secondary truncate">
                          {proj.client?.name || '—'}
                          {undatedCount > 0 && ` · ${undatedCount} sem data`}
                        </span>
                      </span>
                    </button>
                    <div className="relative flex-shrink-0" style={{ width: chartWidth, height: 38 }}>
                      <GridBackdrop days={days} pxPerDay={pxPerDay} todayIdx={todayIdx} zoom={zoom} />
                      {projStart && projEnd && (() => {
                        const s = Math.max(dayIdx(projStart), 0);
                        const e2 = Math.min(dayIdx(projEnd), spanDays - 1);
                        if (e2 < 0 || s > spanDays - 1) return null;
                        return (
                          <div
                            className="absolute h-1.5 rounded-full bg-lumos-yellow/50 top-1/2 -translate-y-1/2"
                            style={{ left: s * pxPerDay + 1, width: Math.max((e2 - s + 1) * pxPerDay - 3, 6) }}
                          />
                        );
                      })()}
                    </div>
                  </div>

                  {/* Linhas das tarefas */}
                  {isExpanded && datedTasks.map(task => {
                    const geo = taskBarGeometry(task);
                    const isOverdue = !!task.data_fim && task.data_fim < todayStr() && !CONCLUDED_STATUSES.has(task.status);
                    const statusDet = getStatusDetails(task.status);
                    const isDraggingThis = dragState?.taskId === task.id;

                    return (
                      <div key={task.id} className="flex border-b border-lumos-border/25 hover:bg-lumos-text-secondary/[0.03] transition-colors">
                        <button
                          onClick={() => openTask(task)}
                          className="sticky left-0 z-10 bg-lumos-bg border-r border-lumos-border pl-7 pr-3 py-1.5 text-left hover:text-lumos-yellow transition-colors"
                          style={{ width: NAME_COL_W, minWidth: NAME_COL_W }}
                          title={`${task.titulo} — ${statusDet.label}`}
                        >
                          <span className="block text-[10px] font-bold text-lumos-text-primary truncate">{task.titulo}</span>
                        </button>
                        <div className="relative flex-shrink-0" style={{ width: chartWidth, height: 30 }}>
                          <GridBackdrop days={days} pxPerDay={pxPerDay} todayIdx={todayIdx} zoom={zoom} />
                          {geo && !geo.off && (
                            geo.isMilestone ? (
                              <div
                                onClick={() => openTask(task)}
                                onPointerDown={e => beginDrag(e, task, 'end')}
                                title={`${task.titulo} · entrega ${task.data_fim}`}
                                className={clsx(
                                  'absolute top-1/2 -translate-y-1/2 w-3 h-3 rotate-45 border cursor-pointer touch-none',
                                  barClassFor(task.status, isOverdue),
                                  isDraggingThis && 'ring-2 ring-lumos-yellow'
                                )}
                                style={{ left: geo.left + pxPerDay / 2 - 6 }}
                              />
                            ) : (
                              <div
                                onClick={() => openTask(task)}
                                onPointerDown={e => beginDrag(e, task, 'move')}
                                title={`${task.titulo} · ${statusDet.label}`}
                                className={clsx(
                                  'absolute top-1/2 -translate-y-1/2 h-4.5 h-[18px] rounded-full border flex items-center overflow-hidden touch-none',
                                  barClassFor(task.status, isOverdue),
                                  canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                                  isDraggingThis && 'ring-2 ring-lumos-yellow shadow-lg z-10',
                                  geo.clippedLeft && 'rounded-l-none border-l-0',
                                  geo.clippedRight && 'rounded-r-none border-r-0'
                                )}
                                style={{ left: geo.left + 1, width: geo.width }}
                              >
                                {/* Alças de redimensionamento */}
                                {canMove && !geo.clippedLeft && (
                                  <span
                                    onPointerDown={e => beginDrag(e, task, 'start')}
                                    className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20"
                                  />
                                )}
                                {canMove && !geo.clippedRight && (
                                  <span
                                    onPointerDown={e => beginDrag(e, task, 'end')}
                                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/20"
                                  />
                                )}
                                {geo.width > 60 && (
                                  <span className="text-[8px] font-black text-black/70 dark:text-black/80 px-2 truncate pointer-events-none">
                                    {task.titulo}
                                  </span>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legenda */}
      <div className="flex items-center gap-4 flex-wrap text-[9px] font-bold uppercase tracking-wider text-lumos-text-secondary">
        <span className="flex items-center gap-1.5"><span className="w-4 h-2 rounded-full bg-neutral-400/40 border border-neutral-400/60" /> Não iniciado</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-2 rounded-full bg-lumos-yellow/70 border border-lumos-yellow" /> Em andamento</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-2 rounded-full bg-green-500/60 border border-green-500/80" /> Concluída</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-2 rounded-full bg-red-500/50 border border-red-500/80" /> Atrasada</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rotate-45 bg-lumos-yellow/70 border border-lumos-yellow" /> Entrega (sem início)</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Fundo da linha: fins de semana, grade e linha de hoje
// -------------------------------------------------------------
function GridBackdrop({ days, pxPerDay, todayIdx, zoom }: {
  days: Date[];
  pxPerDay: number;
  todayIdx: number;
  zoom: ZoomLevel;
}) {
  return (
    <>
      {/* Fins de semana */}
      {pxPerDay >= 16 && days.map((d, i) => (
        (d.getDay() === 0 || d.getDay() === 6) ? (
          <span key={`we-${i}`} className="absolute top-0 bottom-0 bg-lumos-text-secondary/[0.04]" style={{ left: i * pxPerDay, width: pxPerDay }} />
        ) : null
      ))}
      {/* Grade vertical */}
      {days.map((d, i) => {
        const show = zoom === 'trimestre' ? d.getDay() === 1 : true;
        if (!show || i === 0) return null;
        return <span key={`gl-${i}`} className="absolute top-0 bottom-0 w-px bg-lumos-border/25" style={{ left: i * pxPerDay }} />;
      })}
      {/* Linha de hoje */}
      {todayIdx >= 0 && todayIdx < days.length && (
        <span className="absolute top-0 bottom-0 w-[2px] bg-lumos-yellow/70 z-[5]" style={{ left: (todayIdx + 0.5) * pxPerDay }} />
      )}
    </>
  );
}
