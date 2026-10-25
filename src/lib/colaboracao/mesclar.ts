/**
 * Mesclagem de três vias (base, local, remoto) para edição simultânea.
 *
 * - base:   o último estado que o servidor confirmou para esta pessoa (carregado ou salvo por ela).
 * - local:  o que está na tela dela agora (pode ter alterações ainda não salvas).
 * - remoto: o que está no servidor agora (pode incluir alterações de outras pessoas).
 *
 * Regra por campo: se a pessoa NÃO mexeu no campo (local = base), vale o remoto. Se mexeu, vale o dela;
 * e se outra pessoa também mexeu no mesmo campo para um valor diferente, é um conflito (o dela fica, e
 * quem chamou avisa). Nada é perdido em silêncio.
 */

type Registro = Record<string, any>;

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface ResultadoObjeto<T> {
  resultado: T;
  /** Campos que vieram do remoto (outra pessoa mudou e a pessoa local não tinha mexido). */
  aplicados: string[];
  /** Campos que as duas partes mudaram para valores diferentes (fica o valor local). */
  conflitos: string[];
}

/** Mescla um objeto plano. Só os campos presentes em `remoto` entram na conta (ex.: ignora joins como `clients`). */
export function mesclarObjeto<T extends Registro>(base: T | null | undefined, local: T, remoto: T): ResultadoObjeto<T> {
  const resultado: Registro = { ...local };
  const aplicados: string[] = [];
  const conflitos: string[] = [];
  for (const k of Object.keys(remoto)) {
    const b = base?.[k], l = local[k], r = remoto[k];
    if (igual(l, r)) continue;                 // já iguais
    if (igual(l, b)) { resultado[k] = r; aplicados.push(k); continue; } // só o remoto mexeu
    if (!igual(r, b)) conflitos.push(k);       // os dois mexeram, em valores diferentes
    // senão: só o local mexeu, e o valor local fica
  }
  return { resultado: resultado as T, aplicados, conflitos };
}

export interface ResultadoItens<T> {
  itens: T[];
  /** Ids de itens que mudaram por causa de outra pessoa (incluindo novos e removidos). */
  alterados: string[];
  adicionados: string[];
  removidos: string[];
  conflitos: string[];
}

/** Mescla listas de itens com `id`, mantendo a ordem do remoto para itens novos e a local para o resto. */
export function mesclarItens<T extends { id: string }>(base: T[], local: T[], remoto: T[]): ResultadoItens<T> {
  const mapBase = new Map(base.map(i => [i.id, i]));
  const mapLocal = new Map(local.map(i => [i.id, i]));
  const mapRemoto = new Map(remoto.map(i => [i.id, i]));
  const alterados = new Set<string>(), adicionados: string[] = [], removidos: string[] = [], conflitos = new Set<string>();

  const saida: T[] = [];
  for (const l of local) {
    const b = mapBase.get(l.id), r = mapRemoto.get(l.id);
    if (!b) { saida.push(l); continue; }                       // item novo da pessoa local: fica
    if (!r) {                                                   // sumiu no servidor
      if (igual(l, b)) { removidos.push(l.id); alterados.add(l.id); continue; } // ela não mexeu: some
      conflitos.add(l.id); saida.push(l); continue;            // ela mexeu: fica (conflito)
    }
    const m = mesclarObjeto(b as Registro, l as Registro, r as Registro);
    if (m.aplicados.length) alterados.add(l.id);
    if (m.conflitos.length) conflitos.add(l.id);
    saida.push(m.resultado as T);
  }
  // Itens que outra pessoa criou
  for (const r of remoto) {
    if (!mapLocal.has(r.id) && !mapBase.has(r.id)) { saida.push(r); adicionados.push(r.id); alterados.add(r.id); }
  }
  return { itens: saida, alterados: [...alterados], adicionados, removidos, conflitos: [...conflitos] };
}

/** Campos de `atual` diferentes de `base` (para gravar só o que mudou). */
export function camposAlterados<T extends Registro>(base: T | null | undefined, atual: T, campos: string[]): Partial<T> {
  const mudou: Registro = {};
  for (const k of campos) if (!igual(base?.[k], atual[k])) mudou[k] = atual[k];
  return mudou as Partial<T>;
}

/** A pessoa mexeu em algum dos `campos` (comparando com o que o servidor tinha quando ela carregou)? */
export function alteradoLocalmente(base: Registro | null | undefined, local: Registro, campos: string[]): boolean {
  if (!base) return true;
  return campos.some(k => !igual(base[k], local[k]));
}

/** A lista local difere da base (itens a mais, a menos ou com campo diferente, ignorando a ordem)? */
export function itensAlteradosLocalmente<T extends { id: string }>(base: T[] | null | undefined, local: T[], campos: string[]): boolean {
  if (!base) return true;
  if (base.length !== local.length) return true;
  const mapBase = new Map(base.map(i => [i.id, i as Registro]));
  return local.some(l => { const b = mapBase.get(l.id); return !b || campos.some(k => !igual(b[k], (l as Registro)[k])); });
}
