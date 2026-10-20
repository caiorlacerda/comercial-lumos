import { useNavigate } from 'react-router-dom';
import { FolderOpen, CalendarClock, Send, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { DadosHome } from '../tipos';

function Cartao({ rotulo, valor, apoio, icone, tom, onClick }: {
  rotulo: string; valor: number; apoio: string; icone: ReactNode; tom: 'neutro' | 'alerta' | 'atencao'; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'text-left border rounded-lumos p-3.5 transition-all flex items-center gap-3 group cursor-pointer bg-lumos-surface',
        tom === 'alerta' ? 'border-danger/40' : tom === 'atencao' ? 'border-warn/40' : 'border-lumos-border hover:border-lumos-yellow/30',
      )}
    >
      <span className={clsx('hidden sm:block p-2.5 rounded-lg border flex-shrink-0',
        tom === 'alerta' ? 'bg-danger/10 border-danger/30 text-danger-fg'
          : tom === 'atencao' ? 'bg-warn/10 border-warn/30 text-warn-fg'
            : 'bg-lumos-yellow/5 border-lumos-yellow/15 text-lumos-yellow')}>
        {icone}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider sm:tracking-widest leading-tight sm:truncate">{rotulo}</span>
        <span className={clsx('block text-lg sm:text-xl font-semibold tabular-nums', tom === 'alerta' ? 'text-danger-fg' : 'text-lumos-text-primary')}>{valor}</span>
        <span className="block text-[11px] text-lumos-text-secondary truncate">{apoio}</span>
      </span>
    </button>
  );
}

/** Quatro números que dizem se a produção está saudável: ativos, entregas da semana, com o cliente e atrasadas. */
export default function SaudeProducaoBloco({ dados }: { dados: DadosHome }) {
  const navigate = useNavigate();
  const g = dados.gestao;
  if (!g) return null;
  const s = g.saude;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Cartao rotulo="Projetos ativos" valor={s.projetosAtivos} apoio="em produção" tom="neutro"
        icone={<FolderOpen className="w-4 h-4" />} onClick={() => navigate('/producao/projetos')} />
      <Cartao rotulo="Entregas em 7 dias" valor={s.entregas7d} apoio={s.entregas7d ? 'ver no calendário' : 'nenhuma prevista'} tom="neutro"
        icone={<CalendarClock className="w-4 h-4" />} onClick={() => navigate('/producao/schedule')} />
      <Cartao rotulo="Com o cliente" valor={s.comCliente} apoio="aguardando retorno" tom={s.comCliente > 0 ? 'atencao' : 'neutro'}
        icone={<Send className="w-4 h-4" />} onClick={() => navigate('/producao/board')} />
      <Cartao rotulo="Atrasadas" valor={s.atrasadas} apoio={s.atrasadas ? `a mais antiga: ${s.maisAntigaDias} d` : 'tudo no prazo'} tom={s.atrasadas > 0 ? 'alerta' : 'neutro'}
        icone={<AlertTriangle className="w-4 h-4" />} onClick={() => navigate('/producao')} />
    </div>
  );
}
