import type { NextStepsSecao } from '../tipos';

export default function NextStepsSection({ kicker, title, titleAccent, passos }: NextStepsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      <div className="wd-next-steps">
        {passos.map((p, i) => p.texto && (
          <div className="wd-next-step" key={i}>
            <span className="wd-next-numero">{p.numero}</span>
            <span className="wd-next-corpo">
              {p.texto}
              {p.nota && <small>{p.nota}</small>}
            </span>
            <span className="wd-next-quando">{p.quando}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
