import { addDays, format, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * CRONOGRAMA DA EQUIPE — tipos e regras compartilhadas.
 * Substitui a planilha "LUMOS | Cronograma da equipe": uma semana por registro, linhas = pessoas
 * (ou nome livre) e linhas especiais, e em cada célula (linha × dia) uma lista de itens com tipo.
 */

export type TipoItemFixo = 'edicao' | 'gravacao' | 'externa' | 'entrega';
/** Cores livres: só marcam o item, não significam nada (nem entram em automação). */
export type CorLivre = 'roxo' | 'rosa' | 'vermelho' | 'amarelo' | 'turquesa' | 'cinza';
export type TipoItem = TipoItemFixo | CorLivre;
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
  task?: { id: string; titulo: string; status?: string | null } | null;
}

/** Projeto (e, se houver, a tarefa) ao qual um item é ligado. */
export interface Vinculo {
  project: { id: string; name: string };
  task: { id: string; titulo: string; status?: string | null } | null;
}

/** Para onde o clique no vínculo leva: a tarefa exata (se houver) ou o projeto. */
export const linkDoItem = (i: Pick<Item, 'project_id' | 'task_id'>): string | null =>
  i.project_id ? `/producao/projetos?projectId=${i.project_id}${i.task_id ? `&taskId=${i.task_id}` : ''}` : null;

/** Uma tarefa em aberto da plataforma, no formato leve que o cronograma usa para ligar e sugerir. */
export interface TarefaCatalogo {
  id: string;
  titulo: string;
  status: string;
  project_id: string;
  projeto: string;
  responsavel_id: string | null;
}

export const vinculoDeTarefa = (t: TarefaCatalogo): Vinculo => ({
  project: { id: t.project_id, name: t.projeto },
  task: { id: t.id, titulo: t.titulo, status: t.status },
});

/** Minúsculas e sem acento, para comparar texto digitado com título de tarefa. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Tarefas que combinam com o que a pessoa está digitando: todas as palavras (3+ letras) precisam aparecer no
 * "projeto + título". As tarefas da própria pessoa da linha vêm primeiro.
 */
export function sugerirTarefas(texto: string, catalogo: TarefaCatalogo[], userId?: string | null, max = 5): TarefaCatalogo[] {
  const palavras = normalizar(texto).split(/[^a-z0-9]+/).filter(p => p.length >= 3);
  if (!palavras.length) return [];
  return catalogo
    .filter(t => { const h = normalizar(`${t.projeto} ${t.titulo}`); return palavras.every(p => h.includes(p)); })
    .sort((a, b) => Number(b.responsavel_id === userId && !!userId) - Number(a.responsavel_id === userId && !!userId) || a.titulo.length - b.titulo.length)
    .slice(0, max);
}

/** Colunas lidas de cada item, com o nome do projeto e da tarefa vinculados. */
export const SELECT_ITEM = 'id, linha_id, dia, ordem, texto, tipo, task_id, project_id, project:projects(id, name), task:project_tasks(id, titulo, status)';

/** As cores da legenda da planilha: sem cor, verde, azul e laranja. */
export const TIPOS: { id: TipoItemFixo; label: string; caixa: string; ponto: string }[] = [
  { id: 'edicao', label: 'Edição', caixa: 'bg-lumos-surface border-lumos-border', ponto: 'bg-lumos-text-secondary/40' },
  { id: 'gravacao', label: 'Gravação ou Meeting', caixa: 'bg-green-500/15 border-green-500/35', ponto: 'bg-green-500' },
  { id: 'externa', label: 'Externa', caixa: 'bg-sky-500/15 border-sky-500/35', ponto: 'bg-sky-500' },
  { id: 'entrega', label: 'Entrega', caixa: 'bg-orange-500/15 border-orange-500/35', ponto: 'bg-orange-500' },
];

/** Mais cores para marcar itens à vontade (além das 4 da legenda). As classes ficam escritas por extenso para o Tailwind enxergá-las. */
export const CORES_LIVRES: { id: CorLivre; label: string; caixa: string; ponto: string }[] = [
  { id: 'roxo', label: 'Roxo', caixa: 'bg-purple-500/15 border-purple-500/35', ponto: 'bg-purple-500' },
  { id: 'rosa', label: 'Rosa', caixa: 'bg-pink-500/15 border-pink-500/35', ponto: 'bg-pink-500' },
  { id: 'vermelho', label: 'Vermelho', caixa: 'bg-red-500/15 border-red-500/35', ponto: 'bg-red-500' },
  { id: 'amarelo', label: 'Amarelo', caixa: 'bg-yellow-400/20 border-yellow-500/40', ponto: 'bg-yellow-400' },
  { id: 'turquesa', label: 'Turquesa', caixa: 'bg-teal-500/15 border-teal-500/35', ponto: 'bg-teal-500' },
  { id: 'cinza', label: 'Cinza', caixa: 'bg-slate-500/20 border-slate-500/40', ponto: 'bg-slate-500' },
];
export const tipoDoItem = (t: TipoItem) => TIPOS.find(x => x.id === t) ?? CORES_LIVRES.find(x => x.id === t) ?? TIPOS[0];

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
