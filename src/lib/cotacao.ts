import { supabase } from '@/lib/supabase';

export interface CotacaoDia {
  /** Dia da cotação (AAAA-MM-DD). */
  data: string;
  /** PTAX de compra: a que a proposta usa. */
  compra: number;
  venda: number;
  fonte: string;
  /** true quando o Banco Central estava fora do ar e veio a última guardada. */
  do_cache: boolean;
}

/** Busca a cotação do dólar (PTAX de compra). Lança erro se não houver nenhuma. */
export async function buscarCotacao(): Promise<CotacaoDia> {
  const { data, error } = await supabase.functions.invoke('cotacao', { body: {} });
  if (error) {
    // Em não-2xx o erro traz mensagem genérica; a da função está no corpo da resposta.
    let msg = 'Não foi possível obter a cotação agora.';
    try {
      const corpo = await (error as any).context.json();
      if (corpo?.error) msg = corpo.error;
    } catch {
      // sem corpo JSON: fica a mensagem genérica
    }
    throw new Error(msg);
  }
  const c = data as any;
  if (!c || c.error || !(Number(c.compra) > 0)) throw new Error(c?.error || 'Cotação indisponível');
  return c as CotacaoDia;
}
