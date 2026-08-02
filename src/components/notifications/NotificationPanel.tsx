import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  Bell, BellOff, CheckCheck, Settings, X, DollarSign, Clapperboard, Briefcase, Cog, Users2, Trash2,
} from 'lucide-react';
import UserAvatar from '@/components/common/UserAvatar';
import type { Notification } from '@/hooks/useNotifications';

type Cat = Notification['category'];
const CAT: Record<Cat, { label: string; icon: any; color: string }> = {
  financeiro: { label: 'Financeiro', icon: DollarSign, color: 'text-green-500' },
  producao: { label: 'Produção', icon: Clapperboard, color: 'text-lumos-yellow' },
  comercial: { label: 'Comercial', icon: Briefcase, color: 'text-blue-400' },
  sistema: { label: 'Sistema', icon: Cog, color: 'text-lumos-text-secondary' },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (s < 60) return 'agora';
  if (m < 60) return rtf.format(-m, 'minute');
  if (h < 24) return rtf.format(-h, 'hour');
  if (d < 30) return rtf.format(-d, 'day');
  return new Date(iso).toLocaleDateString('pt-BR');
}
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function dayBucket(iso: string): string {
  const d = new Date(iso); const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  if (days <= 7) return 'Esta semana';
  return 'Mais antigas';
}

type TabKey = 'all' | 'unread' | 'team';

interface Props {
  items: Notification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onItemClick: (item: Notification) => void;
  onOpenSettings: () => void;
  onViewAll?: () => void;         // só no popover
  variant?: 'popover' | 'page';
}

