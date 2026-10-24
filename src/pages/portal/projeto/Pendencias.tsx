import { dia } from '../formatacao';

export interface ItemPendente {
  chave: string; texto: string; prazo?: string | null; href?: string;
  /** Clique simples faz isto em vez de seguir o link; Ctrl/Cmd/botão do meio seguem o `href`. */
  aoClicar?: () => void;
  /** Roda antes de a navegação normal acontecer (o link segue seu caminho). Usado para deixar o bilhete de volta. */
  aoNavegar?: () => void;
}

export default function Pendencias({ itens }: { itens: ItemPendente[] }) {
  return (
    <section className="secao" aria-label="O que precisamos de você">
      <span className="rotulo">O que precisamos de você</span>
      <ul className="pendencias">
        {itens.map(i => (
          <li key={i.chave}>
            {i.href ? (
              <a href={i.href} onClick={e => {
                i.aoNavegar?.();
                if (!i.aoClicar || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                i.aoClicar();
              }}>{i.texto}</a>
            ) : <span>{i.texto}</span>}
            {i.prazo && <span className="mono"> · até {dia(i.prazo)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
