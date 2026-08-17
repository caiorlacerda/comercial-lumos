import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import { notify, getAdminUserIds } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';

/**
 * Modal de encerrar (ou reabrir) um projeto no financeiro, com o levantamento
 * do que ainda falta receber. Usado na lista de Custos por Projeto e dentro do
 * detalhe financeiro do projeto. Encerrar NÃO muda a aba de quem encerrou, o
 * projeto só passa a morar na aba Encerrados.
 */

export interface ProjetoEncerravel {
  id: string;                     // projetos_financeiro.id
  name: string;
  project_id: string;
  budget_id?: string | null;
  encerrado_em?: string | null;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtDia = (d?: string | null) => {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y.slice(2)}`;
};

export default function EncerrarProjetoModal({ proj, onClose, onDone }: {
  proj: ProjetoEncerravel;
  onClose: () => void;
  onDone: (reabriu: boolean) => void;
}) {
  const { profile } = useAuth();
  const toast = useToast();
  const reabrindo = !!proj.encerrado_em;
  const [carregando, setCarregando] = useState(!reabrindo);
  const [busy, setBusy] = useState(false);
  const [aReceber, setAReceber] = useState(0);
  const [parcelas, setParcelas] = useState<any[]>([]);

  // Levantamento do que falta entrar, direto das parcelas da proposta.
  useEffect(() => {
    if (reabrindo) return;
    (async () => {
      if (proj.budget_id) {
        const { data } = await supabase
          .from('receivables')
          .select('description, total_amount, received_amount, due_date, status')
          .eq('budget_id', proj.budget_id)
          .not('status', 'in', '("recebido","cancelado")');
        const lista = data || [];
        setParcelas(lista);
        setAReceber(lista.reduce((s, r) => s + (Number(r.total_amount || 0) - Number(r.received_amount || 0)), 0));
      }
      setCarregando(false);
    })();
  }, [proj.budget_id, reabrindo]);

  const confirmar = async () => {
    setBusy(true);
    const { error } = await supabase
      .from('projetos_financeiro')
      .update(reabrindo
        ? { encerrado_em: null, encerrado_por: null }
        : { encerrado_em: new Date().toISOString(), encerrado_por: profile?.id || null })
      .eq('id', proj.id);
    setBusy(false);
    if (error) { toast.error('Não foi possível salvar.'); return; }

    if (!reabrindo) {
      // Avisa os ADMs do que ficou pendente, senão o projeto some da lista e
      // o dinheiro que falta some junto.
      const admins = await getAdminUserIds();
      await notify({
        userIds: admins,
        event: NOTIFICATION_EVENTS.PROJETO_FINANCEIRO_ENCERRADO,
        title: aReceber > 0 ? 'Projeto encerrado com valor a receber' : 'Projeto encerrado, tudo recebido ✓',
        body: aReceber > 0
          ? `${proj.name}: ainda faltam ${fmtBRL(aReceber)} do cliente.`
          : `${proj.name}: não sobrou nada a receber.`,
        link: `/financeiro/custos-projeto/${proj.project_id}`,
        data: { project_id: proj.project_id, a_receber: aReceber },
      });
    }

    toast.success(reabrindo ? 'Projeto reaberto.' : 'Projeto encerrado, foi pra aba Encerrados ✓');
    onDone(reabrindo);
  };

  return (
    <Modal isOpen onClose={onClose} title={reabrindo ? 'Reabrir projeto' : 'Encerrar projeto'} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-lumos-text-primary font-bold">{proj.name}</p>

        {reabrindo ? (
          <p className="text-xs text-lumos-text-secondary">
            O projeto volta pra lista de em andamento. Nada do histórico é perdido nesse caminho.
          </p>
        ) : carregando ? (
          <p className="text-xs text-lumos-text-secondary">Conferindo o que falta receber…</p>
        ) : (
          <>
            <div className={clsx('rounded-lumos border p-4',
              aReceber > 0 ? 'border-red-500/30 bg-red-500/5' : 'border-green-500/30 bg-green-500/5')}>
              <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Ainda falta receber</p>
              <p className={clsx('text-2xl font-black mt-1 tabular-nums', aReceber > 0 ? 'text-red-500' : 'text-green-500')}>
                {aReceber > 0 ? fmtBRL(aReceber) : 'Nada, tudo recebido ✓'}
              </p>
              {parcelas.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-lumos-border pt-3">
                  {parcelas.map((r: any, i: number) => (
                    <li key={i} className="flex justify-between gap-3 text-[11px]">
                      <span className="text-lumos-text-secondary truncate">{r.description}</span>
                      <span className="font-bold tabular-nums flex-shrink-0">
                        {fmtBRL(Number(r.total_amount || 0) - Number(r.received_amount || 0))}
                        <span className="text-lumos-text-secondary font-normal"> · {fmtDia(r.due_date)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs text-lumos-text-secondary">
              O projeto vai pra aba Encerrados, mas você continua onde está. Os custos e o histórico ficam guardados,
              e os administradores recebem um aviso com o que ficou pendente.
              {!proj.budget_id && ' Este projeto não tem proposta ligada, então não deu pra conferir as parcelas.'}
            </p>
          </>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button type="button" onClick={confirmar} disabled={busy || carregando}
            className="btn-primary flex-1 h-10 disabled:opacity-60">
            {busy ? 'Salvando…' : reabrindo ? 'Reabrir' : 'Encerrar projeto'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
