import { supabase } from '@/lib/supabase';
import { type ReviewStatus, STATUS_TO_TASK } from '@/lib/reviewStatus';
import { notify } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';

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
 * A DECISÃO DO CLIENTE VALE PARA A RODADA ATUAL.
 *
 * `client_decision` guarda quem aprovou ou pediu ajustes e quando. Quando a equipe
 * mexe na etapa (reabre, devolve, envia de novo), essa decisão é de uma rodada que
 * já passou: se ficasse, o cliente abria o link e via "aprovado" num vídeo que ele
 * ainda precisa revisar. Toda mudança de etapa feita pelo app usa isto no UPDATE.
 */
export const LIMPA_DECISAO = { client_decision: null, client_decided_by: null, client_decided_at: null } as const;

/** O UPDATE padrão de uma mudança de etapa: novo status, hora e decisão anterior limpa. */
export const atualizacaoDeEtapa = (proximo: ReviewStatus) =>
  ({ status: proximo, updated_at: new Date().toISOString(), ...LIMPA_DECISAO });

/**
 * Garante o link do cliente do grupo do vídeo. Devolve true se criou.
 *
 * Consulta com limit(1) e não maybeSingle: com dois links ativos (já aconteceu) o
 * maybeSingle dá erro, "não achou", e o código criava um terceiro.
 */
export async function garantirLinkDoCliente(
  v: { id: string; group_id: string | null },
  quem?: string | null,
): Promise<boolean> {
  const grupo = v.group_id || v.id;
  const { data: existe } = await supabase.from('review_links')
    .select('id').eq('group_id', grupo).eq('active', true).limit(1);
  if (existe && existe.length) return false;
  const { error } = await supabase.from('review_links')
    .insert([{ video_version_id: v.id, group_id: grupo, created_by: quem ?? null }]);
  return !error;
}

/**
 * A equipe marcou na mão que o cliente aprovou (ou pediu ajustes), por e-mail ou
 * WhatsApp. Quando o cliente decide pelo link o banco avisa; aqui ninguém avisava.
 * Mesmos destinatários da decisão pelo link: admins, atendimento, responsável da
 * tarefa e colaboradores, menos quem fez a marcação.
 */
async function avisarDecisaoMarcadaNaMao(
  v: { id: string; task_id: string | null; project_id?: string | null; file_name?: string | null },
  aprovou: boolean,
  quem?: string | null,
) {
  try {
    const ids = new Set<string>();
    const { data: papeis } = await supabase.from('app_users')
      .select('id').eq('status', 'ativo').in('role', ['admin', 'atendimento']);
    (papeis ?? []).forEach((u: any) => ids.add(u.id));
    if (v.task_id) {
      const { data: t } = await supabase.from('project_tasks').select('responsavel_id').eq('id', v.task_id).maybeSingle();
      if ((t as any)?.responsavel_id) ids.add((t as any).responsavel_id);
      const { data: cs } = await supabase.from('task_collaborators').select('user_id').eq('task_id', v.task_id);
      (cs ?? []).forEach((c: any) => ids.add(c.user_id));
    }
    if (quem) ids.delete(quem);
    await notify({
      userIds: [...ids],
      event: aprovou ? NOTIFICATION_EVENTS.VIDEO_APROVADO_CLIENTE : NOTIFICATION_EVENTS.VIDEO_AJUSTES_CLIENTE,
      title: aprovou ? 'Cliente aprovou um vídeo 🎉' : 'Cliente pediu ajustes',
      body: `A equipe marcou que o cliente ${aprovou ? 'aprovou' : 'pediu ajustes em'} "${v.file_name || 'vídeo'}".`,
      link: v.project_id ? `/producao/projetos?projectId=${v.project_id}&tab=entregas` : '/producao',
      data: { video_version_id: v.id, project_id: v.project_id ?? null, decision: aprovou ? 'aprovado' : 'ajustes', manual: true },
      actorId: quem ?? null,
    });
  } catch { /* o aviso não pode desfazer a mudança de etapa já gravada */ }
}

