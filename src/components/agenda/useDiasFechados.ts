import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { dataDeIso } from './calendario';

/** Dias em que a produtora fechou a agenda (datas avulsas e dias da semana). Devolve o motivo, ou null se está aberto. */
export function useDiasFechados() {
  const [fechados, setFechados] = useState<{ datas: Map<string, string>; semana: Map<number, string> }>({ datas: new Map(), semana: new Map() });

  useEffect(() => {
    (async () => {
      // As tabelas podem não existir antes das migrations: erro vira "nada fechado".
      const [b, w] = await Promise.all([
        supabase.from('agenda_bloqueios').select('data, motivo'),
        supabase.from('agenda_semana_fechada').select('dia_semana, motivo'),
      ]);
      setFechados({
        datas: new Map(((b.data as any[]) || []).map(r => [String(r.data).slice(0, 10), r.motivo || 'Fechada'])),
        semana: new Map(((w.data as any[]) || []).map(r => [Number(r.dia_semana), r.motivo || 'Fechada'])),
      });
    })();
  }, []);

  return useCallback(
    (iso: string) => fechados.datas.get(iso) ?? fechados.semana.get(dataDeIso(iso).getDay()) ?? null,
    [fechados],
  );
}
