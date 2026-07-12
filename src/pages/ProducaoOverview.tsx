import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, Activity, CalendarDays, AlertTriangle,
  ChevronRight, MessageSquare, CheckCircle2, Flag,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useToast } from '@/context/ToastContext';
import { TASK_STATUS_GROUPS, getStatusDetails } from '@/pages/Projetos';

// -------------------------------------------------------------
// Tipos e helpers
// -------------------------------------------------------------
interface OverviewTask {
  id: string;
  project_id: string;
  titulo: string;
  status: string;
  prioridade: 'baixa' | 'media' | 'alta' | null;
  data_fim: string | null;
  responsavel_id: string | null;
  project: { id: string; name: string; client: { name: string } | null } | null;
}

interface ActivityItem {
  id: string;
  type: 'comment' | 'done';
  when: string;
  who: string;
  text: string;
  sub: string;
  projectId: string | null;
  taskId: string | null;
}

const CONCLUDED_STATUSES = new Set(TASK_STATUS_GROUPS.concluido.map(s => s.value));
const ACTIVE_STATUSES = new Set(TASK_STATUS_GROUPS.ativo.map(s => s.value));

const todayStr = () => new Date().toISOString().split('T')[0];
const plusDaysStr = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

const getInitials = (name: string) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
};

const relativeTime = (dateStr: string) => {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const fmtDay = (dateStr: string) =>
  new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

// -------------------------------------------------------------
// Página
// -------------------------------------------------------------
export default function ProducaoOverview() {
  const toast = useToast();
  const navigate = useNavigate();

  const [projectsCount, setProjectsCount] = useState(0);
  const [tasks, setTasks] = useState<OverviewTask[]>([]);
  const [teamUsers, setTeamUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  // Tempo real: mudanças de outros usuários atualizam a visão sem spinner
  useRealtimeRefetch(['projects', 'project_tasks', 'task_comments'], () => fetchData(true));

  async function fetchData(silent = false) {
    try {
      if (!silent) setLoading(true);
      const [projRes, taskRes, usersRes, commentsRes, doneRes] = await Promise.all([
        supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
        supabase
          .from('project_tasks')
          .select('id, project_id, titulo, status, prioridade, data_fim, responsavel_id, project:projects!inner(id, name, status, client:clients(name))')
          .eq('project.status', 'ativo'),
        supabase.from('app_users').select('id, full_name').eq('status', 'ativo'),
        supabase
          .from('task_comments')
          .select('id, content, created_at, user:app_users(full_name), task:project_tasks(id, titulo, project_id)')
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('project_tasks')
          .select('id, titulo, status, updated_at, project_id, responsavel:app_users!responsavel_id(full_name)')
          .in('status', ['entregue', 'concluido'])
          .order('updated_at', { ascending: false })
          .limit(5),
      ]);

      if (taskRes.error) throw taskRes.error;

      setProjectsCount(projRes.count ?? 0);
      setTasks((taskRes.data as any[]) || []);
      setTeamUsers(usersRes.data || []);

      // Feed: comentários + tarefas concluídas recentemente, mesclados por data
      const items: ActivityItem[] = [];
      ((commentsRes.data as any[]) || []).forEach(c => {
        items.push({
          id: `c-${c.id}`,
          type: 'comment',
          when: c.created_at,
          who: c.user?.full_name || 'Alguém',
          text: c.content?.length > 90 ? c.content.slice(0, 90) + '…' : (c.content || ''),
          sub: c.task?.titulo || 'Tarefa',
          projectId: c.task?.project_id ?? null,
          taskId: c.task?.id ?? null,
        });
      });
      ((doneRes.data as any[]) || []).forEach(t => {
        items.push({
          id: `d-${t.id}`,
          type: 'done',
          when: t.updated_at,
          who: t.responsavel?.full_name || 'Equipe',
          text: t.titulo,
          sub: getStatusDetails(t.status).label,
          projectId: t.project_id,
          taskId: t.id,
        });
      });
      items.sort((a, b) => b.when.localeCompare(a.when));
      setActivity(items.slice(0, 10));
    } catch (err: any) {
      console.error('Erro ao carregar visão geral:', err);
      toast.error('Erro ao carregar a visão geral.');
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------------------------------------
  // Métricas derivadas
  // -----------------------------------------------------------
  const openTasks = useMemo(() => tasks.filter(t => !CONCLUDED_STATUSES.has(t.status)), [tasks]);
  const inProgress = useMemo(() => tasks.filter(t => ACTIVE_STATUSES.has(t.status)), [tasks]);

  const overdue = useMemo(
    () => openTasks
      .filter(t => t.data_fim && t.data_fim < todayStr())
      .sort((a, b) => (a.data_fim || '').localeCompare(b.data_fim || '')),
    [openTasks]
  );

  const dueSoon = useMemo(() => {
    const start = todayStr();
    const end = plusDaysStr(7);
    return openTasks
      .filter(t => t.data_fim && t.data_fim >= start && t.data_fim <= end)
      .sort((a, b) => (a.data_fim || '').localeCompare(b.data_fim || ''));
  }, [openTasks]);

  // Distribuição por status (todos os 13, na ordem do fluxo)
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
    return counts;
  }, [tasks]);

  const groupTotals = useMemo(() => ({
    nao_iniciado: TASK_STATUS_GROUPS.nao_iniciado.reduce((acc, s) => acc + (statusCounts[s.value] || 0), 0),
    ativo: TASK_STATUS_GROUPS.ativo.reduce((acc, s) => acc + (statusCounts[s.value] || 0), 0),
    concluido: TASK_STATUS_GROUPS.concluido.reduce((acc, s) => acc + (statusCounts[s.value] || 0), 0),
  }), [statusCounts]);

  // Carga por pessoa (tarefas abertas)
  const workload = useMemo(() => {
    const byUser: Record<string, number> = {};
    let unassigned = 0;
    openTasks.forEach(t => {
      if (t.responsavel_id) byUser[t.responsavel_id] = (byUser[t.responsavel_id] || 0) + 1;
      else unassigned++;
    });
    const rows = Object.entries(byUser)
      .map(([id, count]) => ({
        id,
        name: teamUsers.find(u => u.id === id)?.full_name || 'Usuário',
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    return { rows, unassigned, max: rows.length ? rows[0].count : 0 };
  }, [openTasks, teamUsers]);

  const openTaskInManager = (projectId: string | null, taskId: string | null) => {
    if (!projectId) return;
    navigate(`/producao/projetos?projectId=${projectId}${taskId ? `&taskId=${taskId}` : ''}`);
  };

  const totalTasks = tasks.length;

  // -----------------------------------------------------------
  // Render
  // -----------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-lumos-yellow" />
      </div>
    );
  }

  return (
    <div className="space-y-6 font-work-sans">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight flex items-center gap-2.5">
          <LayoutDashboard className="w-7 h-7 text-lumos-yellow" />
          Visão Geral da Produção
        </h1>
        <p className="text-lumos-text-secondary font-medium mt-1 text-sm">
          Tudo o que está acontecendo nos projetos ativos, num lugar só.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button onClick={() => navigate('/producao/projetos')} className="card p-5 text-left hover:border-lumos-yellow/40 transition-colors group">
          <div className="p-2 bg-lumos-yellow/10 rounded-lumos text-lumos-yellow w-fit mb-3">
            <FolderOpen className="w-4 h-4" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Projetos Ativos</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-0.5">{projectsCount}</p>
        </button>

        <button onClick={() => navigate('/producao/board')} className="card p-5 text-left hover:border-lumos-yellow/40 transition-colors group">
          <div className="p-2 bg-orange-500/10 rounded-lumos text-orange-400 w-fit mb-3">
            <Activity className="w-4 h-4" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Em Produção</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-0.5">{inProgress.length}</p>
        </button>

        <button onClick={() => navigate('/producao/schedule')} className="card p-5 text-left hover:border-lumos-yellow/40 transition-colors group">
          <div className="p-2 bg-blue-500/10 rounded-lumos text-blue-400 w-fit mb-3">
            <CalendarDays className="w-4 h-4" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Entregas em 7 dias</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-0.5">{dueSoon.length}</p>
        </button>

        <button onClick={() => navigate('/producao/board')} className="card p-5 text-left hover:border-red-500/40 transition-colors group">
          <div className="p-2 bg-red-500/10 rounded-lumos text-red-500 w-fit mb-3">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Atrasadas</p>
          <p className={clsx('text-2xl font-black mt-0.5', overdue.length > 0 ? 'text-red-500' : 'text-lumos-text-primary')}>{overdue.length}</p>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Distribuição por status */}
          <div className="card p-6">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-lumos-yellow" /> Tarefas por Status
              <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· {totalTasks} no total</span>
            </h3>

            {totalTasks === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic py-4 text-center">Nenhuma tarefa nos projetos ativos.</p>
            ) : (
              <>
                {/* Barra empilhada por grupo */}
                <div className="flex h-3 rounded-full overflow-hidden border border-lumos-border/40 mb-4">
                  {groupTotals.nao_iniciado > 0 && (
                    <div className="bg-neutral-400/50" style={{ width: `${(groupTotals.nao_iniciado / totalTasks) * 100}%` }} title={`Não iniciado: ${groupTotals.nao_iniciado}`} />
                  )}
                  {groupTotals.ativo > 0 && (
                    <div className="bg-lumos-yellow/80" style={{ width: `${(groupTotals.ativo / totalTasks) * 100}%` }} title={`Ativo: ${groupTotals.ativo}`} />
                  )}
                  {groupTotals.concluido > 0 && (
                    <div className="bg-green-500/70" style={{ width: `${(groupTotals.concluido / totalTasks) * 100}%` }} title={`Concluído: ${groupTotals.concluido}`} />
                  )}
                </div>

                {/* Chips por status */}
                <div className="flex flex-wrap gap-1.5">
                  {[...TASK_STATUS_GROUPS.nao_iniciado, ...TASK_STATUS_GROUPS.ativo, ...TASK_STATUS_GROUPS.concluido].map(s => {
                    const count = statusCounts[s.value] || 0;
                    if (count === 0) return null;
                    return (
                      <span key={s.value} className={clsx('text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full border', s.color)}>
                        {s.label} · {count}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Entregas dos próximos 7 dias */}
          <div className="card p-6">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-blue-400" /> Entregas dos Próximos 7 Dias
            </h3>
            {dueSoon.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic py-3 text-center">Nenhuma entrega prevista para esta semana.</p>
            ) : (
              <div className="space-y-1.5">
                {dueSoon.slice(0, 8).map(t => (
                  <button
                    key={t.id}
                    onClick={() => openTaskInManager(t.project_id, t.id)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lumos border border-lumos-border/50 hover:border-lumos-yellow/40 hover:bg-lumos-text-secondary/[0.03] transition-all text-left group"
                  >
                    <span className={clsx(
                      'text-[10px] font-black px-2 py-1 rounded whitespace-nowrap',
                      t.data_fim === todayStr() ? 'bg-lumos-yellow/15 text-lumos-yellow' : 'bg-blue-500/10 text-blue-400'
                    )}>
                      {t.data_fim === todayStr() ? 'HOJE' : fmtDay(t.data_fim!)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-bold text-lumos-text-primary truncate">{t.titulo}</span>
                      <span className="block text-[10px] text-lumos-text-secondary truncate">
                        {t.project?.client?.name ? `${t.project.client.name} · ` : ''}{t.project?.name}
                      </span>
                    </span>
                    {t.prioridade === 'alta' && <Flag className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                    <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Atrasadas */}
          <div className="card p-6 border-red-500/20">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" /> Tarefas Atrasadas
            </h3>
            {overdue.length === 0 ? (
              <p className="text-xs text-green-500 font-bold py-3 text-center flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Nada atrasado. Produção em dia!
              </p>
            ) : (
              <div className="space-y-1.5">
                {overdue.slice(0, 8).map(t => (
                  <button
                    key={t.id}
                    onClick={() => openTaskInManager(t.project_id, t.id)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lumos border border-red-500/20 hover:border-red-500/50 hover:bg-red-500/[0.04] transition-all text-left group"
                  >
                    <span className="text-[10px] font-black px-2 py-1 rounded bg-red-500/10 text-red-500 whitespace-nowrap">
                      {fmtDay(t.data_fim!)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-bold text-lumos-text-primary truncate">{t.titulo}</span>
                      <span className="block text-[10px] text-lumos-text-secondary truncate">
                        {t.project?.client?.name ? `${t.project.client.name} · ` : ''}{t.project?.name}
                      </span>
                    </span>
                    <span className="text-[9px] font-bold text-red-400 uppercase whitespace-nowrap">
                      {getStatusDetails(t.status).label}
                    </span>
                    <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </button>
                ))}
                {overdue.length > 8 && (
                  <p className="text-[10px] text-lumos-text-secondary text-center pt-1">+ {overdue.length - 8} outras atrasadas</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Coluna lateral */}
        <div className="space-y-6">
          {/* Carga por pessoa */}
          <div className="card p-6">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-lumos-yellow" /> Carga por Pessoa
            </h3>
            {workload.rows.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic py-3 text-center">Nenhuma tarefa aberta atribuída.</p>
            ) : (
              <div className="space-y-2.5">
                {workload.rows.map(row => (
                  <div key={row.id} className="flex items-center gap-2.5">
                    <span
                      title={row.name}
                      className="w-6 h-6 rounded-full bg-lumos-yellow/15 text-lumos-yellow text-[8px] font-black flex items-center justify-center flex-shrink-0 border border-lumos-yellow/20"
                    >
                      {getInitials(row.name)}
                    </span>
                    <span className="text-[10px] font-bold text-lumos-text-primary w-20 truncate flex-shrink-0">
                      {row.name.split(' ')[0]}
                    </span>
                    <div className="flex-1 h-2 bg-lumos-border/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-lumos-yellow/70 rounded-full transition-all"
                        style={{ width: `${(row.count / workload.max) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-black text-lumos-text-secondary w-5 text-right flex-shrink-0">{row.count}</span>
                  </div>
                ))}
                {workload.unassigned > 0 && (
                  <p className="text-[10px] text-lumos-text-secondary pt-1.5 border-t border-lumos-border/40">
                    {workload.unassigned} tarefa{workload.unassigned > 1 ? 's' : ''} aberta{workload.unassigned > 1 ? 's' : ''} sem responsável
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Atividade recente */}
          <div className="card p-6">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-lumos-yellow" /> Atividade Recente
            </h3>
            {activity.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic py-3 text-center">Sem atividade recente.</p>
            ) : (
              <div className="space-y-1">
                {activity.map(item => (
                  <button
                    key={item.id}
                    onClick={() => openTaskInManager(item.projectId, item.taskId)}
                    className="w-full flex items-start gap-2.5 p-2 rounded-lumos hover:bg-lumos-text-secondary/[0.04] transition-colors text-left group"
                  >
                    <span className={clsx(
                      'p-1.5 rounded-full flex-shrink-0 mt-0.5',
                      item.type === 'comment' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-500'
                    )}>
                      {item.type === 'comment' ? <MessageSquare className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[11px] text-lumos-text-primary leading-snug">
                        <span className="font-black">{item.who.split(' ')[0]}</span>
                        {item.type === 'comment' ? ' comentou: ' : ' concluiu: '}
                        <span className="text-lumos-text-secondary">{item.text}</span>
                      </span>
                      <span className="block text-[9px] text-lumos-text-secondary/70 mt-0.5">
                        {item.sub} · {relativeTime(item.when)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
