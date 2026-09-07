import type { DateCardsSecao } from '../tipos';

export default function DateCardsSection({ kicker, title, titleAccent, cards }: DateCardsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      <div className="wd-date-cards">
        {cards.map((c, i) => c.titulo && (
          <div className={c.destaque ? 'wd-date-card wd-date-card-destaque' : 'wd-date-card'} key={i}>
            <div className="wd-date-data">{c.data}</div>
            <div className="wd-date-titulo">{c.titulo}</div>
            {c.nota && <div className="wd-date-nota">{c.nota}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
