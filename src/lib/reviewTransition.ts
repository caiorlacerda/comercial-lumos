import { supabase } from '@/lib/supabase';
import { type ReviewStatus, STATUS_TO_TASK } from '@/lib/reviewStatus';

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

  // A tarefa segue o vídeo. Sem isso, o cartão fica numa etapa e o vídeo em
  // outra, e o time passa a confiar em nenhum dos dois.
  if (v.task_id) {
    await supabase.from('project_tasks').update({ status: STATUS_TO_TASK[proximo] }).eq('id', v.task_id);
  }

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
