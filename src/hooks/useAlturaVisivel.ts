import { useEffect, useState } from 'react';

/**
 * Área REALMENTE visível da tela (a "visual viewport"). No iPhone, com o teclado aberto, ela encolhe e a
 * tela fixa (fixed inset-0) continua do tamanho de antes: o fim dela, onde fica a caixa de comentário,
 * ficava atrás do teclado. Quem usa aplica `altura` e `topo` à tela fixa para ela caber no que se vê.
 */
export function useAlturaVisivel(): { altura: number; topo: number } | null {
  const [area, setArea] = useState<{ altura: number; topo: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const ler = () => setArea({ altura: Math.round(vv.height), topo: Math.round(vv.offsetTop) });
    ler();
    vv.addEventListener('resize', ler);
    vv.addEventListener('scroll', ler);
    return () => { vv.removeEventListener('resize', ler); vv.removeEventListener('scroll', ler); };
  }, []);
  return area;
}
