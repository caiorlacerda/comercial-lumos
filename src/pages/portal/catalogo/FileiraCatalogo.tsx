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
  const setaEsq = useRef<HTMLButtonElement | null>(null);
  const setaDir = useRef<HTMLButtonElement | null>(null);

  const medir = useCallback(() => {
    const el = faixa.current;
    if (!el) return;
    const esq = el.scrollLeft > 4;
    const dir = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    // A seta que está para sumir não pode levar o foco do teclado junto: passa
    // para a seta do lado oposto (se ela está na tela) ou para a própria faixa.
    // Tem que ser agora, com o botão ainda no DOM.
    // A oposta só serve se continuar montada depois desta medição (valores novos).
    const ativo = document.activeElement;
    if ((ativo === setaDir.current && !dir) || (ativo === setaEsq.current && !esq)) {
      const eraDir = ativo === setaDir.current;
      const oposta = eraDir ? setaEsq.current : setaDir.current;
      const opostaFica = eraDir ? esq : dir;
      const destino = oposta && opostaFica ? oposta : el;
      destino.focus({ preventScroll: true });
    }
    setPodeEsq(esq);
    setPodeDir(dir);
  }, []);

  // Mede de novo quando os vídeos mudam e acompanha o tamanho da faixa e do
  // último card (que muda quando a capa/título altera a largura do conteúdo).
  useEffect(() => {
    medir();
    const el = faixa.current;
    if (!el) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    if (el.lastElementChild) ro?.observe(el.lastElementChild);
    return () => { ro?.disconnect(); if (quadro.current !== null) cancelAnimationFrame(quadro.current); };
  }, [medir, fileira.itens]);

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
    // Só foco de teclado: o toque ou o clique já escolhem o que está na tela.
    if (!el || !card) return;
    let teclado = false;
    try { teclado = card.matches(':focus-visible'); } catch { teclado = false; } // Safari antigo lança
    if (!teclado) return;
    // O scroll-padding da faixa dá a folga nas pontas.
    card.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' });
  };

  const titulo = `fileira-${fileira.id}`;
  return (
    <section className="fileira" aria-labelledby={titulo}>
      <h3 id={titulo} className="fileira-titulo">
        {fileira.titulo}{' '}
        <span className="fileira-n">{fileira.itens.length} {fileira.itens.length === 1 ? 'vídeo' : 'vídeos'}</span>
      </h3>
      <div className="fileira-moldura">
        {podeEsq && (
          <button type="button" ref={setaEsq} className="fileira-seta esq" aria-label={`Rolar ${fileira.titulo} para a esquerda`} onClick={() => rolar(-1)}>
            <SetaMes dir="esq" />
          </button>
        )}
        <div className="fileira-faixa" ref={el => { faixa.current = el; registrar(fileira.id, el); }} tabIndex={-1}
          onFocus={trazerFoco}
          onScroll={() => { if (quadro.current === null) quadro.current = requestAnimationFrame(() => { quadro.current = null; medir(); }); }}>
          {fileira.itens.map(it => (
            <CardCatalogo key={it.chave} item={it} capa={it.reviewToken ? capas[it.reviewToken] : null}
              observar={observar} aoAbrir={aoAbrir} mostrarProjeto={mostrarProjeto} />
          ))}
        </div>
        {podeDir && (
          <button type="button" ref={setaDir} className="fileira-seta dir" aria-label={`Rolar ${fileira.titulo} para a direita`} onClick={() => rolar(1)}>
            <SetaMes dir="dir" />
          </button>
        )}
      </div>
    </section>
  );
}
