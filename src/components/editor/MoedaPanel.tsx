import { useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import Select from '@/components/ui/Select';
import { useToast } from '@/context/ToastContext';
import type { BudgetVersion } from '@/utils/financials';
import { buscarCotacao } from '@/lib/cotacao';
import { SPREAD_PADRAO, calcCotacaoTravada, diasDesde, moedaDaVersao } from '@/utils/moeda';

interface Props {
  version: BudgetVersion;
  /** Versão antiga / só leitura. */
  disabled: boolean;
  /** Orçamento aprovado: moeda e cotação ficam congeladas. */
  aprovado: boolean;
  /** Fee mensal não aceita dólar nesta primeira entrega. */
  feeMensal: boolean;
  onChange: (updates: Partial<BudgetVersion>) => void;
}

const dataBR = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};

// A cotação tem 4 casas no banco e o total em US$ sai dela: mostrar 4 casas para a conta bater à mão.
const cotacaoBR = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4,
});

export default function MoedaPanel({ version, disabled, aprovado, feeMensal, onChange }: Props) {
  const toast = useToast();
  const [buscando, setBuscando] = useState(false);
  const [manualAberto, setManualAberto] = useState(false);
  const [manualTexto, setManualTexto] = useState('');

  const moeda = moedaDaVersao(version);
  const bloqueado = disabled || aprovado || feeMensal;
  // Valor mais recente de `bloqueado`: a busca é assíncrona e pode terminar depois de o orçamento ser travado.
  const bloqueadoRef = useRef(bloqueado);
  bloqueadoRef.current = bloqueado;
  const spread = Number(version.fx_spread_pct ?? SPREAD_PADRAO);
  const idade = diasDesde(version.fx_rate_at);
  const velha = idade !== null && idade > (version.validity_days ?? 7);

  // Uma única chamada com os seis campos: o banco só aceita USD junto de uma cotação.
  const aplicar = (mercado: number, fonte: 'ptax' | 'manual', quandoISO?: string) => {
    const m = Math.round(mercado * 10000) / 10000; // coluna numeric(12,4)
    onChange({
      currency: 'USD',
      fx_market_rate: m,
      fx_spread_pct: spread,
      fx_rate: calcCotacaoTravada(m, spread),
      fx_rate_at: quandoISO ?? new Date().toISOString(),
      fx_source: fonte,
    });
  };

  const atualizar = async () => {
    setBuscando(true);
    try {
      const c = await buscarCotacao();
      if (bloqueadoRef.current) {
        toast.warning('A moeda ficou travada enquanto a cotação era buscada. Nada foi alterado.');
        return;
      }
      aplicar(c.compra, 'ptax', c.do_cache ? `${c.data}T12:00:00-03:00` : undefined);
      setManualAberto(false);
      if (c.do_cache) toast.warning(`Banco Central indisponível agora. Usei a última cotação guardada (${dataBR(c.data)}).`);
    } catch {
      toast.error('Não consegui buscar a cotação. Digite a cotação à mão.');
      setManualAberto(true);
    } finally {
      setBuscando(false);
    }
  };

  const escolher = (v: string) => {
    if (v === 'BRL') { onChange({ currency: 'BRL' }); return; }
    void atualizar();
  };

  const usarManual = () => {
    const n = Number(manualTexto.replace(',', '.'));
    if (!(n > 0 && n < 100)) { toast.error('Cotação inválida. Exemplo: 5,07'); return; }
    aplicar(n, 'manual');
    setManualAberto(false);
    setManualTexto('');
  };

  const mudarMargem = (texto: string) => {
    const s = Math.min(Math.max(Number(texto) || 0, 0), 20) / 100;
    const mercado = Number(version.fx_market_rate);
    if (!(mercado > 0)) return;
    onChange({ fx_spread_pct: s, fx_rate: calcCotacaoTravada(mercado, s) });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10px] text-lumos-text-secondary font-black uppercase mb-1 block">Moeda da proposta</label>
        <Select
          disabled={bloqueado || buscando}
          className="input-lumos w-full font-black uppercase text-[10px] disabled:opacity-70"
          value={moeda}
          onChange={escolher}
          options={[{ value: 'BRL', label: 'R$ — Real' }, { value: 'USD', label: 'US$ — Dólar' }]}
        />
        {feeMensal && (
          <p className="text-[10px] text-lumos-text-secondary mt-1">Fee mensal não aceita dólar nesta versão.</p>
        )}
        {aprovado && (
          <p className="text-[10px] text-lumos-text-secondary mt-1">
            Moeda e cotação travadas: o orçamento está aprovado. Volte para "Em Negociação" para alterar.
          </p>
        )}
      </div>

      {moeda === 'USD' && (
        <div className="rounded-lumos border border-lumos-border p-3 space-y-3 text-[10px] font-semibold">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-lumos-text-secondary uppercase font-black block mb-1">Cotação de mercado</span>
              <span className="text-lumos-text-primary text-xs">{cotacaoBR.format(Number(version.fx_market_rate) || 0)}</span>
            </div>
            <div>
              <label className="text-lumos-text-secondary uppercase font-black block mb-1">Margem de segurança</label>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={0} max={20} step={0.5}
                  disabled={bloqueado}
                  className="input-lumos w-full text-center font-bold text-lumos-text-primary disabled:opacity-70"
                  value={Math.round(spread * 10000) / 100}
                  onChange={(e) => mudarMargem(e.target.value)}
                />
                <span className="text-lumos-text-secondary">%</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-lumos-text-secondary uppercase font-black">Cotação travada</span>
            <span className="text-lumos-text-primary text-sm font-black">{cotacaoBR.format(Number(version.fx_rate) || 0)}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-lumos-text-secondary">
              {version.fx_source === 'manual' ? 'Digitada' : 'Banco Central (PTAX)'}
              {version.fx_rate_at ? ` · ${dataBR(version.fx_rate_at)}` : ''}
            </span>
            <button
              type="button" disabled={bloqueado || buscando} onClick={atualizar}
              className="h-8 px-3 rounded-lumos border border-lumos-border text-lumos-text-primary font-bold flex items-center gap-1.5 hover:border-lumos-yellow/50 disabled:opacity-50"
            >
              {buscando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Atualizar cotação
            </button>
          </div>

          {velha && !aprovado && (
            <p className="text-amber-500">
              Cotação de {idade} dia(s) e a proposta vale por {version.validity_days ?? 7}. Atualize a cotação se for reenviar.
            </p>
          )}
        </div>
      )}

      {!bloqueado && (moeda === 'USD' || manualAberto) && (
        <div>
          <button
            type="button" onClick={() => setManualAberto(v => !v)}
            className="text-[10px] text-lumos-text-secondary underline hover:text-lumos-text-primary"
          >
            {manualAberto ? 'Esconder cotação manual' : 'Digitar a cotação à mão'}
          </button>
          {manualAberto && (
            <div className={clsx('flex items-center gap-2 mt-2')}>
              <input
                type="text" inputMode="decimal" placeholder="Cotação de mercado (ex.: 5,07)"
                className="input-lumos w-full text-[11px]"
                value={manualTexto}
                onChange={(e) => setManualTexto(e.target.value)}
              />
              <button
                type="button" onClick={usarManual}
                className="h-9 px-3 rounded-lumos bg-lumos-yellow text-black text-[10px] font-black uppercase whitespace-nowrap"
              >
                Usar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
