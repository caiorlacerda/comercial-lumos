import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { BottomSheet } from '@/components/ui/BottomSheet';
import NotificationPanel from '@/components/notifications/NotificationPanel';

export default function NotificationBell() {
  const { items, unreadCount, markAsRead, markAllAsRead, removeOne } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
  const navigate = useNavigate();
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isOpen || isMobile) return;
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [isOpen, isMobile]);

  const handleItemClick = async (item: Notification) => {
    if (!item.read_at) await markAsRead(item.id);
    setIsOpen(false);
    if (item.link) navigate(item.link);
  };

  const panel = (
    <NotificationPanel
      items={items}
      unreadCount={unreadCount}
      onMarkAllRead={markAllAsRead}
      onMarkRead={markAsRead}
      onRemove={removeOne}
      onItemClick={handleItemClick}
      onOpenSettings={() => { setIsOpen(false); navigate('/configuracoes/notificacoes'); }}
      onViewAll={() => { setIsOpen(false); navigate('/notificacoes'); }}
      variant="popover"
    />
  );

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(o => !o)}
        className="relative p-2 text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5 rounded-full transition-all flex items-center justify-center cursor-pointer"
        aria-label="Notificações"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-lumos-surface">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover (desktop) */}
      {isOpen && !isMobile && (
        <div className="absolute right-0 top-full mt-2 w-[400px] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-50 p-3 animate-in fade-in slide-in-from-top-2 duration-150">
          {panel}
        </div>
      )}

      {/* Bottom sheet (mobile) */}
      <BottomSheet open={isOpen && isMobile} onOpenChange={setIsOpen} title="">
        <div className="font-work-sans h-[70vh] flex flex-col">{panel}</div>
      </BottomSheet>
    </div>
  );
}
