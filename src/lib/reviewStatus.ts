// Status da revisão de vídeo e a relação com o status da tarefa.
//
// Regra do time: a TAREFA é a fonte da verdade. Ao vincular um vídeo a uma tarefa,
// o VÍDEO passa a seguir o status da tarefa (e não o contrário).

export type ReviewStatus =
  | 'EM_REVISAO_INTERNA'
  | 'ALTERACOES_INTERNAS'
  | 'EM_REVISAO_CLIENTE'
  | 'ALTERACOES_CLIENTE'
  | 'APROVADO';

export const STATUS_UI: Record<ReviewStatus, { label: string; color: string }> = {
  EM_REVISAO_INTERNA: { label: 'Revisão interna', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  ALTERACOES_INTERNAS: { label: 'Alterações (interno)', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  EM_REVISAO_CLIENTE: { label: 'Revisão do cliente', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  ALTERACOES_CLIENTE: { label: 'Alterações (cliente)', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  APROVADO: { label: 'Aprovado', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
};

// Vídeo → tarefa (usado quando o status do vídeo muda no painel de revisão).
export const STATUS_TO_TASK: Record<ReviewStatus, string> = {
  EM_REVISAO_INTERNA: 'revisao_interna', ALTERACOES_INTERNAS: 'alteracoes',
  EM_REVISAO_CLIENTE: 'revisao_cliente', ALTERACOES_CLIENTE: 'alteracoes', APROVADO: 'concluido',
};

/**
 * Tarefa → vídeo. Usado ao VINCULAR: o vídeo passa a seguir a tarefa.
 *
 * Dois status de tarefa são ambíguos e precisam do estado atual do vídeo para
 * desempatar, porque o mapa vídeo→tarefa é de mão única:
 *   • 'alteracoes' pode ser alteração INTERNA ou DO CLIENTE
 *   • os status iniciais (iniciar, em_progresso…) não têm equivalente: o vídeo
 *     ainda está em revisão interna, que é onde ele nasce.
 *
 * Retorna null quando não há motivo para mexer no vídeo.
 */
export function taskStatusToVideo(taskStatus: string, current: ReviewStatus): ReviewStatus | null {
  const naFaseDoCliente = current === 'EM_REVISAO_CLIENTE' || current === 'ALTERACOES_CLIENTE';

  switch (taskStatus) {
    case 'revisao_interna':
      return 'EM_REVISAO_INTERNA';
    case 'revisao_cliente':
      return 'EM_REVISAO_CLIENTE';
    case 'alteracoes':
      // Mantém a fase em que o vídeo já está (não joga um vídeo do cliente para o interno).
      return naFaseDoCliente ? 'ALTERACOES_CLIENTE' : 'ALTERACOES_INTERNAS';
    case 'entregue':
    case 'concluido':
      return 'APROVADO';
    case 'aprov_interna':
      // Aprovado internamente = pronto para o cliente ver.
      return 'EM_REVISAO_CLIENTE';
    default:
      // iniciar, pausado, na_fila, em_progresso, aguard_* : o vídeo ainda está em
      // revisão interna. Só puxamos para lá se ele ainda não passou para o cliente,
      // para não desfazer um envio que já aconteceu.
      return naFaseDoCliente || current === 'APROVADO' ? null : 'EM_REVISAO_INTERNA';
  }
}
