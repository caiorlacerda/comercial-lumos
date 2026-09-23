-- BUG: vídeo aprovado sozinho ao ser vinculado a uma tarefa já concluída.
--
-- task_status_to_video() (espelho SQL de taskStatusToVideo em
-- src/lib/reviewStatus.ts) mapeava status de tarefa 'entregue'/'concluido'
-- direto para 'APROVADO' do vídeo. Uma mesma tarefa pode ter passado por uma
-- fase de roteiro (marcada concluída por um motivo que não tem nada a ver com
-- o vídeo) antes de qualquer vídeo existir — e quando o vídeo finalmente era
-- vinculado (ou a tarefa mudava de status com um vídeo já ligado), ele herdava
-- esse "concluído" como se fosse aprovação do vídeo, sem ninguém ter revisado
-- o vídeo em si.
--
-- Relatado pela equipe: "a Lulu está aprovando os vídeos automaticamente" /
-- Tawany identificou que acontecia ao linkar vídeo numa tarefa com roteiro já
-- aprovado.
--
-- Fix: 'entregue'/'concluido' caem no mesmo caminho padrão dos status sem
-- equivalente direto (na_fila, em_progresso, etc.) — o vídeo vai pra revisão
-- interna, nunca pulа pra aprovado sozinho. Aprovar um vídeo passa a ser
-- sempre uma decisão explícita sobre o vídeo (moverEtapa / review_decide).
CREATE OR REPLACE FUNCTION public.task_status_to_video(p_task_status text, p_current text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  fase_cliente boolean := p_current IN ('EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE');
BEGIN
  CASE p_task_status
    WHEN 'revisao_interna' THEN RETURN 'EM_REVISAO_INTERNA';
    WHEN 'revisao_cliente' THEN RETURN 'EM_REVISAO_CLIENTE';
    WHEN 'aprov_interna'   THEN RETURN 'EM_REVISAO_CLIENTE';
    WHEN 'alteracoes'      THEN RETURN CASE WHEN fase_cliente THEN 'ALTERACOES_CLIENTE' ELSE 'ALTERACOES_INTERNAS' END;
    ELSE
      -- na_fila, em_progresso, pausado, aguard_*, entregue, concluido: o vídeo
      -- está em revisão interna. 'entregue'/'concluido' entram aqui de
      -- propósito (ver comentário acima). Não puxa de volta um vídeo que já
      -- foi pro cliente ou aprovado.
      RETURN CASE WHEN fase_cliente OR p_current = 'APROVADO' THEN NULL ELSE 'EM_REVISAO_INTERNA' END;
  END CASE;
END; $$;
