import { useNavigate } from 'react-router-dom';
import { EsqueletoItens } from '@/components/ui/Esqueleto';
import { ChevronRight, CheckCircle2, Film, CalendarPlus, Wrench, Truck, UserX, Receipt, FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import BlocoCartao from '../BlocoCartao';
import type { DadosHome, ItemFila } from '../tipos';

interface Linha { chave: string; icone: ReactNode; singular: string; plural: string; itens: ItemFila[]; rota: string }

const resumoDosItens = (itens: ItemFila[]) => {
  const nomes = itens.slice(0, 2).map(i => i.sub ? `${i.titulo} · ${i.sub}` : i.titulo);
  return nomes.join(' • ') + (itens.length > 2 ? ` • +${itens.length - 2}` : '');
};

/** A fila do que está parado esperando uma decisão da gestão: aval de vídeo, diárias, reservas, fornecedores, tarefas sem dono. */
export default function PrecisoDeVoceBloco({ dados }: { dados: DadosHome }) {
  const navigate = useNavigate();
  const g = dados.gestao;
  if (!g) return null;
  const f = g.filas;
  const extras = dados.admin?.filas;

  const linhas: Linha[] = [
    { chave: 'aval', icone: <Film className="w-4 h-4" />, singular: 'vídeo aguardando aval interno', plural: 'vídeos aguardando aval interno', itens: f.aval, rota: f.aval[0]?.rota ?? '/producao' },
    { chave: 'diarias', icone: <CalendarPlus className="w-4 h-4" />, singular: 'pedido de diária do cliente', plural: 'pedidos de diária dos clientes', itens: f.diarias, rota: f.diarias[0]?.rota ?? '/producao' },
    { chave: 'reservas', icone: <Wrench className="w-4 h-4" />, singular: 'reserva de equipamento para decidir', plural: 'reservas de equipamento para decidir', itens: f.reservas, rota: '/producao/equipamentos' },
    { chave: 'fornecedores', icone: <Truck className="w-4 h-4" />, singular: 'fornecedor para aprovar', plural: 'fornecedores para aprovar', itens: f.fornecedores, rota: '/producao/fornecedores' },
    { chave: 'sem', icone: <UserX className="w-4 h-4" />, singular: 'tarefa sem responsável', plural: 'tarefas sem responsável', itens: f.semResponsavel, rota: '/producao/board' },
    { chave: 'reembolsos', icone: <Receipt className="w-4 h-4" />, singular: 'reembolso aguardando aprovação', plural: 'reembolsos aguardando aprovação', itens: extras?.reembolsos ?? [], rota: '/financeiro/reembolso' },
    { chave: 'notas', icone: <FileText className="w-4 h-4" />, singular: 'nota de fornecedor para pagar', plural: 'notas de fornecedores para pagar', itens: extras?.notas ?? [], rota: '/financeiro/notas' },
  ].filter(l => l.itens.length > 0);

  const total = linhas.reduce((n, l) => n + l.itens.length, 0);

  return (
    <BlocoCartao titulo="Preciso de você" direita={total > 0 ? (
      <span className="text-[10px] font-black uppercase bg-warn/10 text-warn-fg px-2 py-0.5 rounded">{total}</span>
    ) : undefined}>
      {g.carregando ? (
        <EsqueletoItens n={2} />
      ) : linhas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="w-6 h-6 text-ok-fg" />
          <p className="text-sm font-semibold text-lumos-text-primary">Nada esperando por você</p>
          <p className="text-xs text-lumos-text-secondary">Aprovações, pedidos e reservas aparecem aqui quando chegarem.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {linhas.map(l => (
            <button
              key={l.chave}
              type="button"
              onClick={() => navigate(l.rota)}
              className="w-full text-left p-3 rounded border border-lumos-border bg-lumos-bg/30 hover:bg-lumos-yellow/5 hover:border-lumos-yellow/20 transition-all flex items-center gap-3 group cursor-pointer"
            >
              <span className="p-2 rounded-lg bg-warn/10 border border-warn/20 text-warn-fg flex-shrink-0">{l.icone}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-lumos-text-primary">
                  <span className="tabular-nums">{l.itens.length}</span> {l.itens.length === 1 ? l.singular : l.plural}
                </span>
                <span className="block text-[11px] text-lumos-text-secondary truncate">{resumoDosItens(l.itens)}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-lumos-text-secondary group-hover:text-lumos-yellow flex-shrink-0 transition-colors" />
            </button>
          ))}
        </div>
      )}
    </BlocoCartao>
  );
}
