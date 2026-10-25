import { useEffect, useState } from 'react';

/**
 * Barra de carregamento do topo: qualquer tela (ou o carregamento de uma página) avisa que está
 * carregando, e a barra fica correndo até todo mundo terminar. Um contador, para vários
 * carregamentos ao mesmo tempo não se atrapalharem.
 */
let ativos = 0;
const ouvintes = new Set<(ativo: boolean) => void>();
const avisar = () => ouvintes.forEach(f => f(ativos > 0));

export const iniciarCarregamento = () => { ativos++; avisar(); };
export const concluirCarregamento = () => { ativos = Math.max(0, ativos - 1); avisar(); };

/** Enquanto `ativo` for verdadeiro, a barra do topo corre. */
export function useBarraDeCarregamento(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;
    iniciarCarregamento();
    return concluirCarregamento;
  }, [ativo]);
}

/** Usado pela própria barra para saber se deve aparecer. */
export function useCarregandoGlobal() {
  const [ativo, setAtivo] = useState(ativos > 0);
  useEffect(() => { ouvintes.add(setAtivo); setAtivo(ativos > 0); return () => { ouvintes.delete(setAtivo); }; }, []);
  return ativo;
}
