import type { UserRole } from '@/hooks/useAuth';

/** Os três "jeitos de usar a Home": cada papel do app cai em um deles. */
export type PapelHome = 'admin' | 'gestao' | 'time';

/** admin → admin; "Gestão de Produção" (producao) → gestao; todo o resto (time e papéis legados) → time. */
export function papelDaHome(role?: UserRole | string | null): PapelHome {
  if (role === 'admin') return 'admin';
  if (role === 'producao') return 'gestao';
  return 'time';
}

export interface TarefaHome {
  id: string;
  titulo: string;
  status: string;
  prioridade: string;
  data_fim: string | null;
  project_id: string;
  projects: {
    id: string;
    name: string;
    client_id: string | null;
    clients: { id: string; name: string } | null;
  } | null;
}

export interface ResumoTarefas { pending: number; dueToday: number; dueThisWeek: number; overdue: number }

/** O que a Home carrega uma vez e entrega aos blocos. */
export interface DadosHome {
  tarefas: TarefaHome[];
  ordenadas: TarefaHome[];
  carregando: boolean;
  hojeStr: string;
  resumo: ResumoTarefas;
}

/** 'cheia' ocupa a linha toda; 'principal' fica na coluna larga; 'lateral' na coluna estreita. */
export type LarguraBloco = 'cheia' | 'principal' | 'lateral';
