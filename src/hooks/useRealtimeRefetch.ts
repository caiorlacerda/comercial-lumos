import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Colaboração em tempo real (estilo Google Docs): assina INSERT/UPDATE/DELETE
 * nas tabelas indicadas via Supabase Realtime e chama `onChange` com debounce.
 *
 * Padrão de uso — "refetch silencioso": o callback deve rebuscar os dados SEM
 * acionar spinner (os dados antigos ficam na tela até os novos chegarem), para
 * que alterações de outros usuários apareçam de forma fluida.
 *
 * Requisito no banco: as tabelas precisam estar na publication
 * `supabase_realtime` (migration 2026072300). RLS se aplica aos eventos —
 * cada usuário só recebe eventos de linhas que pode ler.
 */
export function useRealtimeRefetch(
  tables: string[],
  onChange: () => void,
  opts?: { debounceMs?: number; enabled?: boolean }
) {
  // Ref para o callback: o efeito não reassina quando o callback muda de
  // identidade (comum com closures de estado), só quando as tabelas mudam.
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const key = tables.join(',');
  const debounceMs = opts?.debounceMs ?? 400;
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled || !key) return;
    let timer: number | undefined;
    // Nome único por montagem: evita colisão quando duas instâncias da mesma
    // página coexistem durante transições.
    const channel = supabase.channel(`rt:${key}:${Math.random().toString(36).slice(2, 9)}`);
    for (const table of key.split(',')) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => cbRef.current(), debounceMs);
        }
      );
    }
    channel.subscribe();
    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [key, enabled, debounceMs]);
}
