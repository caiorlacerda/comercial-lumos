import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Users, UserX,
  ListChecks, Coffee, ShieldCheck, IdCard, PauseCircle, Zap, Radio,
  Search, X, Hourglass, ChevronRight, PartyPopper,
} from 'lucide-react';
import { CELEBRATE_TEST_EVENT, canTestCelebration } from '@/components/common/NewProjectCelebration';
import { useAuth } from '@/hooks/useAuth';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useLayout } from '@/context/LayoutContext';
import UserAvatar from '@/components/common/UserAvatar';
import Select from '@/components/ui/Select';
import { isDone, isActive, isOpen, taskLabel, TASK_ACTIVE } from '@/lib/taskStatus';
import { effectiveStatus } from '@/lib/presence';
import { formatBudgetCode } from '@/utils/formatters';

interface AppUser {
  id: string; full_name: string; email: string; role: string;
  status: 'ativo' | 'inativo'; avatar_url: string | null; tour_seen: boolean | null; last_seen: string | null;
}
interface Task {
  id: string; titulo: string; status: string; prioridade: string;
  data_fim: string | null; responsavel_id: string | null; project_id: string;
  updated_at: string; project: { name: string; code: string | null } | null;
}
interface HR { app_user_id: string | null; cpf: string | null; whatsapp: string | null; birth_date: string | null; }

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', producao: 'Produção', editor: 'Editor',
  atendimento: 'Atendimento', social_media: 'Social Media', basico: 'Básico',
};

