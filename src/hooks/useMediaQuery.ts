import { useEffect, useState } from 'react';

/** Acompanha uma media query do CSS (ex.: `(max-width: 1023px)`), atualizando quando a tela muda de tamanho ou gira. */
export function useMediaQuery(consulta: string): boolean {
  const [bate, setBate] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(consulta).matches : false));
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const aoMudar = () => setBate(m.matches);
    aoMudar();
    m.addEventListener('change', aoMudar);
    return () => m.removeEventListener('change', aoMudar);
  }, [consulta]);
  return bate;
}
