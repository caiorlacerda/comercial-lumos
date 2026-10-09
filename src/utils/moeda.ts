// Moeda da proposta. O dólar é só uma CONVERSÃO FINAL do preço: custo, margem e
// imposto continuam em reais (calcFinancials não muda). Sem dependências de
// propósito — roda no navegador, no PDF e nos testes de linha de comando.

export type Moeda = 'BRL' | 'USD';

/** Margem de segurança padrão sobre a cotação de mercado (3%). */
export const SPREAD_PADRAO = 0.03;

export interface VersaoMoeda {
  currency?: string | null;
  fx_market_rate?: number | string | null;
  fx_spread_pct?: number | string | null;
  fx_rate?: number | string | null;
  fx_rate_at?: string | null;
  fx_source?: string | null;
}

/** Cotação travada da versão (R$ por US$), ou null se não houver uma válida. */
export function taxaDaVersao(v?: VersaoMoeda | null): number | null {
  const t = Number(v?.fx_rate);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** USD só vale com cotação travada; sem ela a proposta é tratada como R$. */
export function moedaDaVersao(v?: VersaoMoeda | null): Moeda {
  return v?.currency === 'USD' && taxaDaVersao(v) !== null ? 'USD' : 'BRL';
}

/**
 * Cotação travada = cotação de mercado menos a margem de segurança. Quanto
 * menor a cotação, maior o preço em dólar: protege a Lumos se o dólar cair
 * até o pagamento. 4 casas, igual ao banco de dados.
 */
export function calcCotacaoTravada(mercado: number, spread: number = SPREAD_PADRAO): number {
  return Math.round(mercado * (1 - spread) * 10000) / 10000;
}

const arredondar2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Converte um valor em reais para a moeda da versão. Em R$, devolve como veio. */
export function converterValor(valorBRL: number, v?: VersaoMoeda | null): number {
  const taxa = moedaDaVersao(v) === 'USD' ? taxaDaVersao(v) : null;
  return taxa ? arredondar2(valorBRL / taxa) : valorBRL;
}

export function formatarMoeda(valor: number, moeda: Moeda = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: moeda,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor);
}

/** Converte (se for dólar) e formata, num passo só. */
export function formatarValorDaVersao(valorBRL: number, v?: VersaoMoeda | null): string {
  return formatarMoeda(converterValor(valorBRL, v), moedaDaVersao(v));
}

/**
 * Os seis campos de moeda, prontos para entrar nos INSERT/UPDATE de
 * budget_versions. Existe pra essa lista não ser copiada à mão em cada lugar.
 */
export function camposDeMoeda(v?: VersaoMoeda | null) {
  return {
    currency: moedaDaVersao(v),
    fx_market_rate: v?.fx_market_rate != null ? Number(v.fx_market_rate) : null,
    fx_spread_pct: v?.fx_spread_pct != null ? Number(v.fx_spread_pct) : SPREAD_PADRAO,
    fx_rate: taxaDaVersao(v),
    fx_rate_at: v?.fx_rate_at ?? null,
    fx_source: v?.fx_source ?? null,
  };
}

/** Dias inteiros desde uma data ISO; null se não houver data. */
export function diasDesde(iso?: string | null, agora: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((agora.getTime() - t) / 86400000);
}

/**
 * Referência em US$ de um título (parcela) de proposta em dólar: o valor PREVISTO
 * em reais ÷ cotação travada da versão. Depois do recebimento o `total_amount`
 * passa a ser o valor real; o previsto fica em `valor_previsto`, então o US$
 * contratado continua o mesmo. null se a versão não for em dólar.
 */
export function usdDoTitulo(
  titulo: { total_amount?: number | string | null; valor_previsto?: number | string | null },
  versao?: VersaoMoeda | null,
): number | null {
  if (moedaDaVersao(versao) !== 'USD') return null;
  const bruto = titulo.valor_previsto ?? titulo.total_amount;
  if (bruto == null) return null;
  const base = Number(bruto);
  return Number.isFinite(base) ? converterValor(base, versao) : null;
}

/**
 * Lê um valor em reais digitado à brasileira ("51.200,50", "51200,5", "R$ 51.200").
 * Lê com segurança ou devolve null: nunca um número silenciosamente errado.
 * - Tira "R$" e todo espaço (inclusive NBSP); se sobrar algo além de dígitos, "." e ",",
 *   é null ("1e3", "0x10", "abc", "-5").
 * - Com vírgula: só uma, com 1 ou 2 dígitos depois; antes dela, só dígitos ou milhar
 *   com ponto ("51.200,50", "51200,5", "1,5"). Ponto depois da vírgula, formato
 *   americano ("1,234.56") e 3 dígitos depois da vírgula ("2,600") são ambíguos: null.
 * - Sem vírgula: "1.234.567" é milhar; "51200.5" / "1.5" / "1000" são decimais de até
 *   2 casas; qualquer outro ("1.2345") é null.
 * - Arredonda para 2 casas ANTES de exigir valor positivo ("0,004" → null).
 */
export function parseValorBR(texto: string): number | null {
  const t = String(texto ?? '').replace(/R\$|\s/g, '');
  if (!t || /[^\d.,]/.test(t)) return null;
  let normal: string;
  if (t.includes(',')) {
    const partes = t.split(',');
    if (partes.length !== 2) return null;
    const [inteira, frac] = partes;
    if (!/^\d{1,2}$/.test(frac)) return null;
    if (!(/^\d+$/.test(inteira) || /^\d{1,3}(\.\d{3})+$/.test(inteira))) return null;
    normal = `${inteira.replace(/\./g, '')}.${frac}`;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    normal = t.replace(/\./g, '');
  } else if (/^\d+(\.\d{1,2})?$/.test(t)) {
    normal = t;
  } else {
    return null;
  }
  const n = Math.round(Number(normal) * 100) / 100;
  return Number.isFinite(n) && n > 0 ? n : null;
}
