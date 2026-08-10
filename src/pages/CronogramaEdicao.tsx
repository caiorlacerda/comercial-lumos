import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';
import UserAvatar from '@/components/common/UserAvatar';
import { formatBudgetCode } from '@/utils/formatters';
import { taskLabel, isDone } from '@/lib/taskStatus';
import {
  Calendar, Plus, Inbox, ChevronLeft, ChevronRight, AlertTriangle, Search, Loader2, Tag,
} from 'lucide-react';
import { format, isPast, isToday, startOfWeek, addDays, addWeeks, subWeeks, parseISO, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import {
  DndContext, DragOverlay, useSensor, useSensors, PointerSensor,
  DragEndEvent, DragStartEvent, useDraggable, useDroppable,
} from '@dnd-kit/core';

// Tags que fazem uma tarefa entrar no cronograma de edição.
const TRIGGER_TAGS = ['entregas', 'edição'];

interface Task {
  id: string;
  titulo: string;
  status: string;
  prioridade: string;
  data_fim: string | null;
  responsavel_id: string | null;
  project_id: string;
  project: { name: string; code: string | null; client: { name: string } | null } | null;
}
interface AppUser { id: string; full_name: string; avatar_url: string | null; role: string; }

const prioBadge = (p: string) => p === 'alta' ? 'bg-red-500/15 text-red-500' : p === 'baixa' ? 'bg-lumos-text-secondary/15 text-lumos-text-secondary' : 'bg-amber-500/15 text-amber-500';

// ---- Aparência do card (usada em lugar e no DragOverlay) ----
function CardView({ task, dragging, overlay }: { task: Task; dragging?: boolean; overlay?: boolean }) {
  const done = isDone(task.status);
  const overdue = !done && !!task.data_fim && isPast(parseISO(task.data_fim)) && !isToday(parseISO(task.data_fim));
  return (
    <div
      className={clsx(
        'w-full p-2 rounded border select-none',
        overlay ? 'shadow-xl rotate-1 cursor-grabbing' : 'hover:shadow-md',
        dragging ? 'opacity-40' :
          done ? 'bg-green-500/5 border-green-500/30' :
          overdue ? 'bg-red-500/[0.04] border-red-500/40' :
          'bg-lumos-surface border-lumos-border hover:border-lumos-yellow/40',
        (dragging && !overlay) && 'bg-lumos-surface border-dashed border-lumos-yellow/40',
        overlay && (done ? 'bg-green-500/10 border-green-500/40' : overdue ? 'bg-red-500/10 border-red-500/50' : 'bg-lumos-surface border-lumos-yellow/50'),
      )}
    >
      <div className="flex items-start gap-1">
        {overdue && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />}
        <span className={clsx('text-[10px] font-black leading-tight break-words', done ? 'text-green-600 dark:text-green-400 line-through opacity-80' : 'text-lumos-text-primary')}>
          {task.titulo}
        </span>
      </div>
      {task.project && (
        <div className="text-[9px] text-lumos-text-secondary mt-1 font-semibold truncate">
          {task.project.code ? formatBudgetCode(task.project.code) + ' ' : ''}{task.project.name}
        </div>
      )}
      <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-lumos-border/60 gap-1">
        <span className={clsx('text-[8px] px-1 py-0.5 rounded font-black uppercase tracking-wide', prioBadge(task.prioridade))}>{task.prioridade}</span>
        <span className="text-[8px] font-bold text-lumos-text-secondary truncate">{taskLabel(task.status)}</span>
      </div>
    </div>
  );
}

// ---- Wrapper arrastável: NÃO aplica transform no card (isso deixava lerdo e
// deformava). Quem segue o cursor é o DragOverlay; aqui só marcamos a origem. ----
function TaskCard({ task, canManage, onOpen }: { task: Task; canManage: boolean; onOpen: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !canManage });
  return (
    <div
      ref={setNodeRef}
      {...(canManage ? attributes : {})}
      {...(canManage ? listeners : {})}
      onClick={() => onOpen(task)}
      className={clsx('text-left', canManage ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-pointer')}
    >
      <CardView task={task} dragging={isDragging} />
    </div>
  );
}

// ---- Célula droppable ----
function Cell({ id, className, children, canManage }: { id: string; className?: string; children: React.ReactNode; canManage: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id, disabled: !canManage });
  return (
    <div ref={setNodeRef} className={clsx(className, isOver && 'bg-lumos-yellow/10 ring-2 ring-inset ring-lumos-yellow/50')}>
      {children}
    </div>
  );
}

export default function CronogramaEdicao() {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const canManage = profile?.role === 'admin' || profile?.role === 'producao';

  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [entregasTagId, setEntregasTagId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [backlogSearch, setBacklogSearch] = useState('');
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));

  const [activeId, setActiveId] = useState<string | null>(null);
  const [novaOpen, setNovaOpen] = useState(false);
  const [nova, setNova] = useState({ project_id: '', titulo: '', responsavel_id: '', data_fim: '', prioridade: 'media' });
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => { fetchData(); }, []);
  useRealtimeRefetch(['project_tasks', 'project_task_tags', 'app_users'], () => fetchData(true));

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: tagRows } = await supabase.from('task_tags').select('id, name').in('name', TRIGGER_TAGS);
      const tagIds = (tagRows || []).map(t => t.id);
      setEntregasTagId((tagRows || []).find(t => t.name === 'entregas')?.id || tagIds[0] || null);

      let taskIds: string[] = [];
      if (tagIds.length) {
        const { data: ptt } = await supabase.from('project_task_tags').select('task_id').in('tag_id', tagIds);
        taskIds = Array.from(new Set((ptt || []).map(r => r.task_id)));
      }

      let taskData: Task[] = [];
      if (taskIds.length) {
        const { data } = await supabase.from('project_tasks')
          .select('id, titulo, status, prioridade, data_fim, responsavel_id, project_id, project:projects(name, code, client:clients(name))')
          .is('deleted_at', null)
          .in('id', taskIds);
        taskData = (data as any as Task[]) || [];
      }
      setTasks(taskData);

      const [{ data: usersData }, { data: projData }] = await Promise.all([
        supabase.from('app_users').select('id, full_name, avatar_url, role, status').eq('status', 'ativo').order('full_name'),
        supabase.from('projects').select('id, name, code').order('created_at', { ascending: false }),
      ]);
      setUsers((usersData as AppUser[]) || []);
      setProjects((projData as any) || []);
    } catch (err: any) {
      toast.error('Não foi possível carregar o cronograma.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Só editores (cargo de edição), em ordem alfabética.
  const editors = useMemo(() =>
    users.filter(u => u.role === 'editor').sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR')),
  [users]);

  const backlog = useMemo(() => {
    const q = backlogSearch.trim().toLowerCase();
    return tasks.filter(t => !t.data_fim && (!q || t.titulo.toLowerCase().includes(q) || (t.project?.name || '').toLowerCase().includes(q)));
  }, [tasks, backlogSearch]);

  const cellTasks = (userId: string, day: Date) =>
    tasks.filter(t => t.responsavel_id === userId && t.data_fim && isSameDay(parseISO(t.data_fim), day));

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    if (!canManage) return;
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const overId = over.id as string;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    let payload: Partial<Task> = {};
    if (overId === 'backlog') {
      if (!task.data_fim) return;
      payload = { data_fim: null };
    } else if (overId.startsWith('cell__')) {
      const [, userId, dateStr] = overId.split('__');
      if (task.responsavel_id === userId && task.data_fim === dateStr) return;
      payload = { responsavel_id: userId, data_fim: dateStr };
    } else return;

    const prev = tasks;
    setTasks(list => list.map(t => t.id === taskId ? { ...t, ...payload } : t));
    const { error } = await supabase.from('project_tasks').update(payload).eq('id', taskId);
    if (error) { toast.error('Erro ao mover. Revertendo.'); setTasks(prev); return; }
    fetchData(true);
  };

  const openTask = (t: Task) => navigate(`/producao/projetos?projectId=${t.project_id}`);

  const criarEdicao = async () => {
    if (!nova.project_id) { toast.error('Escolha o projeto.'); return; }
    if (!nova.titulo.trim()) { toast.error('Dê um título.'); return; }
    try {
      setSaving(true);
      const { data, error } = await supabase.from('project_tasks').insert([{
        project_id: nova.project_id,
        titulo: nova.titulo.trim(),
        responsavel_id: nova.responsavel_id || null,
        data_fim: nova.data_fim || null,
        prioridade: nova.prioridade,
      }]).select('id').single();
      if (error) throw error;
      // Marca com a tag 'entregas' pra entrar no cronograma.
      if (entregasTagId && data?.id) {
        await supabase.from('project_task_tags').insert([{ task_id: data.id, tag_id: entregasTagId }]);
      }
      setNovaOpen(false);
      setNova({ project_id: '', titulo: '', responsavel_id: '', data_fim: '', prioridade: 'media' });
      toast.success('Edição criada no cronograma!');
      fetchData(true);
    } catch (err: any) {
      toast.error(err.message || 'Falha ao criar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-24 text-center"><Loader2 className="w-10 h-10 animate-spin text-lumos-yellow mx-auto" /></div>;
  }

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight flex items-center gap-2">
            <Calendar className="w-6 h-6 text-lumos-yellow" /> Cronograma de Edição
          </h1>
          <p className="text-lumos-text-secondary text-sm flex items-center gap-1.5 flex-wrap">
            Tarefas de produção com tag
            {TRIGGER_TAGS.map(t => <span key={t} className="inline-flex items-center gap-0.5 text-[10px] font-black uppercase bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow px-1.5 py-0.5 rounded"><Tag className="w-2.5 h-2.5" />{t}</span>)}
            , organizadas por pessoa e prazo.
          </p>
        </div>
        {canManage && (
          <button onClick={() => setNovaOpen(true)} className="btn-primary h-10 px-5 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Nova Edição
          </button>
        )}
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
        {/* Grade semanal por pessoa */}
        <div className="bg-lumos-surface border border-lumos-border rounded-lumos overflow-hidden">
          <div className="px-4 py-3 border-b border-lumos-border flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Grade semanal</h2>
              <p className="text-[11px] text-lumos-text-secondary">Entregas por pessoa e dia (posição = prazo).</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekStart(w => subWeeks(w, 1))} className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="h-8 px-3 text-[11px] font-bold rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow">Hoje</button>
              <span className="text-[11px] font-black uppercase text-amber-600 dark:text-lumos-yellow bg-lumos-yellow/10 px-2 py-1 rounded whitespace-nowrap">
                {format(weekStart, "dd MMM", { locale: ptBR })} – {format(addDays(weekStart, 6), "dd MMM yyyy", { locale: ptBR })}
              </span>
              <button onClick={() => setWeekStart(w => addWeeks(w, 1))} className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Cabeçalho dos dias */}
              <div className="grid border-b border-lumos-border" style={{ gridTemplateColumns: '180px repeat(7, minmax(0, 1fr))' }}>
                <div className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Pessoa</div>
                {days.map(d => (
                  <div key={d.toISOString()} className={clsx('px-2 py-2 text-center border-l border-lumos-border', isToday(d) && 'bg-lumos-yellow/[0.06]')}>
                    <p className="text-[10px] font-black uppercase text-lumos-text-secondary">{format(d, 'EEE', { locale: ptBR })}</p>
                    <p className={clsx('text-[11px] font-bold', isToday(d) ? 'text-amber-600 dark:text-lumos-yellow' : 'text-lumos-text-primary')}>{format(d, 'dd/MM')}</p>
                  </div>
                ))}
              </div>

              {/* Linhas por editor */}
              {editors.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-lumos-text-secondary">Nenhum editor cadastrado. Defina o cargo “Editor” em Equipe.</div>
              )}
              {editors.map(u => (
                <div key={u.id} className="grid border-b border-lumos-border/60 last:border-0" style={{ gridTemplateColumns: '180px repeat(7, minmax(0, 1fr))' }}>
                  <div className="px-3 py-2 flex items-center gap-2 min-w-0">
                    <UserAvatar user={u as any} size={28} showStatus />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-lumos-text-primary truncate">{u.full_name}</p>
                    </div>
                  </div>
                  {days.map(d => {
                    const items = cellTasks(u.id, d);
                    return (
                      <Cell key={d.toISOString()} id={`cell__${u.id}__${format(d, 'yyyy-MM-dd')}`} canManage={canManage}
                        className={clsx('min-w-0 min-h-[68px] p-1.5 border-l border-lumos-border/60 space-y-1.5', isToday(d) && 'bg-lumos-yellow/[0.03]')}>
                        {items.map(t => <TaskCard key={t.id} task={t} canManage={canManage} onOpen={openTask} />)}
                      </Cell>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Backlog: tarefas com tag mas sem prazo */}
        <Cell id="backlog" canManage={canManage} className="bg-lumos-surface border border-lumos-border rounded-lumos">
          <div className="px-4 py-3 border-b border-lumos-border flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-lumos-yellow" />
              <h2 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Sem prazo (backlog)</h2>
              <span className="text-[11px] text-lumos-text-secondary">{backlog.length}</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary" />
              <input value={backlogSearch} onChange={e => setBacklogSearch(e.target.value)} placeholder="Filtrar backlog…"
                className="input-lumos pl-8 h-8 text-xs w-56" />
            </div>
          </div>
          <div className="p-3">
            {backlog.length === 0 ? (
              <p className="text-center text-sm text-lumos-text-secondary py-6">
                Nada pendente. Toda tarefa com tag de edição/entrega já tem prazo.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {backlog.map(t => <TaskCard key={t.id} task={t} canManage={canManage} onOpen={openTask} />)}
              </div>
            )}
            {canManage && <p className="text-[10px] text-lumos-text-secondary/70 mt-3 text-center">Arraste um card para a célula de uma pessoa/dia para agendar (define responsável e prazo).</p>}
          </div>
        </Cell>

        <DragOverlay dropAnimation={null}>
          {activeId ? (() => {
            const t = tasks.find(x => x.id === activeId);
            return t ? <div className="w-44"><CardView task={t} overlay /></div> : null;
          })() : null}
        </DragOverlay>
      </DndContext>

      {/* Nova Edição = cria uma tarefa de projeto com a tag 'entregas' */}
      <Modal isOpen={novaOpen} onClose={() => setNovaOpen(false)} title="Nova Edição">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Projeto *</label>
            <Select value={nova.project_id} onChange={v => setNova(n => ({ ...n, project_id: v }))} className="input-lumos w-full"
              options={[{ value: '', label: 'Selecione…' }, ...projects.map(p => ({ value: p.id, label: `${p.code ? formatBudgetCode(p.code) + ' ' : ''}${p.name}` }))]} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Título *</label>
            <input className="input-lumos w-full" value={nova.titulo} onChange={e => setNova(n => ({ ...n, titulo: e.target.value }))} placeholder="Ex.: Corte final — Reels 01" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Responsável</label>
              <Select value={nova.responsavel_id} onChange={v => setNova(n => ({ ...n, responsavel_id: v }))} className="input-lumos w-full"
                options={[{ value: '', label: 'Sem responsável' }, ...users.map(u => ({ value: u.id, label: u.full_name }))]} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Prioridade</label>
              <Select value={nova.prioridade} onChange={v => setNova(n => ({ ...n, prioridade: v }))} className="input-lumos w-full"
                options={[{ value: 'baixa', label: 'Baixa' }, { value: 'media', label: 'Média' }, { value: 'alta', label: 'Alta' }]} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Prazo (entrega)</label>
            <input type="date" className="input-lumos w-full" value={nova.data_fim} onChange={e => setNova(n => ({ ...n, data_fim: e.target.value }))} />
          </div>
          <p className="text-[11px] text-lumos-text-secondary">A tarefa é criada no projeto com a tag <b>entregas</b>, então aparece aqui e na lista/board do projeto, tudo conectado.</p>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setNovaOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={criarEdicao} disabled={saving} className="btn-primary flex-1 h-10 flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
