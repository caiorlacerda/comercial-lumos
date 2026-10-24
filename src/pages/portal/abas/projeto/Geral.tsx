import type { Projeto } from '../../tipos';
import { MARCOS } from '../../motivos';
import { dia } from '../../formatacao';

export default function Geral({ projeto, blocos }: { projeto: Projeto; blocos: Record<string, boolean> }) {
  return (
    <>
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
