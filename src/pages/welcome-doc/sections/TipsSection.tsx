import type { TipsSecao } from '../tipos';

export default function TipsSection({ kicker, title, titleAccent, dicas }: TipsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      <div className="wd-tips">
        {dicas.map((d, i) => d.titulo && (
          <div className="wd-tip" key={i}>
            <div className="wd-tip-numero">{String(i + 1).padStart(2, '0')}</div>
            <h4>{d.titulo}</h4>
            <p>{d.texto}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
