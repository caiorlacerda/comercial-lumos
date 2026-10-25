import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { ProvedorYjsSupabase } from '@/lib/colaboracao/yjsSupabase';

/**
 * Prepara um texto colaborativo: carrega (ou cria, na primeira vez) o documento compartilhado e entra no canal
 * em tempo real. Devolve o documento e o provedor para o editor usar com as extensões de colaboração.
 *
 * `extensoesParaSemear` devolve as extensões do editor (SEM as de colaboração): servem para montar o documento
 * inicial a partir do HTML que já existia, e precisam ter o mesmo esquema do editor de verdade.
 */
export type EstadoTextoColaborativo = 'inativo' | 'carregando' | 'pronto' | 'falhou';

export function useTextoColaborativo({ chave, htmlInicial, ativo, usuario, extensoesParaSemear }: {
  chave: string;
  htmlInicial: string;
  /** Só começa quando verdadeiro (ex.: depois de buscar o texto atual). */
  ativo: boolean;
  usuario: { nome: string; cor: string };
  extensoesParaSemear: () => Extensions;
}) {
  const [estado, setEstado] = useState<EstadoTextoColaborativo>('inativo');
  const [conexao, setConexao] = useState<{ doc: Y.Doc; provedor: ProvedorYjsSupabase } | null>(null);
  const refs = useRef({ htmlInicial, usuario, extensoesParaSemear });
  refs.current = { htmlInicial, usuario, extensoesParaSemear };

  useEffect(() => {
    setConexao(null);
    if (!ativo) { setEstado('inativo'); return; }
    setEstado('carregando');
    let vivo = true;
    let provedor: ProvedorYjsSupabase | null = null;
    (async () => {
      try {
        const doc = new Y.Doc();
        provedor = new ProvedorYjsSupabase(chave, doc, refs.current.usuario);
        let versao = await provedor.carregar();
        if (!vivo) return;
        if (!versao) {
          // Primeira vez: monta o documento com o texto que já existia e guarda (só um dos navegadores consegue).
          const base = new Y.Doc();
          const temp = new Editor({ extensions: [...refs.current.extensoesParaSemear(), Collaboration.configure({ document: base })] });
          temp.commands.setContent(refs.current.htmlInicial || '');
          const inicial = Y.encodeStateAsUpdate(base);
          temp.destroy(); base.destroy();
          if (!vivo) return;
          await ProvedorYjsSupabase.semear(chave, inicial);
          versao = await provedor.carregar();
          if (!vivo) return;
          if (!versao) throw new Error('estado do texto não foi criado');
        }
        await provedor.conectar();
        if (vivo) { setConexao({ doc, provedor }); setEstado('pronto'); }
      } catch (e) {
        console.error('Texto colaborativo indisponível:', e);
        if (vivo) setEstado('falhou');
      }
    })();
    return () => { vivo = false; if (provedor) void provedor.destruir(); };
  }, [chave, ativo]);

  return { estado, doc: conexao?.doc ?? null, provedor: conexao?.provedor ?? null };
}
