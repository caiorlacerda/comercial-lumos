import type { Entrega, Portal } from '../tipos';
import { dia, quandoRelativo, nomeBonito, formato } from '../formatacao';

export default function Inicio({ dados, esperando, capas, blocos, token, marcarVolta, irParaAba }: {
  dados: Portal;
  esperando: (Entrega & { projeto: string })[];
  capas: Record<string, string | null>;
  blocos: Record<string, boolean>;
  token: string;
  marcarVolta: () => void;
  irParaAba: (aba: string) => void;
}) {
  return (
    <main className="painel">
      <div className="folha">
        <section className="chamada">
          <div>
            <p className="rotulo">Esperando você</p>
            <div className="conta mono">{esperando.length}</div>
            <h1>{esperando.length === 1 ? 'Vídeo\npara aprovar' : 'Vídeos\npara aprovar'}</h1>
            <p>
              {esperando.length
                ? 'Abra, comente no ponto exato do vídeo e aprove, ou peça ajuste.'
                : 'Nada esperando por você agora. Quando um vídeo novo sair da edição, ele aparece aqui.'}
            </p>
            {!!esperando.length && esperando[esperando.length - 1].entregue_em && (
              <p className="rotulo desde">O primeiro chegou em {dia(esperando[esperando.length - 1].entregue_em)}</p>
            )}
          </div>

          <div className="quadros">
            {esperando.slice(0, 5).map((e, i) => {
              const f = formato(e.largura, e.altura);
              return (
                <a key={`${e.file_name}${i}`} className={`quadro ${f.classe}`} style={{ animationDelay: `${i * 60}ms` }}
                  onClick={() => marcarVolta()}
                  href={e.review_token ? `/revisao/${e.review_token}` : undefined}
                  title={`${nomeBonito(e.file_name)} · v${String(e.versao).padStart(2, '0')} · ${e.projeto}`}>
                  <span className="still">
                    {e.review_token && capas[e.review_token] && (
                      <img className="foto" src={capas[e.review_token]!} alt="" loading="lazy" />
                    )}
                    <span className="fmt">{f.rotulo}</span>
                    <span className="legenda">
                      <span className="peca">{nomeBonito(e.file_name)}</span>
                      <span className="meta">{e.projeto}</span>
                    </span>
                  </span>
                </a>
              );
            })}
            {esperando.length > 5 && (
              <button className="mais" onClick={() => {
                const p = dados.projetos.find(x => x.entregas.some(e => e.status === 'EM_REVISAO_CLIENTE'));
                if (p) irParaAba(p.id);
              }}>+ {esperando.length - 5}</button>
            )}
          </div>
        </section>

        <div className="duas">
          <section className="secao">
            <span className="rotulo">Seus projetos</span>
            {dados.projetos.map(p => {
              const n = p.entregas.length;
              const ok = p.entregas.filter(e => e.status === 'APROVADO').length;
              const voce = p.entregas.filter(e => e.status === 'EM_REVISAO_CLIENTE').length;
              const resto = n - ok - voce;
              const pc = (x: number) => (n ? (x / n) * 100 : 0);
              return (
                <a key={p.id} className="proj" href={`/portal/${token}?aba=${p.id}`}
                  onClick={e => {
                    // Ctrl/Cmd/botão do meio seguem o link normal (nova aba).
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    irParaAba(p.id);
                  }}>
                  <span>
                    <span className="nome">{p.nome.trim()}</span>
                    <span className="sub">
                      {n ? `${n} ${n === 1 ? 'peça' : 'peças'}` : 'sem entrega ainda'}
                      {p.data_fim ? ` · entrega ${dia(p.data_fim)}` : ''}
                    </span>
                  </span>
                  <span className="barra">
                    {ok > 0 && <i className="b-ok" style={{ width: `${pc(ok)}%` }} />}
                    {voce > 0 && <i className="b-voce" style={{ width: `${pc(voce)}%` }} />}
                    {resto > 0 && <i className="b-prod" style={{ width: `${pc(resto)}%` }} />}
                  </span>
                  <span className="contagem">
                    {voce ? `${voce} com você` : n && ok === n ? 'tudo aprovado' : n ? 'em andamento' : '—'}
                  </span>
                </a>
              );
            })}
            <div className="chaves">
              <span className="chave"><i style={{ background: 'var(--aprovado)' }} /> Aprovado por você</span>
              <span className="chave"><i style={{ background: 'var(--luz)' }} /> Esperando você</span>
              <span className="chave"><i style={{ background: 'var(--producao)' }} /> Com a Lumos</span>
            </div>
          </section>

          {blocos.atividade !== false && (
            <section className="secao">
              <span className="rotulo">Últimos dias</span>
              <ul className="diario">
                {dados.atividade.slice(0, 6).map((a, i) => (
                  <li key={i}>
                    <span className="dia">{quandoRelativo(a.quando)}</span>
                    <span className="fato">
                      {a.tipo === 'decisao'
                        ? <>{a.quem} {a.decisao === 'aprovado' ? 'aprovou' : 'pediu ajustes em'} <b>{nomeBonito(a.file_name)}</b></>
                        : <>Chegou para sua revisão: <b>{nomeBonito(a.file_name)}</b></>}
                      <span className="onde">{a.projeto}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
