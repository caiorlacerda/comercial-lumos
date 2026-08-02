import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/hooks/useNotifications';
import NotificationPanel from '@/components/notifications/NotificationPanel';

// Página "Ver todas" — histórico completo com as mesmas abas e agrupamento do
// popover do sino, num layout de página.
export default function Notificacoes() {
  const { items, unreadCount, markAsRead, markAllAsRead, removeOne } = useNotifications();
  const navigate = useNavigate();

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card p-4 lg:p-6 min-h-[75vh] flex flex-col">
        <NotificationPanel
          items={items}
          unreadCount={unreadCount}
          onMarkAllRead={markAllAsRead}
          onMarkRead={markAsRead}
          onRemove={removeOne}
          onItemClick={async (item) => {
            if (!item.read_at) await markAsRead(item.id);
            if (item.link) navigate(item.link);
          }}
          onOpenSettings={() => navigate('/configuracoes/notificacoes')}
          variant="page"
        />
      </div>
    </div>
  );
}
