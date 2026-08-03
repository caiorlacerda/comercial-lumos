import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, Activity, CalendarDays, AlertTriangle,
  ChevronRight, MessageSquare, CheckCircle2, ArrowRight, Film, ListChecks,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import UserAvatar from '@/components/common/UserAvatar';
import VideoReviewHub from '@/components/producao/VideoReviewHub';
import { useToast } from '@/context/ToastContext';
import { TASK_STATUS_GROUPS, getStatusDetails, stageTheme } from '@/pages/Projetos';

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
  type: 'comment' | 'done' | 'status' | 'clientvideo';
  when: string;
  who: string;
  actor: { id?: string; full_name?: string | null; avatar_url?: string | null } | null;
  text: string;
  sub: string;
  projectId: string | null;
  taskId: string | null;
  statusValue?: string; // pra pintar o chip nos eventos de mudança de etapa
}

// 'entregue' é status legado de conclusão: precisa contar como concluída aqui,
// senão a tarefa cai em "Atrasadas" e na Carga por Pessoa mesmo já entregue.
const CONCLUDED_STATUSES = new Set([...TASK_STATUS_GROUPS.concluido.map(s => s.value), 'entregue']);

// Etapas abertas na ordem do fluxo (mesma régua do hub de projetos).
const OPEN_STAGES = ['na_fila', 'pausado', 'em_progresso', 'revisao_interna', 'revisao_cliente', 'alteracoes'];

const todayStr = () => new Date().toISOString().split('T')[0];
const plusDaysStr = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
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

// "Seg 04/08" — cabeçalho de dia da lista de entregas.
const fmtDow = (dateStr: string) => {
  const dow = new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return `${dow.charAt(0).toUpperCase() + dow.slice(1)} ${fmtDay(dateStr)}`;
};

const daysLate = (dateStr: string) => {
  const diff = Math.floor((new Date(todayStr() + 'T12:00:00').getTime() - new Date(dateStr + 'T12:00:00').getTime()) / 86400000);
  return diff === 1 ? '1 dia' : `${diff} dias`;
};

// "Tawany R." — primeiro nome + inicial do último (dois Vinicius deixam de se confundir).
const nameShort = (full: string) => {
  const parts = (full || '').trim().split(/\s+/);
  if (parts.length < 2) return full || 'Usuário';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
};

// Comentário no feed: troca URLs cruas por "↗ link" (o clique da linha abre a tarefa).
const renderFeedText = (text: string) => {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p)
      ? <span key={i} className="text-lumos-yellow font-bold whitespace-nowrap">↗ link</span>
      : <span key={i}>{p}</span>
  );
};

