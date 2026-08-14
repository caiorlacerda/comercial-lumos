import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Preferência de tela por usuário, guardada no banco (segue a pessoa em
 * qualquer computador). O padrão pinta a tela na hora; o que veio do banco
 * entra por cima assim que chega.
 */
export function useViewPrefs<T extends Record<string, unknown>>(viewKey: string, padrao: T) {
  const [prefs, setPrefs] = useState<T>(padrao);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) { if (vivo) setCarregado(true); return; }
      const { data } = await supabase
        .from('user_view_prefs')
        .select('prefs')
        .eq('user_id', uid)
        .eq('view_key', viewKey)
        .maybeSingle();
      if (!vivo) return;
      if (data?.prefs) setPrefs(p => ({ ...p, ...(data.prefs as T) }));
      setCarregado(true);
    })();
    return () => { vivo = false; };
  }, [viewKey]);

  // Salva otimista: a tela muda na hora, o banco acompanha.
  const salvar = useCallback(async (patch: Partial<T>) => {
    setPrefs(p => ({ ...p, ...patch }));
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    setPrefs(atual => {
      void supabase.from('user_view_prefs').upsert({
        user_id: uid, view_key: viewKey, prefs: atual, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,view_key' });
      return atual;
    });
  }, [viewKey]);

  return { prefs, salvar, carregado };
}
