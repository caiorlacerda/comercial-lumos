import { format, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { Link2 } from 'lucide-react';
import Select from '@/components/ui/Select';
import UserAvatar from '@/components/common/UserAvatar';
import { type Item, type Linha, diasDaSemana, nomeDaLinha, tipoDoItem } from '@/lib/cronograma';

/**
 * A MESMA semana do cronograma, vista por DIA: uma coluna por dia com tudo o que está marcado
 * nele, agrupado por pessoa (e pelas linhas Criação, Externas, Entregas). Não guarda nada:
 * lê os itens da grade, então não há o que digitar duas vezes. Edita-se na visão "Por pessoa".
 */

const COLUNAS = 'repeat(5, minmax(172px, 1fr)) repeat(2, 76px)';

interface Props {
  linhas: Linha[];            // já ordenadas
  itens: Item[];
  dias: ReturnType<typeof diasDaSemana>;
  filtroLinha: string;        // '' = todas
  onFiltro: (id: string) => void;
}

export default function AgendaDaSemana({ linhas, itens, dias, filtroLinha, onFiltro }: Props) {
  const visiveis = filtroLinha ? linhas.filter(l => l.id === filtroLinha) : linhas;
  const total = itens.filter(i => visiveis.some(l => l.id === i.linha_id)).length;

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-lumos-border/60 flex items-center gap-3 flex-wrap">
        <div className="w-56">
          <Select value={filtroLinha} onChange={onFiltro} ariaLabel="Filtrar por pessoa" searchable={linhas.length > 8}
            className={clsx('w-full h-9 px-3 rounded-lumos border bg-lumos-surface text-[11px] font-bold transition-colors',
              filtroLinha ? 'border-lumos-yellow/60 text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}
            options={[{ value: '', label: 'Todas as pessoas' }, ...linhas.map(l => ({ value: l.id, label: nomeDaLinha(l) }))]} />
        </div>
        <span className="text-[11px] text-lumos-text-secondary">{total} {total === 1 ? 'item' : 'itens'} na semana</span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1000px]">
          <div className="grid bg-lumos-yellow/10 border-b border-lumos-border" style={{ gridTemplateColumns: COLUNAS }}>
            {dias.map(d => (
              <div key={d.iso} className={clsx('px-2 py-2 text-center border-l first:border-l-0 border-lumos-border/60', d.fimDeSemana && 'bg-lumos-text-secondary/[0.07]', isToday(d.data) && 'bg-lumos-yellow/20')}>
                <p className="text-[10px] font-black uppercase text-lumos-text-secondary">{format(d.data, d.fimDeSemana ? 'EEE' : 'EEEE', { locale: ptBR })}</p>
                <p className={clsx('text-[11px] font-bold', isToday(d.data) ? 'text-amber-600 dark:text-lumos-yellow' : 'text-lumos-text-primary')}>{format(d.data, 'dd/MM')}</p>
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: COLUNAS }}>
            {dias.map(d => {
              const grupos = visiveis
                .map(l => ({ l, doDia: itens.filter(i => i.linha_id === l.id && i.dia === d.iso).sort((a, b) => a.ordem - b.ordem) }))
                .filter(g => g.doDia.length > 0);
              return (
                <div key={d.iso} className={clsx('min-h-[220px] p-1.5 space-y-2.5 border-l first:border-l-0 border-lumos-border/60',
                  d.fimDeSemana && 'bg-lumos-text-secondary/[0.07]', isToday(d.data) && 'bg-lumos-yellow/[0.05]')}>
                  {grupos.length === 0 && <p className="text-center text-lumos-text-secondary/40 text-xs pt-3">—</p>}
                  {grupos.map(({ l, doDia }) => (
                    <div key={l.id} className="space-y-1">
                      <div className="flex items-center gap-1.5 px-0.5 min-w-0">
                        {l.tipo === 'pessoa' && l.user ? <UserAvatar user={l.user} size={16} /> : null}
                        <p className={clsx('text-[10px] font-black uppercase tracking-wide truncate',
                          l.tipo === 'externas' ? 'text-sky-600 dark:text-sky-400' : l.tipo === 'entregas' ? 'text-orange-600 dark:text-orange-400' : 'text-lumos-text-secondary')}
                          title={nomeDaLinha(l)}>{nomeDaLinha(l)}</p>
                      </div>
                      {doDia.map(i => {
                        const t = tipoDoItem(i.tipo);
                        return (
                          <div key={i.id} className={clsx('flex items-start gap-1.5 rounded border px-1.5 py-1', t.caixa)}>
                            <span className={clsx('mt-[5px] w-2 h-2 rounded-full flex-shrink-0', t.ponto)} />
                            <div className="min-w-0">
                              <p className="text-[12px] leading-snug text-lumos-text-primary whitespace-pre-wrap break-words">{i.texto}</p>
                              {i.project_id && (
                                <p className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-lumos-text-secondary">
                                  <Link2 className="w-2.5 h-2.5 flex-shrink-0" /> <span className="truncate">{i.project?.name || 'Projeto'}{i.task?.titulo ? ` · ${i.task.titulo}` : ''}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
