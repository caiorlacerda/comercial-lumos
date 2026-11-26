/**
 * ORDEM DAS TAREFAS (coluna project_tasks.ordem). A lista do projeto mostra as tarefas por
 * etapa e, dentro da etapa, por essa ordem. A ordem é do projeto: todo mundo vê a mesma.
 */

export interface TarefaOrdenavel { id: string; ordem: number | null; created_at?: string | null }

/** Número repetido acontece (tarefas antigas, criadas sem ordem): desempata sempre do mesmo jeito. */
export const compararOrdem = (a: TarefaOrdenavel, b: TarefaOrdenavel) =>
  (a.ordem ?? 0) - (b.ordem ?? 0)
  || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  || a.id.localeCompare(b.id);

export const ordenarTarefas = <T extends TarefaOrdenavel>(lista: T[]): T[] => [...lista].sort(compararOrdem);

export type Direcao = 'subir' | 'descer';

const PASSO = 10;

/**
 * O que gravar para a tarefa subir ou descer uma posição.
 *  - `etapa`: TODAS as tarefas da mesma etapa (inclusive as escondidas por busca ou filtro);
 *  - `visiveis`: ids na ordem em que aparecem na tela. "Subir" passa na frente da vizinha que se vê.
 * Normalmente grava só a tarefa movida (um número livre entre as vizinhas). Sem número livre
 * (repetidos ou seguidos), renumera a etapa e grava só o que mudou. Vazio = não há para onde ir.
 */
export function planejarMovimento(
  etapa: TarefaOrdenavel[], visiveis: string[], id: string, direcao: Direcao,
): { id: string; ordem: number }[] {
  const i = visiveis.indexOf(id);
  const vizinha = i < 0 ? undefined : visiveis[direcao === 'subir' ? i - 1 : i + 1];
  const todas = ordenarTarefas(etapa);
  const movida = todas.find(t => t.id === id);
  if (!vizinha || !movida) return [];

  const resto = todas.filter(t => t.id !== id);
  const iVizinha = resto.findIndex(t => t.id === vizinha);
  if (iVizinha < 0) return [];
  const pos = direcao === 'subir' ? iVizinha : iVizinha + 1;
  const antes = resto[pos - 1];
  const depois = resto[pos];

  let livre: number | null = null;
  if (!antes) livre = (depois.ordem ?? 0) - PASSO;
  else if (!depois) livre = (antes.ordem ?? 0) + PASSO;
  else {
    const folga = (depois.ordem ?? 0) - (antes.ordem ?? 0);
    if (folga >= 2) livre = (antes.ordem ?? 0) + Math.floor(folga / 2);
  }
  if (livre !== null) return [{ id, ordem: livre }];

  const novaSequencia = [...resto.slice(0, pos), movida, ...resto.slice(pos)];
  const base = todas[0].ordem ?? 0;
  return novaSequencia
    .map((t, k) => ({ id: t.id, ordem: base + k * PASSO, antiga: t.ordem }))
    .filter(t => t.ordem !== t.antiga)
    .map(({ id: tid, ordem }) => ({ id: tid, ordem }));
}
