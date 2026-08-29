/**
 * COLAR FEEDBACK DE FORA e virar comentários com timecode.
 *
 * Cliente manda ajuste por e-mail e por WhatsApp, e alguém da equipe passa isso
 * pra plataforma na mão, um por um, buscando o tempo de cada pedido. É trabalho
 * repetido, e é onde nasce erro de timecode.
 *
 * Aqui a gente lê o texto colado e devolve o que entendeu, pra pessoa CONFERIR
 * antes de criar. Nada é criado às cegas: o que não foi entendido aparece
 * separado, em vez de sumir.
 */

export interface LinhaLida {
  ms: number;
  texto: string;
  /** Como o tempo estava escrito no original — ajuda a conferir. */
  original: string;
}

export interface Leitura {
  comentarios: LinhaLida[];
  /** Linhas com conteúdo que não tinham tempo e nem linha anterior pra grudar. */
  ignoradas: string[];
}

/**
 * Aceita mm:ss, h:mm:ss e hh:mm:ss:ff (com frames). Também 1'20" e "aos 15s",
 * porque é assim que cliente escreve de verdade — não em SMPTE.
 */
const PADROES: { re: RegExp; ms: (m: RegExpMatchArray, fps: number) => number }[] = [
  // 00:00:15:12 (com frames)
  { re: /^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})/, ms: (m, fps) =>
      (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + Math.round((+m[4] / (fps || 25)) * 1000) },
  // 1:20:30
  { re: /^(\d{1,2}):(\d{2}):(\d{2})(?!\d)/, ms: m => (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 },
  // 1:20  /  01:20
  { re: /^(\d{1,3}):(\d{2})(?!\d)/, ms: m => (+m[1] * 60 + +m[2]) * 1000 },
  // 1'20"  ou  1'20
  { re: /^(\d{1,3})'(\d{1,2})"?/, ms: m => (+m[1] * 60 + +m[2]) * 1000 },
  // aos 15s / 15s / 15 seg
  { re: /^(?:aos\s+)?(\d{1,4})\s*(?:s|seg|segundos)\b/i, ms: m => +m[1] * 1000 },
];

export function interpretarComentarios(texto: string, fps = 25): Leitura {
  const comentarios: LinhaLida[] = [];
  const ignoradas: string[] = [];

  for (const bruta of (texto || '').split(/\r?\n/)) {
    // Tira marcador de lista, aspas e espaço: cliente cola de tudo.
    const linha = bruta.replace(/^\s*(?:[-–—•*·]|\d+[).])\s*/, '').trim();
    if (!linha) continue;

    let achou: { ms: number; resto: string; original: string } | null = null;
    for (const p of PADROES) {
      const m = linha.match(p.re);
      if (!m) continue;
      achou = { ms: p.ms(m, fps), resto: linha.slice(m[0].length), original: m[0] };
      break;
    }

    if (achou) {
      // Separador entre tempo e texto: hífen, dois-pontos, barra, travessão.
      const texto = achou.resto.replace(/^\s*[-–—:|>]+\s*/, '').trim();
      comentarios.push({ ms: achou.ms, texto, original: achou.original });
      continue;
    }

    // Sem tempo: continuação do pedido anterior (feedback quebra linha o tempo
    // todo). Sem anterior, não dá pra adivinhar onde vai — vira ignorada.
    if (comentarios.length) {
      const ultimo = comentarios[comentarios.length - 1];
      ultimo.texto = `${ultimo.texto} ${linha}`.trim();
    } else {
      ignoradas.push(linha);
    }
  }

  return {
    comentarios: comentarios.filter(c => c.texto).sort((a, b) => a.ms - b.ms),
    ignoradas,
  };
}
