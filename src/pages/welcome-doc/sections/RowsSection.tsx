import type { RowsSecao } from '../tipos';

export default function RowsSection({ kicker, title, titleAccent, rows, footnote }: RowsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      <div className="wd-rows">
        {rows.map((r, i) => (
          <div className="wd-row" key={i}>
            <div className="wd-row-nome">{r.name}</div>
            <div className="wd-row-papel">{r.role}</div>
            <div className="wd-row-quando">{r.when}</div>
            {r.pill && <span className={`wd-pill wd-pill-${r.pillStyle ?? 'ghost'}`}>{r.pill}</span>}
          </div>
        ))}
      </div>
      {footnote && <p className="wd-footnote">{footnote}</p>}
    </section>
  );
}
