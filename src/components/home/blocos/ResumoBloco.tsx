import { ClipboardList, Clock, CalendarDays, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import type { DadosHome } from '../tipos';

/** Quatro números das tarefas da própria pessoa. */
export default function ResumoBloco({ dados }: { dados: DadosHome }) {
  const stats = dados.resumo;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Card 1: Total Pending */}
      <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-3.5 hover:border-lumos-yellow/30 transition-all flex items-center gap-3 group">
        <div className="p-2.5 bg-lumos-yellow/5 group-hover:bg-lumos-yellow/10 rounded-lg border border-lumos-yellow/15 transition-all">
          <ClipboardList className="w-4 h-4 text-lumos-yellow" />
        </div>
        <div>
          <span className="block text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Minhas Tarefas</span>
          <span className="text-lg md:text-xl font-semibold text-lumos-text-primary">{stats.pending}</span>
        </div>
      </div>

      {/* Card 2: Due Today */}
      <div className={clsx(
        "border rounded-lumos p-3.5 transition-all flex items-center gap-3 group",
        stats.dueToday > 0 ? "bg-lumos-yellow/5 border-lumos-yellow/30" : "bg-lumos-surface border-lumos-border hover:border-lumos-yellow/30"
      )}>
        <div className={clsx(
          "p-2.5 rounded-lg border transition-all",
          stats.dueToday > 0 ? "bg-lumos-yellow/10 border-lumos-yellow/30" : "bg-lumos-yellow/5 group-hover:bg-lumos-yellow/10 border-lumos-yellow/15"
        )}>
          <Clock className="w-4 h-4 text-lumos-yellow" />
        </div>
        <div>
          <span className="block text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Vencem Hoje</span>
          <span className="text-lg md:text-xl font-semibold text-lumos-text-primary">{stats.dueToday}</span>
        </div>
      </div>

      {/* Card 3: Due This Week */}
      <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-3.5 hover:border-lumos-yellow/30 transition-all flex items-center gap-3 group">
        <div className="p-2.5 bg-lumos-yellow/5 group-hover:bg-lumos-yellow/10 rounded-lg border border-lumos-yellow/15 transition-all">
          <CalendarDays className="w-4 h-4 text-lumos-yellow" />
        </div>
        <div>
          <span className="block text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Esta Semana</span>
          <span className="text-lg md:text-xl font-semibold text-lumos-text-primary">{stats.dueThisWeek}</span>
        </div>
      </div>

      {/* Card 4: Overdue */}
      <div className={clsx(
        "border rounded-lumos p-3.5 transition-all flex items-center gap-3 group",
        stats.overdue > 0 ? "bg-red-500/5 border-red-500/30" : "bg-lumos-surface border-lumos-border hover:border-red-500/30"
      )}>
        <div className={clsx(
          "p-2.5 rounded-lg border transition-all",
          stats.overdue > 0 ? "bg-red-500/10 border-red-500/30" : "bg-red-500/5 group-hover:bg-red-500/10 border-red-500/15"
        )}>
          <AlertTriangle className={clsx("w-4 h-4", stats.overdue > 0 ? "text-red-500" : "text-red-400")} />
        </div>
        <div>
          <span className="block text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Atrasadas</span>
          <span className={clsx("text-lg md:text-xl font-semibold", stats.overdue > 0 ? "text-red-500" : "text-lumos-text-primary")}>
            {stats.overdue}
          </span>
        </div>
      </div>
    </div>
  );
}
