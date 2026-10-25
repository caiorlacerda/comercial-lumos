import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Presença em um documento (orçamento, tarefa...): quem está com ele aberto e qual campo está editando.
 * Usa o Realtime do Supabase (canal de presença por documento). Não grava nada no banco.
 */
export interface Pessoa {
  userId: string;
  nome: string;
  avatar: string | null;
  cor: string;
  /** Campo em edição agora, ex.: "item:<id>" ou "briefing". Null = só olhando. */
  campo: string | null;
}

// Cores com bom contraste sobre claro e escuro. A cor nunca é a única pista: o nome aparece junto.
const PALETA = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4d7c0f'];
export const corDaPessoa = (userId: string) => {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
};

interface Eu { id: string; nome: string; avatar?: string | null }

export function usePresencaDoDocumento(chave: string | null, eu: Eu | null) {
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const canalRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const campoRef = useRef<string | null>(null);
  const prontoRef = useRef(false);
  // Uma aba = uma chave: duas abas da mesma pessoa não se contam duas vezes nem se bloqueiam.
  const abaRef = useRef(Math.random().toString(36).slice(2, 9));

  const meuId = eu?.id, meuNome = eu?.nome, meuAvatar = eu?.avatar ?? null;

  const anunciar = useCallback(() => {
    if (!canalRef.current || !prontoRef.current || !meuId) return;
    canalRef.current.track({ userId: meuId, nome: meuNome, avatar: meuAvatar, campo: campoRef.current, em: Date.now() }).catch(() => { /* reconecta sozinho */ });
  }, [meuId, meuNome, meuAvatar]);

  useEffect(() => {
    if (!chave || !meuId) return;
    const canal = supabase.channel(`doc:${chave}`, { config: { presence: { key: `${meuId}:${abaRef.current}` } } });
    canalRef.current = canal;
    canal.on('presence', { event: 'sync' }, () => {
      const estado = canal.presenceState() as Record<string, any[]>;
      const porPessoa = new Map<string, Pessoa & { em: number }>();
      for (const metas of Object.values(estado)) {
        for (const m of metas) {
          if (!m?.userId || m.userId === meuId) continue;
          const atual = porPessoa.get(m.userId);
          // Duas abas da mesma pessoa: vale a que mexeu por último.
          if (!atual || (m.em ?? 0) >= atual.em) {
            porPessoa.set(m.userId, { userId: m.userId, nome: m.nome || 'Alguém', avatar: m.avatar ?? null, cor: corDaPessoa(m.userId), campo: m.campo ?? null, em: m.em ?? 0 });
          }
        }
      }
      setPessoas([...porPessoa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(({ em: _em, ...p }) => p));
    });
    canal.subscribe(status => {
      if (status === 'SUBSCRIBED') { prontoRef.current = true; anunciar(); }
    });
    return () => {
      prontoRef.current = false;
      canalRef.current = null;
      supabase.removeChannel(canal);
      setPessoas([]);
    };
  }, [chave, meuId, anunciar]);

  /** Avisa qual campo esta pessoa está editando (null = nenhum). Só envia quando muda. */
  const definirCampo = useCallback((campo: string | null) => {
    if (campoRef.current === campo) return;
    campoRef.current = campo;
    anunciar();
  }, [anunciar]);

  /** Quem está editando um campo agora (outras pessoas). */
  const quemEdita = useMemo(() => {
    const m = new Map<string, Pessoa>();
    for (const p of pessoas) if (p.campo) m.set(p.campo, p);
    return (campo: string) => m.get(campo);
  }, [pessoas]);

  return { pessoas, definirCampo, quemEdita };
}
