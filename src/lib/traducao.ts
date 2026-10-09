import { supabase } from '@/lib/supabase';
import type { TextoParaTraduzir } from '@/lib/traducaoCore';

/** Limites de cada chamada à função (abaixo dos limites do servidor: 100 itens e 40000 caracteres). */
const ITENS_POR_CHAMADA = 60;
const CARACTERES_POR_CHAMADA = 30000;

/**
 * Maior texto aceito pela IA. Espelha LIMITES.caracteresPorItem da Edge Function, que o cliente
 * não pode importar: um texto maior faria o servidor recusar o pedido inteiro.
 */
export const LIMITE_TEXTO_IA = 8000;

/** Divide em grupos (itens e caracteres) mantendo a ordem. */
function agrupar(itens: TextoParaTraduzir[]): TextoParaTraduzir[][] {
  const grupos: TextoParaTraduzir[][] = [];
  let atual: TextoParaTraduzir[] = [];
  let chars = 0;
  for (const it of itens) {
    const cheio = atual.length >= ITENS_POR_CHAMADA
      || (atual.length > 0 && chars + it.origem.length > CARACTERES_POR_CHAMADA);
    if (cheio) { grupos.push(atual); atual = []; chars = 0; }
    atual.push(it);
    chars += it.origem.length;
  }
  if (atual.length) grupos.push(atual);
  return grupos;
}

/** Grava uma chave como propriedade própria (um texto chamado '__proto__' não vira protótipo). */
function definirPropriedade(obj: Record<string, string>, chave: string, valor: string): void {
  Object.defineProperty(obj, chave, { value: valor, enumerable: true, writable: true, configurable: true });
}

/**
 * Pede à função `traduzir-orcamento` a tradução (inglês americano) dos textos.
 * Devolve um mapa texto original → tradução. Os textos são enviados em grupos, um
 * por vez. Lança Error com a mensagem do servidor (ou uma mensagem amigável) se algo
 * falhar; nunca devolve resultado parcial. Textos acima de LIMITE_TEXTO_IA não vão à IA:
 * voltam em `ignorados` para a pessoa traduzir à mão.
 */
export async function traduzirTextos(todos: TextoParaTraduzir[]): Promise<{ traducoes: Record<string, string>; modelo: string; ignorados: TextoParaTraduzir[] }> {
  const ignorados = todos.filter((it) => it.origem.length > LIMITE_TEXTO_IA);
  const itens = todos.filter((it) => it.origem.length <= LIMITE_TEXTO_IA);
  if (itens.length === 0) return { traducoes: {}, modelo: '', ignorados };

  const traducoes: Record<string, string> = {};
  let modelo = '';
  for (const grupo of agrupar(itens)) {
    const pedido = grupo.map((it, i) => ({ id: `t${i}`, tipo: it.tipo, origem: it.origem }));
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
    for (const p of pedido) {
      if (!Object.prototype.hasOwnProperty.call(porId, p.id)) throw new Error('Resposta incompleta. Tente de novo.');
      definirPropriedade(traducoes, p.origem, porId[p.id]);
    }
    modelo = String(d.modelo || modelo);
  }
  return { traducoes, modelo, ignorados };
}
