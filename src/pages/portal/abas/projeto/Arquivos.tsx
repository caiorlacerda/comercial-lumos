import type { Projeto } from '../../tipos';

export default function Arquivos({ projeto }: { projeto: Projeto }) {
  return (
    <section className="secao">
      <span className="rotulo">Arquivos liberados</span>
      {projeto.arquivos.map((a, i) => (
        <div key={i} className="arquivo">
          <span className="nm">{a.name}<span>{a.kind}</span></span>
          <a className="baixar" href={a.url} target="_blank" rel="noopener noreferrer">Abrir</a>
        </div>
      ))}
    </section>
  );
}
