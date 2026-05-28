import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Bell, Calendar, X } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function NotificationBell() {
  const { isAdmin } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    
    fetchDuePayables();
  }, [isAdmin]);

  async function fetchDuePayables() {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      
      const [payablesRes, costsRes] = await Promise.all([
        supabase
          .from('payables')
          .select('id, description, amount, due_date')
          .is('paid_at', null)
          .lte('due_date', todayStr),
        supabase
          .from('project_costs')
          .select('id, description, amount, cost_date')
          .is('paid_at', null)
          .lte('cost_date', todayStr)
      ]);

      const list = [
        ...(payablesRes.data || []).map(p => ({ ...p, type: 'despesa', date: p.due_date })),
        ...(costsRes.data || []).map(c => ({ ...c, type: 'custo', date: c.cost_date }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setNotifications(list);
    } catch (err) {
      console.error('Error fetching due notifications:', err);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-text-secondary/5 rounded-full transition-all flex items-center justify-center"
        aria-label="Notificações"
      >
        <Bell className="w-5 h-5" />
        {notifications.length > 0 && (
          <span className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-lumos-surface">
            {notifications.length}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
          <div className="absolute right-0 bottom-full lg:bottom-auto lg:top-full mt-2 mb-2 lg:mb-0 w-80 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-50 p-4 animate-in fade-in slide-in-from-bottom-2 lg:slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between border-b border-lumos-border pb-2 mb-3">
              <h4 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-1.5">
                <Bell className="w-4 h-4 text-lumos-yellow" /> Notificações
              </h4>
              <button onClick={() => setIsOpen(false)} className="text-lumos-text-secondary hover:text-lumos-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2 pr-1">
              {notifications.length === 0 ? (
                <p className="text-xs text-lumos-text-secondary italic text-center py-4">Sem contas vencendo hoje ou atrasadas.</p>
              ) : (
                notifications.map((item) => (
                  <Link
                    key={item.id}
                    to="/financeiro/contas-pagar"
                    onClick={() => setIsOpen(false)}
                    className="block p-2.5 rounded hover:bg-lumos-bg/50 border border-lumos-border/40 transition-colors"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <p className="text-xs font-bold text-lumos-text-primary line-clamp-2">{item.description}</p>
                      <span className="text-[10px] font-black text-red-500 whitespace-nowrap">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.amount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[9px] text-lumos-text-secondary font-semibold uppercase tracking-wider">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-lumos-yellow" />
                        Venceu em {new Date(item.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </span>
                      <span className={item.type === 'despesa' ? 'text-lumos-yellow' : 'text-blue-400'}>
                        {item.type}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