/**
 * MOVER UM VÍDEO DE ETAPA — regra única.
 *
 * Mudar a etapa nunca é só mudar o status do vídeo: a tarefa vinculada
 * acompanha, a decisão da rodada anterior sai e a passagem pro cliente precisa do
 * link pronto. Essa regra vive aqui porque ela é chamada de três lugares (menu do
 * card, player aberto pelo painel e player aberto pela tarefa) — e três cópias
 * virariam três verdades na primeira vez que alguém mexesse numa delas. Foi
 * exatamente o tipo de divergência que custou caro no financeiro.
 *
 * Se `v.status` vier preenchido e for a etapa do cliente, marcar "aprovou" ou
 * "pediu ajustes" avisa o time (a decisão pelo link já avisa por conta própria).
 */
export async function moverEtapa(
  v: { id: string; group_id: string | null; task_id: string | null; status?: string; project_id?: string | null; file_name?: string | null },
  proximo: ReviewStatus,
  quem?: string | null,
): Promise<{ ok: boolean; erro?: string; criouLink?: boolean }> {
  const { error } = await supabase.from('video_versions')
    .update(atualizacaoDeEtapa(proximo))
    .eq('id', v.id);
  if (error) return { ok: false, erro: error.message };

  // A tarefa acompanha, mas pelo conjunto: com vários formatos, ela mostra o
  // mais atrasado. Sem isso, o cartão fica numa etapa e os vídeos em outra, e o
  // time passa a não confiar em nenhum dos dois.
  await sincronizarTarefa(v.task_id, proximo);

  // Passou pro cliente: o link já nasce aqui. Ninguém precisa lembrar de gerar,
  // e não existe link solto antes da hora.
  let criouLink = false;
  if (proximo === 'EM_REVISAO_CLIENTE') criouLink = await garantirLinkDoCliente(v, quem);

  if (v.status === 'EM_REVISAO_CLIENTE' && (proximo === 'APROVADO' || proximo === 'ALTERACOES_CLIENTE')) {
    void avisarDecisaoMarcadaNaMao(v, proximo === 'APROVADO', quem);
  }

  return { ok: true, criouLink };
}

/**
 * MOVER VÁRIOS VÍDEOS DE ETAPA DE UMA VEZ — a mesma regra de moverEtapa.
 *
 * Existia uma cópia disso dentro do painel de Entregas. Agora o painel e a página
 * Revisão de vídeos usam esta, pelo mesmo motivo da regra única acima: o vídeo
 * muda, a tarefa vinculada acompanha (pelo conjunto dos formatos), quem vai pro
 * cliente ganha o link, a decisão da rodada anterior sai e, se a equipe marcou na
 * mão que o cliente decidiu, o time é avisado.
 */
export async function moverEtapaEmLote(
  videos: { id: string; group_id: string | null; task_id: string | null; status?: string; project_id?: string | null; file_name?: string | null }[],
  proximo: ReviewStatus,
  quem?: string | null,
): Promise<{ ok: boolean; erro?: string }> {
  if (!videos.length) return { ok: true };
  const { error } = await supabase.from('video_versions')
    .update(atualizacaoDeEtapa(proximo))
    .in('id', videos.map(v => v.id));
  if (error) return { ok: false, erro: error.message };

  if (proximo === 'EM_REVISAO_CLIENTE') await Promise.all(videos.map(v => garantirLinkDoCliente(v, quem)));

  // Uma tarefa pode ter vários formatos: cada uma recalcula pelo conjunto, em vez
  // de todas receberem a etapa do lote.
  const taskIds = [...new Set(videos.map(v => v.task_id).filter(Boolean) as string[])];
  await Promise.all(taskIds.map(id => sincronizarTarefa(id, proximo)));

  if (proximo === 'APROVADO' || proximo === 'ALTERACOES_CLIENTE') {
    videos.filter(v => v.status === 'EM_REVISAO_CLIENTE')
      .forEach(v => { void avisarDecisaoMarcadaNaMao(v, proximo === 'APROVADO', quem); });
  }
  return { ok: true };
}

export const mensagemDaEtapa = (proximo: ReviewStatus, criouLink?: boolean) =>
  proximo === 'APROVADO'
    ? 'Aprovado! Gerando o vFINAL em 02_APROVADO…'
    : `Status atualizado ✓${criouLink ? ' Link do cliente criado.' : ''}`;
