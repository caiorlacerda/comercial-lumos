import type { ComponentType } from 'react';

/** Um compromisso no calendário (diária, OD, prazo de tarefa...). A tela que usa o calendário monta a lista. */
export interface EventoCal {
  id: string;
  titulo: string;
  /** Dia em que começa, AAAA-MM-DD. */
  data: string;
  /** HH:MM. Sem hora, o evento fica na faixa "dia todo" da semana/dia. */
  hora?: string | null;
  /** HH:MM. Fim menor que o início = termina no dia seguinte. */
  horaFim?: string | null;
  /** Duração (min) quando só há início. Padrão 60. */
  duracaoPadraoMin?: number;
  /** Cor do evento (hex): faixa lateral e véu do fundo. */
  cor: string;
  Icon?: ComponentType<{ className?: string }>;
  /** Linha secundária: projeto, local... */
  subtitulo?: string | null;
  /** Linhas do cartão que abre ao passar o mouse. */
  detalhes?: string[];
  /** Tipo da tarefa (Edição, Motion...), mostrado como pílula pequena junto do título. */
  tipo?: { nome: string; cor: string } | null;
  /** Selo curto: "Atrasado", "Feita"... */
  selo?: string | null;
  atrasado?: boolean;
  /** Já passou: aparece esmaecido. */
  passado?: boolean;
}

export type Granularidade = 'mes' | 'semana' | 'dia';

export const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const DIAS_LONGOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const p2 = (n: number) => String(n).padStart(2, '0');
export const isoDe = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const hojeIso = () => isoDe(new Date());
export const dataDeIso = (iso: string) => new Date(iso + 'T12:00:00');
export const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const domingoDe = (d: Date) => addDias(d, -d.getDay());

export const minDe = (h?: string | null) => {
  if (!h) return null;
  const [a, b] = h.split(':').map(Number);
  return a * 60 + (b || 0);
};
export const hhmm = (m: number) => `${p2(Math.floor(m / 60) % 24)}:${p2(m % 60)}`;

/** Dias que a janela mostra: o mês inteiro (completando as semanas), a semana ou o dia. */
export function diasDaJanela(cursor: Date, gran: Granularidade): Date[] {
  if (gran === 'dia') return [new Date(cursor)];
  let ini: Date, fim: Date;
  if (gran === 'semana') {
    ini = domingoDe(cursor);
    fim = addDias(ini, 6);
  } else {
    const primeiro = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const ultimo = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    ini = domingoDe(primeiro);
    fim = addDias(domingoDe(ultimo), 6);
  }
  const dias: Date[] = [];
  for (let d = new Date(ini); d <= fim; d = addDias(d, 1)) dias.push(new Date(d));
  return dias;
}

export function tituloDaJanela(cursor: Date, gran: Granularidade): string {
  if (gran === 'mes') return `${MESES_LONGOS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  if (gran === 'dia') return `${DIAS_LONGOS[cursor.getDay()]}, ${cursor.getDate()} de ${MESES_CURTOS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  const ini = domingoDe(cursor);
  const fim = addDias(ini, 6);
  return `${ini.getDate()} ${MESES_CURTOS[ini.getMonth()]} — ${fim.getDate()} ${MESES_CURTOS[fim.getMonth()]} ${fim.getFullYear()}`;
}

export function navegarJanela(cursor: Date, gran: Granularidade, dir: -1 | 1): Date {
  if (gran === 'dia') return addDias(cursor, dir);
  if (gran === 'semana') return addDias(cursor, dir * 7);
  return new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
}

/** Pedaço de um evento dentro de UM dia (a diária que vira a madrugada tem dois pedaços). */
export interface Trecho {
  evento: EventoCal;
  dia: string;           // AAAA-MM-DD
  ini: number;           // minutos desde 00:00
  fim: number;           // minutos (até 1440)
  continuacao: boolean;  // segundo pedaço, no dia seguinte
  continua: boolean;     // primeiro pedaço, segue no dia seguinte
}

/** Quebra o evento em trechos por dia. Sem hora, devolve [] (vai pra faixa "dia todo"). */
export function trechosDoEvento(e: EventoCal): Trecho[] {
  const ini = minDe(e.hora);
  if (ini == null) return [];
  const fimBruto = minDe(e.horaFim);
  const duracao = e.duracaoPadraoMin ?? 60;
  const fimAbs = fimBruto == null ? ini + duracao : (fimBruto > ini ? fimBruto : fimBruto + 1440);
  if (fimAbs <= 1440) return [{ evento: e, dia: e.data, ini, fim: fimAbs, continuacao: false, continua: false }];
  const prox = isoDe(addDias(dataDeIso(e.data), 1));
  return [
    { evento: e, dia: e.data, ini, fim: 1440, continuacao: false, continua: true },
    { evento: e, dia: prox, ini: 0, fim: Math.min(fimAbs - 1440, 1440), continuacao: true, continua: false },
  ];
}

/** Coloca trechos que se sobrepõem lado a lado: devolve, por trecho, a coluna e o total de colunas do grupo. */
export function empilhar(trechos: Trecho[]): { t: Trecho; col: number; cols: number }[] {
  const ord = [...trechos].sort((a, b) => a.ini - b.ini || b.fim - a.fim);
  const saida: { t: Trecho; col: number; cols: number }[] = [];
  let grupo: { t: Trecho; col: number; cols: number }[] = [];
  let fimGrupo = -1;
  const fechar = () => { const n = Math.max(1, ...grupo.map(g => g.col + 1)); grupo.forEach(g => { g.cols = n; saida.push(g); }); grupo = []; };
  for (const t of ord) {
    if (grupo.length && t.ini >= fimGrupo) fechar();
    const usadas = new Set(grupo.filter(g => g.t.fim > t.ini).map(g => g.col));
    let col = 0;
    while (usadas.has(col)) col++;
    grupo.push({ t, col, cols: 1 });
    fimGrupo = Math.max(fimGrupo, t.fim);
  }
  if (grupo.length) fechar();
  return saida;
}
