import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { VisaoProjetos } from './tipos';

/** Busca saúde, pendências e equipe. Qualquer falha (função ainda não criada,
 *  rede, erro de acesso) devolve null e os blocos novos simplesmente não aparecem:
 *  o resto do portal nunca depende desta chamada. */
export function useVisaoProjetos(token: string, ativo: boolean): VisaoProjetos | null {
  const [visao, setVisao] = useState<VisaoProjetos | null>(null);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    supabase.rpc('portal_visao_projetos', { p_token: token }).then(({ data, error }) => {
      if (!vivo) return;
      if (error || !data || (data as { error?: string }).error) { setVisao(null); return; }
      setVisao(data as VisaoProjetos);
    });
    return () => { vivo = false; };
  }, [token, ativo]);
  return visao;
}
