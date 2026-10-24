import type { EstadoSaude } from '../tipos';

/** O porquê de um projeto estar em atenção ou atrasado é assunto interno e nunca
 *  chega aqui: o cliente lê só o estado e a frase de cada um. */
const TEXTO: Record<EstadoSaude, { titulo: string; frase: string }> = {
  no_prazo: { titulo: 'No prazo', frase: 'Tudo andando como combinado.' },
  atencao: { titulo: 'Atenção', frase: 'Estamos acompanhando o prazo de perto.' },
  atrasado: { titulo: 'Atrasado', frase: 'O prazo combinado passou. Fale com seu atendimento para o novo cronograma.' },
};

export default function Saude({ estado }: { estado: EstadoSaude }) {
  const t = TEXTO[estado];
  return (
    <section className={`secao saude saude-${estado}`} aria-label="Situação do projeto">
      <span className="rotulo">Situação</span>
      <p className="saude-linha"><i className="saude-ponto" aria-hidden="true" /> <b>{t.titulo}</b></p>
      <p className="nota">{t.frase}</p>
    </section>
  );
}
