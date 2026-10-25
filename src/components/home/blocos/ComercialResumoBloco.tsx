import { useNavigate } from 'react-router-dom';
import { EsqueletoLinhas } from '@/components/ui/Esqueleto';
import { ChevronRight } from 'lucide-react';
import BlocoCartao from '../BlocoCartao';
import type { DadosHome } from '../tipos';

/** Onde o comercial está: orçamentos em negociação, os que estão sem resposta há uma semana e os aprovados no mês. */
export default function ComercialResumoBloco({ dados }: { dados: DadosHome }) {
  const navigate = useNavigate();
  const a = dados.admin;
  if (!a) return null;
  const c = a.comercial;

  return (
    <BlocoCartao titulo="Comercial" direita={
      <button type="button" onClick={() => navigate('/orcamentos')} className="text-[10px] uppercase tracking-wider text-lumos-text-secondary hover:text-lumos-yellow transition-colors cursor-pointer">ver orçamentos</button>
    }>
      {a.carregando ? (
        <EsqueletoLinhas n={4} className="py-1" />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-lumos-border bg-lumos-bg/30 p-2.5">
              <span className="block text-[10px] uppercase tracking-widest text-lumos-text-secondary">Em negociação</span>
              <span className="text-lg font-semibold text-lumos-text-primary tabular-nums">{c.emNegociacao}</span>
            </div>
            <div className="rounded border border-lumos-border bg-lumos-bg/30 p-2.5">
              <span className="block text-[10px] uppercase tracking-widest text-lumos-text-secondary">Aprovados no mês</span>
              <span className="text-lg font-semibold text-ok-fg tabular-nums">{c.aprovadosNoMes}</span>
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-lumos-text-secondary mb-1.5">Sem resposta há 7 dias ou mais</p>
            {c.semResposta7d.length === 0 ? (
              <p className="text-xs text-lumos-text-secondary italic">Nenhum orçamento esperando há tanto tempo.</p>
            ) : (
              <div className="space-y-1.5">
                {c.semResposta7d.map(o => (
                  <button key={o.id} type="button" onClick={() => navigate(`/orcamentos/${o.id}`)}
                    className="w-full text-left px-2.5 py-2 rounded border border-warn/25 bg-warn/5 hover:bg-warn/10 transition-colors flex items-center gap-2 group cursor-pointer">
                    <span className="min-w-0 flex-1 text-xs font-semibold text-lumos-text-primary truncate">{o.titulo}</span>
                    <span className="text-[11px] text-warn-fg font-semibold flex-shrink-0">{o.dias} dias</span>
                    <ChevronRight className="w-3.5 h-3.5 text-lumos-text-secondary group-hover:text-lumos-yellow flex-shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </BlocoCartao>
  );
}
