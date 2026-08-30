import { supabase } from '@/lib/supabase';
import { type ReviewStatus, STATUS_TO_TASK } from '@/lib/reviewStatus';

/**
 * A TAREFA SEGUE O CONJUNTO DOS FORMATOS DELA.
 *
 * Uma tarefa costuma ter 16:9, 9:16 e 1:1, e eles andam em ritmos diferentes:
 * o 16:9 aprovado enquanto o 1:1 voltou com ajuste. Antes, qualquer vídeo que
 * se movia carimbava a tarefa inteira — o último a se mexer ganhava, e a tarefa
 * passava a mentir sobre os outros dois.
 *
 * Agora a tarefa mostra a etapa do formato MAIS ATRASADO: ainda há trabalho
 * enquanto o último não fechar. A conta vive no banco (sincronizar_status_tarefa),
 * porque a página do cliente também move vídeo e duas cópias da mesma regra
 * viram duas regras diferentes na primeira mudança.
 */
export async function sincronizarTarefa(taskId: string | null, fallback?: ReviewStatus) {
  if (!taskId) return;
  const { error } = await supabase.rpc('sincronizar_status_tarefa', { p_task_id: taskId });
  // Banco sem a função (migration não rodada): mantém o comportamento antigo,
  // pra ninguém ficar com o cartão parado numa etapa que já passou.
  if (error && fallback) {
    await supabase.from('project_tasks').update({ status: STATUS_TO_TASK[fallback] }).eq('id', taskId);
  }
}

/**
 * MOVER UM VÍDEO DE ETAPA — regra única.
 *
 * Mudar a etapa nunca é só mudar o status do vídeo: a tarefa vinculada
 * acompanha, e a passagem pro cliente precisa do link pronto. Essa regra vive
 * aqui porque ela é chamada de três lugares (menu do card, player aberto pelo
 * painel e player aberto pela tarefa) — e três cópias virariam três verdades na
 * primeira vez que alguém mexesse numa delas. Foi exatamente o tipo de
 * divergência que custou caro no financeiro.
 */
export async function moverEtapa(
  v: { id: string; group_id: string | null; task_id: string | null },
  proximo: ReviewStatus,
  quem?: string | null,
): Promise<{ ok: boolean; erro?: string; criouLink?: boolean }> {
  const { error } = await supabase.from('video_versions')
    .update({ status: proximo, updated_at: new Date().toISOString() })
    .eq('id', v.id);
  if (error) return { ok: false, erro: error.message };

  // A tarefa acompanha, mas pelo conjunto: com vários formatos, ela mostra o
  // mais atrasado. Sem isso, o cartão fica numa etapa e os vídeos em outra, e o
  // time passa a não confiar em nenhum dos dois.
  await sincronizarTarefa(v.task_id, proximo);

  // Passou pro cliente: o link já nasce aqui. Ninguém precisa lembrar de gerar,
  // e não existe link solto antes da hora.
  let criouLink = false;
  if (proximo === 'EM_REVISAO_CLIENTE') {
    const grupo = v.group_id || v.id;
    const { data: existe } = await supabase.from('review_links')
      .select('id').eq('group_id', grupo).eq('active', true).maybeSingle();
    if (!existe) {
      const { error: eLink } = await supabase.from('review_links')
        .insert([{ video_version_id: v.id, group_id: grupo, created_by: quem ?? null }]);
      criouLink = !eLink;
    }
  }

  return { ok: true, criouLink };
}

export const mensagemDaEtapa = (proximo: ReviewStatus, criouLink?: boolean) =>
  proximo === 'APROVADO'
    ? 'Aprovado! Gerando o vFINAL em 02_APROVADO…'
    : `Status atualizado ✓${criouLink ? ' Link do cliente criado.' : ''}`;
