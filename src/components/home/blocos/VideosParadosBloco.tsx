import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import BlocoCartao from '../BlocoCartao';
import type { DadosHome } from '../tipos';

const ROTULO: Record<string, string> = { EM_REVISAO_INTERNA: 'aguardando aval interno', EM_REVISAO_CLIENTE: 'com o cliente' };

/** Vídeos em revisão que não andam há dias: os mais antigos primeiro. */
export default function VideosParadosBloco({ dados }: { dados: DadosHome }) {
  const navigate = useNavigate();
  const g = dados.gestao;
  if (!g) return null;

  return (
    <BlocoCartao titulo="Vídeos parados" direita={g.parados.length > 0 ? (
      <span className="text-[10px] font-black uppercase bg-warn/10 text-warn-fg px-2 py-0.5 rounded">{g.parados.length}</span>
    ) : undefined}>
      {g.carregando ? (
        <p className="text-xs text-lumos-text-secondary italic text-center py-4">Carregando…</p>
      ) : g.parados.length === 0 ? (
        <p className="text-xs text-lumos-text-secondary italic text-center py-6">Nenhum vídeo parado em revisão.</p>
      ) : (
        <div className="space-y-2">
          {g.parados.map(v => (
            <button key={v.id} type="button" onClick={() => navigate(v.rota)}
              className="w-full text-left p-3 rounded border border-lumos-border bg-lumos-bg/30 hover:bg-lumos-yellow/5 hover:border-lumos-yellow/20 transition-all flex items-center gap-3 group cursor-pointer">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-lumos-text-primary truncate group-hover:text-lumos-yellow transition-colors">{v.arquivo}</span>
                <span className="block text-[11px] text-lumos-text-secondary truncate">
                  {ROTULO[v.status] ?? v.status} há {v.dias} dias{v.projeto ? ` · ${v.projeto}` : ''}
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-lumos-text-secondary group-hover:text-lumos-yellow flex-shrink-0 transition-colors" />
            </button>
          ))}
        </div>
      )}
    </BlocoCartao>
  );
}
