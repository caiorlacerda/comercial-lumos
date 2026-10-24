import { useEffect, useMemo, useState } from 'react';
import { mesDeHoje } from './formatacao';
import { SetaMes } from './icones';

const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MES_NOME = ['janeiro','fevereiro','março','abril','maio','junho',
  'julho','agosto','setembro','outubro','novembro','dezembro'];
export default function Calendario({ dias, suas, escolhido, onEscolher }: {
  dias: { data: string; estado: string }[];
  /** Datas em que ESTE projeto tem gravação marcada, pelo nome. O servidor já
   *  manda isso em `agendadas`, e sem cruzar aqui um dia do próprio cliente
   *  aparecia com o mesmo cinza de um dia ocupado por outro: "indisponível",
   *  sem dizer que a gravação é dele. A lista de cima e o calendário passam a
   *  contar a mesma história. */
  suas: Record<string, string>;
  escolhido: string | null;
  onEscolher: (d: string, gatilho?: HTMLButtonElement) => void;
}) {
  // Agrupa por mês na ordem em que vieram: o banco já mandou ordenado, e
  // reordenar aqui só criaria uma segunda fonte da mesma verdade.
  const meses = useMemo(() => {
    const lista: { chave: string; titulo: string; dias: typeof dias }[] = [];
    dias.forEach(d => {
      const chave = d.data.slice(0, 7);
      let m = lista.find(x => x.chave === chave);
      if (!m) {
        const [ano, mes] = chave.split('-');
        m = { chave, titulo: `${MES_NOME[Number(mes) - 1]} de ${ano}`, dias: [] };
        lista.push(m);
      }
      m.dias.push(d);
    });
    return lista;
  }, [dias]);

  // Um mês por vez, abrindo no mês corrente. Se o mês de hoje não estiver
  // entre os que o servidor mandou (não devia acontecer: a agenda começa em
  // current_date), cai no primeiro mês disponível.
  const [indice, setIndice] = useState(() => {
    // Abre no primeiro mês que tem dia pedível, não no mês corrente. Pedindo
    // no fim do mês, com a antecedência mínima, o mês de hoje aparecia sem
    // nenhum dia clicável: um calendário vazio como primeira impressão, e a
    // pessoa tendo que adivinhar que precisa avançar.
    const comLivre = meses.findIndex(m => m.dias.some(d => d.estado === 'livre'));
    if (comLivre >= 0) return comLivre;
    const i = meses.findIndex(m => m.chave === mesDeHoje());
    return i >= 0 ? i : 0;
  });
  // Guarda contra o mês sumir de baixo da pessoa se `dias` encolher.
  useEffect(() => {
    setIndice(i => Math.min(i, Math.max(0, meses.length - 1)));
  }, [meses.length]);

  const mes = meses[indice];

  /**
   * O mês inteiro, sempre em seis semanas.
   *
   * O servidor só manda de hoje até 90 dias, então agosto chegava com dois
   * dias e novembro pela metade: o calendário nascia torto e a seção mudava
   * de altura a cada seta, o que embaralha a leitura. Aqui o mês é completado
   * com os dias que faltam, marcados como fora do alcance (passado, ou longe
   * demais), e a grade tem sempre 42 casas: a altura para de pular.
   */
  const grade = useMemo(() => {
    if (!mes) return [];
    const [ano, numMes] = mes.chave.split('-').map(Number);
    // Dia 0 do mês seguinte é o último dia deste.
    const quantos = new Date(ano, numMes, 0).getDate();
    // T12:00:00 e não T00:00:00: meia-noite em fuso negativo cai no dia
    // anterior, e o calendário inteiro anda uma casa.
    const comeca = new Date(`${mes.chave}-01T12:00:00`).getDay();
    const porData = new Map(mes.dias.map(d => [d.data, d]));
    const casas: (typeof mes.dias[number] | null)[] = Array.from({ length: comeca }, () => null);
    for (let n = 1; n <= quantos; n++) {
      const data = `${mes.chave}-${String(n).padStart(2, '0')}`;
      casas.push(porData.get(data) || { data, estado: 'fora' });
    }
    while (casas.length < 42) casas.push(null);
    return casas;
  }, [mes]);

  if (!mes) return null;

  return (
    <div className="mes">
      <div className="mes-cabeca">
        <button type="button" className="seta-mes" disabled={indice === 0}
          onClick={() => setIndice(i => i - 1)} aria-label="Mês anterior">
          <SetaMes dir="esq" />
        </button>
        <span className="rotulo">{mes.titulo}</span>
        <button type="button" className="seta-mes" disabled={indice === meses.length - 1}
          onClick={() => setIndice(i => i + 1)} aria-label="Próximo mês">
          <SetaMes dir="dir" />
        </button>
      </div>
      <div className="calend">
        {SEMANA.map((d, i) => <span key={`c${i}`} className="cab">{d}</span>)}
        {grade.map((d, i) => {
          if (!d) return <span key={`v${i}`} className="dia fantasma" />;
          const livre = d.estado === 'livre';
          const sua = suas[d.data];
          return (
            <button key={d.data} type="button" disabled={!livre}
              className={`dia ${d.estado}${sua ? ' sua' : ''}${escolhido === d.data ? ' escolhido' : ''}`}
              title={sua ? `Sua gravação, ${sua}`
                : livre ? 'Pedir esta data'
                : d.estado === 'cedo' ? 'Cedo demais para pedir'
                : d.estado === 'fora' ? 'Fora do período que dá pra pedir'
                : 'Indisponível'}
              onClick={e => onEscolher(d.data, e.currentTarget)}>
              <span className="num">{Number(d.data.slice(8, 10))}</span>
              {/* O nome da gravação escrito no dia, como num calendário de
                  verdade: sem isto, o cliente vê a marca amarela e ainda tem
                  que voltar na lista de cima pra saber o que é. */}
              {sua && <span className="rot-dia">{sua}</span>}
            </button>
          );
        })}
      </div>
      <div className="legenda-cores">
        <span><i className="am-livre" /> livre para pedir</span>
        <span><i className="am-sua" /> sua gravação</span>
        <span><i className="am-fora" /> indisponível</span>
      </div>
    </div>
  );
}
