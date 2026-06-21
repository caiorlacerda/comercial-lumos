import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
  Bell, 
  X, 
  DollarSign, 
  Film, 
  Briefcase, 
  Settings, 
  Trash2, 
  CheckCheck, 
  BellOff 
} from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { clsx } from 'clsx';

export default function NotificationBell() {
  const { 
    items, 
    loading, 
    unreadCount, 
    markAsRead, 
    markAllAsRead, 
    removeOne 
  } = useNotifications();
  
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close desktop popover on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleItemClick = async (item: Notification) => {
    if (!item.read_at) {
      await markAsRead(item.id);
    }
    setIsOpen(false);
    if (item.link) {
      navigate(item.link);
    }
  };

  const handleItemDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    await removeOne(id);
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'financeiro':
        return <DollarSign className="w-4 h-4 text-green-500" />;
      case 'producao':
        return <Film className="w-4 h-4 text-yellow-500" />;
      case 'comercial':
        return <Briefcase className="w-4 h-4 text-blue-500" />;
      case 'sistema':
      default:
        return <Settings className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

    if (diffSecs < 60) return 'agora';
    if (diffMins < 60) return rtf.format(-diffMins, 'minute');
    if (diffHours < 24) return rtf.format(-diffHours, 'hour');
    if (diffDays < 30) return rtf.format(-diffDays, 'day');
    
    return date.toLocaleDateString('pt-BR');
  };

  const notificationListContent = (
    <div className="max-h-[360px] overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
      {items.length === 0 ? (
        <div className="text-center py-8 text-lumos-text-secondary/70 flex flex-col items-center justify-center gap-2">
          <BellOff className="w-8 h-8 opacity-40" />
          <p className="text-xs italic">Sem notificações recentes.</p>
        </div>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            onClick={() => handleItemClick(item)}
            className={clsx(
              "group relative block p-3 rounded-lumos border border-lumos-border/40 transition-all cursor-pointer hover:bg-lumos-text-secondary/5",
              !item.read_at ? "bg-lumos-yellow/5 border-lumos-yellow/20" : "bg-lumos-surface"
            )}
          >
            <div className="flex gap-2.5 items-start">
              {/* Category Icon and Status Dot */}
              <div className="flex flex-col items-center gap-1.5 mt-0.5">
                <div className="p-1.5 bg-lumos-bg rounded-lg border border-lumos-border/50">
                  {getCategoryIcon(item.category)}
                </div>
              </div>

              {/* Text Body */}
              <div className="flex-1 min-w-0 pr-6">
                <div className="flex items-center gap-1.5">
                  {!item.read_at && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                  )}
                  <p className="text-xs font-bold text-lumos-text-primary leading-snug truncate">
                    {item.title}
                  </p>
                </div>
                {item.body && (
                  <p className="text-[10px] text-lumos-text-secondary mt-0.5 line-clamp-2 leading-relaxed">
                    {item.body}
                  </p>
                )}
                <span className="block text-[8px] text-lumos-text-secondary mt-1 font-semibold uppercase tracking-wider">
                  {formatRelativeTime(item.created_at)}
                </span>
              </div>

              {/* Delete Button */}
              <button
                onClick={(e) => handleItemDelete(e, item.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 cursor-pointer"
                title="Excluir notificação"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="relative" ref={popoverRef}>
      {/* Trigger Bell Button */}
      <button
        onClick={handleToggle}
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

      {/* Desktop Popover Panel */}
      {isOpen && (
        <div className="hidden lg:block absolute right-0 top-full mt-2 w-[380px] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-50 p-4 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between border-b border-lumos-border pb-2.5 mb-3">
            <h4 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-lumos-yellow" /> Notificações
            </h4>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-[10px] font-bold text-lumos-yellow hover:underline flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Marcar lidas
              </button>
            )}
          </div>

          {notificationListContent}

          <div className="mt-3">
            <Link
              to="/configuracoes/notificacoes"
              onClick={() => setIsOpen(false)}
              className="block text-center text-[10px] font-black uppercase text-lumos-yellow hover:underline py-2.5 border-t border-lumos-border"
            >
              Configurar notificações
            </Link>
          </div>
        </div>
      )}

      {/* Mobile Bottom Sheet Panel */}
      <BottomSheet 
        open={isOpen && window.innerWidth < 1024} 
        onOpenChange={setIsOpen} 
        title="Notificações"
      >
        <div className="space-y-4 font-work-sans">
          {unreadCount > 0 && (
            <div className="flex justify-end border-b border-lumos-border/50 pb-2">
              <button
                onClick={markAllAsRead}
                className="text-[11px] font-black text-lumos-yellow hover:underline flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" /> Marcar tudo como lido
              </button>
            </div>
          )}
          
          {notificationListContent}

          <div className="pt-2">
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/configuracoes/notificacoes');
              }}
              className="w-full text-center text-xs font-black uppercase text-lumos-yellow hover:underline py-3 bg-lumos-yellow/10 rounded-lumos border border-lumos-yellow/20 cursor-pointer"
            >
              Configurar Notificações
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
