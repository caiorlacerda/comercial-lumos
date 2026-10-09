// Glossário de traduções do orçamento. Chaveado pelo TEXTO ORIGINAL (não por id
// de item): sobrevive a nova versão (itens ganham uuid novo), a reordenação e a
// repetição do mesmo texto; um texto editado simplesmente fica "sem tradução".
// Sem imports: roda no navegador, no PDF e nos testes de linha de comando.

export interface Traducoes {
  versao: 1;
  /** texto original (sem espaços nas pontas) → tradução em inglês */
  textos: Record<string, string>;
  traduzido_em?: string;
  modelo?: string;
}

export interface TextoParaTraduzir {
  origem: string;
  tipo: 'texto' | 'html';
}

interface VersaoTextos {
  notes_client?: string | null;
  logistics_date?: string | null;
  logistics_time?: string | null;
  logistics_location?: string | null;
}
interface ItemTextos {
  name?: string | null;
  description?: string | null;
  sort_order?: number | null;
}

/** Chave do glossário: o texto sem espaços nas pontas. */
export const chave = (s?: string | null): string => String(s ?? '').trim();

const ehHtml = (s: string) => /<\/?[a-z][^>]*>/i.test(s);

/**
 * Todos os textos do orçamento que o PDF em inglês precisa traduzir, sem repetição,
 * na ordem em que aparecem: logística, briefing (HTML) e itens (nome, descrição).
 * Unidade e categoria saem de um mapa fixo (pdfTextos), não daqui.
 */
export function coletarTextos(version: VersaoTextos | null | undefined, items: ItemTextos[] | null | undefined): TextoParaTraduzir[] {
  const vistos = new Set<string>();
  const out: TextoParaTraduzir[] = [];
  const add = (texto: string | null | undefined, forcarHtml = false) => {
    const o = chave(texto);
    if (!o || vistos.has(o)) return;
    vistos.add(o);
    out.push({ origem: o, tipo: forcarHtml || ehHtml(o) ? 'html' : 'texto' });
  };
  add(version?.logistics_date);
  add(version?.logistics_time);
  add(version?.logistics_location);
  add(version?.notes_client, true);
  const ordenados = [...(items ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const it of ordenados) {
    add(it.name);
    add(it.description);
  }
  return out;
}

/** O que ainda não tem tradução (ausente ou só espaços). */
export function faltantes(coletados: TextoParaTraduzir[], traducoes: Traducoes | null | undefined): TextoParaTraduzir[] {
  return coletados.filter((c) => chave(traducoes?.textos?.[c.origem]) === '');
}

/** Tradução do texto, ou o próprio texto se não houver. */
export function traduzir(traducoes: Traducoes | null | undefined, origem?: string | null): string {
  const o = String(origem ?? '');
  const t = traducoes?.textos?.[chave(o)];
  return t && chave(t) !== '' ? t : o;
}

/**
 * Tira o que as fontes do PDF (Poppins/Work Sans, subset latin) não cobre:
 * setas e símbolos matemáticos viram ASCII; emoji e seletores de variação somem.
 */
export function sanitizarTraducao(s: string): string {
  return String(s ?? '')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[✓✔]/g, '')
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/️/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Junta traduções novas às existentes (sanitizadas), sem mutar a entrada. */
export function mesclar(
  base: Traducoes | null | undefined,
  novas: Record<string, string>,
  agoraISO?: string,
  modelo?: string,
): Traducoes {
  const textos: Record<string, string> = { ...(base?.textos ?? {}) };
  for (const [origem, en] of Object.entries(novas)) textos[chave(origem)] = sanitizarTraducao(en);
  return {
    versao: 1,
    textos,
    traduzido_em: agoraISO ?? base?.traduzido_em,
    modelo: modelo ?? base?.modelo,
  };
}
