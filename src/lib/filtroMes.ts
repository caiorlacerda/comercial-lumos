import type { SelectOption } from '@/components/ui/Select';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** "2026-11" — o formato que o seletor de mês guarda e compara. */
export const FORMATO_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Mês ("AAAA-MM") de uma data vinda do banco, ou null se vazia/inválida.
 *
 * Data pura ("2026-11-01", coluna `date`) usa o próprio texto: passar por `new Date`
 * a lê como meia-noite UTC e, no Brasil, cairia no último dia do mês anterior.
 * Carimbo com hora (`timestamptz`) vale no fuso de quem está olhando.
 */
export function chaveMes(valor?: string | null): string | null {
  if (!valor) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor.slice(0, 7);
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-11" → "Nov/2026". */
export function rotuloMes(chave: string): string {
  const [ano, mes] = chave.split('-');
  return `${MESES[Number(mes) - 1] ?? mes}/${ano}`;
}

/**
 * Opções do seletor: "Todos os meses" + os meses que existem nos dados, do mais novo
 * para o mais antigo. O mês escolhido entra mesmo sem dados, para o filtro ativo
 * nunca ficar escondido (lista vazia sem explicação).
 */
export function opcoesDeMes(chaves: Iterable<string | null>, selecionado: string): SelectOption[] {
  const s = new Set<string>();
  for (const c of chaves) if (c) s.add(c);
  if (selecionado) s.add(selecionado);
  const meses = [...s].sort((a, b) => b.localeCompare(a));
  return [{ value: '', label: 'Todos os meses' }, ...meses.map(m => ({ value: m, label: rotuloMes(m) }))];
}
