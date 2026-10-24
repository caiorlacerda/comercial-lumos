import { dia } from '../formatacao';

export default function ProximoMarco({ marco }: { marco: { rotulo: string; data: string | null } }) {
  return (
    <section className="secao" aria-label="Próximo passo do projeto">
      <span className="rotulo">Próximo passo</span>
      <p className="marco-linha"><b>{marco.rotulo}</b>{marco.data && <span className="mono"> · {dia(marco.data)}</span>}</p>
    </section>
  );
}
