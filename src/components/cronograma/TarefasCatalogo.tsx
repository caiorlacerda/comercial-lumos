import { createContext, useContext } from 'react';
import { supabase } from '@/lib/supabase';
import type { TarefaCatalogo } from '@/lib/cronograma';

/**
 * As tarefas em aberto da plataforma, carregadas uma vez pela página do cronograma e lidas por quem precisa
 * (a busca "Vincular a tarefa" e a sugestão enquanto se digita um item).
 */
export const TarefasCatalogoContext = createContext<TarefaCatalogo[]>([]);
export const useTarefasCatalogo = () => useContext(TarefasCatalogoContext);

const nomeDoProjeto = (p: any): string => (Array.isArray(p) ? p[0]?.name : p?.name) || '';
const paraCatalogo = (rows: any[]): TarefaCatalogo[] => rows.map(t => ({
  id: t.id, titulo: t.titulo || '(sem título)', status: t.status, project_id: t.project_id,
  projeto: nomeDoProjeto(t.projects), responsavel_id: t.responsavel_id ?? null,
}));
const COLUNAS = 'id, titulo, status, project_id, responsavel_id, projects(name)';

/** Tarefas em aberto (tudo que não está aprovado/entregue), fora as da lixeira. */
export async function carregarTarefasAbertas(): Promise<TarefaCatalogo[]> {
  const { data } = await supabase.from('project_tasks').select(COLUNAS)
    .is('deleted_at', null).not('status', 'in', '(concluido,entregue)').order('created_at', { ascending: false }).limit(1000);
  return paraCatalogo((data as any[]) || []);
}

/** As aprovadas mais recentes, só para quando alguém pede para incluí-las na busca. */
export async function carregarTarefasConcluidas(): Promise<TarefaCatalogo[]> {
  const { data } = await supabase.from('project_tasks').select(COLUNAS)
    .is('deleted_at', null).in('status', ['concluido', 'entregue']).order('updated_at', { ascending: false }).limit(300);
  return paraCatalogo((data as any[]) || []);
}
