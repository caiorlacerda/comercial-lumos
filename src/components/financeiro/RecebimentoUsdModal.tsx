import { useState } from 'react';
import { clsx } from 'clsx';
import Modal from '@/components/common/Modal';
import DatePicker from '@/components/ui/DatePicker';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { formatarMoeda, parseValorBR, usdDoTitulo } from '@/utils/moeda';

export interface RecebimentoUsdResultado {
  previsto: number;
  recebido: number;
}

interface Props {
  /** Título (receivable) com `budget_version` embutida (currency, fx_rate) e `valor_previsto` opcional. */
  titulo: any;
  onClose: () => void;
  onDone: (r: RecebimentoUsdResultado) => void;
}

const ERROS: Record<string, string> = {
  valor_invalido: 'Informe um valor em reais maior que zero.',
  data_invalida: 'Informe a data em que o dinheiro entrou.',
  nao_encontrado: 'Este título não existe mais.',
  status_invalido: 'Este título já está recebido ou foi cancelado.',
  nao_e_dolar: 'Este título não é de uma proposta em dólar.',
};

// Data local de hoje (AAAA-MM-DD), sem o desvio de fuso do toISOString.
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function RecebimentoUsdModal({ titulo, onClose, onDone }: Props) {
  const toast = useToast();
  const [texto, setTexto] = useState('');
  const [data, setData] = useState<string | null>(hoje());
  const [salvando, setSalvando] = useState(false);

  const previsto = Number(titulo.valor_previsto ?? titulo.total_amount ?? 0);
  const usd = usdDoTitulo(titulo, titulo.budget_version);
  const valor = parseValorBR(texto);
  const diferenca = valor != null ? Math.round((valor - previsto) * 100) / 100 : null;
  const muitoDiferente = diferenca != null && previsto > 0 && Math.abs(diferenca) / previsto > 0.15;

  const confirmar = async () => {
    if (valor == null) { toast.error(ERROS.valor_invalido); return; }
    if (!data) { toast.error(ERROS.data_invalida); return; }
    setSalvando(true);
    try {
      const { data: r, error } = await supabase.rpc('registrar_recebimento_cambial', {
        p_receivable_id: titulo.id,
        p_valor_brl: valor,
        p_data: data,
      });
      if (error) throw error;
      if (!r?.ok) { toast.error(ERROS[r?.error] || 'Não foi possível registrar o recebimento.'); return; }
      onDone({ previsto: Number(r.previsto), recebido: Number(r.recebido) });
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível registrar o recebimento.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Registrar recebimento em dólar" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="text-xs text-lumos-text-secondary space-y-1">
          <p className="font-bold text-lumos-text-primary text-sm">{titulo.description}</p>
          <p>
            Previsto: <span className="font-bold text-lumos-text-primary">{formatarMoeda(previsto, 'BRL')}</span>
            {usd != null && <span> · {formatarMoeda(usd, 'USD')} contratados</span>}
          </p>
        </div>

        <div>
          <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-1 block">
            Valor recebido em R$ (já convertido)
          </label>
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            placeholder="Ex.: 51.200,00"
            className="input-lumos w-full"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {diferenca != null && (
            <p className={clsx('text-[11px] font-bold mt-1', diferenca >= 0 ? 'text-green-500' : 'text-red-500')}>
              Diferença para o previsto: {diferenca >= 0 ? '+' : '−'}{formatarMoeda(Math.abs(diferenca), 'BRL')} (variação cambial)
            </p>
          )}
          {muitoDiferente && (
            <p className="text-[11px] text-amber-500 mt-1">
              Confira o valor: ele difere mais de 15% do previsto.
            </p>
          )}
        </div>

        <div>
          <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-1 block">
            Data em que o dinheiro entrou
          </label>
          <DatePicker value={data} onChange={setData} max={hoje()} />
        </div>

        <p className="text-[11px] text-lumos-text-secondary">
          O total deste título passa a ser o valor recebido; o previsto fica guardado para a referência em dólar.
        </p>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 h-10 text-sm">Cancelar</button>
          <button
            type="button"
            onClick={confirmar}
            disabled={salvando || valor == null || !data}
            className="btn-primary flex-1 h-10 text-sm font-bold disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Registrar recebimento'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
