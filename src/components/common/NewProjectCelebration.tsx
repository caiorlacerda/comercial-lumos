import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PartyPopper, ArrowRight, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Confetti from '@/components/common/Confetti';

export type CelebrationPayload = { budgetId: string | null; projectName: string; code: string };

// Evento interno usado pelo botão de TESTE (Monitoramento) para abrir o popup
// sem precisar aprovar um orçamento de verdade.
export const CELEBRATE_TEST_EVENT = 'lumos:celebrate-test';

/**
 * Popup de comemoração: aparece NA HORA para admin e produção quando um orçamento
 * é aprovado. Escuta o INSERT em `notifications` (o trigger do banco cria a linha
 * assim que budgets.status vira 'aprovado'), então chega em tempo real.
 */
export default function NewProjectCelebration() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [payload, setPayload] = useState<CelebrationPayload | null>(null);
  const [going, setGoing] = useState(false);

  const userId = profile?.id;
  const canCelebrate = profile?.role === 'admin' || profile?.role === 'producao';

  // Realtime: nova notificação de orçamento aprovado para MIM.
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
        const d = row.data || {};
        setPayload({
          budgetId: d.budget_id ?? null,
          projectName: d.project_name || 'Novo projeto',
          code: d.code || '',
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, canCelebrate]);

  // Gatilho de teste (botão em Monitoramento).
  useEffect(() => {
    const onTest = (e: Event) => setPayload((e as CustomEvent).detail as CelebrationPayload);
    window.addEventListener(CELEBRATE_TEST_EVENT, onTest);
    return () => window.removeEventListener(CELEBRATE_TEST_EVENT, onTest);
  }, []);

  if (!payload) return null;

  const close = () => { setPayload(null); setGoing(false); };

  // O projeto é criado logo após a aprovação; resolvemos pelo budget_id no clique
  // (evita corrida com a criação) e caímos na lista se ainda não existir.
  const goToProject = async () => {
    setGoing(true);
    let path = '/producao/projetos';
    if (payload.budgetId) {
      const { data } = await supabase.from('projects').select('id').eq('budget_id', payload.budgetId).maybeSingle();
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
              {payload.projectName}
            </h2>
            {payload.code && (
              <span className="inline-block mt-3 text-[11px] font-black text-amber-600 dark:text-lumos-yellow bg-amber-500/10 dark:bg-lumos-yellow/10 px-2.5 py-1 rounded uppercase tracking-tight">
                {payload.code}
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
          </div>
        </div>
      </div>
    </>
  );
}
