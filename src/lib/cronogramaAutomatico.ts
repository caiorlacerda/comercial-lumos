import { addDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { type TipoItem, dataDeIso, iso } from '@/lib/cronograma';

/**
 * Itens que o cronograma mostra SOZINHOS, sem ninguém digitar (espelho ao vivo, nada é gravado):
 *  · linha Externas → as diárias (project_diarias) marcadas na semana
 *  · linha Entregas → as entregas ao cliente (data_entrega_cliente das tarefas) da semana
 * São só leitura; para mudar, edita-se a diária/tarefa no projeto.
 */

export interface ItemAutomatico {
  id: string;
  linhaTipo: 'externas' | 'entregas';
  dia: string;          // AAAA-MM-DD
  texto: string;
  tipo: TipoItem;
  projeto: string;      // nome do projeto (usado para não repetir o que já foi digitado à mão)
  link: string;
}

const nomeDoProjeto = (p: any): string => (Array.isArray(p) ? p[0]?.name : p?.name) || '';

export async function buscarAutomaticos(inicio: string): Promise<ItemAutomatico[]> {
  const fim = iso(addDays(dataDeIso(inicio), 6));
  const [diarias, entregas] = await Promise.all([
    supabase.from('project_diarias').select('id, nome, data, hora_inicio, project_id, projects(name)')
      .gte('data', inicio).lte('data', fim),
    supabase.from('project_tasks').select('id, titulo, data_entrega_cliente, project_id, projects(name)')
      .is('deleted_at', null).gte('data_entrega_cliente', inicio).lte('data_entrega_cliente', fim),
  ]);

  const lista: (ItemAutomatico & { hora: string })[] = [];
  for (const d of (diarias.data as any[]) || []) {
    if (!d.data) continue;
    const projeto = nomeDoProjeto(d.projects);
    const hora = d.hora_inicio ? String(d.hora_inicio).slice(0, 5) : '';
    const nome = (d.nome || '').trim();
    lista.push({
      id: `diaria:${d.id}`, linhaTipo: 'externas', dia: String(d.data).slice(0, 10), tipo: 'externa', projeto, hora,
      texto: [hora, projeto, nome && nome !== projeto ? `· ${nome}` : ''].filter(Boolean).join(' '),
      link: `/producao/projetos?projectId=${d.project_id}&tab=diarias`,
    });
  }
  for (const t of (entregas.data as any[]) || []) {
    if (!t.data_entrega_cliente) continue;
    const projeto = nomeDoProjeto(t.projects);
    lista.push({
      id: `entrega:${t.id}`, linhaTipo: 'entregas', dia: String(t.data_entrega_cliente).slice(0, 10), tipo: 'entrega', projeto, hora: '',
      texto: projeto ? `${projeto} · ${t.titulo}` : t.titulo,
      link: `/producao/projetos?projectId=${t.project_id}&taskId=${t.id}`,
    });
  }
  // Por horário (quem tem hora vem primeiro) e depois por nome, para a ordem não pular a cada atualização.
  return lista
    .sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99') || a.texto.localeCompare(b.texto, 'pt-BR'))
    .map(({ hora: _hora, ...resto }) => resto);
}

/**
 * Os automáticos de uma célula. Se alguém já digitou à mão o mesmo projeto naquele dia e linha
 * (como na planilha, que tinha "Shopee" escrito), o automático não repete.
 */
export function automaticosDaCelula(todos: ItemAutomatico[], linhaTipo: string, dia: string, textosManuais: string[]): ItemAutomatico[] {
  const manuais = textosManuais.map(t => t.toLowerCase());
  return todos.filter(a => a.linhaTipo === linhaTipo && a.dia === dia
    && !(a.projeto && manuais.some(m => m.includes(a.projeto.toLowerCase()))));
}