const STALE_DAYS = 3;
const todayStr = () => new Date().toISOString().split('T')[0];
const daysLate = (due: string) => Math.floor((Date.now() - new Date(due + 'T23:59:59').getTime()) / 86400000);
function relTime(iso: string | null) {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}
const fmtDate = (d: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—';
const prioColor = (p: string) => p === 'alta' ? 'text-red-500' : p === 'baixa' ? 'text-lumos-text-secondary' : 'text-amber-500';

export default function MonitoramentoEquipe() {
  const navigate = useNavigate();
  const { getLiveStatus } = useLayout();
  const { profile } = useAuth(); // usado só pela trava do botão de teste (temporário)
  const [users, setUsers] = useState<AppUser[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hr, setHr] = useState<HR[]>([]);
  const [loading, setLoading] = useState(true);
  // Filtros + drill-down
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [period, setPeriod] = useState(7); // dias, para produtividade
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);
  useRealtimeRefetch(['project_tasks', 'app_users', 'team_members', 'projects'], () => load(true));
  // Poll de fallback: last_seen fresco mesmo sem realtime.
  useEffect(() => { const t = setInterval(() => load(true), 60_000); return () => clearInterval(t); }, []);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const [u, t, h] = await Promise.all([
      supabase.from('app_users').select('id, full_name, email, role, status, avatar_url, tour_seen, last_seen').eq('status', 'ativo').order('full_name'),
      supabase.from('project_tasks').select('id, titulo, status, prioridade, data_fim, responsavel_id, project_id, updated_at, project:projects(name, code)'),
      supabase.from('team_members').select('app_user_id, cpf, whatsapp, birth_date'),
    ]);
    setUsers((u.data as AppUser[]) || []);
    setTasks((t.data as any as Task[]) || []);
    setHr((h.data as HR[]) || []);
    setLoading(false);
  }

  const today = todayStr();
  const isStale = (task: Task) => isActive(task.status) && (Date.now() - new Date(task.updated_at).getTime()) > STALE_DAYS * 86400000;
  const isOverdue = (task: Task) => !!task.data_fim && task.data_fim < today && isOpen(task.status);
  const doneInPeriod = (task: Task) => isDone(task.status) && (Date.now() - new Date(task.updated_at).getTime()) <= period * 86400000;

  // Escopo por projeto (filtro). Vale para agregados, produtividade e gargalos.
  const scoped = useMemo(() => projectFilter ? tasks.filter(t => t.project_id === projectFilter) : tasks, [tasks, projectFilter]);

  // Listas para os selects de filtro
  const projectOptions = useMemo(() => {
    const m = new Map<string, { name: string; code: string | null }>();
    tasks.forEach(t => { if (t.project_id && !m.has(t.project_id)) m.set(t.project_id, { name: t.project?.name || 'Projeto', code: t.project?.code || null }); });
    return [{ value: '', label: 'Todos os projetos' }, ...Array.from(m.entries())
      .map(([id, p]) => ({ value: id, label: `${p.code ? formatBudgetCode(p.code) + ' ' : ''}${p.name}` }))
      .sort((a, b) => a.label.localeCompare(b.label))];
  }, [tasks]);
  const roleOptions = useMemo(() => {
    const set = new Set(users.map(u => u.role));
    return [{ value: '', label: 'Todos os cargos' }, ...Array.from(set).map(r => ({ value: r, label: ROLE_LABEL[r] || r }))];
  }, [users]);

  const hrByUser = useMemo(() => {
    const m = new Map<string, HR>();
    hr.forEach(x => { if (x.app_user_id) m.set(x.app_user_id, x); });
    return m;
  }, [hr]);

  // Estatísticas por pessoa (sobre o escopo de projeto atual)
  const people = useMemo(() => {
    return users.map(u => {
      const mine = scoped.filter(t => t.responsavel_id === u.id);
      const open = mine.filter(t => isOpen(t.status));
      const active = mine.filter(t => isActive(t.status));
      const done = mine.filter(t => isDone(t.status));
      const overdue = mine.filter(isOverdue);
      const stale = mine.filter(isStale);
      const donePeriod = mine.filter(doneInPeriod).length;
      const current = active.find(t => t.status === 'em_progresso')
        || [...active].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]
        || null;
      const online = effectiveStatus(getLiveStatus(u.id), u.last_seen) === 'online';
      const h = hrByUser.get(u.id);
      const hrFilled = !!h && !!(h.cpf || h.whatsapp || h.birth_date);
      return {
        user: u, online, current, tasks: mine,
        open: open.length, active: active.length, done: done.length, donePeriod,
        overdue: overdue.length, stale: stale.length,
        onboarded: !!u.tour_seen, hrFilled,
      };
    }).sort((a, b) => Number(b.online) - Number(a.online) || b.overdue - a.overdue || b.open - a.open);
  }, [users, scoped, hrByUser, getLiveStatus, period]);

  const visiblePeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter(p =>
      (!roleFilter || p.user.role === roleFilter) &&
      (!q || p.user.full_name.toLowerCase().includes(q) || (p.user.email || '').toLowerCase().includes(q)));
  }, [people, roleFilter, search]);

  const maxOpen = Math.max(1, ...people.map(p => p.open));

  // Gargalos: tarefas paradas em cada status ativo + tempo médio "parado" (proxy: desde o último update).
  const bottlenecks = useMemo(() => TASK_ACTIVE.filter(s => s !== 'em_andamento').map(s => {
    const items = scoped.filter(t => t.status === s);
    const avgDays = items.length ? items.reduce((a, t) => a + (Date.now() - new Date(t.updated_at).getTime()) / 86400000, 0) / items.length : 0;
    return { status: s, count: items.length, avgDays };
  }).filter(b => b.count > 0).sort((a, b) => b.count - a.count), [scoped]);
  const maxBottleneck = Math.max(1, ...bottlenecks.map(b => b.count));

  // Agregados (sobre o escopo)
  const onlineCount = people.filter(p => p.online).length;
  const overdueTasks = useMemo(() => scoped.filter(isOverdue)
    .sort((a, b) => daysLate(b.data_fim!) - daysLate(a.data_fim!)), [scoped]);
  const activeCount = scoped.filter(t => isActive(t.status)).length;
  const openCount = scoped.filter(t => isOpen(t.status)).length;
  const doneCount = scoped.filter(t => isDone(t.status)).length;
  const totalCount = scoped.length;
  const donePct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const unassigned = scoped.filter(t => isOpen(t.status) && !t.responsavel_id).length;
  const staleCount = scoped.filter(isStale).length;
  const idlePeople = people.filter(p => p.active === 0).length;
  const onboardingPending = people.filter(p => !p.onboarded).length;
  const filtersActive = !!(search || roleFilter || projectFilter);

  const detailPerson = detailId ? people.find(p => p.user.id === detailId) || null : null;

  const userName = (id: string | null) => users.find(u => u.id === id)?.full_name || 'Sem responsável';

  const Kpi = ({ icon: Icon, label, value, sub, tone = 'default' }: any) => (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-4">
      <div className="flex items-center gap-2 text-lumos-text-secondary">
        <Icon className={clsx('w-4 h-4', tone === 'danger' && 'text-red-500', tone === 'good' && 'text-green-500', tone === 'warn' && 'text-amber-500')} />
        <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
      </div>
      <p className={clsx('text-3xl font-black mt-2 text-lumos-text-primary', tone === 'danger' && value > 0 && 'text-red-500')}>{value}</p>
      {sub && <p className="text-[11px] text-lumos-text-secondary mt-0.5">{sub}</p>}
    </div>
  );

  if (loading) {
    return <div className="py-24 text-center"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-lumos-yellow mx-auto" /></div>;
  }

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight flex items-center gap-2">
            <Radio className="w-6 h-6 text-lumos-yellow" /> Monitoramento da Equipe
          </h1>
          <p className="text-lumos-text-secondary text-sm">Visão ao vivo de quem está online, o que cada um faz e o que falta entregar. Reservado à direção.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* ⚠️ TEMPORÁRIO — botão só para testar o layout do popup de projeto novo.
              Exclusivo do Caio: o Monitoramento é aberto a todos os admins, então sem
              essa trava o botão apareceria para os outros. Remover quando o teste acabar. */}
          {canTestCelebration(profile?.email) && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent(CELEBRATE_TEST_EVENT, {
                detail: { budgetId: null, projectName: 'Heinz | Maionese Saborizada', code: '#2026-228' },
              }))}
              className="flex items-center gap-1.5 text-[11px] font-bold text-lumos-text-secondary border border-dashed border-lumos-border hover:text-lumos-yellow hover:border-lumos-yellow/50 px-2.5 py-1 rounded-full transition-colors"
              title="Apenas teste: abre o popup de comemoração"
            >
              <PartyPopper className="w-3.5 h-3.5" /> Testar popup
            </button>
          )}

          <span className="flex items-center gap-1.5 text-[11px] font-bold text-green-500 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" /></span>
            Tempo real
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar pessoa por nome ou e-mail…"
            className="input-lumos pl-10 w-full h-10 text-sm" />
        </div>
        <Select value={roleFilter} onChange={setRoleFilter} options={roleOptions} className="input-lumos h-10 text-sm min-w-[160px]" />
        <Select value={projectFilter} onChange={setProjectFilter} options={projectOptions} className="input-lumos h-10 text-sm min-w-[220px]" />
        {filtersActive && (
          <button onClick={() => { setSearch(''); setRoleFilter(''); setProjectFilter(''); }}
            className="h-10 px-3 rounded-lumos border border-lumos-border text-xs font-bold text-lumos-text-secondary hover:text-lumos-yellow flex items-center gap-1.5">
            <X className="w-3.5 h-3.5" /> Limpar
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={Users} label="Online agora" value={onlineCount} sub={`de ${people.length} pessoas`} tone="good" />
        <Kpi icon={Activity} label="Em andamento" value={activeCount} sub="tarefas ativas" />
        <Kpi icon={AlertTriangle} label="Atrasadas" value={overdueTasks.length} sub="passaram do prazo" tone="danger" />
        <Kpi icon={ListChecks} label="Abertas" value={openCount} sub={`${doneCount} concluídas`} />
        <Kpi icon={CheckCircle2} label="Conclusão" value={`${donePct}%`} sub="do total de tarefas" tone="good" />
        <Kpi icon={IdCard} label="Cadastros pend." value={onboardingPending} sub="onboarding não feito" tone={onboardingPending ? 'warn' : 'good'} />
      </div>

      {/* Alertas / sinais de risco */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Alert icon={UserX} label="Sem responsável" value={unassigned} hint="tarefas abertas sem dono" tone={unassigned ? 'danger' : 'ok'} />
        <Alert icon={PauseCircle} label={`Paradas +${STALE_DAYS}d`} value={staleCount} hint="ativas sem movimento" tone={staleCount ? 'warn' : 'ok'} />
        <Alert icon={Coffee} label="Sem tarefa ativa" value={idlePeople} hint="pessoas ociosas agora" tone={idlePeople ? 'warn' : 'ok'} />
        <Alert icon={Zap} label="Atrasadas" value={overdueTasks.length} hint="precisam de ação já" tone={overdueTasks.length ? 'danger' : 'ok'} />
      </div>

      {/* Equipe ao vivo */}
      <div className="bg-lumos-surface border border-lumos-border rounded-lumos overflow-hidden">
        <div className="px-4 py-3 border-b border-lumos-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-lumos-yellow" />
            <h2 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Equipe ao vivo</h2>
            <span className="text-[11px] text-lumos-text-secondary">{visiblePeople.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Entregues em</span>
            <div className="flex items-center rounded-lumos border border-lumos-border overflow-hidden">
              {[7, 30].map(d => (
                <button key={d} onClick={() => setPeriod(d)}
                  className={clsx('h-7 px-2.5 text-[11px] font-black transition-colors', period === d ? 'bg-lumos-yellow text-black' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider">
                <th className="px-4 py-3">Pessoa</th>
                <th className="px-4 py-3">Fazendo agora</th>
                <th className="px-4 py-3 text-center">Abertas</th>
                <th className="px-4 py-3 text-center">Atrasadas</th>
                <th className="px-4 py-3 text-center" title={`Concluídas nos últimos ${period} dias`}>Entregues {period}d</th>
                <th className="px-4 py-3">Carga</th>
                <th className="px-4 py-3 text-center">Cadastro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {visiblePeople.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-sm text-lumos-text-secondary italic">Ninguém com esse filtro.</td></tr>
              ) : visiblePeople.map(p => (
                <tr key={p.user.id} onClick={() => setDetailId(p.user.id)} className="hover:bg-lumos-text-primary/5 cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar user={p.user as any} size={36} showStatus lastSeen={p.user.last_seen} />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-lumos-text-primary truncate">{p.user.full_name}</p>
                        <p className="text-[11px] text-lumos-text-secondary">
                          {ROLE_LABEL[p.user.role] || p.user.role} · {p.online ? <span className="text-green-500 font-bold">online</span> : `visto ${relTime(p.user.last_seen)}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[280px]">
                    {p.current ? (
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/producao/projetos?projectId=${p.current!.project_id}`); }} className="text-left group">
                        <span className="text-sm font-semibold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors truncate block">{p.current.titulo}</span>
                        <span className="text-[10px] text-lumos-text-secondary uppercase tracking-wide">
                          {taskLabel(p.current.status)}{p.current.project?.name ? ` · ${p.current.project.name}` : ''}
                        </span>
                      </button>
                    ) : (
                      <span className="text-xs text-lumos-text-secondary italic flex items-center gap-1"><Coffee className="w-3.5 h-3.5" /> sem tarefa ativa</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-sm font-black text-lumos-text-primary">{p.open}</td>
                  <td className={clsx('px-4 py-3 text-center text-sm font-black', p.overdue ? 'text-red-500' : 'text-lumos-text-secondary')}>{p.overdue || '—'}</td>
                  <td className="px-4 py-3 text-center text-sm font-black text-green-500">{p.donePeriod || '—'}</td>
                  <td className="px-4 py-3 w-40">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-lumos-bg overflow-hidden">
                        <div className={clsx('h-full rounded-full', p.overdue ? 'bg-red-500' : p.open === 0 ? 'bg-lumos-border' : 'bg-lumos-yellow')} style={{ width: `${(p.open / maxOpen) * 100}%` }} />
                      </div>
                      {p.stale > 0 && <span title={`${p.stale} parada(s) +${STALE_DAYS}d`} className="text-[9px] font-black text-amber-500 flex items-center gap-0.5"><PauseCircle className="w-3 h-3" />{p.stale}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <span title={p.onboarded ? 'Onboarding concluído' : 'Onboarding pendente'}
                        className={clsx('inline-flex items-center gap-0.5 text-[9px] font-black uppercase px-1.5 py-0.5 rounded', p.onboarded ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500')}>
                        <ShieldCheck className="w-3 h-3" /> App
                      </span>
                      <span title={p.hrFilled ? 'Dados de RH preenchidos' : 'Dados de RH pendentes'}
                        className={clsx('inline-flex items-center gap-0.5 text-[9px] font-black uppercase px-1.5 py-0.5 rounded', p.hrFilled ? 'bg-green-500/10 text-green-500' : 'bg-lumos-text-secondary/10 text-lumos-text-secondary')}>
                        <IdCard className="w-3 h-3" /> RH
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gargalos por etapa */}
      <div className="bg-lumos-surface border border-lumos-border rounded-lumos overflow-hidden">
        <div className="px-4 py-3 border-b border-lumos-border flex items-center gap-2">
          <Hourglass className="w-4 h-4 text-lumos-yellow" />
          <h2 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Gargalos por etapa</h2>
          <span className="text-[11px] text-lumos-text-secondary">onde as tarefas ativas estão paradas</span>
        </div>
        {bottlenecks.length === 0 ? (
          <div className="py-8 text-center text-sm text-lumos-text-secondary">Sem tarefas ativas no momento.</div>
        ) : (
          <div className="p-4 space-y-2.5">
            {bottlenecks.map(b => (
              <div key={b.status} className="flex items-center gap-3">
                <span className="text-[11px] font-bold text-lumos-text-primary w-36 flex-shrink-0 truncate">{taskLabel(b.status)}</span>
                <div className="flex-1 h-5 rounded-full bg-lumos-bg overflow-hidden relative">
                  <div className={clsx('h-full rounded-full', b.avgDays >= STALE_DAYS ? 'bg-red-500/70' : 'bg-lumos-yellow')} style={{ width: `${(b.count / maxBottleneck) * 100}%` }} />
                  <span className="absolute inset-y-0 left-2 flex items-center text-[10px] font-black text-lumos-text-primary">{b.count}</span>
                </div>
                <span className={clsx('text-[10px] font-bold w-24 text-right flex-shrink-0', b.avgDays >= STALE_DAYS ? 'text-red-500' : 'text-lumos-text-secondary')}>
                  ~{b.avgDays.toFixed(1)}d parada
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tarefas atrasadas */}
      <div className="bg-lumos-surface border border-lumos-border rounded-lumos overflow-hidden">
        <div className="px-4 py-3 border-b border-lumos-border flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <h2 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Atrasadas</h2>
          <span className="text-[11px] text-lumos-text-secondary">{overdueTasks.length}</span>
        </div>
        {overdueTasks.length === 0 ? (
          <div className="py-10 text-center text-sm text-lumos-text-secondary flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" /> Nada atrasado. Time em dia!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider">
                  <th className="px-4 py-3">Tarefa</th>
                  <th className="px-4 py-3">Responsável</th>
                  <th className="px-4 py-3">Projeto</th>
                  <th className="px-4 py-3 text-center">Prazo</th>
                  <th className="px-4 py-3 text-center">Atraso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lumos-border">
                {overdueTasks.slice(0, 30).map(t => (
                  <tr key={t.id} onClick={() => navigate(`/producao/projetos?projectId=${t.project_id}`)} className="hover:bg-lumos-text-primary/5 cursor-pointer group">
                    <td className="px-4 py-2.5">
                      <span className="text-sm font-semibold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors">{t.titulo}</span>
                      <span className={clsx('ml-2 text-[9px] font-black uppercase', prioColor(t.prioridade))}>{t.prioridade}</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-lumos-text-secondary">{userName(t.responsavel_id)}</td>
                    <td className="px-4 py-2.5 text-xs text-lumos-text-secondary">
                      {t.project?.code && <span className="font-black text-amber-600 dark:text-lumos-yellow mr-1">{formatBudgetCode(t.project.code)}</span>}
                      {t.project?.name || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-lumos-text-secondary">{fmtDate(t.data_fim)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-[11px] font-black text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full whitespace-nowrap flex items-center gap-1 justify-center w-fit mx-auto">
                        <Clock className="w-3 h-3" /> {daysLate(t.data_fim!)}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drill-down de uma pessoa */}
      {detailPerson && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150" onClick={() => setDetailId(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl max-h-[92vh] overflow-y-auto custom-scrollbar bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl">
            <div className="sticky top-0 bg-lumos-surface border-b border-lumos-border px-5 py-3 flex items-center justify-between z-10">
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar user={detailPerson.user as any} size={40} showStatus lastSeen={detailPerson.user.last_seen} />
                <div className="min-w-0">
                  <h2 className="text-base font-black text-lumos-text-primary truncate">{detailPerson.user.full_name}</h2>
                  <p className="text-[11px] text-lumos-text-secondary">
                    {ROLE_LABEL[detailPerson.user.role] || detailPerson.user.role} · {detailPerson.online ? <span className="text-green-500 font-bold">online</span> : `visto ${relTime(detailPerson.user.last_seen)}`}
                  </p>
                </div>
              </div>
              <button onClick={() => setDetailId(null)} className="p-1.5 rounded-lumos text-lumos-text-secondary hover:text-lumos-text-primary"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-4 gap-2 text-center">
                <MiniStat label="Abertas" value={detailPerson.open} />
                <MiniStat label="Atrasadas" value={detailPerson.overdue} tone={detailPerson.overdue ? 'danger' : undefined} />
                <MiniStat label={`Entregues ${period}d`} value={detailPerson.donePeriod} tone="good" />
                <MiniStat label={`Paradas +${STALE_DAYS}d`} value={detailPerson.stale} tone={detailPerson.stale ? 'warn' : undefined} />
              </div>

              {(['ativas', 'a_fazer', 'atrasadas'] as const).map(group => {
                const items = detailPerson.tasks.filter(t =>
                  group === 'atrasadas' ? isOverdue(t)
                  : group === 'ativas' ? (isActive(t.status) && !isOverdue(t))
                  : (isOpen(t.status) && !isActive(t.status) && !isOverdue(t)));
                if (items.length === 0) return null;
                const title = group === 'atrasadas' ? 'Atrasadas' : group === 'ativas' ? 'Em andamento' : 'A fazer';
                return (
                  <div key={group}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1.5">{title} · {items.length}</p>
                    <div className="space-y-1">
                      {items.sort((a, b) => (a.data_fim || '9999').localeCompare(b.data_fim || '9999')).map(t => (
                        <button key={t.id} onClick={() => { setDetailId(null); navigate(`/producao/projetos?projectId=${t.project_id}`); }}
                          className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lumos border border-lumos-border/60 hover:border-lumos-yellow/40 hover:bg-lumos-text-primary/5 transition-colors group">
                          <span className="flex-1 min-w-0">
                            <span className="text-sm font-semibold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors truncate block">{t.titulo}</span>
                            <span className="text-[10px] text-lumos-text-secondary uppercase tracking-wide">
                              {taskLabel(t.status)}{t.project?.name ? ` · ${t.project.name}` : ''}
                            </span>
                          </span>
                          {t.data_fim && (
                            <span className={clsx('text-[10px] font-bold whitespace-nowrap', isOverdue(t) ? 'text-red-500' : 'text-lumos-text-secondary')}>
                              {isOverdue(t) ? `${daysLate(t.data_fim)}d atraso` : fmtDate(t.data_fim)}
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-lumos-text-secondary flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {detailPerson.open === 0 && (
                <p className="text-sm text-lumos-text-secondary text-center py-4 flex items-center justify-center gap-2">
                  <Coffee className="w-4 h-4" /> Sem tarefas abertas.
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'good' | 'warn' }) {
  return (
    <div className="bg-lumos-bg/40 border border-lumos-border rounded-lumos py-2">
      <p className={clsx('text-2xl font-black leading-none', tone === 'danger' ? 'text-red-500' : tone === 'good' ? 'text-green-500' : tone === 'warn' ? 'text-amber-500' : 'text-lumos-text-primary')}>{value}</p>
      <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary mt-1">{label}</p>
    </div>
  );
}

function Alert({ icon: Icon, label, value, hint, tone }: any) {
  const danger = tone === 'danger' && value > 0;
  const warn = tone === 'warn' && value > 0;
  return (
    <div className={clsx('rounded-lumos border p-3 flex items-center gap-3',
      danger ? 'border-red-500/30 bg-red-500/[0.03]' : warn ? 'border-amber-500/30 bg-amber-500/[0.03]' : 'border-lumos-border bg-lumos-surface')}>
      <div className={clsx('w-9 h-9 rounded-lumos flex items-center justify-center flex-shrink-0',
        danger ? 'bg-red-500/10 text-red-500' : warn ? 'bg-amber-500/10 text-amber-500' : 'bg-lumos-text-secondary/10 text-lumos-text-secondary')}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0">
        <p className={clsx('text-xl font-black leading-none', danger ? 'text-red-500' : warn ? 'text-amber-500' : 'text-lumos-text-primary')}>{value}</p>
        <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mt-1">{label}</p>
        <p className="text-[10px] text-lumos-text-secondary/70 truncate">{hint}</p>
      </div>
    </div>
  );
}
