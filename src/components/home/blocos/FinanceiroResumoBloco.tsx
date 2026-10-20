import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Wallet, ArrowUpRight, FileText } from 'lucide-react';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { formatCurrency } from '@/utils/financials';
import type { DadosHome } from '../tipos';

function Cartao({ rotulo, valor, apoio, icone, tom, onClick }: {
  rotulo: string; valor: string; apoio: string; icone: ReactNode; tom: 'neutro' | 'alerta' | 'ok' | 'atencao'; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'text-left border rounded-lumos p-3.5 transition-all flex items-center gap-3 group cursor-pointer bg-lumos-surface',
        tom === 'alerta' ? 'border-danger/40' : tom === 'atencao' ? 'border-warn/40' : tom === 'ok' ? 'border-ok/40' : 'border-lumos-border hover:border-lumos-yellow/30',
      )}
    >
      <span className={clsx('hidden sm:block p-2.5 rounded-lg border flex-shrink-0',
        tom === 'alerta' ? 'bg-danger/10 border-danger/30 text-danger-fg'
          : tom === 'atencao' ? 'bg-warn/10 border-warn/30 text-warn-fg'
            : tom === 'ok' ? 'bg-ok/10 border-ok/30 text-ok-fg'
              : 'bg-lumos-yellow/5 border-lumos-yellow/15 text-lumos-yellow')}>
        {icone}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider sm:tracking-widest leading-tight sm:truncate">{rotulo}</span>
        {/* lumos-valor-oculto: some junto com os demais valores no "modo apresentação" */}
        <span className={clsx('lumos-valor-oculto block text-base sm:text-xl font-semibold tabular-nums whitespace-nowrap', tom === 'alerta' ? 'text-danger-fg' : tom === 'ok' ? 'text-ok-fg' : 'text-lumos-text-primary')}>{valor}</span>
        <span className="block text-[11px] text-lumos-text-secondary truncate">{apoio}</span>
      </span>
    </button>
  );
}

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

/** Quatro números do caixa: o que está atrasado para entrar, o que entrou no mês, o que vence para sair e as notas a pagar. */
export default function FinanceiroResumoBloco({ dados }: { dados: DadosHome }) {
  const navigate = useNavigate();
  const a = dados.admin;
  if (!a) return null;
  const f = a.financeiro;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Cartao rotulo="A receber em atraso" valor={formatCurrency(f.receberAtrasado.valor)}
        apoio={f.receberAtrasado.qtd ? plural(f.receberAtrasado.qtd, 'título', 'títulos') : 'nada em atraso'}
        tom={f.receberAtrasado.qtd > 0 ? 'alerta' : 'neutro'} icone={<AlertTriangle className="w-4 h-4" />}
        onClick={() => navigate('/financeiro/contas?tab=receber')} />
      <Cartao rotulo="Recebido no mês" valor={formatCurrency(f.recebidoNoMes)} apoio="entrou em caixa"
        tom={f.recebidoNoMes > 0 ? 'ok' : 'neutro'} icone={<ArrowUpRight className="w-4 h-4" />}
        onClick={() => navigate('/financeiro/contas?tab=receber')} />
      <Cartao rotulo="A pagar em 7 dias" valor={formatCurrency(f.pagar7d.valor)}
        apoio={f.pagar7d.vencidas > 0 ? `${plural(f.pagar7d.vencidas, 'conta vencida', 'contas vencidas')}` : f.pagar7d.qtd ? plural(f.pagar7d.qtd, 'conta', 'contas') : 'nada a vencer'}
        tom={f.pagar7d.vencidas > 0 ? 'atencao' : 'neutro'} icone={<Wallet className="w-4 h-4" />}
        onClick={() => navigate('/financeiro/contas?tab=pagar')} />
      <Cartao rotulo="Notas para pagar" valor={formatCurrency(f.notasParaPagar.valor)}
        apoio={f.notasParaPagar.qtd ? plural(f.notasParaPagar.qtd, 'nota recebida', 'notas recebidas') : 'nenhuma pendente'}
        tom="neutro" icone={<FileText className="w-4 h-4" />}
        onClick={() => navigate('/financeiro/notas')} />
    </div>
  );
}
