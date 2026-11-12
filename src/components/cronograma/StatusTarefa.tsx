import { clsx } from 'clsx';
import { taskLabel } from '@/lib/taskStatus';

/** Etapa da tarefa (Na fila, Edição, Revisão…) como uma etiqueta pequena; as cores seguem as da Home. */
const COR: Record<string, string> = {
  na_fila: 'bg-lumos-text-secondary/15 text-lumos-text-secondary',
  pausado: 'bg-lumos-text-secondary/15 text-lumos-text-secondary',
  roteiro: 'bg-indigo-500/15 text-indigo-400',
  captacao: 'bg-sky-500/15 text-sky-400',
  em_progresso: 'bg-orange-500/15 text-orange-400',
  revisao_interna: 'bg-purple-500/15 text-purple-400',
  revisao_cliente: 'bg-amber-500/15 text-amber-400',
  alteracoes: 'bg-red-500/15 text-red-400',
  concluido: 'bg-green-500/15 text-green-400',
  entregue: 'bg-green-500/15 text-green-400',
};

export default function StatusTarefa({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return null;
  return (
    <span className={clsx('inline-block px-1.5 py-px rounded text-[9px] font-black uppercase tracking-wide whitespace-nowrap',
      COR[status] || 'bg-lumos-text-secondary/15 text-lumos-text-secondary', className)}>
      {taskLabel(status)}
    </span>
  );
}
