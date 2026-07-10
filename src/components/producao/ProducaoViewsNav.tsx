import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, Columns3, ChartGantt, Clapperboard } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/hooks/useAuth';

// Views da Produção (estilo ClickUp): pills no topo das páginas para alternar
// entre as formas de visualizar os projetos. A sidebar mostra só as páginas
// principais; estas rotas são acessadas por aqui (e pela busca Cmd+K).
const VIEWS = [
  { label: 'Visão Geral', path: '/producao', icon: LayoutDashboard, permission: 'ordem_do_dia', end: true },
  { label: 'Calendário', path: '/producao/dashboard', icon: CalendarDays, permission: 'ordem_do_dia' },
  { label: 'Board', path: '/producao/board', icon: Columns3, permission: 'ordem_do_dia' },
  { label: 'Timeline', path: '/producao/schedule', icon: ChartGantt, permission: 'ordem_do_dia' },
  { label: 'Cronograma', path: '/producao/cronograma-edicao', icon: Clapperboard, permission: 'cronograma_edicao' },
];

export default function ProducaoViewsNav() {
  const { can } = useAuth();

  const visible = VIEWS.filter(v => can(v.permission));
  if (visible.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
      {visible.map(view => (
        <NavLink
          key={view.path}
          to={view.path}
          end={view.end}
          className={({ isActive }) => clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all border flex-shrink-0',
            isActive
              ? 'bg-lumos-yellow text-lumos-bg border-lumos-yellow shadow-sm'
              : 'text-lumos-text-secondary border-lumos-border hover:text-lumos-text-primary hover:border-lumos-text-secondary/40'
          )}
        >
          <view.icon className="w-3.5 h-3.5" />
          {view.label}
        </NavLink>
      ))}
    </div>
  );
}
