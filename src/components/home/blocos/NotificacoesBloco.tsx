import { useNavigate } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { useNotifications } from '@/hooks/useNotifications';

/** Últimas notificações (5). */
export default function NotificacoesBloco() {
  const navigate = useNavigate();
  const { items: notifications, markAsRead, markAllAsRead } = useNotifications();

  const handleNotificationClick = async (item: any) => {
    if (!item.read_at) {
      await markAsRead(item.id);
    }
    if (item.link) {
      navigate(item.link);
    }
  };

  return (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-3.5 space-y-3.5 shadow-sm">
      <div className="flex items-center justify-between border-b border-lumos-border/50 pb-2.5">
        <h2 className="text-[11px] uppercase tracking-[3px] text-lumos-text-primary flex items-center gap-3">
          <span className="block h-2 w-2 bg-lumos-yellow" /> Notificações
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
  );
}
