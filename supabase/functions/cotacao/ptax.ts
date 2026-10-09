// Leitura da cotação do dólar no Banco Central (PTAX, serviço Olinda).
// Puro, sem imports: o index.ts usa dentro do Deno e os testes rodam no Node.

export interface CotacaoPtax {
  /** Dia da cotação (AAAA-MM-DD). */
  data: string;
  compra: number;
  venda: number;
}

const mdy = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;

/**
 * Endereço que lista as cotações dos últimos `diasAtras` dias (o BC só publica
 * em dia útil). NÃO acrescentar `$select`: o firewall do Banco Central responde
 * 403 a esse parâmetro (testado em 2026-10-09); a resposta já vem enxuta.
 */
export function urlPtax(hoje: Date, diasAtras = 10): string {
  const ini = new Date(hoje.getTime() - diasAtras * 86400000);
  return (
    'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
    'CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)' +
    `?@dataInicial='${mdy(ini)}'&@dataFinalCotacao='${mdy(hoje)}'` +
    '&$top=100&$orderby=dataHoraCotacao%20desc&$format=json'
  );
}

/** Pega a cotação mais recente da resposta do BC; null se não houver nenhuma válida. */
export function escolherCotacao(json: unknown): CotacaoPtax | null {
  const lista = (json as { value?: unknown })?.value;
  if (!Array.isArray(lista)) return null;
  let melhor: { quando: string; compra: number; venda: number } | null = null;
  for (const r of lista as Record<string, unknown>[]) {
    const compra = Number(r?.cotacaoCompra);
    const venda = Number(r?.cotacaoVenda);
    const quando = String(r?.dataHoraCotacao ?? '');
    if (!(compra > 0) || !(venda > 0) || !quando) continue;
    if (!melhor || quando > melhor.quando) melhor = { quando, compra, venda };
  }
  return melhor ? { data: melhor.quando.slice(0, 10), compra: melhor.compra, venda: melhor.venda } : null;
}
