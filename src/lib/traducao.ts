import { supabase } from '@/lib/supabase';
import type { TextoParaTraduzir } from '@/lib/traducaoCore';

/**
 * Pede à função `traduzir-orcamento` a tradução (inglês americano) dos textos.
 * Devolve um mapa texto original → tradução. Lança Error com a mensagem do servidor
 * (ou uma mensagem amigável) se algo falhar; nunca devolve resultado parcial.
 */
export async function traduzirTextos(itens: TextoParaTraduzir[]): Promise<{ traducoes: Record<string, string>; modelo: string }> {
  const pedido = itens.map((it, i) => ({ id: `t${i}`, tipo: it.tipo, origem: it.origem }));
  const { data, error } = await supabase.functions.invoke('traduzir-orcamento', { body: { itens: pedido } });
  if (error) {
    let msg = 'Não foi possível traduzir agora. Tente de novo.';
    try {
      const corpo = await (error as any).context?.json?.();
      if (corpo?.error) msg = String(corpo.error);
    } catch { /* corpo ilegível: fica a mensagem amigável */ }
    throw new Error(msg);
  }
  const d = data as any;
  if (!d || d.error || !d.traducoes) throw new Error(d?.error || 'Não foi possível traduzir agora. Tente de novo.');
  const porId: Record<string, string> = d.traducoes;
  const traducoes: Record<string, string> = {};
  pedido.forEach((p) => { if (porId[p.id]) traducoes[p.origem] = porId[p.id]; });
  return { traducoes, modelo: String(d.modelo || '') };
}