// -------------------------------------------------------------
// Página
// -------------------------------------------------------------
export default function ProducaoOverview() {
  const toast = useToast();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [projectsCount, setProjectsCount] = useState(0);
  const [tasks, setTasks] = useState<OverviewTask[]>([]);
  const [teamUsers, setTeamUsers] = useState<{ id: string; full_name: string; avatar_url?: string | null }[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [videoRows, setVideoRows] = useState<{ group_id: string; versao: number; status: string; task_id: string | null }[]>([]);
  // Tarefas em que o usuário entra como colaborador (aparecem na Minha fila).
  const [myCollabTaskIds, setMyCollabTaskIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Pipeline: incluir concluídas na barra? / etapa expandida (lista inline)
  const [pipeWithDone, setPipeWithDone] = useState(false);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  // Âncoras pra navegação interna dos KPIs e do placar de vídeo
  const pipeRef = useRef<HTMLDivElement>(null);
  const lateRef = useRef<HTMLDivElement>(null);
  const weekRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  useEffect(() => { fetchData(); }, []);

  // Tempo real: mudanças de outros usuários atualizam a visão sem spinner
  useRealtimeRefetch(['projects', 'project_tasks', 'task_comments', 'video_versions', 'review_comments', 'task_collaborators'], () => fetchData(true));

  async function fetchData(silent = false) {
    try {
      if (!silent) setLoading(true);
      const [projRes, taskRes, usersRes, commentsRes, doneRes, statusActRes, videoRes, clientComRes, myCollabRes] = await Promise.all([
        supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
        supabase
          .from('project_tasks')
          .select('id, project_id, titulo, status, prioridade, data_fim, responsavel_id, project:projects!inner(id, name, status, client:clients(name))')
          .eq('project.status', 'ativo')
          .is('deleted_at', null),
        supabase.from('app_users').select('id, full_name, avatar_url').eq('status', 'ativo'),
        supabase
          .from('task_comments')
          .select('id, content, created_at, user:app_users(id, full_name, avatar_url), task:project_tasks(id, titulo, project_id)')
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('project_tasks')
          .select('id, titulo, status, updated_at, project_id, responsavel:app_users!responsavel_id(id, full_name, avatar_url)')
          .in('status', ['entregue', 'concluido'])
          .order('updated_at', { ascending: false })
          .limit(5),
        // Mudanças de etapa (feed): quem moveu o quê pra onde.
        supabase
          .from('task_activity')
          .select('id, task_id, actor_name, new_value, created_at, task:project_tasks!inner(id, titulo, project_id)')
          .eq('action', 'status')
          .order('created_at', { ascending: false })
          .limit(8),
        // Placar de vídeo: versões dos projetos ativos (agrupadas por group_id no client).
        supabase
          .from('video_versions')
          .select('group_id, versao, status, task_id, project:projects!inner(status)')
          .eq('project.status', 'ativo'),
        // Comentários de cliente nos vídeos (feed).
        supabase
          .from('review_comments')
          .select('id, author_name, created_at, video:video_versions!inner(id, file_name, project_id)')
          .eq('is_team', false)
          .order('created_at', { ascending: false })
          .limit(5),
        // Tarefas em que eu sou colaborador (entram na Minha fila).
        profile?.id
          ? supabase.from('task_collaborators').select('task_id').eq('user_id', profile.id)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      if (taskRes.error) throw taskRes.error;

      setProjectsCount(projRes.count ?? 0);
      setTasks((taskRes.data as any[]) || []);
      setTeamUsers(usersRes.data || []);
      setVideoRows((videoRes.data as any[]) || []);
      setMyCollabTaskIds(((myCollabRes.data as any[]) || []).map(r => r.task_id));

      // Feed: comentários + concluídas + mudanças de etapa + cliente no vídeo
      const items: ActivityItem[] = [];
      ((commentsRes.data as any[]) || []).forEach(c => {
        items.push({
          id: `c-${c.id}`, type: 'comment', when: c.created_at,
          who: c.user?.full_name || 'Alguém', actor: c.user || null,
          text: c.content?.length > 90 ? c.content.slice(0, 90) + '…' : (c.content || ''),
          sub: c.task?.titulo || 'Tarefa',
          projectId: c.task?.project_id ?? null, taskId: c.task?.id ?? null,
        });
      });
      ((doneRes.data as any[]) || []).forEach(t => {
        items.push({
          id: `d-${t.id}`, type: 'done', when: t.updated_at,
          who: t.responsavel?.full_name || 'Equipe', actor: t.responsavel || null,
          text: t.titulo, sub: getStatusDetails(t.status).label,
          projectId: t.project_id, taskId: t.id,
        });
      });
      ((statusActRes.data as any[]) || []).forEach(a => {
        // Conclusões já entram pelo feed de concluídas — evita duplicar.
        if (a.new_value === 'concluido' || a.new_value === 'entregue') return;
        items.push({
          id: `s-${a.id}`, type: 'status', when: a.created_at,
          who: a.actor_name || 'Alguém', actor: null,
          text: a.task?.titulo || 'Tarefa', sub: getStatusDetails(a.new_value || '').label,
          projectId: a.task?.project_id ?? null, taskId: a.task?.id ?? null,
          statusValue: a.new_value || '',
        });
      });
      ((clientComRes.data as any[]) || []).forEach(rc => {
        items.push({
          id: `v-${rc.id}`, type: 'clientvideo', when: rc.created_at,
          who: rc.author_name || 'Cliente', actor: null,
          text: rc.video?.file_name || 'vídeo', sub: 'comentário do cliente',
          projectId: rc.video?.project_id ?? null, taskId: null,
        });
      });
      items.sort((a, b) => b.when.localeCompare(a.when));
      setActivity(items.slice(0, 12));
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

  // Entregas agrupadas por dia (Hoje / Amanhã / Dia)
  const dueByDay = useMemo(() => {
    const map = new Map<string, OverviewTask[]>();
    dueSoon.slice(0, 12).forEach(t => {
      const k = t.data_fim!;
      map.set(k, [...(map.get(k) || []), t]);
    });
    return Array.from(map.entries());
  }, [dueSoon]);

  // Minha fila: minhas tarefas abertas (como responsável OU colaborador),
  // atrasadas primeiro, depois por prazo.
  const myTasks = useMemo(() => {
    if (!profile?.id) return [];
    const mine = openTasks.filter(t => t.responsavel_id === profile.id || myCollabTaskIds.includes(t.id));
    const today = todayStr();
    return mine.sort((a, b) => {
      const aLate = a.data_fim && a.data_fim < today ? 0 : 1;
      const bLate = b.data_fim && b.data_fim < today ? 0 : 1;
      if (aLate !== bLate) return aLate - bLate;
      if (!a.data_fim && !b.data_fim) return 0;
      if (!a.data_fim) return 1;
      if (!b.data_fim) return -1;
      return a.data_fim.localeCompare(b.data_fim);
    }).slice(0, 8);
  }, [openTasks, profile?.id, myCollabTaskIds]);

  // Pipeline por etapa (só abertas; concluídas atrás do toggle).
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    openTasks.forEach(t => {
      const k = OPEN_STAGES.includes(t.status) ? t.status : 'na_fila';
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }, [openTasks]);
  const doneTotal = tasks.length - openTasks.length;
  const pipeTotal = openTasks.length + (pipeWithDone ? doneTotal : 0);

  const clientCount = useMemo(
    () => new Set(tasks.map(t => t.project?.client?.name).filter(Boolean)).size,
    [tasks]
  );
  const awaitingClient = useMemo(() => openTasks.filter(t => t.status === 'revisao_cliente').length, [openTasks]);
  const dueTodayCount = useMemo(() => dueSoon.filter(t => t.data_fim === todayStr()).length, [dueSoon]);

  // Carga por pessoa: abertas + fatia de atrasadas, clicável.
  const workload = useMemo(() => {
    const byUser: Record<string, { count: number; late: number }> = {};
    let unassigned = 0;
    const today = todayStr();
    openTasks.forEach(t => {
      if (t.responsavel_id) {
        const e = (byUser[t.responsavel_id] = byUser[t.responsavel_id] || { count: 0, late: 0 });
        e.count++;
        if (t.data_fim && t.data_fim < today) e.late++;
      } else unassigned++;
    });
    const rows = Object.entries(byUser)
      .map(([id, v]) => {
        const u = teamUsers.find(x => x.id === id);
        return { id, name: u?.full_name || 'Usuário', avatar_url: u?.avatar_url ?? null, ...v };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    return { rows, unassigned, max: rows.length ? rows[0].count : 0 };
  }, [openTasks, teamUsers]);

  // Placar de vídeo: 1 vídeo = 1 grupo, status da versão mais alta.
  const videoBoard = useMemo(() => {
    const byGroup = new Map<string, { versao: number; status: string; task_id: string | null }>();
    videoRows.forEach(v => {
      const cur = byGroup.get(v.group_id);
      if (!cur || v.versao > cur.versao) byGroup.set(v.group_id, { versao: v.versao, status: v.status, task_id: v.task_id });
    });
    const groups = Array.from(byGroup.values());
    return {
      interna: groups.filter(g => g.status === 'EM_REVISAO_INTERNA').length,
      cliente: groups.filter(g => g.status === 'EM_REVISAO_CLIENTE').length,
      ajustes: groups.filter(g => g.status === 'ALTERACOES_INTERNAS' || g.status === 'ALTERACOES_CLIENTE').length,
      orfaos: groups.filter(g => !g.task_id && g.status !== 'APROVADO').length,
    };
  }, [videoRows]);

  const openTaskInManager = (projectId: string | null, taskId?: string | null, tab?: string) => {
    if (!projectId) return;
    const params = new URLSearchParams({ projectId });
    if (taskId) params.set('taskId', taskId);
    if (tab) params.set('tab', tab);
    navigate(`/producao/projetos?${params.toString()}`);
  };

  const expandedTasks = useMemo(
    () => expandedStage
      ? (expandedStage === 'concluido'
        ? tasks.filter(t => CONCLUDED_STATUSES.has(t.status))
        : openTasks.filter(t => (OPEN_STAGES.includes(t.status) ? t.status : 'na_fila') === expandedStage))
      : [],
    [expandedStage, openTasks, tasks]
  );

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

  const stageChipCls = (s: string) => clsx('text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap', getStatusDetails(s).color);

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

      {/* ================= MINHA FILA ================= */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ListChecks className="w-4 h-4 text-lumos-yellow" />
          <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest">Minha fila</h3>
          <span className="text-[11px] text-lumos-text-secondary font-semibold">
            {myTasks.length === 0 ? 'nada aberto no seu nome 🙌' : `${myTasks.length} tarefa${myTasks.length > 1 ? 's' : ''} · ${profile?.full_name?.split(' ')[0] || ''}`}
          </span>
        </div>
        {myTasks.length > 0 && (
          <div className="flex gap-2.5 overflow-x-auto pb-1 no-scrollbar">
            {myTasks.map(t => {
              const late = t.data_fim && t.data_fim < todayStr();
              const isToday = t.data_fim === todayStr();
              return (
                <button key={t.id} onClick={() => openTaskInManager(t.project_id, t.id)}
                  className={clsx('min-w-[220px] max-w-[260px] flex-shrink-0 text-left border rounded-lumos p-3 transition-colors hover:border-lumos-yellow/50',
                    late ? 'border-red-500/40 bg-red-500/[0.03]' : 'border-lumos-border bg-lumos-bg/30')}>
                  <p className={clsx('text-[9px] font-black uppercase tracking-widest', late ? 'text-red-400' : isToday ? 'text-lumos-yellow' : 'text-lumos-text-secondary')}>
                    {late ? `Atrasada · ${fmtDay(t.data_fim!)}` : isToday ? 'Hoje' : t.data_fim ? fmtDow(t.data_fim) : 'Sem prazo'}
                  </p>
                  <p className="text-xs font-bold text-lumos-text-primary truncate mt-1">{t.titulo}</p>
                  <p className="text-[10px] text-lumos-text-secondary truncate mt-1 flex items-center gap-1.5">
                    <span className="truncate">{t.project?.client?.name ? `${t.project.client.name} · ` : ''}{t.project?.name}</span>
                    <span className={stageChipCls(t.status)}>{getStatusDetails(t.status).label}</span>
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ================= KPIs ================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="p-2 bg-lumos-yellow/10 rounded-lumos text-lumos-yellow w-fit mb-3"><FolderOpen className="w-4 h-4" /></div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Projetos Ativos</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-0.5">{projectsCount}</p>
          <p className="text-[10px] text-lumos-text-secondary">{clientCount} cliente{clientCount !== 1 ? 's' : ''}</p>
        </div>

        <button onClick={() => scrollTo(weekRef)} className="card p-5 text-left hover:border-lumos-yellow/40 transition-colors">
          <div className="p-2 bg-blue-500/10 rounded-lumos text-blue-400 w-fit mb-3"><CalendarDays className="w-4 h-4" /></div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Entregas em 7 dias</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-0.5">{dueSoon.length}</p>
          <p className="text-[10px] text-lumos-text-secondary">{dueTodayCount > 0 ? `${dueTodayCount} ${dueTodayCount === 1 ? 'é hoje' : 'são hoje'}` : 'nenhuma hoje'}</p>
        </button>

        <button onClick={() => { setExpandedStage('revisao_cliente'); scrollTo(pipeRef); }} className="card p-5 text-left hover:border-amber-500/40 transition-colors">
          <div className="p-2 bg-amber-500/10 rounded-lumos text-amber-400 w-fit mb-3"><Activity className="w-4 h-4" /></div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Com o Cliente</p>
          <p className={clsx('text-2xl font-black mt-0.5', awaitingClient > 0 ? 'text-amber-400' : 'text-lumos-text-primary')}>{awaitingClient}</p>
          <p className="text-[10px] text-lumos-text-secondary">aguardando retorno</p>
        </button>

        <button onClick={() => scrollTo(lateRef)} className="card p-5 text-left hover:border-red-500/40 transition-colors">
          <div className="p-2 bg-red-500/10 rounded-lumos text-red-500 w-fit mb-3"><AlertTriangle className="w-4 h-4" /></div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Atrasadas</p>
          <p className={clsx('text-2xl font-black mt-0.5', overdue.length > 0 ? 'text-red-500' : 'text-lumos-text-primary')}>{overdue.length}</p>
          <p className="text-[10px] text-lumos-text-secondary">{overdue.length > 0 ? `mais antiga: ${daysLate(overdue[0].data_fim!)}` : 'tudo em dia 🎉'}</p>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* ================= COLUNA PRINCIPAL ================= */}
        <div className="lg:col-span-2 space-y-6">

          {/* Pipeline das tarefas abertas */}
          <div ref={pipeRef} className="card p-6 scroll-mt-24">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-1 flex items-center gap-2">
              <Activity className="w-4 h-4 text-lumos-yellow" /> Pipeline das tarefas abertas
              <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· {openTasks.length} abertas</span>
              <button onClick={() => setPipeWithDone(v => !v)} className="ml-auto text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary underline underline-offset-2 normal-case tracking-normal">
                {pipeWithDone ? 'só abertas' : `incluir concluídas (${doneTotal})`}
              </button>
            </h3>

            {openTasks.length === 0 && !pipeWithDone ? (
              <p className="text-xs text-lumos-text-secondary italic py-4 text-center">Nenhuma tarefa aberta nos projetos ativos.</p>
            ) : (
              <>
                <div className="flex h-3.5 rounded-full overflow-hidden border border-lumos-border/40 my-4">
                  {OPEN_STAGES.map(s => {
                    const n = stageCounts[s] || 0;
                    if (!n) return null;
                    return <div key={s} className={clsx(stageTheme(s).bar, 'transition-all')} style={{ width: `${(n / pipeTotal) * 100}%` }} title={`${getStatusDetails(s).label}: ${n}`} />;
                  })}
                  {pipeWithDone && doneTotal > 0 && (
                    <div className="bg-green-500/70" style={{ width: `${(doneTotal / pipeTotal) * 100}%` }} title={`Concluídas: ${doneTotal}`} />
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {OPEN_STAGES.map(s => {
                    const n = stageCounts[s] || 0;
                    if (!n) return null;
                    return (
                      <button key={s} onClick={() => setExpandedStage(cur => cur === s ? null : s)}
                        className={clsx('text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full border transition-all', getStatusDetails(s).color,
                          expandedStage === s && 'ring-1 ring-lumos-yellow/60')}>
                        {getStatusDetails(s).label} · {n}
                      </button>
                    );
                  })}
                  {pipeWithDone && doneTotal > 0 && (
                    <button onClick={() => setExpandedStage(cur => cur === 'concluido' ? null : 'concluido')}
                      className={clsx('text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full border transition-all', getStatusDetails('concluido').color,
                        expandedStage === 'concluido' && 'ring-1 ring-lumos-yellow/60')}>
                      Concluído · {doneTotal}
                    </button>
                  )}
                </div>

                {/* Lista inline da etapa clicada */}
                {expandedStage && expandedTasks.length > 0 && (
                  <div className="mt-4 border-t border-lumos-border/40 pt-2 space-y-0.5">
                    {expandedTasks.slice(0, 10).map(t => {
                      const u = teamUsers.find(x => x.id === t.responsavel_id);
                      return (
                        <button key={t.id} onClick={() => openTaskInManager(t.project_id, t.id)}
                          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lumos hover:bg-lumos-text-secondary/[0.05] text-left group">
                          <span className="text-xs font-bold text-lumos-text-primary truncate">{t.titulo}</span>
                          <span className="text-[10px] text-lumos-text-secondary truncate">{t.project?.client?.name ? `${t.project.client.name} · ` : ''}{t.project?.name}</span>
                          <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                            {t.data_fim && <span className={clsx('text-[10px] font-bold', t.data_fim < todayStr() ? 'text-red-400' : 'text-lumos-text-secondary')}>{fmtDay(t.data_fim)}</span>}
                            {u && <UserAvatar user={u} size={18} />}
                            <ChevronRight className="w-3.5 h-3.5 text-lumos-text-secondary opacity-0 group-hover:opacity-100" />
                          </span>
                        </button>
                      );
                    })}
                    {expandedTasks.length > 10 && <p className="text-[10px] text-lumos-text-secondary text-center pt-1">+ {expandedTasks.length - 10} outras</p>}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Atrasadas (urgência primeiro, acima da semana) */}
          <div ref={lateRef} className="card p-6 border-red-500/20 scroll-mt-24">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" /> Atrasadas
              {overdue.length > 0 && <span className="text-red-400 font-bold normal-case tracking-normal">· {overdue.length}</span>}
            </h3>
            {overdue.length === 0 ? (
              <p className="text-xs text-green-500 font-bold py-3 text-center flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Nada atrasado. Produção em dia!
              </p>
            ) : (
              <div className="space-y-1.5">
                {overdue.slice(0, 8).map(t => (
                  <button key={t.id} onClick={() => openTaskInManager(t.project_id, t.id)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lumos border border-red-500/20 hover:border-red-500/50 hover:bg-red-500/[0.04] transition-all text-left group">
                    <span className="text-[10px] font-black px-2 py-1 rounded bg-red-500/10 text-red-500 whitespace-nowrap">{fmtDay(t.data_fim!)}</span>
                    <span className={stageChipCls(t.status)}>{getStatusDetails(t.status).label}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-bold text-lumos-text-primary truncate">{t.titulo}</span>
                      <span className="block text-[10px] text-lumos-text-secondary truncate">{t.project?.client?.name ? `${t.project.client.name} · ` : ''}{t.project?.name}</span>
                    </span>
                    <span className="text-[9px] font-black text-red-400 whitespace-nowrap">{daysLate(t.data_fim!)}</span>
                    <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </button>
                ))}
                {overdue.length > 8 && <p className="text-[10px] text-lumos-text-secondary text-center pt-1">+ {overdue.length - 8} outras atrasadas</p>}
              </div>
            )}
          </div>

          {/* Entregas da semana, agrupadas por dia */}
          <div ref={weekRef} className="card p-6 scroll-mt-24">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-3 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-blue-400" /> Entregas da semana
              <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· {dueSoon.length}</span>
              <button onClick={() => navigate('/producao/dashboard')} className="ml-auto text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary underline underline-offset-2 normal-case tracking-normal">
                ver no calendário
              </button>
            </h3>
            {dueSoon.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic py-3 text-center">Nenhuma entrega prevista para esta semana.</p>
            ) : (
              <div>
                {dueByDay.map(([day, dayTasks]) => (
                  <div key={day}>
                    <p className={clsx('text-[9px] font-black uppercase tracking-widest pt-3 pb-1.5',
                      day === todayStr() ? 'text-lumos-yellow' : 'text-lumos-text-secondary')}>
                      {day === todayStr() ? `Hoje · ${fmtDow(day)}` : day === plusDaysStr(1) ? `Amanhã · ${fmtDow(day)}` : fmtDow(day)}
                    </p>
                    <div className="space-y-1">
                      {dayTasks.map(t => {
                        const u = teamUsers.find(x => x.id === t.responsavel_id);
                        return (
                          <button key={t.id} onClick={() => openTaskInManager(t.project_id, t.id)}
                            className="w-full flex items-center gap-2.5 p-2 rounded-lumos border border-lumos-border/50 hover:border-lumos-yellow/40 hover:bg-lumos-text-secondary/[0.03] transition-all text-left group">
                            <span className={stageChipCls(t.status)}>{getStatusDetails(t.status).label}</span>
                            <span className="text-xs font-bold text-lumos-text-primary truncate">{t.titulo}</span>
                            {t.prioridade === 'alta' && (
                              <span className="text-[9px] font-black uppercase text-red-400 border border-red-500/35 bg-red-500/[0.07] rounded-full px-1.5 py-0.5 flex-shrink-0">Alta</span>
                            )}
                            <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] text-lumos-text-secondary truncate max-w-[110px]">{t.project?.client?.name || t.project?.name}</span>
                              {u && <UserAvatar user={u} size={20} />}
                              <ChevronRight className="w-4 h-4 text-lumos-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ================= COLUNA LATERAL ================= */}
        <div className="space-y-6">
          {/* Carga por pessoa */}
          <div className="card p-6">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-lumos-yellow" /> Carga por Pessoa
              <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· abertas</span>
            </h3>
            {workload.rows.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic py-3 text-center">Nenhuma tarefa aberta atribuída.</p>
            ) : (
              <div className="space-y-2.5">
                {workload.rows.map(row => (
                  <button key={row.id} onClick={() => navigate(`/producao/board?resp=${row.id}`)}
                    className="w-full flex items-center gap-2.5 group" title={`Abrir as tarefas de ${row.name} no Board`}>
                    <UserAvatar user={{ id: row.id, full_name: row.name, avatar_url: row.avatar_url }} size={24} showStatus />
                    <span className="text-[10px] font-bold text-lumos-text-primary w-[76px] truncate flex-shrink-0 text-left group-hover:text-lumos-yellow transition-colors">
                      {nameShort(row.name)}
                    </span>
                    <div className="flex-1 h-2 bg-lumos-border/30 rounded-full overflow-hidden flex">
                      <div className="h-full bg-lumos-yellow/70" style={{ width: `${((row.count - row.late) / workload.max) * 100}%` }} />
                      {row.late > 0 && <div className="h-full bg-red-500" style={{ width: `${(row.late / workload.max) * 100}%` }} title={`${row.late} atrasada(s)`} />}
                    </div>
                    <span className="text-[10px] font-black text-lumos-text-secondary w-5 text-right flex-shrink-0">{row.count}</span>
                  </button>
                ))}
                {workload.unassigned > 0 && (
                  <button onClick={() => navigate('/producao/board?resp=none')}
                    className="mt-2 w-full text-[11px] font-black text-red-400 border-[1.5px] border-red-500/40 bg-red-500/[0.06] rounded-full px-3 py-2 hover:bg-red-500/[0.12] transition-colors">
                    ⚠ {workload.unassigned} tarefa{workload.unassigned > 1 ? 's' : ''} sem responsável · atribuir
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Placar de revisão de vídeo */}
          <div className="card p-6">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
              <Film className="w-4 h-4 text-lumos-yellow" /> Revisão de Vídeo
              <button onClick={() => scrollTo(hubRef)} className="ml-auto text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary underline underline-offset-2 normal-case tracking-normal">
                abrir central
              </button>
            </h3>
            <div className="space-y-2">
              {[
                { label: 'Revisão interna', n: videoBoard.interna, cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
                { label: 'Com o cliente', n: videoBoard.cliente, cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
                { label: 'Ajustes', n: videoBoard.ajustes, cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
              ].map(r => (
                <button key={r.label} onClick={() => scrollTo(hubRef)} className="w-full flex items-center gap-2 group">
                  <span className={clsx('text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full border', r.cls)}>{r.label}</span>
                  <span className="ml-auto text-base font-black text-lumos-text-primary group-hover:text-lumos-yellow transition-colors">{r.n}</span>
                </button>
              ))}
            </div>
            {videoBoard.orfaos > 0 && (
              <button onClick={() => scrollTo(hubRef)}
                className="mt-3 w-full text-[11px] font-bold text-amber-500 border-[1.5px] border-dashed border-amber-500/50 bg-amber-500/[0.07] rounded-lumos px-3 py-2 hover:bg-amber-500/[0.14] transition-colors text-left">
                ⚠ {videoBoard.orfaos} vídeo{videoBoard.orfaos > 1 ? 's' : ''} sem tarefa vinculada · vincular agora
              </button>
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
                  <button key={item.id}
                    onClick={() => item.type === 'clientvideo' ? openTaskInManager(item.projectId, null, 'entregas') : openTaskInManager(item.projectId, item.taskId)}
                    className="w-full flex items-start gap-2.5 p-2 rounded-lumos hover:bg-lumos-text-secondary/[0.04] transition-colors text-left group">
                    {item.type === 'comment' || item.type === 'done' ? (
                      <UserAvatar user={item.actor || { full_name: item.who }} size={26} showStatus className="mt-0.5" />
                    ) : (
                      <span className={clsx('w-[26px] h-[26px] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                        item.type === 'clientvideo' ? 'bg-amber-500/15 text-amber-400' : 'bg-lumos-text-secondary/10 text-lumos-text-secondary')}>
                        {item.type === 'clientvideo' ? <MessageSquare className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
                      </span>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-[11px] text-lumos-text-primary leading-snug">
                        <span className="font-black">{item.who.split(' ')[0]}</span>
                        {item.type === 'comment' && <> comentou: <span className="text-lumos-text-secondary">{renderFeedText(item.text)}</span></>}
                        {item.type === 'done' && <> concluiu: <span className="text-lumos-text-secondary">{item.text}</span></>}
                        {item.type === 'status' && <> moveu <span className="text-lumos-text-secondary">{item.text}</span> pra{' '}
                          <span className={clsx('text-[8.5px] font-black uppercase px-1.5 py-px rounded-full border', getStatusDetails(item.statusValue || '').color)}>{item.sub}</span></>}
                        {item.type === 'clientvideo' && <> <span className="text-amber-400 font-bold">(cliente)</span> comentou no vídeo <span className="text-lumos-text-secondary">{item.text}</span></>}
                      </span>
                      <span className="block text-[9px] text-lumos-text-secondary/70 mt-0.5">
                        {item.type === 'status' || item.type === 'clientvideo' ? relativeTime(item.when) : <>{item.sub} · {relativeTime(item.when)}</>}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Central de revisões (âncora do placar) */}
      <div ref={hubRef} className="scroll-mt-24">
        <VideoReviewHub />
      </div>
    </div>
  );
}
