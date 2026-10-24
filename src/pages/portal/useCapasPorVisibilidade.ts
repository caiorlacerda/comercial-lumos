import { useCallback, useEffect, useRef } from 'react';

/**
 * Pede a capa de um card só quando ele chega perto da tela. O `pedirCapas` do
 * shell muda a cada capa que chega (depende do estado), então ele entra por
 * ref: o observador não é refeito. Os pedidos de um instante são juntados e
 * enviados de uma vez (o shell já parte em lotes de 6).
 */
export function useCapasPorVisibilidade(pedirCapas: (tokens: string[]) => Promise<void>) {
  const pedirRef = useRef(pedirCapas);
  pedirRef.current = pedirCapas;

  const observador = useRef<IntersectionObserver | null>(null);
  const tokenDe = useRef(new Map<Element, string>());
  const pendentes = useRef(new Set<string>());
  const temporizador = useRef<number | null>(null);
  const limpezaAgendada = useRef(false);

  const despachar = useCallback(() => {
    temporizador.current = null;
    if (!pendentes.current.size) return;
    const lista = [...pendentes.current];
    pendentes.current.clear();
    void pedirRef.current(lista);
  }, []);

  // Card que saiu da tela de vez (o React chama o ref com null, sem dizer qual
  // elemento era): depois do commit, tira do mapa o que não está mais no DOM.
  const limpar = useCallback(() => {
    limpezaAgendada.current = false;
    tokenDe.current.forEach((_t, el) => {
      if (el.isConnected) return;
      observador.current?.unobserve(el);
      tokenDe.current.delete(el);
    });
  }, []);

  useEffect(() => {
    // Sem IntersectionObserver (navegador antigo): quem pede é a função de registro
    // (abaixo), então aqui não há nada a observar.
    if (typeof IntersectionObserver === 'undefined') return;
    observador.current = new IntersectionObserver(entradas => {
      entradas.forEach(en => {
        if (!en.isIntersecting) return;
        const t = tokenDe.current.get(en.target);
        if (!t) return;
        pendentes.current.add(t);
        observador.current?.unobserve(en.target);
      });
      if (pendentes.current.size && temporizador.current === null) {
        temporizador.current = window.setTimeout(despachar, 120);
      }
    }, { rootMargin: '0px 300px 0px 300px' });
    // Cards que registraram antes do observador existir.
    tokenDe.current.forEach((_t, el) => observador.current?.observe(el));
    return () => {
      observador.current?.disconnect();
      observador.current = null;
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
      temporizador.current = null;
    };
  }, [despachar]);

  return useCallback((el: Element | null, reviewToken: string | null) => {
    if (!el) {
      if (!limpezaAgendada.current) {
        limpezaAgendada.current = true;
        queueMicrotask(limpar);
      }
      return;
    }
    if (!reviewToken) return;
    if (tokenDe.current.get(el) === reviewToken) return;
    tokenDe.current.set(el, reviewToken);
    // Sem IntersectionObserver (navegador antigo): pede na hora, também para cards
    // que registram depois do primeiro commit. O mesmo atraso curto junta os pedidos.
    if (typeof IntersectionObserver === 'undefined') {
      pendentes.current.add(reviewToken);
      if (temporizador.current === null) temporizador.current = window.setTimeout(despachar, 120);
      return;
    }
    observador.current?.observe(el);
  }, [limpar, despachar]);
}
