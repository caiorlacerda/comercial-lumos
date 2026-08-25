import { useEffect, useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';

/**
 * PARCELAMENTO — mora no Financeiro de propósito: o comercial fecha a venda,
 * e o combinado de pagamento costuma vir depois. Enquanto não vem, a proposta
 * aprovada fica com uma parcela única "a definir" (valor cheio, sem
 * vencimento), então o dinheiro nunca some do radar.
 *
 * Regra de ouro: parcela que JÁ teve recebimento não é tocada. O plano novo
 * distribui apenas o saldo em aberto.
 */

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const brData = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const somaDias = (base: string, dias: number) => {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};

interface Props {
  budgetId: string;
  nomeProjeto?: string;
  onClose: () => void;
  onDone?: () => void;
}

export default function ParcelamentoModal({ budgetId, nomeProjeto, onClose, onDone }: Props) {
  const toast = useToast();
  const [plano, setPlano] = useState<'a_vista' | 'entrada_saldo'>('a_vista');
  const [dias, setDias] = useState(30);
  const [entradaPct, setEntradaPct] = useState(50);
  const [base, setBase] = useState(() => new Date().toISOString().slice(0, 10));
  const [salvando, setSalvando] = useState(false);
  const [resumo, setResumo] = useState<{ total: number; recebido: number; saldo: number } | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('receivables')
        .select('total_amount, received_amount, status')
        .eq('budget_id', budgetId).neq('status', 'cancelado');
      const total = (data || []).reduce((s, r) => s + Number(r.total_amount || 0), 0);
      const recebido = (data || []).reduce((s, r) => s + Number(r.received_amount || 0), 0);
      setResumo({ total, recebido, saldo: Math.max(total - recebido, 0) });
    })();
  }, [budgetId]);

  const salvar = async () => {
    setSalvando(true);
    const { data, error } = await supabase.rpc('definir_parcelamento', {
      p_budget_id: budgetId,
      p_plan: plano,
      p_days: dias,
      p_entry_pct: entradaPct,
      p_base: base,
    });
    setSalvando(false);
    if (error) {
      if (/definir_parcelamento|function|schema/i.test(error.message)) {
        setIndisponivel(true);
        return;
      }
      toast.error(`Não deu pra definir: ${error.message}`);
      return;
    }
    const r = data as { ok?: boolean; error?: string; parcelas_criadas?: number } | null;
    if (!r?.ok) {
      toast.error(r?.error === 'nada_em_aberto'
        ? 'Não há saldo em aberto pra parcelar neste projeto.'
        : 'Não foi possível definir o parcelamento.');
      return;
    }
    toast.success(`Parcelamento definido ✓ ${r.parcelas_criadas} parcela${r.parcelas_criadas === 1 ? '' : 's'}.`);
    onDone?.();
    onClose();
  };

  const saldo = resumo?.saldo ?? 0;
  const entrada = plano === 'entrada_saldo' ? Math.round(saldo * entradaPct) / 100 : 0;

  return (
    <Modal isOpen onClose={onClose} title="Definir parcelamento" maxWidth="max-w-md">
      <div className="space-y-4">
        {nomeProjeto && <p className="text-sm font-bold text-lumos-text-primary">{nomeProjeto}</p>}

        {indisponivel ? (
          <div className="rounded-lumos border border-lumos-border p-4 text-center space-y-2">
            <CalendarClock className="w-7 h-7 text-lumos-text-secondary mx-auto" />
            <p className="text-sm font-bold text-lumos-text-primary">Parcelamento ainda não ativado</p>
            <p className="text-xs text-lumos-text-secondary">Falta rodar a migration da Fase 2 no Supabase.</p>
          </div>
        ) : (
          <>
            {resumo && (
              <div className="rounded-lumos border border-lumos-border p-3 text-[12.5px] space-y-1">
                <div className="flex justify-between"><span className="text-lumos-text-secondary">Valor do projeto</span><span className="font-bold">{brl(resumo.total)}</span></div>
                {resumo.recebido > 0 && (
                  <div className="flex justify-between"><span className="text-lumos-text-secondary">Já recebido (fica intacto)</span><span className="font-bold text-green-500">{brl(resumo.recebido)}</span></div>
                )}
                <div className="flex justify-between border-t border-lumos-border pt-1">
                  <span className="text-lumos-text-secondary">A parcelar</span>
                  <span className="font-black text-lumos-text-primary">{brl(saldo)}</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'a_vista' as const, titulo: 'Valor cheio', desc: 'Uma parcela só' },
                { id: 'entrada_saldo' as const, titulo: 'Entrada + saldo', desc: 'Metade agora, resto depois' },
              ]).map(op => (
                <button key={op.id} onClick={() => setPlano(op.id)}
                  className={clsx('rounded-lumos border p-3 text-left transition-colors',
                    plano === op.id
                      ? 'border-lumos-yellow bg-lumos-yellow/10'
                      : 'border-lumos-border hover:border-lumos-text-secondary/40')}>
                  <p className="text-[13px] font-bold text-lumos-text-primary">{op.titulo}</p>
                  <p className="text-[11px] text-lumos-text-secondary">{op.desc}</p>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {plano === 'entrada_saldo' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Entrada (%)</label>
                  <input type="number" min={1} max={99} value={entradaPct}
                    onChange={e => setEntradaPct(Number(e.target.value) || 50)}
                    className="input-lumos w-full h-10 text-sm" />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">
                  {plano === 'entrada_saldo' ? 'Saldo em (dias)' : 'Prazo (dias)'}
                </label>
                <input type="number" min={0} value={dias}
                  onChange={e => setDias(Number(e.target.value) || 0)}
                  className="input-lumos w-full h-10 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">A partir de</label>
                <input type="date" value={base} onChange={e => setBase(e.target.value)}
                  className="input-lumos w-full h-10 text-sm" />
              </div>
            </div>

            {saldo > 0 && (
              <div className="rounded-lumos bg-lumos-text-secondary/5 border border-lumos-border p-3 space-y-1 text-[12.5px]">
                <p className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary">Vai ficar assim</p>
                {plano === 'entrada_saldo' ? (
                  <>
                    <div className="flex justify-between"><span>Entrada</span><span className="font-bold">{brl(entrada)} · {brData(base)}</span></div>
                    <div className="flex justify-between"><span>Saldo</span><span className="font-bold">{brl(saldo - entrada)} · {brData(somaDias(base, dias))}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between"><span>Parcela única</span><span className="font-bold">{brl(saldo)} · {brData(somaDias(base, dias))}</span></div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          {!indisponivel && (
            <button onClick={salvar} disabled={salvando || saldo <= 0}
              className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Definir parcelamento
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
