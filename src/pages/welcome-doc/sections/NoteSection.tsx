import type { NoteSecao } from '../tipos';

export default function NoteSection({ kicker, label, body }: NoteSecao) {
  if (!body) return null;
  const paragrafos = body.split('\n\n').filter(Boolean);
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <div className="wd-note">
        {label && <span className="wd-note-label">{label}</span>}
        {paragrafos.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    </section>
  );
}
