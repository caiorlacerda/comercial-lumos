// Datas SEM hora (colunas `date` do banco, como o vencimento). Chegam como 'YYYY-MM-DD'.
// `new Date('2026-10-21')` é meia-noite UTC, que no Brasil é o dia anterior (20/10): por isso
// nunca se formata nem se compara uma data sem hora passando por `new Date(texto)` direto.

/** 'YYYY-MM-DD' → '21/10/2026', sem virar o dia (lê a data ao meio-dia). */
export const dataBR = (iso: string) => new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR');

/** Hoje no fuso do navegador, como 'YYYY-MM-DD'. `toISOString()` usa UTC e, depois das 21h no Brasil, já devolve o dia seguinte. */
export const hojeLocalISO = () => new Date().toLocaleDateString('en-CA');

/** A data sem hora já passou (é anterior a hoje)? Uma conta que vence hoje ainda NÃO está vencida. */
export const jaPassou = (iso: string) => String(iso).slice(0, 10) < hojeLocalISO();
