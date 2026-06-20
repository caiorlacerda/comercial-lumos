import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Bell, Calendar, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';

export default function NotificationBell() {
  const { isAdmin, isProducao } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const canSeeNotifications = isAdmin || isProducao;

  useEffect(() => {
    if (!canSeeNotifications) return;
    
    fetchNotifications();
  }, [isAdmin, isProducao]);

  async function fetchNotifications() {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString();

      const promises = [];

      // Query payables for Admins
      if (isAdmin) {
        promises.push(
          supabase
            .from('payables')
            .select('id, description, amount, due_date')
            .is('paid_at', null)
            .lte('due_date', todayStr)
            .then(res => (res.data || []).map(p => ({
              id: p.id,
              description: p.description,
              amount: p.amount,
              date: p.due_date,
              type: 'despesa',
              link: '/financeiro/contas-pagar'
            })))
        );

        promises.push(
          supabase
            .from('projetos_financeiro')
            .select('id, created_at, client:clients(name)')
            .eq('pendente_preenchimento', true)
            .then(res => (res.data || []).map(p => ({
              id: p.id,
              description: `Pendente preencher dimensões: ${(p.client as any)?.name || 'Cliente'}`,
              amount: null,
              date: p.created_at.split('T')[0],
              type: 'pendente',
              link: `/financeiro/custos-projeto/${p.id}`
            })))
        );
      }

      // Query project costs for Admins or Production users
      promises.push(
        supabase
          .from('project_costs')
          .select('id, description, amount, cost_date')
          .is('paid_at', null)
          .lte('cost_date', todayStr)
          .then(res => (res.data || []).map(c => ({
            id: c.id,
            description: c.description,
            amount: c.amount,
            date: c.cost_date,
            type: 'custo',
            link: '/financeiro/custos-projeto'
          })))
      );

      // Query recent ordens do dia for Production and Admins
      promises.push(
        supabase
          .from('ordens_do_dia')
          .select('id, codigo, titulo, data_producao, created_at')
          .gte('created_at', sevenDaysAgoStr)
          .then(res => (res.data || []).map(o => ({
            id: o.id,
            description: `Nova Ordem: ${o.codigo} - ${o.titulo}`,
            amount: null,
            date: o.data_producao || o.created_at.split('T')[0],
            type: 'ordem',
            link: `/ordem-do-dia/${o.id}`
          })))
      );

      const results = await Promise.all(promises);
      const list = results.flat().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setNotifications(list);
    } catch (err) {
      console.error('Error fetching due notifications:', err);
    }
  }

  if (!canSeeNotifications) return null;

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
          <div className="absolute right-0 top-full mt-2 w-80 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-50 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
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
                <p className="text-xs text-lumos-text-secondary italic text-center py-4">Sem notificações pendentes.</p>
              ) : (
                notifications.map((item) => (
                  <Link
                    key={item.id}
                    to={item.link}
                    onClick={() => setIsOpen(false)}
                    className="block p-2.5 rounded hover:bg-lumos-bg/50 border border-lumos-border/40 transition-colors"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <p className="text-xs font-bold text-lumos-text-primary line-clamp-2 leading-snug">{item.description}</p>
                      {item.amount !== null && item.amount !== undefined ? (
                        <span className="text-[10px] font-black text-red-500 whitespace-nowrap">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.amount)}
                        </span>
                      ) : (
                        <span className="text-[9px] font-black text-green-500 whitespace-nowrap uppercase tracking-wider">
                          Nova
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[9px] text-lumos-text-secondary font-semibold uppercase tracking-wider">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-lumos-yellow" />
                        {item.type === 'ordem' ? 'Gravando em ' : item.type === 'pendente' ? 'Criado em ' : 'Venceu em '}
                        {new Date(item.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </span>
                      <span className={clsx(
                        "text-[9px] font-bold uppercase tracking-wider",
                        item.type === 'despesa' && 'text-lumos-yellow',
                        item.type === 'custo' && 'text-blue-400',
                        item.type === 'ordem' && 'text-green-400',
                        item.type === 'pendente' && 'text-purple-400'
                      )}>
                        {item.type === 'pendente' ? 'pendência' : item.type}
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
