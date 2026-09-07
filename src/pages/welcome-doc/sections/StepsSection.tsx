import type { StepsSecao } from '../tipos';

export default function StepsSection({ kicker, title, titleAccent, lead, passos }: StepsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      {lead && <p className="wd-secao-lead">{lead}</p>}
      <ol className="wd-steps">
        {passos.map((p, i) => (
          <li className={p.suaVez ? 'wd-step wd-step-sua-vez' : 'wd-step'} key={i}>
            <span className="wd-step-numero">{p.numero}</span>
            <span className="wd-step-texto">{p.texto}</span>
            <span className="wd-step-quem">{p.quemFaz}</span>
            <span className="wd-step-quando">{p.quando}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