export default function NotificationPanel({
  items, unreadCount, onMarkAllRead, onMarkRead, onRemove, onClearAll, onItemClick, onOpenSettings, onViewAll, variant = 'popover',
}: Props) {
  const [tab, setTab] = useState<TabKey>('all');
  const teamCount = items.filter(n => n.scope === 'team').length;

  const filtered = useMemo(() => {
    if (tab === 'unread') return items.filter(n => !n.read_at);
    if (tab === 'team') return items.filter(n => n.scope === 'team');
    return items;
  }, [items, tab]);

  // Agrupamento por dia (mantém a ordem já vinda do fetch: mais recente primeiro).
  const groups = useMemo(() => {
    const order = ['Hoje', 'Ontem', 'Esta semana', 'Mais antigas'];
    const map = new Map<string, Notification[]>();
    for (const n of filtered) {
      const k = dayBucket(n.created_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(n);
    }
    return order.filter(k => map.has(k)).map(k => ({ label: k, items: map.get(k)! }));
  }, [filtered]);

  const TabBtn = ({ id, label, count }: { id: TabKey; label: string; count: number }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={clsx('relative flex items-center gap-1.5 py-2.5 mr-4 text-[13px] font-bold transition-colors',
        tab === id ? 'text-lumos-text-primary' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}
    >
      {label}
      <span className={clsx('text-[10px] font-black rounded-full px-1.5 min-w-[18px] text-center',
        tab === id ? 'bg-lumos-yellow text-black' : 'bg-lumos-text-secondary/15 text-lumos-text-secondary')}>{count}</span>
      {tab === id && <span className="absolute left-0 right-3 -bottom-px h-0.5 rounded-full bg-lumos-yellow" />}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Cabeçalho */}
      <div className="flex-shrink-0 px-1">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-lumos-text-primary tracking-tight flex items-center gap-2">
            <Bell className="w-4 h-4 text-lumos-yellow" /> Notificações
          </h3>
          <div className="flex items-center gap-0.5">
            {unreadCount > 0 && (
              <button onClick={onMarkAllRead} title="Marcar todas como lidas"
                className="w-8 h-8 rounded-lumos flex items-center justify-center text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/10 transition-colors">
                <CheckCheck className="w-[18px] h-[18px]" />
              </button>
            )}
            {items.length > 0 && (
              <button
                onClick={() => { if (window.confirm('Limpar todas as notificações? Isso remove todas da sua lista.')) onClearAll(); }}
                title="Limpar todas"
                className="w-8 h-8 rounded-lumos flex items-center justify-center text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors">
                <Trash2 className="w-[18px] h-[18px]" />
              </button>
            )}
            <button onClick={onOpenSettings} title="Configurar notificações"
              className="w-8 h-8 rounded-lumos flex items-center justify-center text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 transition-colors">
              <Settings className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
        {/* Abas */}
        <div className="flex items-center border-b border-lumos-border mt-2">
          <TabBtn id="all" label="Tudo" count={items.length} />
          <TabBtn id="unread" label="Não lidas" count={unreadCount} />
          <TabBtn id="team" label="Do time" count={teamCount} />
        </div>
      </div>

      {/* Lista */}
      <div className={clsx('flex-1 overflow-y-auto custom-scrollbar -mx-1 px-1', variant === 'popover' && 'max-h-[420px]')}>
        {filtered.length === 0 ? (
          <div className="text-center py-14 text-lumos-text-secondary/70 flex flex-col items-center gap-2">
            <BellOff className="w-8 h-8 opacity-40" />
            <p className="text-xs">{tab === 'team' ? 'Nada do time por aqui ainda.' : tab === 'unread' ? 'Tudo lido por aqui 🎉' : 'Sem notificações.'}</p>
          </div>
        ) : (
          groups.map(g => (
            <div key={g.label}>
              <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary/60 px-2 pt-3 pb-1">{g.label}</p>
              {g.items.map(n => (
                <NotificationItem key={n.id} n={n} onClick={() => onItemClick(n)} onMarkRead={() => onMarkRead(n.id)} onRemove={() => onRemove(n.id)} />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Rodapé */}
      {variant === 'popover' && onViewAll && (
        <div className="flex-shrink-0 pt-2 mt-1 border-t border-lumos-border">
          <button onClick={onViewAll} className="w-full text-center text-[11px] font-black uppercase tracking-wider text-lumos-yellow hover:underline py-2">
            Ver todas as notificações
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Item ------------------------------------- */

function NotificationItem({ n, onClick, onMarkRead, onRemove }: {
  n: Notification; onClick: () => void; onMarkRead: () => void; onRemove: () => void;
}) {
  const cat = CAT[n.category] || CAT.sistema;
  const CatIcon = cat.icon;
  const unread = !n.read_at;

  return (
    <div
      onClick={onClick}
      className={clsx('group relative flex gap-3 px-2 py-3 rounded-lumos cursor-pointer transition-colors',
        unread ? 'bg-lumos-yellow/[0.06] hover:bg-lumos-yellow/[0.09]' : 'hover:bg-lumos-text-secondary/[0.04]')}
    >
      {/* Ator (avatar) ou ícone da categoria */}
      <div className="relative flex-shrink-0">
        {n.actor ? (
          <UserAvatar user={n.actor} size={40} />
        ) : n.scope === 'team' ? (
          <div className="w-10 h-10 rounded-full bg-lumos-yellow/15 flex items-center justify-center"><Users2 className="w-5 h-5 text-lumos-yellow" /></div>
        ) : (
          <div className="w-10 h-10 rounded-full bg-lumos-bg border border-lumos-border flex items-center justify-center"><CatIcon className={clsx('w-5 h-5', cat.color)} /></div>
        )}
        {/* Selo da categoria no canto do avatar */}
        {n.actor && (
          <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-lumos-surface border-2 border-lumos-surface flex items-center justify-center ring-1 ring-lumos-border">
            <CatIcon className={clsx('w-3 h-3', cat.color)} />
          </span>
        )}
      </div>

      {/* Corpo */}
      <div className="flex-1 min-w-0 pr-5">
        <p className={clsx('text-[13.5px] leading-snug text-lumos-text-primary', unread && 'font-bold')}>{n.title}</p>
        {n.body && <p className="text-xs text-lumos-text-secondary mt-0.5 line-clamp-2 leading-relaxed">{n.body}</p>}
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-lumos-text-secondary/70">
          <span className="inline-flex items-center gap-1 font-semibold"><CatIcon className={clsx('w-3 h-3', cat.color)} />{cat.label}</span>
          <span className="w-1 h-1 rounded-full bg-lumos-text-secondary/40" />
          <span>{clockTime(n.created_at)}</span>
          <span className="w-1 h-1 rounded-full bg-lumos-text-secondary/40" />
          <span>{relativeTime(n.created_at)}</span>
        </div>
      </div>

      {/* Estado / ações */}
      {unread && <span className="absolute right-2.5 top-3.5 w-2 h-2 rounded-full bg-lumos-yellow group-hover:opacity-0 transition-opacity" />}
      <div className="absolute right-1.5 top-2.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {unread && (
          <button onClick={(e) => { e.stopPropagation(); onMarkRead(); }} title="Marcar como lida"
            className="w-7 h-7 rounded-full flex items-center justify-center text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/10">
            <CheckCheck className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Excluir"
          className="w-7 h-7 rounded-full flex items-center justify-center text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
