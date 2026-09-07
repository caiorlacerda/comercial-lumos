import type { TwoPanelsSecao } from '../tipos';

export default function TwoPanelsSection({ kicker, title, titleAccent, esquerda, direita }: TwoPanelsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      <div className="wd-two-panels">
        <div className="wd-panel">
          <h3>{esquerda.titulo}</h3>
          <p className="wd-panel-sub">{esquerda.sub}</p>
          <ul>{esquerda.itens.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </div>
        <div className="wd-panel wd-panel-fora">
          <h3>{direita.titulo}</h3>
          <p className="wd-panel-sub">{direita.sub}</p>
          <ul>{direita.itens.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}
