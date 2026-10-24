/** Horários da diária. Fim menor que o início significa que a diária termina no dia seguinte (ex.: 20:00 → 04:00). */

const paraMin = (h?: string | null) => {
  if (!h) return null;
  const [a, b] = h.split(':').map(Number);
  return a * 60 + (b || 0);
};

/** Termina depois da meia-noite? (fim menor que o início) */
export const viraODia = (ini?: string | null, fim?: string | null) => {
  const i = paraMin(ini), f = paraMin(fim);
  return i != null && f != null && f < i;
};

/** Início e fim iguais não dizem nada (zero hora ou 24 h?), então não se aceita. */
export const horarioInvalido = (ini?: string | null, fim?: string | null) => {
  const i = paraMin(ini), f = paraMin(fim);
  return i != null && f != null && f === i;
};

/** Duração em horas (uma casa decimal), contando a virada do dia. Null se faltar início ou fim. */
export const duracaoDaDiaria = (ini?: string | null, fim?: string | null): number | null => {
  const i = paraMin(ini), f = paraMin(fim);
  if (i == null || f == null) return null;
  const m = f > i ? f - i : f + 1440 - i;
  return Math.round((m / 60) * 10) / 10;
};
