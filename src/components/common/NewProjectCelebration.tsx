import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PartyPopper, ArrowRight, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Confetti from '@/components/common/Confetti';

type Celebration = { id: string; budgetId: string | null; projectName: string; code: string };

// Janela de "atraso": uma aprovação que aconteceu enquanto a pessoa estava offline
// ainda é comemorada quando ela entra, desde que tenha sido nos últimos 7 dias
// (cobre fim de semana/feriado sem ressuscitar aprovação antiga).
const CATCH_UP_DAYS = 7;

// Quais comemorações já foram exibidas neste navegador (evita repetir a cada
// recarregamento). Ficam aqui e não no banco para não mexer no read_at do sininho.
const SEEN_KEY = 'lumos_celebracoes_vistas';
const getSeen = (): string[] => {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; }
};
const markSeen = (id: string) => {
  try {
    const seen = getSeen();
    if (seen.includes(id)) return;
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id].slice(-50)));
  } catch { /* localStorage indisponível: no pior caso, comemora de novo */ }
};

const toCelebration = (row: any): Celebration => {
  const d = row?.data || {};
  return {
    id: row.id,
    budgetId: d.budget_id ?? null,
    projectName: d.project_name || 'Novo projeto',
    code: d.code || '',
  };
};

/**
 * Popup de comemoração de projeto novo, para admin e produção.
 *
 * Dois caminhos, os dois via a notificação `orcamento_aprovado` que o trigger do
 * banco cria assim que budgets.status vira 'aprovado':
 *  - ONLINE: chega na hora pelo Realtime (INSERT em notifications).
 *  - OFFLINE: ao entrar, buscamos as aprovações recentes ainda não comemoradas.
 *
 * Se mais de um projeto fechou enquanto a pessoa estava fora, elas entram numa
 * fila e são mostradas uma de cada vez.
 */
export default function NewProjectCelebration() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<Celebration[]>([]);
  const [going, setGoing] = useState(false);

  const userId = profile?.id;
  const canCelebrate = profile?.role === 'admin' || profile?.role === 'producao';

  // Enfileira sem duplicar (o realtime pode chegar junto com o catch-up do login).
  const enqueue = (c: Celebration) => {
    if (getSeen().includes(c.id)) return;
    setQueue(prev => (prev.some(x => x.id === c.id) ? prev : [...prev, c]));
  };

  // 1) Catch-up no login: aprovações recentes que a pessoa ainda não viu.
  useEffect(() => {
    if (!userId || !canCelebrate) return;
    let alive = true;
    (async () => {
      const since = new Date(Date.now() - CATCH_UP_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('notifications')
        .select('id, data, created_at')
        .eq('user_id', userId)
        .eq('event_type', 'orcamento_aprovado')
        .gte('created_at', since)
        .order('created_at', { ascending: true });
      if (!alive || !data) return;
      const seen = getSeen();
      const pending = data.filter(r => !seen.includes(r.id)).map(toCelebration);
      if (pending.length) setQueue(prev => [...prev, ...pending.filter(p => !prev.some(x => x.id === p.id))]);
    })();
    return () => { alive = false; };
  }, [userId, canCelebrate]);

  // 2) Realtime: aprovação acontecendo agora, com a pessoa online.
  useEffect(() => {
    if (!userId || !canCelebrate) return;
    const channel = supabase
      .channel(`celebration:${userId}-${Math.random().toString(36).slice(2, 11)}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, ({ new: row }: any) => {
        if (row?.event_type !== 'orcamento_aprovado') return;
        enqueue(toCelebration(row));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, canCelebrate]);

  const current = queue[0];
  if (!current) return null;

  // Fecha a atual e passa para a próxima da fila (se houver).
  const close = () => {
    markSeen(current.id);
    setQueue(prev => prev.slice(1));
    setGoing(false);
  };

  // O projeto é criado logo após a aprovação; resolvemos pelo budget_id no clique
  // (evita corrida com a criação) e caímos na lista se ainda não existir.
  const goToProject = async () => {
    setGoing(true);
    let path = '/producao/projetos';
    if (current.budgetId) {
      const { data } = await supabase.from('projects').select('id').eq('budget_id', current.budgetId).maybeSingle();
      if (data?.id) path = `/producao/projetos?projectId=${data.id}`;
    }
    close();
    navigate(path);
  };

  return (
    <>
      {/* O canvas do Confetti é z-[300], abaixo do overlay (z-400). Este wrapper cria
          um stacking context acima do modal para o confete cair na frente de tudo. */}
      <div className="fixed inset-0 z-[500] pointer-events-none">
        <Confetti duration={6000} />
      </div>

      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
        <div className="relative w-full max-w-md bg-lumos-surface border border-lumos-yellow/40 rounded-lumos shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
          <div className="absolute top-0 left-0 w-full h-1 bg-lumos-yellow" />

          <button
            onClick={close}
            title="Fechar"
            className="absolute top-3 right-3 p-1.5 rounded-full text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-primary/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="px-8 pt-10 pb-8 text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-lumos-yellow/15 flex items-center justify-center">
              <PartyPopper className="w-8 h-8 text-lumos-yellow" />
            </div>

            <p className="text-[11px] font-black uppercase tracking-widest text-lumos-yellow mb-2">
              Fechamos um projeto novo
            </p>
            <h2 className="text-2xl font-black text-lumos-text-primary tracking-tight leading-tight">
              {current.projectName}
            </h2>
            {current.code && (
              <span className="inline-block mt-3 text-[11px] font-black text-amber-600 dark:text-lumos-yellow bg-amber-500/10 dark:bg-lumos-yellow/10 px-2.5 py-1 rounded uppercase tracking-tight">
                {current.code}
              </span>
            )}

            <p className="mt-5 text-sm text-lumos-text-secondary leading-relaxed">
              O cliente aprovou o orçamento, o projeto já está na produção. Bora fazer acontecer!
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <button
                onClick={goToProject}
                disabled={going}
                className="btn-primary flex-1 h-11 flex items-center justify-center gap-2 text-sm font-black uppercase tracking-widest disabled:opacity-60"
              >
                Ver projeto <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={close}
                className="flex-1 h-11 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-text-secondary/40 text-sm font-bold transition-colors"
              >
                Fechar
              </button>
            </div>

            {queue.length > 1 && (
              <p className="mt-4 text-[11px] font-bold text-lumos-text-secondary/70">
                Mais {queue.length - 1} {queue.length - 1 === 1 ? 'projeto fechado' : 'projetos fechados'} enquanto você esteve fora
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
