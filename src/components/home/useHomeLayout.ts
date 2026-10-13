import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BLOCOS, ORDEM_PADRAO, type BlocoHome } from './catalogo';
import type { PapelHome } from './tipos';

/** O que a pessoa personalizou: a ordem completa e os blocos escondidos. */
interface Salvo { v: 1; ordem: string[]; ocultos: string[] }

const CHAVE_LOCAL = 'lumos:home-layout:v1';

const lerLocal = (): Salvo | null => {
  try {
    const j = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || 'null');
    return j && Array.isArray(j.ordem) && Array.isArray(j.ocultos) ? j : null;
  } catch { return null; }
};
const guardarLocal = (s: Salvo | null) => {
  try { s ? localStorage.setItem(CHAVE_LOCAL, JSON.stringify(s)) : localStorage.removeItem(CHAVE_LOCAL); } catch { /* sem armazenamento: segue */ }
};

export interface ItemLayout { bloco: BlocoHome; oculto: boolean }

/**
 * Layout da Home de cada pessoa: ordem e blocos escondidos. O padrão depende do papel;
 * a personalização fica no navegador e, se a coluna `home_layout` existir em
 * `dashboard_preferences`, também na conta (vale em qualquer aparelho).
 */
export function useHomeLayout(papel: PapelHome) {
  const permitidos = useMemo(() => BLOCOS.filter(b => b.papeis.includes(papel)), [papel]);
  const [salvo, setSalvo] = useState<Salvo | null>(() => lerLocal());

  // Busca o layout da conta (se a coluna ainda não existe no banco, segue só com o local)
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase.from('dashboard_preferences')
          .select('home_layout').eq('user_id', user.id).maybeSingle();
        const remoto = (data as any)?.home_layout;
        if (error || !remoto || !Array.isArray(remoto.ordem) || !Array.isArray(remoto.ocultos)) return;
        if (vivo) { setSalvo(remoto as Salvo); guardarLocal(remoto as Salvo); }
      } catch { /* sem rede ou sem coluna: fica o local */ }
    })();
    return () => { vivo = false; };
  }, []);

  const itens = useMemo<ItemLayout[]>(() => {
    const ids = permitidos.map(b => b.id);
    const padrao = ORDEM_PADRAO[papel].filter(id => ids.includes(id));
    const padraoOcultos = ids.filter(id => !padrao.includes(id));
    const ordemBase = [...padrao, ...padraoOcultos];

    let ordem = ordemBase;
    let ocultos = padraoOcultos;
    if (salvo) {
      const conhecidos = salvo.ordem.filter(id => ids.includes(id));
      const novos = ordemBase.filter(id => !conhecidos.includes(id));          // blocos criados depois
      ordem = [...conhecidos, ...novos];
      ocultos = [...salvo.ocultos.filter(id => ids.includes(id)), ...novos.filter(id => padraoOcultos.includes(id))];
    }
    return ordem.map(id => ({ bloco: permitidos.find(b => b.id === id)!, oculto: ocultos.includes(id) }));
  }, [permitidos, papel, salvo]);

  const salvar = useCallback(async (novo: Salvo | null) => {
    setSalvo(novo);
    guardarLocal(novo);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('dashboard_preferences').upsert(
        { user_id: user.id, home_layout: novo, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    } catch { /* melhor esforço: o local já guardou */ }
  }, []);

  const emSalvo = useCallback((lista: ItemLayout[]): Salvo => ({
    v: 1, ordem: lista.map(i => i.bloco.id), ocultos: lista.filter(i => i.oculto).map(i => i.bloco.id),
  }), []);

  const mover = useCallback((id: string, direcao: -1 | 1) => {
    const lista = [...itens];
    const i = lista.findIndex(x => x.bloco.id === id);
    const j = i + direcao;
    if (i < 0 || j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    void salvar(emSalvo(lista));
  }, [itens, salvar, emSalvo]);

  const alternar = useCallback((id: string) => {
    void salvar(emSalvo(itens.map(x => x.bloco.id === id ? { ...x, oculto: !x.oculto } : x)));
  }, [itens, salvar, emSalvo]);

  const restaurar = useCallback(() => { void salvar(null); }, [salvar]);

  return { itens, visiveis: itens.filter(i => !i.oculto).map(i => i.bloco), mover, alternar, restaurar, personalizado: !!salvo };
}
