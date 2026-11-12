import { addDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { type Item, type Linha, type TipoItem, dataDeIso, iso, normalizar } from '@/lib/cronograma';

/**
 * Itens que o cronograma mostra SOZINHOS, sem ninguém digitar (espelho ao vivo, nada é gravado):
 *  · linha Externas → as diárias (project_diarias) marcadas na semana
 *  · linha Entregas → as entregas ao cliente (data_entrega_cliente das tarefas) da semana
 *  · linha de PESSOA → as tarefas em aberto dela que vencem na semana (data_fim), no dia do prazo
 * São só leitura; para mudar, edita-se a diária/tarefa no projeto.
 */

export interface ItemAutomatico {
  id: string;
  linhaTipo: 'externas' | 'entregas' | 'pessoa';
  userId?: string | null;   // linha de pessoa: de quem é a tarefa
  taskId?: string;          // linha de pessoa: a tarefa (evita repetir o que já foi ligado/digitado à mão)
  titulo?: string;          // título da tarefa, para comparar com o texto digitado
  status?: string | null;   // etapa da tarefa
  dia: string;          // AAAA-MM-DD
  texto: string;
  tipo: TipoItem;
  projeto: string;      // nome do projeto (usado para não repetir o que já foi digitado à mão)
  link: string;
}

const nomeDoProjeto = (p: any): string => (Array.isArray(p) ? p[0]?.name : p?.name) || '';

export async function buscarAutomaticos(inicio: string): Promise<ItemAutomatico[]> {
  const fim = iso(addDays(dataDeIso(inicio), 6));
  const [diarias, entregas, prazos] = await Promise.all([
    supabase.from('project_diarias').select('id, nome, data, hora_inicio, project_id, projects(name)')
      .gte('data', inicio).lte('data', fim),
    supabase.from('project_tasks').select('id, titulo, data_entrega_cliente, project_id, projects(name)')
      .is('deleted_at', null).gte('data_entrega_cliente', inicio).lte('data_entrega_cliente', fim),
    supabase.from('project_tasks').select('id, titulo, status, data_fim, responsavel_id, project_id, projects(name)')
      .is('deleted_at', null).not('responsavel_id', 'is', null).not('status', 'in', '(concluido,entregue)')
      .gte('data_fim', inicio).lte('data_fim', fim),
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
  for (const t of (prazos.data as any[]) || []) {
    if (!t.data_fim || !t.responsavel_id) continue;
    const projeto = nomeDoProjeto(t.projects);
    lista.push({
      id: `prazo:${t.id}`, linhaTipo: 'pessoa', userId: t.responsavel_id, taskId: t.id, titulo: t.titulo, status: t.status,
      dia: String(t.data_fim).slice(0, 10), tipo: 'edicao', projeto, hora: '',
      texto: projeto ? `${t.titulo} · ${projeto}` : t.titulo,
      link: `/producao/projetos?projectId=${t.project_id}&taskId=${t.id}`,
    });
  }
  // Por horário (quem tem hora vem primeiro) e depois por nome, para a ordem não pular a cada atualização.
  return lista
    .sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99') || a.texto.localeCompare(b.texto, 'pt-BR'))
    .map(({ hora: _hora, ...resto }) => resto);
}

/** O título da tarefa sem o prefixo de ordem ("C- Escolha da pós" → "escolha da pos"), para achar o mesmo trabalho no texto digitado. */
const miolo = (titulo: string) => normalizar(titulo).replace(/^\s*[a-z0-9]{1,2}\s*[-–.)]\s*/, '').trim();

/**
 * Os automáticos de uma célula. Se alguém já digitou à mão o mesmo projeto naquele dia e linha
 * (como na planilha, que tinha "Shopee" escrito), o automático não repete. Na linha de pessoa, o prazo
 * de uma tarefa também não repete quando o item digitado já está ligado a ela ou cita o título dela.
 */
export function automaticosDaCelula(todos: ItemAutomatico[], linha: Pick<Linha, 'tipo' | 'user_id'>, dia: string, manuais: Pick<Item, 'texto' | 'task_id'>[]): ItemAutomatico[] {
  const textos = manuais.map(m => normalizar(m.texto));
  return todos.filter(a => {
    if (a.linhaTipo !== linha.tipo || a.dia !== dia) return false;
    if (a.linhaTipo === 'pessoa') {
      if (!linha.user_id || a.userId !== linha.user_id) return false;
      const m = miolo(a.titulo || '');
      return !manuais.some(x => x.task_id === a.taskId) && !(m.length >= 5 && textos.some(t => t.includes(m)));
    }
    return !(a.projeto && textos.some(t => t.includes(a.projeto.toLowerCase())));
  });
}
