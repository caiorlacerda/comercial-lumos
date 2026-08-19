/**
 * PRESETS DE PERÍODO do Financeiro, no modelo do benchmark: Hoje, Esta
 * semana, Este mês, Mês passado, Este semestre, Este ano, Últimos 30 dias,
 * Últimos 12 meses, Todo o período, e um intervalo personalizado.
 */

export type PeriodoPreset =
  | 'hoje' | 'esta_semana' | 'este_mes' | 'mes_passado' | 'este_semestre'
  | 'este_ano' | 'ultimos_30' | 'ultimos_12m' | 'todo' | 'personalizado';

export const PERIODO_LABELS: Record<PeriodoPreset, string> = {
  hoje: 'Hoje',
  esta_semana: 'Esta semana',
  este_mes: 'Este mês',
  mes_passado: 'Mês passado',
  este_semestre: 'Este semestre',
  este_ano: 'Este ano',
  ultimos_30: 'Últimos 30 dias',
  ultimos_12m: 'Últimos 12 meses',
  todo: 'Todo o período',
  personalizado: 'Personalizado',
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Intervalo [inicio, fim] em AAAA-MM-DD, inclusivo. null = sem limite. */
export function intervaloDoPreset(preset: PeriodoPreset): { inicio: string | null; fim: string | null } {
  const hoje = new Date();
  const y = hoje.getFullYear(), m = hoje.getMonth();
  switch (preset) {
    case 'hoje':
      return { inicio: iso(hoje), fim: iso(hoje) };
    case 'esta_semana': {
      // segunda a domingo da semana corrente
      const seg = new Date(hoje);
      seg.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7));
      const dom = new Date(seg);
      dom.setDate(seg.getDate() + 6);
      return { inicio: iso(seg), fim: iso(dom) };
    }
    case 'este_mes':
      return { inicio: iso(new Date(y, m, 1)), fim: iso(new Date(y, m + 1, 0)) };
    case 'mes_passado':
      return { inicio: iso(new Date(y, m - 1, 1)), fim: iso(new Date(y, m, 0)) };
    case 'este_semestre': {
      const inicioMes = m < 6 ? 0 : 6;
      return { inicio: iso(new Date(y, inicioMes, 1)), fim: iso(new Date(y, inicioMes + 6, 0)) };
    }
    case 'este_ano':
      return { inicio: `${y}-01-01`, fim: `${y}-12-31` };
    case 'ultimos_30': {
      const d = new Date(hoje);
      d.setDate(d.getDate() - 29);
      return { inicio: iso(d), fim: iso(hoje) };
    }
    case 'ultimos_12m': {
      const d = new Date(y, m - 11, 1);
      return { inicio: iso(d), fim: iso(hoje) };
    }
    case 'todo':
    case 'personalizado':
    default:
      return { inicio: null, fim: null };
  }
}
