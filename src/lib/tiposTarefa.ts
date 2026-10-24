import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** Tipo de tarefa (Roteiro, Edição, Motion...): catálogo `task_tipos`, uma escolha por tarefa (`project_tasks.tipo_id`). */
export interface TipoTarefa {
  id: string;
  nome: string;
  cor: string;
  ordem: number;
}

/** Sem acento nem caixa, para comparar. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Jeitos de escrever que o time já usa no título, apontando pro tipo do catálogo.
const SINONIMOS: Record<string, string> = {
  gravacao: 'captacao',
  thumb: 'design',
  arte: 'design',
};

/**
 * Se o título começa com "TIPO | resto" e TIPO é um tipo do catálogo (ou um sinônimo conhecido),
 * devolve o tipo e o título sem o prefixo. Só o primeiro "|" conta, e o resto não pode ficar vazio.
 */
export function tipoDoPrefixo(titulo: string, tipos: TipoTarefa[]): { tipo: TipoTarefa; titulo: string } | null {
  const i = titulo.indexOf('|');
  if (i <= 0) return null;
  const resto = titulo.slice(i + 1).trim();
  if (!resto) return null;
  const chave = normalizar(titulo.slice(0, i));
  const alvo = SINONIMOS[chave] ?? chave;
  const tipo = tipos.find(t => normalizar(t.nome) === alvo);
  return tipo ? { tipo, titulo: resto } : null;
}

let cache: TipoTarefa[] | null = null;
let pendente: Promise<TipoTarefa[]> | null = null;
const ouvintes = new Set<(t: TipoTarefa[]) => void>();

async function buscar(): Promise<TipoTarefa[]> {
  // Antes do SQL a tabela não existe: erro vira lista vazia e os campos de Tipo não aparecem.
  const { data, error } = await supabase.from('task_tipos').select('id, nome, cor, ordem').order('ordem', { ascending: true });
  cache = error ? [] : ((data as TipoTarefa[]) || []);
  ouvintes.forEach(f => f(cache!));
  return cache;
}

/** Catálogo de tipos, carregado uma vez e compartilhado entre as telas. */
export function useTiposTarefa() {
  const [tipos, setTipos] = useState<TipoTarefa[]>(cache ?? []);
  useEffect(() => {
    ouvintes.add(setTipos);
    if (cache) setTipos(cache);
    else (pendente ||= buscar().finally(() => { pendente = null; }));
    return () => { ouvintes.delete(setTipos); };
  }, []);
  const recarregar = useCallback(() => buscar(), []);
  const porId = useCallback((id?: string | null) => (id ? tipos.find(t => t.id === id) : undefined), [tipos]);
  return { tipos, porId, recarregar };
}

/**
 * Tipo de várias tarefas de uma vez, para telas que montam as tarefas com os próprios selects
 * (Home, Board...). Busca só `id, tipo_id` das tarefas mostradas; sem a coluna (SQL pendente), nada aparece.
 */
export function useTipoDasTarefas(ids: string[]) {
  const { tipos } = useTiposTarefa();
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const chave = [...ids].sort().join(',');
  useEffect(() => {
    if (!tipos.length || !chave) { setMapa({}); return; }
    let vivo = true;
    (async () => {
      const lista = chave.split(',');
      const out: Record<string, string> = {};
      for (let i = 0; i < lista.length; i += 150) {
        const { data, error } = await supabase.from('project_tasks').select('id, tipo_id').in('id', lista.slice(i, i + 150));
        if (error) break;
        for (const r of (data as { id: string; tipo_id: string | null }[]) || []) if (r.tipo_id) out[r.id] = r.tipo_id;
      }
      if (vivo) setMapa(out);
    })();
    return () => { vivo = false; };
  }, [chave, tipos.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCallback((id: string) => tipos.find(t => t.id === mapa[id]), [tipos, mapa]);
}
