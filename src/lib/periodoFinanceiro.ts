/**
 * A que período um projeto pertence nas telas do Financeiro (Dashboard, Relatórios).
 *
 * Regra única, para cada projeto cair em UM só mês (a soma dos meses fecha com o total do ano):
 *   1. a data em que o dinheiro entrou (`data_recebido`), se já recebeu;
 *   2. senão, o vencimento previsto (`data_recebimento_negociada`);
 *   3. senão, a data de criação do registro.
 *
 * Antes, o projeto entrava no período se o vencimento OU a criação caíssem nele: o mesmo projeto aparecia em
 * dois períodos e o recebimento de um mês aparecia no mês do vencimento.
 */
export interface ProjetoComDatas {
  data_recebido?: string | null;
  data_recebimento_negociada?: string | null;
  created_at?: string | null;
}

/** Normaliza para 'YYYY-MM-DD'. Data pura (sem hora) é usada como está; timestamp vira data local. */
function paraDia(valor: string): string {
  if (valor.length === 10) return valor;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? valor.slice(0, 10) : d.toLocaleDateString('en-CA');
}

/** 'YYYY-MM-DD' da data que posiciona o projeto no tempo, ou null se não houver nenhuma. */
export function dataDoProjeto(p: ProjetoComDatas): string | null {
  const bruta = p.data_recebido || p.data_recebimento_negociada || p.created_at;
  return bruta ? paraDia(String(bruta)) : null;
}

/** O projeto cai em [inicio, fimExclusivo)? Datas 'YYYY-MM-DD'. */
export function projetoNoPeriodo(p: ProjetoComDatas, inicio: string, fimExclusivo: string): boolean {
  const dia = dataDoProjeto(p);
  return dia != null && dia >= inicio && dia < fimExclusivo;
}
