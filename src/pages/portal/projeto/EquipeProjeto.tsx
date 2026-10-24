import type { VisaoProjeto } from '../tipos';

export default function EquipeProjeto({ equipe }: { equipe: VisaoProjeto['equipe'] }) {
  return (
    <section className="secao" aria-label="Equipe do projeto">
      <span className="rotulo">Equipe do projeto</span>
      {equipe.map((p, i) => (
        <div key={i} className="pessoa">
          {p.foto
            ? <img className="foto" src={p.foto} alt="" loading="lazy" />
            : <span className="rosto" style={{ width: 44, height: 44, fontSize: 16 }}>{p.nome.charAt(0)}</span>}
          <span><span className="nm">{p.nome}</span><span className="fn">{p.funcao || 'Produtora Lumos'}</span></span>
        </div>
      ))}
    </section>
  );
}
