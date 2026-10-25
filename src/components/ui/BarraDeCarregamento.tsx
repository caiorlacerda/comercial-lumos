import { useEffect, useRef, useState } from 'react';
import { useCarregandoGlobal } from '@/lib/progressoDeCarregamento';

/**
 * Barra fina amarela no topo da tela. Só aparece se o carregamento passar de ~150 ms (carregamento
 * rápido não pisca nada), corre devagar até ~85% e, quando termina, completa e some.
 */
export default function BarraDeCarregamento() {
  const ativo = useCarregandoGlobal();
  const [fase, setFase] = useState<'oculta' | 'correndo' | 'completa'>('oculta');
  const espera = useRef<number | null>(null);
  const fim = useRef<number | null>(null);

  useEffect(() => {
    if (espera.current) window.clearTimeout(espera.current);
    if (fim.current) window.clearTimeout(fim.current);
    if (ativo) {
      espera.current = window.setTimeout(() => setFase('correndo'), 150);
    } else {
      setFase(f => (f === 'correndo' ? 'completa' : 'oculta'));
      fim.current = window.setTimeout(() => setFase('oculta'), 350);
    }
    return () => {
      if (espera.current) window.clearTimeout(espera.current);
      if (fim.current) window.clearTimeout(fim.current);
    };
  }, [ativo]);

  // A largura precisa nascer em 0 e só depois ir a 85%, senão a transição não anima.
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    if (fase === 'oculta') { setLargura(0); return; }
    if (fase === 'completa') { setLargura(100); return; }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setLargura(85)));
    return () => cancelAnimationFrame(id);
  }, [fase]);

  if (fase === 'oculta') return null;
  return (
    <div aria-hidden className="pointer-events-none fixed left-0 right-0 top-0 z-[500] h-[3px]">
      <div
        className="h-full bg-lumos-yellow shadow-[0_0_8px_rgba(239,199,0,0.7)]"
        style={{
          width: `${largura}%`,
          opacity: fase === 'completa' ? 0 : 1,
          transition: fase === 'completa' ? 'width 0.2s ease-out, opacity 0.3s ease-out 0.15s' : 'width 9s cubic-bezier(0.1, 0.6, 0.3, 1)',
        }}
      />
    </div>
  );
}
