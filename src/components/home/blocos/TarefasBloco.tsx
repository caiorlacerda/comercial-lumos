import { useNavigate } from 'react-router-dom';
import { TipoPilula } from '@/components/producao/TipoDeTarefa';
import { useTipoDasTarefas } from '@/lib/tiposTarefa';
import { AlertTriangle, ChevronRight, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { DadosHome } from '../tipos';

const getPriorityBadgeClass = (priority: string) => {
  switch (priority) {
    case 'urgente':
      return 'bg-red-500/10 text-red-500 border-red-500/20';
    case 'alta':
      return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
    case 'media':
      return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    case 'baixa':
    default:
      return 'bg-gray-500/10 text-lumos-text-secondary border-lumos-border/35';
  }
};

const getStatusBadge = (status: string) => {
  const map: Record<string, { label: string; class: string }> = {
    'na_fila': { label: 'Na fila', class: 'bg-lumos-text-secondary/15 text-lumos-text-secondary' },
    'pausado': { label: 'Pausado', class: 'bg-lumos-text-secondary/15 text-lumos-text-secondary' },
    'roteiro': { label: 'Roteiro', class: 'bg-indigo-500/15 text-indigo-400' },
    'captacao': { label: 'Captação', class: 'bg-sky-500/15 text-sky-400' },
    'em_progresso': { label: 'Edição', class: 'bg-orange-500/15 text-orange-400' },
    'revisao_interna': { label: 'Revisão interna', class: 'bg-purple-500/15 text-purple-400' },
    'revisao_cliente': { label: 'Com o cliente', class: 'bg-amber-500/15 text-amber-400' },
    'alteracoes': { label: 'Ajustes', class: 'bg-red-500/15 text-red-400' },
    'concluido': { label: 'Aprovado', class: 'bg-green-500/15 text-green-400' },
  };
  const details = map[status] || { label: status, class: 'bg-lumos-text-secondary/15 text-lumos-text-secondary' };
  return (
    <span className={clsx("px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider", details.class)}>
      {details.label}
    </span>
  );
};

/** Minhas tarefas pendentes, por prazo. */
export default function TarefasBloco({ dados }: { dados: DadosHome }) {
  const navigate = useNavigate();
  const { tarefas, ordenadas: sortedTasks, carregando: loadingTasks, hojeStr: todayStr } = dados;
  const tipoDe = useTipoDasTarefas(sortedTasks.map(t => t.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-1.5">
        <h2 className="text-[11px] uppercase tracking-[3px] text-lumos-text-primary flex items-center gap-3">
          <span className="block h-2 w-2 bg-lumos-yellow" /> Minhas Tarefas Pendentes
        </h2>
        <span className="text-[10px] font-black uppercase bg-lumos-yellow/10 text-lumos-yellow px-2 py-0.5 rounded">
          {tarefas.length} ativas
        </span>
      </div>

      {loadingTasks ? (
        <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-10 text-center flex flex-col items-center justify-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-lumos-yellow"></div>
          <p className="text-xs text-lumos-text-secondary font-bold uppercase tracking-wider">Carregando tarefas...</p>
        </div>
      ) : sortedTasks.length === 0 ? (
        <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-10 text-center flex flex-col items-center justify-center gap-4 shadow-sm">
          <div className="p-4 bg-green-500/10 rounded-full border border-green-500/20 text-green-500">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-lumos-text-primary">Tudo em dia! 🎉</h3>
            <p className="text-xs text-lumos-text-secondary mt-1 max-w-sm mx-auto leading-relaxed">
              Você não tem nenhuma tarefa pendente atribuída no gerenciador de projetos neste momento.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedTasks.map(task => {
            const isOverdue = task.data_fim && task.data_fim < todayStr;
            const isDueToday = task.data_fim === todayStr;

            return (
              <div
                key={task.id}
                onClick={() => {
                  const projId = task.projects?.id;
                  if (projId) {
                    navigate(`/producao/projetos?projectId=${projId}&taskId=${task.id}`);
                  } else {
                    navigate('/producao/projetos');
                  }
                }}
                className={clsx(
                  "bg-lumos-surface border rounded-lumos p-3.5 transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-lumos-yellow/40 group hover:shadow-md",
                  isOverdue ? "border-red-500/25 bg-red-500/[0.01]" : "border-lumos-border"
                )}
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {task.prioridade && (
                      <span className={clsx("px-2 py-0.5 rounded text-[8px] font-black uppercase border tracking-wider", getPriorityBadgeClass(task.prioridade))}>
                        {task.prioridade}
                      </span>
                    )}
                    {getStatusBadge(task.status)}
                  </div>
                  <h4 className="text-[13px] font-semibold text-lumos-text-primary truncate group-hover:text-lumos-yellow transition-colors leading-tight">
                    {tipoDe(task.id) && <TipoPilula tipo={tipoDe(task.id)!} pequeno className="mr-1.5 align-[1px]" />}
                    {task.titulo}
                  </h4>
                  <p className="text-[10px] text-lumos-text-secondary font-semibold uppercase tracking-wider">
                    {task.projects?.clients?.name || 'Cliente Sem Nome'} • {task.projects?.name || 'Projeto Sem Nome'}
                  </p>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 border-lumos-border/40 pt-3 md:pt-0">
                  {/* Deadline info */}
                  <div className="text-left md:text-right">
                    <span className="block text-[8px] font-bold text-lumos-text-secondary uppercase tracking-widest">Prazo</span>
                    {task.data_fim ? (
                      <span className={clsx(
                        "text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 mt-0.5",
                        isOverdue ? "text-red-500" : isDueToday ? "text-lumos-yellow" : "text-lumos-text-primary"
                      )}>
                        {isOverdue && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 animate-pulse" />}
                        {new Date(task.data_fim + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-lumos-text-secondary/60 mt-0.5 block italic">
                        Sem prazo
                      </span>
                    )}
                  </div>

                  {/* Go icon */}
                  <div className="p-1.5 rounded-full bg-lumos-bg border border-lumos-border/50 group-hover:bg-lumos-yellow/10 group-hover:border-lumos-yellow/30 text-lumos-text-secondary group-hover:text-lumos-yellow transition-all flex items-center justify-center flex-shrink-0">
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
