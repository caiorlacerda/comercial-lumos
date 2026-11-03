import { useCallback, useState } from 'react';
import { FORMATO_MES } from '@/lib/filtroMes';

/**
 * Mês escolhido num filtro, lembrado no navegador (um por tela, pela `chave`).
 * '' = todos os meses. O armazenamento pode falhar (janela privada, bloqueio):
 * nesse caso o filtro funciona igual, só não é lembrado.
 */
export function useMesLembrado(chave: string): [string, (mes: string) => void] {
  const [mes, setMes] = useState<string>(() => {
    try {
      const salvo = localStorage.getItem(chave) ?? '';
      return FORMATO_MES.test(salvo) ? salvo : '';
    } catch { return ''; }
  });

  const mudar = useCallback((novo: string) => {
    setMes(novo);
    try {
      if (novo) localStorage.setItem(chave, novo);
      else localStorage.removeItem(chave);
    } catch { /* sem armazenamento: o filtro vale só nesta sessão */ }
  }, [chave]);

  return [mes, mudar];
}
