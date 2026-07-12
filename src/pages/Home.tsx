import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { NAV_SECTIONS, getSectionItems } from '@/lib/navigation';
import { useToast } from '@/context/ToastContext';
import { 
  ClipboardList, 
  Clock, 
  CalendarDays, 
  AlertTriangle, 
  Bell, 
  CheckCheck, 
  ChevronRight, 
  Flame, 
  ExternalLink,
  CheckCircle2
} from 'lucide-react';
import { clsx } from 'clsx';
import Confetti from '@/components/common/Confetti';
import UserAvatar from '@/components/common/UserAvatar';
import OnboardingGate from '@/components/common/OnboardingGate';
import WelcomeTour from '@/components/common/WelcomeTour';

interface Birthday { id: string; app_user_id: string | null; full_name: string; photo_url: string | null; }

interface TaskWithProject {
  id: string;
  titulo: string;
  status: string;
  prioridade: string;
  data_fim: string | null;
  project_id: string;
  projects: {
    id: string;
    name: string;
    client_id: string | null;
    clients: {
      id: string;
      name: string;
    } | null;
  } | null;
}

export default function Home() {
  const { profile, can, isAdmin } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { items: notifications, markAsRead, markAllAsRead } = useNotifications();

  const [tasks, setTasks] = useState<TaskWithProject[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  // Aniversariantes de hoje → confete + banner comemorativo (para todo o time)
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [bannerClosed, setBannerClosed] = useState(false);
  useEffect(() => {
    supabase.rpc('birthdays_today').then(({ data }) => {
      const list = (data as Birthday[]) || [];
      if (list.length) { setBirthdays(list); setShowConfetti(true); }
    });
  }, []);

  const userId = profile?.id;
  const ctx = useMemo(() => ({ can, isAdmin }), [can, isAdmin]);

  // Load Tasks assigned to this user
  useEffect(() => {
    async function fetchTasks() {
      if (!userId) return;
      try {
        setLoadingTasks(true);
        const { data, error } = await supabase
          .from('project_tasks')
          .select(`
            id,
            project_id,
            titulo,
            status,
            prioridade,
            data_fim,
            responsavel_id,
            projects (
              id,
              name,
              client_id,
              clients (
                id,
                name
              )
            )
          `)
          .eq('responsavel_id', userId)
          .neq('status', 'concluido');

        if (error) throw error;
        setTasks((data as any) || []);
      } catch (err: any) {
        console.error('Error fetching home tasks:', err);
        toast.error('Erro ao carregar suas tarefas pendentes.');
      } finally {
        setLoadingTasks(false);
      }
    }

    fetchTasks();
  }, [userId, toast]);

  // Get current local date formatted
  const formattedDate = useMemo(() => {
    const dateStr = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date());
    return dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  }, []);

  const todayStr = useMemo(() => new Date().toLocaleDateString('en-CA'), []);

  // Compute stats metrics
  const stats = useMemo(() => {
    const pending = tasks.length;
    const dueToday = tasks.filter(t => t.data_fim === todayStr).length;

    // Due this week (next 7 days)
    const next7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const next7DaysStr = next7Days.toLocaleDateString('en-CA');
    const dueThisWeek = tasks.filter(t => t.data_fim && t.data_fim >= todayStr && t.data_fim <= next7DaysStr).length;

    // Overdue tasks
    const overdue = tasks.filter(t => t.data_fim && t.data_fim < todayStr).length;

    return { pending, dueToday, dueThisWeek, overdue };
  }, [tasks, todayStr]);

  // Sort tasks: data_fim ascending, null dates at the end
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (!a.data_fim) return 1;
      if (!b.data_fim) return -1;
      return a.data_fim.localeCompare(b.data_fim);
    });
  }, [tasks]);

  // Filter dynamic visible navigation items as shortcuts
  const shortcuts = useMemo(() => {
    const visibleShortcuts: { label: string; path: string; icon: any }[] = [];
    NAV_SECTIONS.forEach(sec => {
      if (sec.visibleWhen(ctx)) {
        const items = getSectionItems(sec.id, ctx);
        items.forEach(item => {
          // Exclude configuration details and raw list pages to keep it clean
          if (item.path !== '/configuracoes' && item.path !== '/financeiro/configuracao') {
            visibleShortcuts.push({
              label: item.label,
              path: item.path,
              icon: item.icon
            });
          }
        });
      }
    });
    return visibleShortcuts.slice(0, 8); // Display top 8 shortcuts
  }, [ctx]);

  const handleNotificationClick = async (item: any) => {
    if (!item.read_at) {
      await markAsRead(item.id);
    }
    if (item.link) {
      navigate(item.link);
    }
  };

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case 'urgente':
        return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'alta':
        return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      case 'media':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'baixa':
      default:
        return 'bg-gray-500/10 text-lumos-text-secondary border-lumos-border/35';
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; class: string }> = {
      'iniciar': { label: 'A Fazer', class: 'bg-lumos-text-secondary/15 text-lumos-text-secondary' },
      'desenvolvimento': { label: 'Em Progresso', class: 'bg-blue-500/15 text-blue-400' },
      'revisao': { label: 'Em Revisão', class: 'bg-purple-500/15 text-purple-400' },
      'aprovado': { label: 'Aprovada', class: 'bg-green-500/15 text-green-400' },
    };
    const details = map[status] || { label: status, class: 'bg-lumos-text-secondary/15 text-lumos-text-secondary' };
    return (
      <span className={clsx("px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider", details.class)}>
        {details.label}
      </span>
    );
  };

  const myBirthday = birthdays.some(b => (b.app_user_id && b.app_user_id === profile?.id) || b.full_name === profile?.full_name);
  const birthdayNames = birthdays.map(b => b.full_name.split(' ')[0]).join(', ').replace(/, ([^,]*)$/, ' e $1');

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-work-sans text-lumos-text-primary pb-10">

      {/* Tour de boas-vindas (só no 1º login) + onboarding de dados */}
      <WelcomeTour />
      <OnboardingGate />

      {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}

      {/* Banner de aniversário 🎂 */}
      {birthdays.length > 0 && !bannerClosed && (
        <div className="relative overflow-hidden rounded-lumos border border-lumos-yellow/40 bg-gradient-to-r from-lumos-yellow/15 via-pink-500/10 to-purple-500/10 p-4 flex items-center gap-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex -space-x-2 flex-shrink-0">
            {birthdays.slice(0, 4).map(b => (
              <UserAvatar key={b.id} user={{ full_name: b.full_name, avatar_url: b.photo_url }} size={40} className="ring-2 ring-lumos-surface rounded-full" />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm md:text-base font-black text-lumos-text-primary flex items-center gap-1.5">
              🎂 {myBirthday ? `Feliz aniversário, ${profile?.full_name?.split(' ')[0]}!` : `Hoje é aniversário de ${birthdayNames}!`}
            </p>
            <p className="text-[11px] text-lumos-text-secondary font-semibold">
              {myBirthday ? 'A Lumos deseja um dia incrível! 🎉' : 'Passa lá e deseja um feliz aniversário! 🎉'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={() => setShowConfetti(true)} title="Soltar confete de novo" className="hidden sm:flex text-lg hover:scale-110 transition-transform">🎉</button>
            <button onClick={() => setBannerClosed(true)} className="p-1 rounded-full text-lumos-text-secondary hover:text-lumos-text-primary" title="Fechar">
              <span className="text-lg leading-none">×</span>
            </button>
          </div>
        </div>
      )}

      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-lumos-surface border border-lumos-border/50 rounded-lumos p-6 relative overflow-hidden shadow-sm">
        <div className="absolute top-0 left-0 h-full w-1 bg-lumos-yellow" />
        <div>
          <h1 className="text-xl md:text-2xl font-black text-lumos-text-primary tracking-tight">
            Olá, {profile?.full_name || 'Membro Lumos'}! 👋
          </h1>
          <p className="text-xs text-lumos-text-secondary mt-1 font-semibold uppercase tracking-wider">
            {formattedDate}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-center bg-lumos-yellow/10 border border-lumos-yellow/20 px-3.5 py-1.5 rounded-full">
          <Flame className="w-4 h-4 text-lumos-yellow animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-wider text-lumos-yellow">
            Tudo Pronto Para Produzir
          </span>
        </div>
      </div>

      {/* Resumo do Dia Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Pending */}
        <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-4 hover:border-lumos-yellow/30 transition-all flex items-center gap-4 group">
          <div className="p-3 bg-lumos-yellow/5 group-hover:bg-lumos-yellow/10 rounded-lg border border-lumos-yellow/15 transition-all">
            <ClipboardList className="w-5 h-5 text-lumos-yellow" />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Minhas Tarefas</span>
            <span className="text-xl md:text-2xl font-black text-lumos-text-primary">{stats.pending}</span>
          </div>
        </div>

        {/* Card 2: Due Today */}
        <div className={clsx(
          "border rounded-lumos p-4 transition-all flex items-center gap-4 group",
          stats.dueToday > 0 ? "bg-lumos-yellow/5 border-lumos-yellow/30" : "bg-lumos-surface border-lumos-border hover:border-lumos-yellow/30"
        )}>
          <div className={clsx(
            "p-3 rounded-lg border transition-all",
            stats.dueToday > 0 ? "bg-lumos-yellow/10 border-lumos-yellow/30" : "bg-lumos-yellow/5 group-hover:bg-lumos-yellow/10 border-lumos-yellow/15"
          )}>
            <Clock className="w-5 h-5 text-lumos-yellow" />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Vencem Hoje</span>
            <span className="text-xl md:text-2xl font-black text-lumos-text-primary">{stats.dueToday}</span>
          </div>
        </div>

        {/* Card 3: Due This Week */}
        <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-4 hover:border-lumos-yellow/30 transition-all flex items-center gap-4 group">
          <div className="p-3 bg-lumos-yellow/5 group-hover:bg-lumos-yellow/10 rounded-lg border border-lumos-yellow/15 transition-all">
            <CalendarDays className="w-5 h-5 text-lumos-yellow" />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Esta Semana</span>
            <span className="text-xl md:text-2xl font-black text-lumos-text-primary">{stats.dueThisWeek}</span>
          </div>
        </div>

        {/* Card 4: Overdue */}
        <div className={clsx(
          "border rounded-lumos p-4 transition-all flex items-center gap-4 group",
          stats.overdue > 0 ? "bg-red-500/5 border-red-500/30" : "bg-lumos-surface border-lumos-border hover:border-red-500/30"
        )}>
          <div className={clsx(
            "p-3 rounded-lg border transition-all",
            stats.overdue > 0 ? "bg-red-500/10 border-red-500/30" : "bg-red-500/5 group-hover:bg-red-500/10 border-red-500/15"
          )}>
            <AlertTriangle className={clsx("w-5 h-5", stats.overdue > 0 ? "text-red-500" : "text-red-400")} />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Atrasadas</span>
            <span className={clsx("text-xl md:text-2xl font-black", stats.overdue > 0 ? "text-red-500" : "text-lumos-text-primary")}>
              {stats.overdue}
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left / Main: Tasks List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between pb-1.5">
            <h2 className="text-sm font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-lumos-yellow" /> Minhas Tarefas Pendentes
            </h2>
            <span className="text-[10px] font-black uppercase bg-lumos-yellow/10 text-lumos-yellow px-2 py-0.5 rounded">
              {tasks.length} ativas
            </span>
          </div>

          {loadingTasks ? (
            <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-12 text-center flex flex-col items-center justify-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-lumos-yellow"></div>
              <p className="text-xs text-lumos-text-secondary font-bold uppercase tracking-wider">Carregando tarefas...</p>
            </div>
          ) : sortedTasks.length === 0 ? (
            <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-12 text-center flex flex-col items-center justify-center gap-4 shadow-sm">
              <div className="p-4 bg-green-500/10 rounded-full border border-green-500/20 text-green-500">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-lumos-text-primary">Tudo em dia! 🎉</h3>
                <p className="text-xs text-lumos-text-secondary mt-1 max-w-sm mx-auto leading-relaxed">
                  Você não tem nenhuma tarefa pendente atribuída no gerenciador de projetos neste momento.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedTasks.map(task => {
                const isOverdue = task.data_fim && task.data_fim < todayStr;
                const isDueToday = task.data_fim === todayStr;

                return (
                  <div
                    key={task.id}
                    onClick={() => {
                      const projId = task.projects?.id;
                      if (projId) {
                        navigate(`/producao/projetos?projectId=${projId}&taskId=${task.id}`);
                      } else {
                        navigate('/producao/projetos');
                      }
                    }}
                    className={clsx(
                      "bg-lumos-surface border rounded-lumos p-4 transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-lumos-yellow/40 group hover:shadow-md",
                      isOverdue ? "border-red-500/25 bg-red-500/[0.01]" : "border-lumos-border"
                    )}
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {task.prioridade && (
                          <span className={clsx("px-2 py-0.5 rounded text-[8px] font-black uppercase border tracking-wider", getPriorityBadgeClass(task.prioridade))}>
                            {task.prioridade}
                          </span>
                        )}
                        {getStatusBadge(task.status)}
                      </div>
                      <h4 className="text-xs md:text-sm font-black text-lumos-text-primary truncate group-hover:text-lumos-yellow transition-colors leading-tight">
                        {task.titulo}
                      </h4>
                      <p className="text-[10px] text-lumos-text-secondary font-semibold uppercase tracking-wider">
                        {task.projects?.clients?.name || 'Cliente Sem Nome'} • {task.projects?.name || 'Projeto Sem Nome'}
                      </p>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 border-lumos-border/40 pt-3 md:pt-0">
                      {/* Deadline info */}
                      <div className="text-left md:text-right">
                        <span className="block text-[8px] font-bold text-lumos-text-secondary uppercase tracking-widest">Prazo</span>
                        {task.data_fim ? (
                          <span className={clsx(
                            "text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 mt-0.5",
                            isOverdue ? "text-red-500" : isDueToday ? "text-lumos-yellow" : "text-lumos-text-primary"
                          )}>
                            {isOverdue && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 animate-pulse" />}
                            {new Date(task.data_fim + 'T12:00:00').toLocaleDateString('pt-BR')}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-lumos-text-secondary/60 mt-0.5 block italic">
                            Sem prazo
                          </span>
                        )}
                      </div>

                      {/* Go icon */}
                      <div className="p-1.5 rounded-full bg-lumos-bg border border-lumos-border/50 group-hover:bg-lumos-yellow/10 group-hover:border-lumos-yellow/30 text-lumos-text-secondary group-hover:text-lumos-yellow transition-all flex items-center justify-center flex-shrink-0">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Columns: Notifications + Shortcuts */}
        <div className="space-y-6">
          
          {/* Recent Notifications */}
          <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-4 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-lumos-border/50 pb-2.5">
              <h2 className="text-sm font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2">
                <Bell className="w-4 h-4 text-lumos-yellow" /> Notificações
              </h2>
              {notifications.filter(n => !n.read_at).length > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-[10px] font-black text-lumos-yellow hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5" /> Ler todas
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="text-center py-6 text-lumos-text-secondary/70 flex flex-col items-center justify-center gap-1.5">
                <p className="text-xs italic">Sem notificações recentes.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.slice(0, 5).map(item => (
                  <div
                    key={item.id}
                    onClick={() => handleNotificationClick(item)}
                    className={clsx(
                      "p-3 rounded border transition-all cursor-pointer text-left relative overflow-hidden group",
                      !item.read_at 
                        ? "bg-lumos-yellow/5 border-lumos-yellow/20 hover:bg-lumos-yellow/10" 
                        : "bg-lumos-bg/30 border-lumos-border hover:bg-lumos-text-secondary/5"
                    )}
                  >
                    {!item.read_at && (
                      <div className="absolute left-0 top-0 h-full w-0.5 bg-lumos-yellow" />
                    )}
                    <h4 className="text-xs font-bold text-lumos-text-primary truncate">
                      {item.title}
                    </h4>
                    {item.body && (
                      <p className="text-[10px] text-lumos-text-secondary mt-0.5 line-clamp-1">
                        {item.body}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Shortcuts */}
          <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-4 space-y-4 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2 border-b border-lumos-border/50 pb-2.5">
              <ExternalLink className="w-4 h-4 text-lumos-yellow" /> Atalhos Rápidos
            </h2>

            {shortcuts.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic text-center py-4">Nenhum atalho disponível.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {shortcuts.map(shortcut => (
                  <button
                    key={shortcut.path}
                    onClick={() => navigate(shortcut.path)}
                    className="flex flex-col items-center justify-center p-3 rounded border border-lumos-border bg-lumos-bg/35 hover:bg-lumos-yellow/5 hover:border-lumos-yellow/20 transition-all text-center gap-1.5 group cursor-pointer"
                  >
                    <shortcut.icon className="w-4 h-4 text-lumos-text-secondary group-hover:text-lumos-yellow transition-all" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-lumos-text-primary group-hover:text-lumos-yellow transition-all leading-none">
                      {shortcut.label}
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
