import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { BottomSheet } from '@/components/ui/BottomSheet';
import NotificationPanel from '@/components/notifications/NotificationPanel';

export default function NotificationBell() {
  const { items, unreadCount, markAsRead, markAllAsRead, removeOne, clearAll } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Posiciona o popover: à DIREITA do sino (que fica no rail, à esquerda), com o
  // rodapé alinhado ao sino, abrindo pra cima. Clamped pra nunca sair da tela.
  useLayoutEffect(() => {
    if (!isOpen || isMobile) return;
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 400;
    const left = Math.min(r.right + 8, window.innerWidth - width - 8);
    const bottom = Math.max(8, window.innerHeight - r.bottom);
    setPos({ left, bottom });
  }, [isOpen, isMobile]);

  useEffect(() => {
    if (!isOpen || isMobile) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
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
      onClearAll={clearAll}
      onItemClick={handleItemClick}
      onOpenSettings={() => { setIsOpen(false); navigate('/configuracoes/notificacoes'); }}
      onViewAll={() => { setIsOpen(false); navigate('/notificacoes'); }}
      variant="popover"
    />
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
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

      {/* Popover (desktop) — em portal, posição fixa, nunca cortado */}
      {isOpen && !isMobile && pos && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: 400, maxHeight: 'calc(100vh - 24px)' }}
          className="bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-[200] p-3 flex flex-col animate-in fade-in slide-in-from-left-2 duration-150"
        >
          {panel}
        </div>,
        document.body,
      )}

      {/* Bottom sheet (mobile) */}
      <BottomSheet open={isOpen && isMobile} onOpenChange={setIsOpen} title="">
        <div className="font-work-sans h-[70vh] flex flex-col">{panel}</div>
      </BottomSheet>
    </div>
  );
}
