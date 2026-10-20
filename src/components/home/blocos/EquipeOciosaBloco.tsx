import { useNavigate } from 'react-router-dom';
import BlocoCartao from '../BlocoCartao';
import UserAvatar from '@/components/common/UserAvatar';
import type { DadosHome } from '../tipos';

/** Quem da equipe está sem nenhuma tarefa aberta: gente disponível para receber trabalho. */
export default function EquipeOciosaBloco({ dados }: { dados: DadosHome }) {
  const navigate = useNavigate();
  const g = dados.gestao;
  if (!g) return null;
  const lista = g.ociosos;

  return (
    <BlocoCartao titulo="Disponíveis" direita={lista.length > 0 ? (
      <span className="text-[10px] font-black uppercase bg-ok/10 text-ok-fg px-2 py-0.5 rounded">{lista.length}</span>
    ) : undefined}>
      {g.carregando ? (
        <p className="text-xs text-lumos-text-secondary italic text-center py-4">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-xs text-lumos-text-secondary italic text-center py-6">Todo mundo tem tarefa aberta.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-lumos-text-secondary">Sem nenhuma tarefa aberta agora:</p>
          <div className="flex flex-wrap gap-1.5">
            {lista.slice(0, 8).map(p => (
              <button key={p.id} type="button" onClick={() => navigate('/equipe')}
                className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border border-lumos-border bg-lumos-bg/30 hover:border-lumos-yellow/30 transition-colors cursor-pointer">
                <UserAvatar user={{ full_name: p.nome, avatar_url: p.avatar_url }} size={20} className="rounded-full flex-shrink-0" />
                <span className="text-xs font-medium text-lumos-text-primary">{p.nome.split(' ')[0]}</span>
              </button>
            ))}
            {lista.length > 8 && <span className="text-[11px] text-lumos-text-secondary self-center">+{lista.length - 8}</span>}
          </div>
        </div>
      )}
    </BlocoCartao>
  );
}
