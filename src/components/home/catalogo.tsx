import type { ReactNode } from 'react';
import type { DadosHome, LarguraBloco, PapelHome } from './tipos';
import ResumoBloco from './blocos/ResumoBloco';
import HojeBloco from './blocos/HojeBloco';
import TarefasBloco from './blocos/TarefasBloco';
import VideosAjustesBloco from './blocos/VideosAjustesBloco';
import NotificacoesBloco from './blocos/NotificacoesBloco';
import AtalhosBloco from './blocos/AtalhosBloco';
import MuralBloco from './blocos/MuralBloco';

export interface BlocoHome {
  id: string;
  titulo: string;
  largura: LarguraBloco;
  /** Papéis para os quais o bloco existe (a pessoa ainda pode escondê-lo). */
  papeis: PapelHome[];
  render: (dados: DadosHome) => ReactNode;
}

const TODOS: PapelHome[] = ['admin', 'gestao', 'time'];

/** Todos os blocos da Home. Para criar um novo: componente em ./blocos e uma linha aqui. */
export const BLOCOS: BlocoHome[] = [
  { id: 'resumo', titulo: 'Resumo das minhas tarefas', largura: 'cheia', papeis: TODOS, render: d => <ResumoBloco dados={d} /> },
  { id: 'hoje', titulo: 'Hoje', largura: 'principal', papeis: TODOS, render: d => <HojeBloco dados={d} /> },
  { id: 'tarefas', titulo: 'Minhas tarefas pendentes', largura: 'principal', papeis: TODOS, render: d => <TarefasBloco dados={d} /> },
  { id: 'videos_ajustes', titulo: 'Vídeos com ajustes', largura: 'lateral', papeis: TODOS, render: d => <VideosAjustesBloco dados={d} /> },
  { id: 'notificacoes', titulo: 'Notificações', largura: 'lateral', papeis: TODOS, render: () => <NotificacoesBloco /> },
  { id: 'atalhos', titulo: 'Atalhos rápidos', largura: 'lateral', papeis: TODOS, render: () => <AtalhosBloco /> },
  { id: 'mural', titulo: 'Mural de recados', largura: 'cheia', papeis: TODOS, render: () => <MuralBloco /> },
];

/** Ordem inicial por papel (o que não está na lista nasce escondido, mas pode ser ligado em "Personalizar"). */
export const ORDEM_PADRAO: Record<PapelHome, string[]> = {
  time: ['resumo', 'hoje', 'videos_ajustes', 'mural', 'tarefas', 'notificacoes', 'atalhos'],
  gestao: ['resumo', 'mural', 'tarefas', 'notificacoes', 'atalhos'],
  admin: ['resumo', 'mural', 'tarefas', 'notificacoes', 'atalhos'],
};
