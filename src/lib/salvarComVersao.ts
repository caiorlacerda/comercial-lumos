import { supabase } from '@/lib/supabase';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * SALVAMENTO COM TRAVA DE VERSÃO (optimistic locking)
 *
 * Para telas em que várias pessoas editam a mesma linha ao mesmo tempo e o
 * salvamento manda um objeto inteiro de volta (JSON de lista, por exemplo).
 * Sem trava, quem salva por último grava o que leu quando abriu a tela e apaga
 * em silêncio o que a outra pessoa fez no meio do caminho.
 *
 * Como funciona: a linha tem um contador `versao` que um gatilho BEFORE UPDATE
 * soma 1 a cada atualização (migração 2026093338). Aqui o UPDATE vai com
 * `.eq('id', ...)` E `.eq('versao', <a versão que eu li>)`. Se outra pessoa
 * salvou antes, a versão no banco já é outra, o UPDATE não pega linha nenhuma,
 * **nada é escrito** e a resposta volta como `desatualizado`.
 *
 * O que a tela deve fazer com `desatualizado`: recarregar do servidor e avisar
 * a pessoa, com todas as letras, que a alteração dela não entrou. Descartar em
 * silêncio é exatamente o problema que esta função existe pra resolver.
 *
 * Degrada sem quebrar: se a coluna `versao` ainda não existir no banco (ou se
 * quem chamou não tiver a versão em mãos), o salvamento acontece do mesmo
 * jeito, só que sem a trava, como a tela fazia antes.
 *
 * Exemplo:
 *
 * ```ts
 * const r = await salvarComVersao<Linha>({
 *   tabela: 'ordens_do_dia', id, versao: versaoRef.current,
 *   campos: { titulo: 'Novo título' },
 * });
 * if (r.status === 'desatualizado') { await recarregar(); avisar(); return; }
 * if (r.status === 'erro') { mostrarErro(r.erro); return; }
 * versaoRef.current = r.versao;
 * ```
 */
export type Salvamento<T> =
  /** Gravou. `linha` é a linha nova que o banco devolveu, `versao` é o contador já somado. */
  | { status: 'salvo'; linha: T; versao: number | null }
  /** Outra pessoa salvou antes. NADA foi escrito no banco. */
  | { status: 'desatualizado' }
  /** Deu erro de verdade (rede, permissão, coluna inexistente). */
  | { status: 'erro'; erro: PostgrestError };

export interface OpcoesSalvarComVersao {
  /** Nome da tabela, ex.: `'ordens_do_dia'`. */
  tabela: string;
  /** Identificador da linha. */
  id: string;
  /**
   * A versão que a tela leu quando carregou (ou a devolvida pelo último
   * salvamento). `null`/`undefined` salva sem trava, para o caso de a coluna
   * ainda não existir no banco.
   */
  versao: number | null | undefined;
  /** Os campos a gravar. */
  campos: Record<string, unknown>;
  /** Nome da coluna do contador, se algum dia for diferente de `versao`. */
  colunaVersao?: string;
  /** Nome da coluna de identificador, se algum dia for diferente de `id`. */
  colunaId?: string;
}

/** A coluna do contador ainda não existe neste banco (migração não rodou). */
function semColunaDeVersao(erro: PostgrestError, coluna: string): boolean {
  return erro.code === '42703' || new RegExp(`column .*${coluna}`, 'i').test(String(erro.message));
}

export async function salvarComVersao<T = Record<string, unknown>>(
  opts: OpcoesSalvarComVersao
): Promise<Salvamento<T>> {
  const { tabela, id, versao, campos, colunaVersao = 'versao', colunaId = 'id' } = opts;

  const escrever = (comTrava: boolean) => {
    const q = supabase.from(tabela).update(campos).eq(colunaId, id);
    // `.select()` traz a linha nova de volta: é dela que sai a versão seguinte,
    // e é o número de linhas devolvidas que denuncia o conflito.
    return (comTrava ? q.eq(colunaVersao, versao as number) : q).select().maybeSingle();
  };

  const comTrava = versao != null;
  let { data, error } = await escrever(comTrava);

  // Banco ainda sem a coluna: tenta de novo sem a trava. Perder a proteção é
  // ruim, perder o salvamento é pior.
  if (error && comTrava && semColunaDeVersao(error, colunaVersao)) {
    ({ data, error } = await escrever(false));
  }

  if (error) return { status: 'erro', erro: error };

  // Zero linhas: ou a versão mudou (outra pessoa salvou), ou a linha sumiu.
  // Nos dois casos o certo é recarregar antes de escrever qualquer coisa.
  if (!data) return { status: 'desatualizado' };

  const linha = data as T;
  const nova = (linha as Record<string, unknown>)[colunaVersao];
  return { status: 'salvo', linha, versao: typeof nova === 'number' ? nova : null };
}
