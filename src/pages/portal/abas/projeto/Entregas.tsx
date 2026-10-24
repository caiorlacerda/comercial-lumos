import type { Projeto } from '../../tipos';
import { ESTADO } from '../../motivos';
import { nomeBonito, formato } from '../../formatacao';

export default function Entregas({ projeto, capas, marcarVolta }: {
  projeto: Projeto; capas: Record<string, string | null>; marcarVolta: () => void;
}) {
  return (
    <section className="secao">
      <span className="rotulo">Entregas</span>
      {!projeto.entregas.length ? (
        <p className="nota">
          Nada para ver ainda. Assim que o primeiro corte sair da edição, ele aparece aqui.
        </p>
      ) : (
        ['EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO'].map(st => {
          const lista = projeto.entregas.filter(e => e.status === st);
          if (!lista.length) return null;
          return (
            <div key={st} className="peca-bloco">
              <div>
                <h3>{ESTADO[st]?.label}</h3>
                <span className="estado">{lista.length} {lista.length === 1 ? 'peça' : 'peças'}</span>
                <span className={`selo ${ESTADO[st]?.classe}`}>{ESTADO[st]?.label}</span>
              </div>
              <div className="quadros">
                {lista.map((e, i) => {
                  const f = formato(e.largura, e.altura);
                  return (
                    <a key={`${e.file_name}${i}`} className={`quadro ${f.classe}`}
                      onClick={() => marcarVolta()}
                      href={e.review_token ? `/revisao/${e.review_token}` : undefined}
                      title={`${nomeBonito(e.file_name)} · v${String(e.versao).padStart(2, '0')}`}>
                      <span className="still">
                        {e.review_token && capas[e.review_token] && (
                          <img className="foto" src={capas[e.review_token]!} alt="" loading="lazy" />
                        )}
                        <span className="fmt">{f.rotulo}</span>
                        <span className="legenda">
                          <span className="peca">{nomeBonito(e.file_name)}</span>
                          <span className="meta">
                            v{String(e.versao).padStart(2, '0')}
                            {e.client_decided_by ? ` · ${e.client_decided_by}` : ''}
                          </span>
                        </span>
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
