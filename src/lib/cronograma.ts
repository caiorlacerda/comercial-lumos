import { addDays, format, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * CRONOGRAMA DA EQUIPE — tipos e regras compartilhadas.
 * Substitui a planilha "LUMOS | Cronograma da equipe": uma semana por registro, linhas = pessoas
 * (ou nome livre) e linhas especiais, e em cada célula (linha × dia) uma lista de itens com tipo.
 */

export type TipoItem = 'edicao' | 'gravacao' | 'externa' | 'entrega';
export type TipoLinha = 'pessoa' | 'criacao' | 'externas' | 'entregas';

export interface Semana {
  id: string;
  inicio: string; // AAAA-MM-DD, sempre segunda-feira
  projetos_andamento: string;
  projetos_iniciar: string;
}

export interface Linha {
  id: string;
  semana_id: string;
  ordem: number;
  tipo: TipoLinha;
  user_id: string | null;
  nome: string | null;
  user?: { id: string; full_name: string; avatar_url: string | null; job_title: string | null } | null;
}

export interface Item {
  id: string;
  linha_id: string;
  dia: string; // AAAA-MM-DD
  ordem: number;
  texto: string;
  tipo: TipoItem;
  task_id: string | null;
  project_id: string | null;
  /** Vínculo opcional com um projeto/tarefa da plataforma (vem junto na consulta). */
  project?: { id: string; name: string } | null;
  task?: { id: string; titulo: string } | null;
}

/** Colunas lidas de cada item, com o nome do projeto e da tarefa vinculados. */
export const SELECT_ITEM = 'id, linha_id, dia, ordem, texto, tipo, task_id, project_id, project:projects(id, name), task:project_tasks(id, titulo)';

/** As cores da legenda da planilha: sem cor, verde, azul e laranja. */
export const TIPOS: { id: TipoItem; label: string; caixa: string; ponto: string }[] = [
  { id: 'edicao', label: 'Edição', caixa: 'bg-lumos-surface border-lumos-border', ponto: 'bg-lumos-text-secondary/40' },
  { id: 'gravacao', label: 'Gravação ou Meeting', caixa: 'bg-green-500/15 border-green-500/35', ponto: 'bg-green-500' },
  { id: 'externa', label: 'Externa', caixa: 'bg-sky-500/15 border-sky-500/35', ponto: 'bg-sky-500' },
  { id: 'entrega', label: 'Entrega', caixa: 'bg-orange-500/15 border-orange-500/35', ponto: 'bg-orange-500' },
];
export const tipoDoItem = (t: TipoItem) => TIPOS.find(x => x.id === t) ?? TIPOS[0];

/** Item novo numa linha especial já nasce com o tipo dela (Externas → azul, Entregas → laranja). */
export const tipoPadraoDaLinha = (l: Pick<Linha, 'tipo'>): TipoItem =>
  l.tipo === 'externas' ? 'externa' : l.tipo === 'entregas' ? 'entrega' : 'edicao';

export const ROTULO_LINHA: Record<TipoLinha, string> = {
  pessoa: 'Pessoa', criacao: 'Criação', externas: 'Externas', entregas: 'Entregas',
};
export const nomeDaLinha = (l: Linha): string =>
  l.user?.full_name || l.nome || ROTULO_LINHA[l.tipo];

export const iso = (d: Date) => format(d, 'yyyy-MM-dd');
export const dataDeIso = (s: string) => new Date(`${s}T12:00:00`);
export const segundaDe = (d: Date) => startOfWeek(d, { weekStartsOn: 1 });

/** Os 7 dias da semana a partir da segunda. Sábado e domingo ficam estreitos e cinza. */
export const diasDaSemana = (inicio: Date) =>
  Array.from({ length: 7 }, (_, i) => {
    const d = addDays(inicio, i);
    return { data: d, iso: iso(d), fimDeSemana: i >= 5 };
  });

/** "26 – 30 Out" (segunda a sexta), como o nome das abas da planilha. */
export const rotuloDaSemana = (inicio: Date) => {
  const sex = addDays(inicio, 4);
  const mes = (d: Date) => format(d, 'MMM', { locale: ptBR }).replace('.', '');
  return inicio.getMonth() === sex.getMonth()
    ? `${format(inicio, 'dd')} – ${format(sex, 'dd')} ${mes(sex)}`
    : `${format(inicio, 'dd')} ${mes(inicio)} – ${format(sex, 'dd')} ${mes(sex)}`;
};
