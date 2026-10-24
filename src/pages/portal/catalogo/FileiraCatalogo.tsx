import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';
import type { Fileira } from '../catalogo';
import CardCatalogo from './CardCatalogo';
import { SetaMes } from '../icones';

/**
 * Uma fileira que rola de lado. Setas só aparecem quando há mais conteúdo
 * daquele lado e não aparecem em tela de toque (lá o dedo rola). O elemento
 * rolável é entregue por `registrar`, para o Catálogo ler e restaurar a posição
 * quando a pessoa volta do vídeo.
 */
export default function FileiraCatalogo({ fileira, capas, observar, aoAbrir, mostrarProjeto, registrar }: {
  fileira: Fileira;
  capas: Record<string, string | null>;
  observar: (el: Element | null, token: string | null) => void;
  aoAbrir: () => void;
  mostrarProjeto: boolean;
  /** Entrega o elemento rolável para quem precisa ler/escrever o scrollLeft. */
  registrar: (id: string, el: HTMLDivElement | null) => void;
}) {
  const faixa = useRef<HTMLDivElement | null>(null);
  const [podeEsq, setPodeEsq] = useState(false);
  const [podeDir, setPodeDir] = useState(false);
  const quadro = useRef<number | null>(null);

  const medir = useCallback(() => {
    const el = faixa.current;
    if (!el) return;
    setPodeEsq(el.scrollLeft > 4);
    setPodeDir(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    medir();
    const el = faixa.current;
    if (!el) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); if (quadro.current !== null) cancelAnimationFrame(quadro.current); };
  }, [medir, fileira.itens.length]);

  const rolar = (dir: -1 | 1) => {
    const el = faixa.current;
    if (!el) return;
    const reduzido = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: reduzido ? 'auto' : 'smooth' });
  };

  // Foco por teclado em card cortado pela borda da fileira: o navegador só rola
  // se o card estiver quase todo fora, e um card pela metade escondido atrás da
  // borda não serve a quem navega por Tab. Traz o card inteiro para dentro.
  const trazerFoco = (e: FocusEvent<HTMLDivElement>) => {
    const el = faixa.current;
    const card = (e.target as HTMLElement).closest('.cat-card');
    if (!el || !card) return;
    const f = el.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    if (c.left < f.left) el.scrollBy({ left: c.left - f.left - 8, behavior: 'auto' });
    else if (c.right > f.right) el.scrollBy({ left: c.right - f.right + 8, behavior: 'auto' });
  };

  const titulo = `fileira-${fileira.id}`;
  return (
    <section className="fileira" aria-labelledby={titulo}>
      <h3 id={titulo} className="fileira-titulo">
        {fileira.titulo}
        <span className="fileira-n">{fileira.itens.length} {fileira.itens.length === 1 ? 'vídeo' : 'vídeos'}</span>
      </h3>
      <div className="fileira-moldura">
        {podeEsq && (
          <button type="button" className="fileira-seta esq" aria-label={`Rolar ${fileira.titulo} para a esquerda`} onClick={() => rolar(-1)}>
            <SetaMes dir="esq" />
          </button>
        )}
        <div className="fileira-faixa" ref={el => { faixa.current = el; registrar(fileira.id, el); }}
          onFocus={trazerFoco}
          onScroll={() => { if (quadro.current === null) quadro.current = requestAnimationFrame(() => { quadro.current = null; medir(); }); }}>
          {fileira.itens.map(it => (
            <CardCatalogo key={it.chave} item={it} capa={it.reviewToken ? capas[it.reviewToken] : null}
              observar={observar} aoAbrir={aoAbrir} mostrarProjeto={mostrarProjeto} />
          ))}
        </div>
        {podeDir && (
          <button type="button" className="fileira-seta dir" aria-label={`Rolar ${fileira.titulo} para a direita`} onClick={() => rolar(1)}>
            <SetaMes dir="dir" />
          </button>
        )}
      </div>
    </section>
  );
}
