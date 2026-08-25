import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Preferência de tela por usuário, guardada no banco (segue a pessoa em
 * qualquer computador, em qualquer navegador).
 *
 * Duas coisas que já morderam a gente aqui:
 *
 * 1. CORRIDA — se a pessoa mexia na preferência ANTES de a leitura do banco
 *    voltar, a resposta antiga caía por cima da escolha nova e a tela
 *    "desfazia" sozinha, mesmo com o valor certo já gravado. Daí o `mexeuAqui`:
 *    depois que a pessoa escolhe, a resposta atrasada do banco só preenche as
 *    chaves que ela não tocou.
 *
 * 2. PISCADA — a tela pintava no padrão e só depois trocava pelo que estava
 *    salvo, o que passa a sensação de que nada foi guardado. Agora a última
 *    escolha fica também num cache local por usuário, então a primeira pintura
 *    já sai certa. O banco continua sendo a verdade: quando a resposta chega,
 *    ela manda.
 */
const cacheKey = (viewKey: string, uid: string) => `lumos_viewprefs:${viewKey}:${uid}`;

const lerCache = <T,>(viewKey: string, uid: string): Partial<T> | null => {
  try {
    const cru = localStorage.getItem(cacheKey(viewKey, uid));
    return cru ? (JSON.parse(cru) as Partial<T>) : null;
  } catch { return null; }
};

const gravarCache = (viewKey: string, uid: string, valor: unknown) => {
  try { localStorage.setItem(cacheKey(viewKey, uid), JSON.stringify(valor)); } catch { /* ignora */ }
};

export function useViewPrefs<T extends Record<string, unknown>>(viewKey: string, padrao: T) {
  const [prefs, setPrefs] = useState<T>(padrao);
  const [carregado, setCarregado] = useState(false);
  // Espelho síncrono do estado: precisamos do valor completo na hora de gravar,
  // sem depender de quando o React processa o setState.
  const atual = useRef<T>(padrao);
  const mexeuAqui = useRef<Set<string>>(new Set());
  const uidRef = useRef<string | null>(null);

  const aplicar = useCallback((novo: T) => {
    atual.current = novo;
    setPrefs(novo);
  }, []);

  // Só entra o que a pessoa não acabou de mexer nesta sessão.
  const mesclarDeFora = useCallback((vindo: Record<string, unknown>) => {
    const seguro = Object.fromEntries(
      Object.entries(vindo).filter(([k]) => !mexeuAqui.current.has(k))
    );
    aplicar({ ...atual.current, ...seguro } as T);
  }, [aplicar]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      // getSession lê a sessão que já está no navegador, sem ida à rede — é o
      // que deixa a primeira pintura sair certa.
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id ?? null;
      uidRef.current = uid;
      if (!uid) { if (vivo) setCarregado(true); return; }

      const doCache = lerCache<T>(viewKey, uid);
      if (vivo && doCache) mesclarDeFora(doCache as Record<string, unknown>);

      const { data } = await supabase
        .from('user_view_prefs')
        .select('prefs')
        .eq('view_key', viewKey)
        .eq('user_id', uid)
        .maybeSingle();
      if (!vivo) return;
      if (data?.prefs) {
        mesclarDeFora(data.prefs as Record<string, unknown>);
        gravarCache(viewKey, uid, data.prefs);
      }
      setCarregado(true);
    })();
    return () => { vivo = false; };
  }, [viewKey, mesclarDeFora]);

  // Salva otimista: a tela muda na hora, o banco acompanha. Se o banco recusar,
  // o erro aparece no console em vez de sumir em silêncio (era fire-and-forget).
  const salvar = useCallback(async (patch: Partial<T>) => {
    Object.keys(patch).forEach(k => mexeuAqui.current.add(k));
    const completo = { ...atual.current, ...patch } as T;
    aplicar(completo);

    let uid = uidRef.current;
    if (!uid) {
      const { data: sess } = await supabase.auth.getSession();
      uid = sess?.session?.user?.id ?? null;
      uidRef.current = uid;
    }
    if (!uid) return { ok: false, erro: 'sessão expirada' };
    gravarCache(viewKey, uid, completo);

    const { error } = await supabase.from('user_view_prefs').upsert({
      user_id: uid, view_key: viewKey, prefs: completo, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,view_key' });
    if (error) {
      console.error(`[useViewPrefs:${viewKey}] não deu pra salvar a preferência:`, error.message);
      return { ok: false, erro: error.message };
    }
    return { ok: true };
  }, [viewKey, aplicar]);

  return { prefs, salvar, carregado };
}
