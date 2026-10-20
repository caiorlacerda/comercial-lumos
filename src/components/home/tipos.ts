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

/** Um item de fila ("Preciso de você"): título, linha de apoio e para onde levar a pessoa. */
export interface ItemFila { id: string; titulo: string; sub?: string; rota: string }

/** As filas de pendências que dependem de uma decisão da gestão. */
export interface FilasGestao {
  aval: ItemFila[];          // vídeos aguardando aval interno
  diarias: ItemFila[];       // pedidos de diária dos clientes
  reservas: ItemFila[];      // reservas de equipamento solicitadas
  fornecedores: ItemFila[];  // cadastros de fornecedor a aprovar
  semResponsavel: ItemFila[]; // tarefas abertas sem responsável
}

export interface CargaPessoa { id: string; nome: string; avatar_url: string | null; abertas: number; atrasadas: number }

export interface VideoParado { id: string; arquivo: string; projeto: string | null; dias: number; status: string; rota: string }

/** Visão da produção para quem gere o time (gestão de produção e admin). */
export interface DadosGestao {
  carregando: boolean;
  saude: { projetosAtivos: number; entregas7d: number; comCliente: number; atrasadas: number; maisAntigaDias: number };
  filas: FilasGestao;
  carga: { pessoas: CargaPessoa[]; semResponsavel: number; max: number };
  parados: VideoParado[];
}

/** O que a Home carrega uma vez e entrega aos blocos. */
export interface DadosHome {
  tarefas: TarefaHome[];
  ordenadas: TarefaHome[];
  carregando: boolean;
  hojeStr: string;
  resumo: ResumoTarefas;
  /** Só existe para gestão e admin. */
  gestao?: DadosGestao;
}

/** 'cheia' ocupa a linha toda; 'principal' fica na coluna larga; 'lateral' na coluna estreita. */
export type LarguraBloco = 'cheia' | 'principal' | 'lateral';
