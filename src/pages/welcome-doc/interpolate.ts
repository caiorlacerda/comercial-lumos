export interface VariavelDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  group: string;
}

const VAR_RE = /\{\{(\w+)\}\}/g;

/** Interpola {{CHAVE}} em todo campo string de `secoes`, recursivamente
 *  (arrays e objetos aninhados incluídos). Variável obrigatória vazia
 *  mantém o token visível — nunca deveria acontecer de verdade, porque
 *  publicar já bloqueia isso antes, mas não esconde silenciosamente se
 *  acontecer. Variável opcional vazia colapsa o CAMPO inteiro (a string
 *  inteira vira ''), pra nunca sobrar frase pela metade na tela. */
export function interpolarSecoes<T>(secoes: T, valores: Record<string, string>, variaveis: VariavelDef[]): T {
  const obrigatorias = new Set(variaveis.filter(v => v.required).map(v => v.key));
  return interpolarValor(secoes, valores, obrigatorias) as T;
}

function interpolarValor(valor: unknown, valores: Record<string, string>, obrigatorias: Set<string>): unknown {
  if (typeof valor === 'string') return interpolarTexto(valor, valores, obrigatorias);
  if (Array.isArray(valor)) return valor.map(v => interpolarValor(v, valores, obrigatorias));
  if (valor && typeof valor === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) out[k] = interpolarValor(v, valores, obrigatorias);
    return out;
  }
  return valor;
}

function interpolarTexto(texto: string, valores: Record<string, string>, obrigatorias: Set<string>): string {
  let temOpcionalVazia = false;
  const resultado = texto.replace(VAR_RE, (match, chave: string) => {
    const valor = valores[chave];
    if (valor) return valor;
    if (obrigatorias.has(chave)) return match;
    temOpcionalVazia = true;
    return '';
  });
  return temOpcionalVazia ? '' : resultado;
}
