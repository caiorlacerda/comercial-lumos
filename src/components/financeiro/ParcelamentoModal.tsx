import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import DatePicker from '@/components/ui/DatePicker';

/**
 * PARCELAMENTO — mora no Financeiro de propósito: o comercial fecha a venda,
 * e o combinado de pagamento costuma vir depois. Enquanto não vem, a proposta
 * aprovada fica com uma parcela única "a definir" (valor cheio, sem
 * vencimento), então o dinheiro nunca some do radar.
 *
 * Regra de ouro: parcela que JÁ teve recebimento não é tocada. O plano novo
 * distribui apenas o saldo em aberto.
 *
 * Fee mensal é o terceiro plano: em vez de 1 ou 2 parcelas, gera uma conta
 * por mês (do início ao fim) mais uma por adendo pontual. Se o projeto já
 * tem fee mensal configurado (veio da proposta, ou já foi definido aqui
 * antes), a janela mostra a divisão mês a mês em vez do formulário de
 * configurar do zero, com um jeito de adicionar um adendo novo ou estender
 * o contrato — nunca mexendo no que já existe.
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
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const mesLabel = (isoAnoMes: string) => {
  const [y, m] = isoAnoMes.split('-');
  return `${MESES[Number(m) - 1]}/${y}`;
};

interface Props {
  budgetId: string;
  nomeProjeto?: string;
  onClose: () => void;
  onDone?: () => void;
}

interface MesFeeMensal { due_date: string; fixo: number; adendo: number }

export default function ParcelamentoModal({ budgetId, nomeProjeto, onClose, onDone }: Props) {
  const toast = useToast();
  const [plano, setPlano] = useState<'a_vista' | 'entrada_saldo' | 'fee_mensal'>('a_vista');
  const [dias, setDias] = useState(30);
  const [entradaPct, setEntradaPct] = useState(50);
  const [base, setBase] = useState(() => new Date().toISOString().slice(0, 10));
  const [salvando, setSalvando] = useState(false);
  const [resumo, setResumo] = useState<{ total: number; recebido: number; saldo: number } | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);

  // Fee mensal — configurar do zero
  const [fmInicio, setFmInicio] = useState('');
  const [fmFim, setFmFim] = useState('');
  const [fmValor, setFmValor] = useState(0);
  const [fmAdendos, setFmAdendos] = useState<{ mes: string; valor: number }[]>([]);

  // Fee mensal — já configurado: a divisão real, vinda das contas a receber
  const [fmMeses, setFmMeses] = useState<MesFeeMensal[] | null>(null);
  const [fmNovoAdendoMes, setFmNovoAdendoMes] = useState('');
  const [fmNovoAdendoValor, setFmNovoAdendoValor] = useState(0);
  const [fmNovoMesExtra, setFmNovoMesExtra] = useState('');

  useEffect(() => {
    (async () => {
      const [{ data }, { data: feeRows }] = await Promise.all([
        supabase.from('receivables').select('total_amount, received_amount, status')
          .eq('budget_id', budgetId).neq('status', 'cancelado'),
        supabase.from('receivables').select('due_date, total_amount, description')
          .eq('budget_id', budgetId).eq('origem', 'fee_mensal').order('due_date'),
      ]);
      const total = (data || []).reduce((s, r) => s + Number(r.total_amount || 0), 0);
      const recebido = (data || []).reduce((s, r) => s + Number(r.received_amount || 0), 0);
      setResumo({ total, recebido, saldo: Math.max(total - recebido, 0) });

      if (feeRows && feeRows.length > 0) {
        const porMes = new Map<string, MesFeeMensal>();
        feeRows.forEach((r: any) => {
          const mes = String(r.due_date).slice(0, 7);
          const atual = porMes.get(mes) || { due_date: mes, fixo: 0, adendo: 0 };
          if (String(r.description).includes('Adendo')) atual.adendo += Number(r.total_amount || 0);
          else atual.fixo += Number(r.total_amount || 0);
          porMes.set(mes, atual);
        });
        setFmMeses([...porMes.values()].sort((a, b) => a.due_date.localeCompare(b.due_date)));
        setPlano('fee_mensal');
      }
    })();
  }, [budgetId]);

  const salvar = async () => {
    setSalvando(true);
    const rpc = plano === 'fee_mensal'
      ? supabase.rpc('definir_fee_mensal', {
          p_budget_id: budgetId, p_inicio: `${fmInicio}-01`, p_fim: `${fmFim}-01`,
          p_valor: fmValor, p_adendos: fmAdendos,
        })
      : supabase.rpc('definir_parcelamento', {
          p_budget_id: budgetId, p_plan: plano, p_days: dias, p_entry_pct: entradaPct, p_base: base,
        });
    const { data, error } = await rpc;
    setSalvando(false);
    if (error) {
      if (/definir_parcelamento|definir_fee_mensal|function|schema/i.test(error.message)) {
        setIndisponivel(true);
        return;
      }
      toast.error(`Não deu pra definir: ${error.message}`);
      return;
    }
    const r = data as { ok?: boolean; error?: string; parcelas_criadas?: number } | null;
    if (!r?.ok) {
      toast.error(
        r?.error === 'nada_em_aberto' ? 'Não há saldo em aberto pra parcelar neste projeto.'
        : r?.error === 'periodo_invalido' ? 'Confira as datas de início e fim.'
        : r?.error === 'valor_invalido' ? 'Informe um valor mensal maior que zero.'
        : 'Não foi possível definir o parcelamento.'
      );
      return;
    }
    toast.success(`Parcelamento definido ✓ ${r.parcelas_criadas} parcela${r.parcelas_criadas === 1 ? '' : 's'}.`);
    onDone?.();
    onClose();
  };

  const adicionarAdendoExistente = async () => {
    if (!fmNovoAdendoMes || fmNovoAdendoValor <= 0) return;
    setSalvando(true);
    const { error } = await supabase.rpc('adicionar_parcela_fee_mensal', {
      p_budget_id: budgetId, p_mes: `${fmNovoAdendoMes}-01`, p_valor: fmNovoAdendoValor, p_eh_adendo: true,
    });
    setSalvando(false);
    if (error) { toast.error(`Não deu pra adicionar: ${error.message}`); return; }
    toast.success('Adendo adicionado ✓');
    onDone?.();
    onClose();
  };

  const estenderContrato = async () => {
    if (!fmNovoMesExtra) return;
    const valorBase = fmMeses && fmMeses.length > 0 ? fmMeses[fmMeses.length - 1].fixo : 0;
    setSalvando(true);
    const { error } = await supabase.rpc('adicionar_parcela_fee_mensal', {
      p_budget_id: budgetId, p_mes: `${fmNovoMesExtra}-01`, p_valor: valorBase, p_eh_adendo: false,
    });
    setSalvando(false);
    if (error) { toast.error(`Não deu pra estender: ${error.message}`); return; }
    toast.success('Contrato estendido ✓');
    onDone?.();
    onClose();
  };

  const saldo = resumo?.saldo ?? 0;
  const entrada = plano === 'entrada_saldo' ? Math.round(saldo * entradaPct) / 100 : 0;
  const jaConfigurado = fmMeses !== null && fmMeses.length > 0;

  return (
    <Modal isOpen onClose={onClose} title="Definir parcelamento" maxWidth={jaConfigurado || plano === 'fee_mensal' ? 'max-w-lg' : 'max-w-md'}>
      <div className="space-y-4">
        {nomeProjeto && <p className="text-sm font-bold text-lumos-text-primary">{nomeProjeto}</p>}

        {indisponivel ? (
          <div className="rounded-lumos border border-lumos-border p-4 text-center space-y-2">
            <CalendarClock className="w-7 h-7 text-lumos-text-secondary mx-auto" />
            <p className="text-sm font-bold text-lumos-text-primary">Parcelamento ainda não ativado</p>
            <p className="text-xs text-lumos-text-secondary">Falta rodar a migration da Fase 2 no Supabase.</p>
          </div>
        ) : jaConfigurado ? (
          <>
            <div className="rounded-lumos border border-lumos-border overflow-hidden">
              <div className="grid grid-cols-3 bg-lumos-text-secondary/5 text-[10px] font-black uppercase text-lumos-text-secondary px-3 py-2">
                <span>Mês</span><span className="text-right">Fixo</span><span className="text-right">Adendo</span>
              </div>
              {fmMeses!.map(m => (
                <div key={m.due_date} className="grid grid-cols-3 px-3 py-2 text-[12.5px] border-t border-lumos-border">
                  <span className="text-lumos-text-primary font-bold">{mesLabel(m.due_date)}</span>
                  <span className="text-right text-lumos-text-primary">{brl(m.fixo)}</span>
                  <span className="text-right text-lumos-text-secondary">{m.adendo > 0 ? brl(m.adendo) : '—'}</span>
                </div>
              ))}
            </div>

            <div className="rounded-lumos bg-lumos-text-secondary/5 border border-lumos-border p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary">Adicionar adendo num mês existente</p>
              <div className="flex items-center gap-2">
                <select className="input-lumos h-9 text-xs flex-1" value={fmNovoAdendoMes} onChange={e => setFmNovoAdendoMes(e.target.value)}>
                  <option value="">Selecione o mês</option>
                  {fmMeses!.map(m => <option key={m.due_date} value={m.due_date}>{mesLabel(m.due_date)}</option>)}
                </select>
                <input type="number" min={0} placeholder="Valor" className="input-lumos h-9 w-28 text-xs"
                  value={fmNovoAdendoValor || ''} onChange={e => setFmNovoAdendoValor(Number(e.target.value) || 0)} />
                <button onClick={adicionarAdendoExistente} disabled={salvando} className="btn-primary h-9 px-3 text-xs">Adicionar</button>
              </div>
            </div>

            <div className="rounded-lumos bg-lumos-text-secondary/5 border border-lumos-border p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary">Estender o contrato com mais um mês</p>
              <div className="flex items-center gap-2">
                <DatePicker mode="month" className="input-lumos h-9 text-xs flex-1" value={fmNovoMesExtra}
                  onChange={v => setFmNovoMesExtra(v ? v.slice(0, 7) : '')} />
                <button onClick={estenderContrato} disabled={salvando} className="btn-primary h-9 px-3 text-xs">Estender</button>
              </div>
            </div>
          </>
        ) : (
          <>
            {resumo && (
              <div className="rounded-lumos border border-lumos-border p-3 text-[12.5px] space-y-1">
                <div className="flex justify-between"><span className="text-lumos-text-secondary">Valor do projeto</span><span className="font-bold text-lumos-text-primary">{brl(resumo.total)}</span></div>
                {resumo.recebido > 0 && (
                  <div className="flex justify-between"><span className="text-lumos-text-secondary">Já recebido (fica intacto)</span><span className="font-bold text-green-500">{brl(resumo.recebido)}</span></div>
                )}
                <div className="flex justify-between border-t border-lumos-border pt-1">
                  <span className="text-lumos-text-secondary">A parcelar</span>
                  <span className="font-black text-lumos-text-primary">{brl(saldo)}</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'a_vista' as const, titulo: 'Valor cheio', desc: 'Uma parcela só' },
                { id: 'entrada_saldo' as const, titulo: 'Entrada + saldo', desc: 'Metade agora, resto depois' },
                { id: 'fee_mensal' as const, titulo: 'Fee mensal', desc: 'Valor fixo por mês' },
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

            {plano === 'fee_mensal' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Início</label>
                    <DatePicker mode="month" value={fmInicio} onChange={v => setFmInicio(v ? v.slice(0, 7) : '')} className="input-lumos w-full h-10 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Fim</label>
                    <DatePicker mode="month" value={fmFim} onChange={v => setFmFim(v ? v.slice(0, 7) : '')} className="input-lumos w-full h-10 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Valor mensal</label>
                    <input type="number" min={0} value={fmValor || ''} onChange={e => setFmValor(Number(e.target.value) || 0)} className="input-lumos w-full h-10 text-sm" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Adendos pontuais (opcional)</label>
                  {fmAdendos.map((ad, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <DatePicker mode="month" value={ad.mes} onChange={v => {
                        const next = [...fmAdendos]; next[idx] = { ...next[idx], mes: v ? v.slice(0, 7) : '' }; setFmAdendos(next);
                      }} className="input-lumos h-9 text-xs flex-1" />
                      <input type="number" min={0} placeholder="Valor" value={ad.valor || ''} onChange={e => {
                        const next = [...fmAdendos]; next[idx] = { ...next[idx], valor: Number(e.target.value) || 0 }; setFmAdendos(next);
                      }} className="input-lumos h-9 w-28 text-xs" />
                      <button onClick={() => setFmAdendos(fmAdendos.filter((_, i) => i !== idx))} className="p-2 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => setFmAdendos([...fmAdendos, { mes: '', valor: 0 }])} className="text-[11px] font-bold text-lumos-yellow flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Adicionar adendo
                  </button>
                </div>
              </div>
            ) : (
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
                  <DatePicker mode="date" value={base} onChange={v => setBase(v || new Date().toISOString().slice(0, 10))}
                    className="input-lumos w-full h-10 text-sm" />
                </div>
              </div>
            )}

            {plano !== 'fee_mensal' && saldo > 0 && (
              <div className="rounded-lumos bg-lumos-text-secondary/5 border border-lumos-border p-3 space-y-1 text-[12.5px]">
                <p className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary">Vai ficar assim</p>
                {plano === 'entrada_saldo' ? (
                  <>
                    <div className="flex justify-between text-lumos-text-primary"><span>Entrada</span><span className="font-bold">{brl(entrada)} · {brData(base)}</span></div>
                    <div className="flex justify-between text-lumos-text-primary"><span>Saldo</span><span className="font-bold">{brl(saldo - entrada)} · {brData(somaDias(base, dias))}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between text-lumos-text-primary"><span>Parcela única</span><span className="font-bold">{brl(saldo)} · {brData(somaDias(base, dias))}</span></div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1">{jaConfigurado ? 'Fechar' : 'Cancelar'}</button>
          {!indisponivel && !jaConfigurado && (
            <button onClick={salvar} disabled={salvando || (plano === 'fee_mensal' ? (!fmInicio || !fmFim || fmValor <= 0) : saldo <= 0)}
              className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Definir parcelamento
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
