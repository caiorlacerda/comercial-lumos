import type { ReactNode } from 'react';
import type { DadosHome, LarguraBloco, PapelHome } from './tipos';
import ResumoBloco from './blocos/ResumoBloco';
import HojeBloco from './blocos/HojeBloco';
import TarefasBloco from './blocos/TarefasBloco';
import VideosAjustesBloco from './blocos/VideosAjustesBloco';
import NotificacoesBloco from './blocos/NotificacoesBloco';
import AtalhosBloco from './blocos/AtalhosBloco';
import MuralBloco from './blocos/MuralBloco';
import SaudeProducaoBloco from './blocos/SaudeProducaoBloco';
import PrecisoDeVoceBloco from './blocos/PrecisoDeVoceBloco';
import CargaEquipeBloco from './blocos/CargaEquipeBloco';
import VideosParadosBloco from './blocos/VideosParadosBloco';

export interface BlocoHome {
  id: string;
  titulo: string;
  largura: LarguraBloco;
  /** Papéis para os quais o bloco existe (a pessoa ainda pode escondê-lo). */
  papeis: PapelHome[];
  render: (dados: DadosHome) => ReactNode;
}

const TODOS: PapelHome[] = ['admin', 'gestao', 'time'];
const GESTAO: PapelHome[] = ['admin', 'gestao'];

/** Todos os blocos da Home. Para criar um novo: componente em ./blocos e uma linha aqui. */
export const BLOCOS: BlocoHome[] = [
  { id: 'saude_producao', titulo: 'Saúde da produção', largura: 'cheia', papeis: GESTAO, render: d => <SaudeProducaoBloco dados={d} /> },
  { id: 'preciso_de_voce', titulo: 'Preciso de você', largura: 'principal', papeis: GESTAO, render: d => <PrecisoDeVoceBloco dados={d} /> },
  { id: 'carga_equipe', titulo: 'Carga da equipe', largura: 'lateral', papeis: GESTAO, render: d => <CargaEquipeBloco dados={d} /> },
  { id: 'videos_parados', titulo: 'Vídeos parados', largura: 'lateral', papeis: GESTAO, render: d => <VideosParadosBloco dados={d} /> },
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
  // 'resumo' (os quatro números das MINHAS tarefas) fica de fora por padrão: repetia os rótulos da Saúde da produção e confundia. Dá para ligar em Personalizar.
  gestao: ['saude_producao', 'preciso_de_voce', 'carga_equipe', 'videos_parados', 'tarefas', 'notificacoes', 'atalhos', 'mural'],
  // Admin: por enquanto a mesma visão da gestão; financeiro, comercial e equipe entram na fase 3.
  admin: ['saude_producao', 'preciso_de_voce', 'carga_equipe', 'videos_parados', 'tarefas', 'notificacoes', 'atalhos', 'mural'],
};
