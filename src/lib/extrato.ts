/**
 * PARSER DO EXTRATO BANCÁRIO (Cora) — aceita o CSV e o PDF que o banco manda
 * todo mês e devolve as movimentações prontas pra importar.
 *
 * O CSV traz o nome completo da contraparte; o PDF trunca ("ELETROPAULO MET…").
 * Pra subir os dois do mesmo mês sem duplicar nada, o hash de deduplicação usa
 * um PREFIXO normalizado da identificação (12 caracteres), que é igual nos
 * dois formatos, junto com data, tipo, valor e um ordinal (pra preservar dois
 * pagamentos idênticos genuínos no mesmo dia).
 */

export interface LinhaExtrato {
  data: string;            // AAAA-MM-DD
  descricao: string;       // "Transf Pix enviada", "Boleto pago"…
  tipo: 'credito' | 'debito';
  identificacao: string;   // contraparte
  valor: number;           // com sinal (débito negativo)
  hash: string;
}

export interface ResultadoExtrato {
  linhas: LinhaExtrato[];
  saldoInicial: number | null;
  saldoFinal: number | null;
  periodo: string | null;
}

const brParaIso = (d: string) => {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// "1.234,56" ou "1234.56" → número
const parseValor = (s: string) => {
  const limpo = s.replace(/[^\d.,-]/g, '');
  if (/,\d{1,2}$/.test(limpo)) return parseFloat(limpo.replace(/\./g, '').replace(',', '.'));
  return parseFloat(limpo.replace(/,/g, ''));
};

const normalizarId = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

export function montarHash(l: Omit<LinhaExtrato, 'hash'>, ordinal: number) {
  const centavos = Math.round(Math.abs(l.valor) * 100);
  return `${l.data}|${l.tipo}|${centavos}|${normalizarId(l.identificacao)}|${ordinal}`;
}

function aplicarHashes(linhas: Omit<LinhaExtrato, 'hash'>[]): LinhaExtrato[] {
  const vistos = new Map<string, number>();
  return linhas.map(l => {
    const base = montarHash(l, 0).slice(0, -2);
    const ordinal = (vistos.get(base) || 0) + 1;
    vistos.set(base, ordinal);
    return { ...l, hash: montarHash(l, ordinal) };
  });
}

// ── CSV (Data,Transação,Tipo Transação,Identificação,Valor) ────────────────
export function parseCsvExtrato(texto: string): ResultadoExtrato {
  const linhas: Omit<LinhaExtrato, 'hash'>[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const campos = bruta.split(',');
    if (campos.length < 5) continue;
    const data = brParaIso(campos[0].trim());
    if (!data) continue; // cabeçalho e lixo
    const valor = parseValor(campos[campos.length - 1]);
    if (Number.isNaN(valor)) continue;
    const tipoTxt = campos[2].trim().toUpperCase();
    // nome com vírgula: junta tudo entre a 4ª coluna e o valor
    const identificacao = campos.slice(3, campos.length - 1).join(',').trim();
    linhas.push({
      data,
      descricao: campos[1].trim(),
      tipo: tipoTxt.includes('CR') || valor > 0 ? 'credito' : 'debito',
      identificacao,
      valor,
    });
  }
  return { linhas: aplicarHashes(linhas), saldoInicial: null, saldoFinal: null, periodo: null };
}

// ── PDF (extrato Cora) ─────────────────────────────────────────────────────
export async function parsePdfExtrato(dados: ArrayBuffer): Promise<ResultadoExtrato> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: dados }).promise;
  const textoLinhas: string[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const porY = new Map<number, { x: number; s: string }[]>();
    for (const item of tc.items as { transform: number[]; str: string }[]) {
      const y = Math.round(item.transform[5]);
      if (!porY.has(y)) porY.set(y, []);
      porY.get(y)!.push({ x: item.transform[4], s: item.str });
    }
    [...porY.keys()].sort((a, b) => b - a).forEach(y => {
      const pedacos = porY.get(y)!.sort((a, b) => a.x - b.x)
        .map(p => p.s.trim()).filter(s => s && s !== '…');
      if (pedacos.length) textoLinhas.push(pedacos);
    });
  }

  const RE_VALOR = /^([+-])\s*R\$\s*([\d.,]+)$/;
  const RE_DATA = /^(\d{2}\/\d{2}\/\d{4})$/;
  const RE_DOC = /^[\d.\/\s-]+$/; // CNPJ/CPF soltos no meio da linha

  let saldoInicial: number | null = null;
  let saldoFinal: number | null = null;
  let periodo: string | null = null;
  let dataCorrente: string | null = null;
  const linhas: Omit<LinhaExtrato, 'hash'>[] = [];

  for (const pedacos of textoLinhas) {
    const junta = pedacos.join(' ');
    if (/^\d{2}\/\d{2}\/\d{4}\s+a\s+\d{2}\/\d{2}\/\d{4}$/.test(junta)) periodo = junta;
    if (junta.includes('Saldo inicial')) saldoInicial = parseValor(pedacos[pedacos.length - 1]);
    if (junta.includes('Saldo final')) saldoFinal = parseValor(pedacos[pedacos.length - 1]);

    // "31/07/2026 | Saldo do dia | R$ x" define a data das linhas seguintes
    const comData = pedacos.find(p => RE_DATA.test(p));
    if (comData && junta.includes('Saldo do dia')) {
      dataCorrente = brParaIso(comData);
      continue;
    }

    // Linha de transação: termina em "+/- R$ valor"
    const mValor = pedacos[pedacos.length - 1]?.match(RE_VALOR);
    if (!mValor || !dataCorrente || pedacos.length < 2) continue;
    const sinal = mValor[1] === '-' ? -1 : 1;
    const valor = sinal * parseValor(mValor[2]);
    const descricao = pedacos[0];
    const identificacao = pedacos.slice(1, -1)
      .filter(p => !RE_DOC.test(p))
      .join(' ')
      .trim();
    linhas.push({
      data: dataCorrente,
      descricao,
      tipo: sinal < 0 ? 'debito' : 'credito',
      identificacao: identificacao || descricao,
      valor,
    });
  }

  return { linhas: aplicarHashes(linhas), saldoInicial, saldoFinal, periodo };
}
