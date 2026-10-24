import type { Projeto, Entrega, VisaoProjeto } from '../../tipos';
import { MARCOS } from '../../motivos';
import { proximoMarco } from '../../marcos';
import { dia, nomeBonito } from '../../formatacao';
import Saude from '../../projeto/Saude';
import ProximoMarco from '../../projeto/ProximoMarco';
import Pendencias from '../../projeto/Pendencias';
import EquipeProjeto from '../../projeto/EquipeProjeto';

interface Props {
  projeto: Projeto;
  blocos: Record<string, boolean>;
  /** O que `portal_visao_projetos` diz deste projeto. Sem ela (função ainda não
   *  publicada, falha de rede) nenhum bloco novo aparece e a tela fica como era. */
  visao?: VisaoProjeto | null;
  /** Vídeos deste projeto esperando a decisão do cliente. */
  esperando: Entrega[];
  /** Deixa o bilhete de volta antes de sair pro player. */
  marcarVolta: () => void;
}

export default function Geral({ projeto, blocos, visao, esperando, marcarVolta }: Props) {
  const marco = visao ? proximoMarco(projeto) : null;
  const itens = visao ? [
    ...esperando.map(e => ({
      chave: `v-${e.file_name}-${e.versao}`,
      texto: `Aprovar ou pedir ajuste: ${nomeBonito(e.file_name)} (v${String(e.versao).padStart(2, '0')})`,
      href: e.review_token ? `/revisao/${e.review_token}` : undefined,
      aoNavegar: marcarVolta,
    })),
    ...visao.pendencias.map(p => ({ chave: p.id, texto: p.texto, prazo: p.prazo })),
  ] : [];
  return (
    <>
      {visao?.saude && <Saude estado={visao.saude.estado} />}
      {marco && <ProximoMarco marco={marco} />}
      {itens.length > 0 && <Pendencias itens={itens} />}
      {visao && visao.equipe.length > 0 && <EquipeProjeto equipe={visao.equipe} />}

      {/* Meta zero não é pacote (seria "NaN%" e "3 de 0"): o item some. */}
      {blocos.escopo !== false && projeto.escopo.some(it => it.meta > 0) && (
        <section className="secao">
          <span className="rotulo">Seu pacote neste mês</span>
          {projeto.escopo.filter(it => it.meta > 0).map((it, i) => (
            <div key={i} className="proj" style={{ cursor: 'default' }}>
              <span><span className="nome">{it.rotulo}</span></span>
              <span className="barra">
                <i className={it.realizado >= it.meta ? 'b-ok' : 'b-voce'}
                  style={{ width: `${Math.min(100, (it.realizado / it.meta) * 100)}%` }} />
              </span>
              <span className="contagem">{it.realizado} de {it.meta}</span>
            </div>
          ))}
        </section>
      )}

      {blocos.cronograma !== false && (
        <section className="secao">
          <span className="rotulo">Onde o projeto está</span>
          <ul className="etapas">
            {(() => {
              const st = projeto.stages || {};
              const temAgora = MARCOS.map(m => m.status.some(s => (st[s] || 0) > 0));
              const iAtual = temAgora.findIndex(Boolean);
              return MARCOS.map((m, i) => {
                const fase = projeto.cronograma.find(c => m.status.includes(c.etapa));
                const classe = iAtual === -1 ? 'pendente' : i < iAtual ? 'feita' : i === iAtual ? 'agora' : 'pendente';
                return (
                  <li key={m.chave} className={`etapa ${classe}`}>
                    <span className="q">{m.label}</span>
                    <span className="d">
                      {classe === 'agora' ? 'agora'
                        : fase?.fim ? dia(fase.fim)
                        : fase?.prazo_cliente ? `previsto ${dia(fase.prazo_cliente)}`
                        : classe === 'feita' ? 'concluído' : '—'}
                    </span>
                  </li>
                );
              });
            })()}
          </ul>
        </section>
      )}
    </>
  );
}
