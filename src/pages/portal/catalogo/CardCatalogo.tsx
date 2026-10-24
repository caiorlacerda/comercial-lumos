import { useCallback } from 'react';
import type { ItemCatalogo } from '../catalogo';
import { ESTADO } from '../motivos';
import { formato } from '../formatacao';

/** Um vídeo do catálogo: capa no formato real, título embaixo, selo do estado. */
export default function CardCatalogo({ item, capa, observar, aoAbrir, mostrarProjeto }: {
  item: ItemCatalogo;
  capa: string | null | undefined;
  observar: (el: Element | null, token: string | null) => void;
  aoAbrir: () => void;
  mostrarProjeto: boolean;
}) {
  const f = formato(item.largura, item.altura);
  const estado = ESTADO[item.status];
  const ref = useCallback((el: HTMLAnchorElement | null) => observar(el, item.reviewToken), [observar, item.reviewToken]);
  const meta = `v${String(item.versao).padStart(2, '0')}${mostrarProjeto ? ` · ${item.projeto}` : ''}`;
  return (
    <a ref={ref} className={`cat-card ${f.classe}`}
      href={item.reviewToken ? `/revisao/${item.reviewToken}` : undefined}
      onClick={item.reviewToken ? () => aoAbrir() : undefined}
      aria-label={`${item.nome}, ${meta}${estado ? `, ${estado.label}` : ''}`}>
      <span className="cat-capa">
        {capa && <img className="foto" src={capa} alt="" loading="lazy" draggable={false} />}
        <span className="fmt">{f.rotulo}</span>
        {estado && <span className={`cat-selo ${estado.classe}`}>{estado.label}</span>}
      </span>
      <span className="cat-titulo">{item.nome}</span>
      <span className="cat-meta">{meta}</span>
    </a>
  );
}
