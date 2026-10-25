import { useNavigate } from 'react-router-dom';
import { EsqueletoLinhas } from '@/components/ui/Esqueleto';
import BlocoCartao from '../BlocoCartao';
import UserAvatar from '@/components/common/UserAvatar';
import type { DadosHome } from '../tipos';

/** Quantas tarefas abertas cada pessoa carrega (e quantas já estão atrasadas), da maior carga para a menor. */
export default function CargaEquipeBloco({ dados }: { dados: DadosHome }) {
  const navigate = useNavigate();
  const g = dados.gestao;
  if (!g) return null;
  const { pessoas, semResponsavel, max } = g.carga;

  return (
    <BlocoCartao titulo="Carga da equipe" direita={<span className="text-[10px] uppercase tracking-wider text-lumos-text-secondary">abertas</span>}>
      {g.carregando ? (
        <EsqueletoLinhas n={4} className="py-1" />
      ) : pessoas.length === 0 && semResponsavel === 0 ? (
        <p className="text-xs text-lumos-text-secondary italic text-center py-6">Nenhuma tarefa aberta.</p>
      ) : (
        <div className="space-y-2.5">
          {pessoas.map(p => (
            <button key={p.id} type="button" onClick={() => navigate('/producao/board')} className="w-full flex items-center gap-2.5 text-left group cursor-pointer">
              <UserAvatar user={{ full_name: p.nome, avatar_url: p.avatar_url }} size={24} className="rounded-full flex-shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-lumos-text-primary truncate group-hover:text-lumos-yellow transition-colors">{p.nome}</span>
                  <span className="tabular-nums text-lumos-text-secondary flex-shrink-0">
                    {p.abertas}{p.atrasadas > 0 && <span className="text-danger-fg font-semibold"> · {p.atrasadas} atrasada{p.atrasadas > 1 ? 's' : ''}</span>}
                  </span>
                </span>
                <span className="block h-1.5 rounded-full bg-lumos-text-secondary/15 mt-1 overflow-hidden">
                  <span className="block h-full rounded-full bg-lumos-yellow" style={{ width: `${max ? Math.max(6, Math.round((p.abertas / max) * 100)) : 0}%` }} />
                </span>
              </span>
            </button>
          ))}
          {semResponsavel > 0 && (
            <button type="button" onClick={() => navigate('/producao/board')}
              className="w-full text-left text-xs text-warn-fg bg-warn/10 border border-warn/25 rounded px-2.5 py-2 hover:bg-warn/15 transition-colors cursor-pointer">
              {semResponsavel} tarefa{semResponsavel > 1 ? 's' : ''} sem responsável · atribuir
            </button>
          )}
        </div>
      )}
    </BlocoCartao>
  );
}
