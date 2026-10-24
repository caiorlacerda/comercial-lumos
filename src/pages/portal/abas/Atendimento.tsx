import type { Portal } from '../tipos';
import { dia, linkZap, linkSlack } from '../formatacao';
import { IconeZap, IconeSlack, IconeMail } from '../icones';

export default function Atendimento({ dados }: { dados: Portal }) {
  return (
    <main className="painel">
      <div className="folha">
        <div className="cabeca-proj">
          <p className="rotulo">Atendimento</p>
          <h2>Quem cuida<br />da sua conta</h2>
        </div>
        <section className="secao">
          {dados.contatos.length ? dados.contatos.map((c, i) => {
            const zap = c.whatsapp ? linkZap(c.whatsapp) : null;
            const slack = c.slack ? linkSlack(c.slack) : null;
            return (
              <div key={i} className="pessoa">
                {c.foto
                  ? <img className="foto" src={c.foto} alt="" loading="lazy" />
                  : <span className="rosto" style={{ width: 44, height: 44, fontSize: 16 }}>{c.nome.charAt(0)}</span>}
                <span><span className="nm">{c.nome}</span><span className="fn">{c.cargo || 'Produtora Lumos'}</span></span>
                {/* Só entra o canal que existe: botão que não leva a lugar
                    nenhum é pior que botão que não está lá. */}
                <span className="canais">
                  {zap && <a className="canal zap" href={zap} target="_blank" rel="noopener noreferrer"><IconeZap /> WhatsApp</a>}
                  {slack && <a className="canal slack" href={slack} target="_blank" rel="noopener noreferrer"><IconeSlack /> Slack</a>}
                  {c.email && <a className="canal mail" href={`mailto:${c.email}`}><IconeMail /> E-mail</a>}
                </span>
              </div>
            );
          }) : (
            <p className="nota">Fale com quem te mandou este link que a gente te conecta com o time.</p>
          )}
        </section>

        {dados.financeiro && (
          <section className="secao">
            <span className="rotulo">Financeiro</span>
            <div className="arquivo">
              <span className="nm">
                {dados.financeiro.em_dia ? 'Pagamentos em dia' : 'Há vencimento em aberto'}
                <span>{dados.financeiro.proximo_vencimento ? `próximo vencimento ${dia(dados.financeiro.proximo_vencimento)}` : 'sem vencimento próximo'}</span>
              </span>
              <span className={`selo ${dados.financeiro.em_dia ? 's-ok' : 's-aj'}`} style={{ margin: 0 }}>
                {dados.financeiro.em_dia ? 'Em dia' : 'Pendente'}
              </span>
            </div>
            <p className="nota" style={{ marginTop: 12 }}>
              Sem valores por aqui: só a situação e a data. Para nota fiscal ou boleto, fale com o atendimento.
            </p>
          </section>
        )}

        <div className="rodape">
          <span className="farol" style={{ width: 9, height: 9 }} />
          <span className="rotulo">Produtora Lumos · portal de {dados.cliente.nome}</span>
        </div>
      </div>
    </main>
  );
}
