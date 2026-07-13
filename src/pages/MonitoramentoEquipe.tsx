import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Users, UserX,
  ListChecks, Coffee, ShieldCheck, IdCard, PauseCircle, Zap, Radio,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useLayout } from '@/context/LayoutContext';
import UserAvatar from '@/components/common/UserAvatar';
import StatusDot from '@/components/common/StatusDot';
import { isDone, isActive, isOpen, taskLabel } from '@/lib/taskStatus';
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
  const [users, setUsers] = useState<AppUser[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hr, setHr] = useState<HR[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  useRealtimeRefetch(['project_tasks', 'app_users', 'team_members', 'projects'], () => load(true));

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

  const hrByUser = useMemo(() => {
    const m = new Map<string, HR>();
    hr.forEach(x => { if (x.app_user_id) m.set(x.app_user_id, x); });
    return m;
  }, [hr]);

  // Estatísticas por pessoa
  const people = useMemo(() => {
    return users.map(u => {
      const mine = tasks.filter(t => t.responsavel_id === u.id);
      const open = mine.filter(t => isOpen(t.status));
      const active = mine.filter(t => isActive(t.status));
      const done = mine.filter(t => isDone(t.status));
      const overdue = mine.filter(isOverdue);
      const stale = mine.filter(isStale);
      // "Fazendo agora": prioriza em_progresso, senão qualquer ativa mais recente.
      const current = active.find(t => t.status === 'em_progresso')
        || [...active].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]
        || null;
      const online = getLiveStatus(u.id) === 'online';
      const h = hrByUser.get(u.id);
      const hrFilled = !!h && !!(h.cpf || h.whatsapp || h.birth_date);
      return {
        user: u, online, current,
        open: open.length, active: active.length, done: done.length,
        overdue: overdue.length, stale: stale.length,
        onboarded: !!u.tour_seen, hrFilled,
      };
    }).sort((a, b) => Number(b.online) - Number(a.online) || b.overdue - a.overdue || b.open - a.open);
  }, [users, tasks, hrByUser, getLiveStatus]);

  const maxOpen = Math.max(1, ...people.map(p => p.open));

  // Agregados globais
  const onlineCount = people.filter(p => p.online).length;
  const overdueTasks = useMemo(() => tasks.filter(isOverdue)
    .sort((a, b) => daysLate(b.data_fim!) - daysLate(a.data_fim!)), [tasks]);
  const activeCount = tasks.filter(t => isActive(t.status)).length;
  const openCount = tasks.filter(t => isOpen(t.status)).length;
  const doneCount = tasks.filter(t => isDone(t.status)).length;
  const totalCount = tasks.length;
  const donePct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const unassigned = tasks.filter(t => isOpen(t.status) && !t.responsavel_id).length;
  const staleCount = tasks.filter(isStale).length;
  const idlePeople = people.filter(p => p.active === 0).length;
  const onboardingPending = people.filter(p => !p.onboarded).length;

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
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-green-500 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full">
          <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" /></span>
          Tempo real
        </span>
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
        <div className="px-4 py-3 border-b border-lumos-border flex items-center gap-2">
          <Users className="w-4 h-4 text-lumos-yellow" />
          <h2 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary">Equipe ao vivo</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider">
                <th className="px-4 py-3">Pessoa</th>
                <th className="px-4 py-3">Fazendo agora</th>
                <th className="px-4 py-3 text-center">Abertas</th>
                <th className="px-4 py-3 text-center">Atrasadas</th>
                <th className="px-4 py-3 text-center">Concluídas</th>
                <th className="px-4 py-3">Carga</th>
                <th className="px-4 py-3 text-center">Cadastro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {people.map(p => (
                <tr key={p.user.id} className="hover:bg-lumos-text-primary/5">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar user={p.user as any} size={36} showStatus />
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
                      <button onClick={() => navigate(`/producao/projetos?projectId=${p.current!.project_id}`)} className="text-left group">
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
                  <td className="px-4 py-3 text-center text-sm font-black text-green-500">{p.done}</td>
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
