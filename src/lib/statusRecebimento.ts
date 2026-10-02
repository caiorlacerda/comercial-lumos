/**
 * Nomes dos estágios de um título (nota fiscal + pagamento), iguais em Custos
 * de Projeto e em Contas a Receber.
 *
 * As duas tabelas guardam o mesmo ciclo com valores diferentes e o banco as
 * mantém em sincronia (supabase/migrations/2026100200_verdade_unica_recebimento.sql):
 *
 *   etapa  projetos_financeiro.status_titulo   receivables.status
 *     1    emitir_nf                           aguardando
 *     2    pedido_nf_feito                     emitir_nf
 *     3    esperando_pagamento                 nf_emitida
 *     4    pagamento_recebido                  recebido
 *
 * "Em atraso" não é uma etapa: é derivado da data (não recebeu e o vencimento
 * passou). Mudou o texto aqui, mudou nas duas telas.
 */
export const ETAPAS_RECEBIMENTO = {
  1: 'Emitir NF',
  2: 'NF pedida',
  3: 'NF emitida',
  4: 'Recebido',
} as const;

export const LABEL_ATRASO = 'Em atraso';

/** projetos_financeiro.status_titulo */
export const TITULO_LABEL: Record<string, string> = {
  emitir_nf: ETAPAS_RECEBIMENTO[1],
  pedido_nf_feito: ETAPAS_RECEBIMENTO[2],
  esperando_pagamento: ETAPAS_RECEBIMENTO[3],
  pagamento_atraso: LABEL_ATRASO,
  pagamento_recebido: ETAPAS_RECEBIMENTO[4],
};

/** receivables.status */
export const RECEBIVEL_LABEL: Record<string, string> = {
  aguardando: ETAPAS_RECEBIMENTO[1],
  emitir_nf: ETAPAS_RECEBIMENTO[2],
  nf_emitida: ETAPAS_RECEBIMENTO[3],
  recebido: ETAPAS_RECEBIMENTO[4],
  parcial: 'Parcial',
  inadimplente: LABEL_ATRASO,
  atrasado: LABEL_ATRASO,
  cancelado: 'Cancelado',
};

/**
 * Data que a coluna "Recebimento" mostra nas duas telas: a data em que o
 * dinheiro entrou, quando já entrou; senão o vencimento previsto.
 */
export function dataRecebimentoExibida(recebido: boolean, dataRecebido?: string | null, vencimento?: string | null): string | null {
  return (recebido && dataRecebido ? dataRecebido : vencimento) || null;
}
