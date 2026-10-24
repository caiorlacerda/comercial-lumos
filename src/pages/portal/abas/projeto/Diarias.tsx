import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Agenda, Gravacao, Portal, Projeto } from '../../tipos';
import { ESTADO_PEDIDO, MOTIVO_GENERICO, motivoPedido, motivoCancelar, motivoAgenda } from '../../motivos';
import { NOME_SALVO, EMAIL_SALVO, lerSalvo, gravarSalvo } from '../../armazenamento';
import { dia, mesPorExtenso, dataPorExtenso, horario, noDia, duracaoTexto, mesDeHoje } from '../../formatacao';
import { IconeFechar } from '../../icones';
import Calendario from '../../Calendario';
import { useJanela } from '../../useJanela';

export default function Diarias({ token, projeto, voce, nome, exigeLogin }: {
  token: string; projeto: Projeto; voce: Portal['voce']; nome: string; exigeLogin: boolean;
}) {
  // ── Diárias: agenda do projeto aberto ──────────────────────────────
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [carregandoAgenda, setCarregandoAgenda] = useState(false);
  const [erroAgenda, setErroAgenda] = useState<string | null>(null);
  /** Geração da busca de agenda: cada troca de projeto/aba soma um. Uma busca
   *  (a inicial ou um refetch pós-envio/cancelamento) só aplica o resultado
   *  se a geração ainda for a mesma — senão a pessoa já saiu dali, e um
   *  resultado tardio de outro projeto sobrescreveria a tela atual. */
  const geracaoAgenda = useRef(0);

  // Só quando a aba abre: a maioria das visitas não vai ao calendário, e ele
  // custa 90 dias de consulta.
  useEffect(() => {
    const minhaGeracao = ++geracaoAgenda.current;
    setCarregandoAgenda(true);
    // Limpa o que sobrou do projeto anterior: sem isso, pacote/gravações/
    // pedidos de um projeto ficavam visíveis embaixo do nome do próximo
    // enquanto a busca nova ainda não voltou.
    setAgenda(null);
    setErroAgenda(null);
    supabase.rpc('portal_agenda', { p_token: token, p_project_id: projeto.id })
      .then(({ data, error }) => {
        if (geracaoAgenda.current !== minhaGeracao) return;
        const falha = error ? 'erro' : (data as any)?.error;
        if (falha) {
          // `portal_agenda` devolve um objeto sem as chaves de Agenda quando
          // dá erro: nunca guardar isso como se fosse a agenda, ou o render
          // quebra (agenda?.dias etc. não protegem contra objeto sem a
          // chave — só contra agenda nula).
          setAgenda(null);
          setErroAgenda(error ? MOTIVO_GENERICO : motivoAgenda(falha, exigeLogin));
        } else {
          setAgenda(data as Agenda);
        }
        setCarregandoAgenda(false);
      });
  }, [projeto.id, token, exigeLogin]);

  const [dataEscolhida, setDataEscolhida] = useState<string | null>(null);

  /** Data da gravação -> nome dela, pra marcar no calendário os dias que já
   *  são do próprio cliente. Sai de `agendadas`, a mesma lista do bloco
   *  "Gravações marcadas": uma fonte só, contada em dois lugares. */
  const suasGravacoes = useMemo(() => {
    const mapa: Record<string, string> = {};
    (agenda?.agendadas || []).forEach(g => { if (g.data) mapa[g.data] = g.nome; });
    return mapa;
  }, [agenda]);
  /** A gravação aberta na janela de detalhes. Guarda a gravação, não o índice
   *  dela: se a agenda recarregar com a janela aberta, o índice passaria a
   *  apontar pra outra gravação. */
  const [gravacaoAberta, setGravacaoAberta] = useState<Gravacao | null>(null);
  const gatilhoGravacaoRef = useRef<HTMLButtonElement | null>(null);
  const gravacaoModalRef = useRef<HTMLDivElement>(null);
  const abrirGravacao = useCallback((g: Gravacao, gatilho?: HTMLButtonElement) => {
    gatilhoGravacaoRef.current = gatilho || null;
    setGravacaoAberta(g);
    setErroOrdemPdf(null);
  }, []);
  useJanela(!!gravacaoAberta, gravacaoModalRef, gatilhoGravacaoRef, () => setGravacaoAberta(null));

  /** Baixar a ordem do dia em PDF, de dentro da janela da gravação. O gerador
   *  de PDF (`@react-pdf/renderer`, mais de 1MB) só entra no bundle quando o
   *  cliente clica — o portal é público e abre rápido pra todo mundo, mesmo
   *  quem nunca baixa nada. */
  const [baixandoOrdemPdf, setBaixandoOrdemPdf] = useState(false);
  const [erroOrdemPdf, setErroOrdemPdf] = useState<string | null>(null);
  const baixarOrdemPdf = useCallback(async (g: Gravacao) => {
    const d = noDia(g);
    if (!d || baixandoOrdemPdf) return;
    setBaixandoOrdemPdf(true);
    setErroOrdemPdf(null);
    try {
      const [{ pdf }, { OrdemDoDiaClientePDF }, React] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/editor/OrdemDoDiaClientePDF'),
        import('react'),
      ]);
      const blob = await pdf(React.createElement(OrdemDoDiaClientePDF, {
        nome: g.nome,
        data: g.data,
        horario: horario(g),
        local: g.local,
        ordem: { ponto_encontro: d.ponto, cronograma: d.cronograma, nota_cliente: d.nota || null },
      }) as any).toBlob();
      const nomeArquivo = `Ordem_do_dia_${g.nome}_${g.data}`
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s-]/g, '').replace(/\s+/g, '_') + '.pdf';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nomeArquivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      setErroOrdemPdf('Não foi possível gerar o PDF. Tente de novo.');
    } finally {
      setBaixandoOrdemPdf(false);
    }
  }, [baixandoOrdemPdf]);

  /** O botão do dia que abriu a janela de pedido, pra devolver o foco a ele
   *  quando ela fechar (Esc, X ou clique fora) — sem isto, quem navega por
   *  teclado ou leitor de tela perde o lugar onde estava. */
  const gatilhoPedidoRef = useRef<HTMLButtonElement | null>(null);
  const pedidoModalRef = useRef<HTMLDivElement>(null);
  const abrirPedido = useCallback((data: string, gatilho?: HTMLButtonElement) => {
    gatilhoPedidoRef.current = gatilho || null;
    setDataEscolhida(data);
  }, []);

  /** O pacote do mês DA DATA ESCOLHIDA, que é o único que responde a pergunta
   *  do formulário: "esta diária vai entrar como extra?". `portal_pedir_diaria`
   *  decide `fora_do_pacote` pelo mês da data pedida, e a tela lia o mês
   *  corrente, então a maioria das datas do calendário (90 dias, quase sempre
   *  outro mês) dava aviso errado, nos dois sentidos: aviso de cobrança à parte
   *  sem motivo, ou nenhum aviso e o pedido chegando marcado como extra.
   *  Sem data escolhida, não há aviso nenhum.
   *  Enquanto a migração 2026093333 não roda, `pacotes` não vem: aí o pacote do
   *  mês corrente ainda vale, mas só para datas do mês corrente. */
  const pacoteDaData = useMemo(() => {
    if (!dataEscolhida || !agenda) return null;
    const mes = dataEscolhida.slice(0, 7);
    if (agenda.pacotes) return agenda.pacotes[mes] || null;
    return mes === mesDeHoje() ? agenda.pacote : null;
  }, [agenda, dataEscolhida]);

  const [pedDescricao, setPedDescricao] = useState('');
  const [pedLocal, setPedLocal] = useState('');
  const [pedDuracao, setPedDuracao] = useState(10);
  const [pedNome, setPedNome] = useState(nome);
  const pedNomeTocado = useRef(false);
  const [pedEmail, setPedEmail] = useState(() => lerSalvo(EMAIL_SALVO));
  const [enviandoPedido, setEnviandoPedido] = useState(false);
  /** A mesma trava, mas síncrona. `enviandoPedido` é estado: dois cliques no
   *  mesmo tique do navegador leem os dois `false` (o React ainda não
   *  re-renderizou o botão desabilitado) e saem os dois pedidos ao mesmo tempo.
   *  Um vence, o outro bate no índice único de pedido pendente. O ref muda na
   *  hora, então o segundo clique nem chega a sair. */
  const enviandoRef = useRef(false);
  const [erroPedido, setErroPedido] = useState<string | null>(null);
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [erroCancelar, setErroCancelar] = useState<string | null>(null);

  // `nome` só existe depois da tela "Como te chamamos?", que roda DEPOIS do
  // primeiro render deste componente — então `useState(nome)` acima só pega
  // o nome a tempo se ele já estava salvo. Sem isto, quem digita o nome ali
  // encontrava o campo do pedido vazio. Só sincroniza enquanto a pessoa não
  // tiver mexido no campo com a mão.
  useEffect(() => {
    if (!pedNomeTocado.current) setPedNome(nome);
  }, [nome]);

  // Trocou de data, de aba ou de projeto: o aviso da tentativa anterior não
  // vale mais.
  useEffect(() => { setErroPedido(null); }, [dataEscolhida]);

  // A janela de pedido (aberta quando há data escolhida) segue o mesmo
  // comportamento da janela da gravação.
  useJanela(!!dataEscolhida, pedidoModalRef, gatilhoPedidoRef, () => setDataEscolhida(null));

  const enviarPedido = useCallback(async () => {
    if (!dataEscolhida || enviandoRef.current) return;
    const minhaGeracao = geracaoAgenda.current;
    enviandoRef.current = true;
    setEnviandoPedido(true);
    setErroPedido(null);
    const { data, error } = await supabase.rpc('portal_pedir_diaria', {
      p_token: token,
      p_project_id: projeto.id,
      p_data: dataEscolhida,
      p_duracao: pedDuracao,
      p_local: pedLocal.trim() || null,
      p_descricao: pedDescricao,
      p_nome: exigeLogin ? null : pedNome,
      p_email: exigeLogin ? null : pedEmail,
    });
    // Erro de transporte (rede, RLS) não é "sem resposta": sem tratar aqui,
    // `data` vem nulo, `falha` fica undefined, e o código seguia pro
    // caminho de sucesso como se o pedido tivesse sido criado de verdade.
    if (error) {
      setErroPedido(MOTIVO_GENERICO);
      enviandoRef.current = false;
      setEnviandoPedido(false);
      return;
    }
    const falha = (data as any)?.error;
    if (falha) {
      setErroPedido(motivoPedido(falha));
      enviandoRef.current = false;
      setEnviandoPedido(false);
      return;
    }
    if (!exigeLogin) {
      gravarSalvo(NOME_SALVO, pedNome.trim());
      gravarSalvo(EMAIL_SALVO, pedEmail.trim());
    }
    setPedDescricao('');
    setPedLocal('');
    setDataEscolhida(null);
    enviandoRef.current = false;
    setEnviandoPedido(false);
    const { data: nova, error: erroNova } = await supabase.rpc('portal_agenda', { p_token: token, p_project_id: projeto.id });
    // Mesma guarda do efeito principal: se a pessoa já trocou de projeto
    // enquanto isto rodava, este resultado é velho e não vale mais nada.
    if (geracaoAgenda.current === minhaGeracao && !erroNova && !(nova as any)?.error) {
      setAgenda(nova as Agenda);
    }
  }, [token, projeto, dataEscolhida, pedDuracao, pedLocal, pedDescricao, exigeLogin, pedNome, pedEmail]);

  const cancelarPedido = useCallback(async (id: string) => {
    if (cancelandoId) return;
    const minhaGeracao = geracaoAgenda.current;
    setCancelandoId(id);
    setErroCancelar(null);
    const { data, error } = await supabase.rpc('portal_cancelar_pedido', { p_token: token, p_pedido_id: id });
    if (error) {
      setErroCancelar(MOTIVO_GENERICO);
      setCancelandoId(null);
      return;
    }
    const falha = (data as any)?.error;
    if (falha) {
      setErroCancelar(motivoCancelar(falha));
      setCancelandoId(null);
      return;
    }
    setCancelandoId(null);
    const { data: nova, error: erroNova } = await supabase.rpc('portal_agenda', { p_token: token, p_project_id: projeto.id });
    if (geracaoAgenda.current === minhaGeracao && !erroNova && !(nova as any)?.error) {
      setAgenda(nova as Agenda);
    }
  }, [token, projeto, cancelandoId]);

  return (
    erroAgenda ? (
      <section className="secao">
        <p className="nota alerta">{erroAgenda}</p>
        {exigeLogin && (
          <button type="button" className="botao" style={{ marginTop: 12 }}
            onClick={async () => { await supabase.auth.signOut(); location.reload(); }}>
            Entrar de novo
          </button>
        )}
      </section>
    ) : (
      <>
        {/* Meta zero não é pacote: seria barra de largura NaN% e
            "3 de 0" escrito na tela. Sem meta, o bloco não aparece,
            igual a projeto sem contrato por volume. */}
        {agenda?.pacote && agenda.pacote.meta > 0 && (
          <section className="secao">
            <span className="rotulo">Suas diárias neste mês</span>
            <div className="proj" style={{ cursor: 'default' }}>
              <span><span className="nome">Diárias do pacote</span></span>
              <span className="barra">
                <i className={agenda.pacote.realizado >= agenda.pacote.meta ? 'b-ok' : 'b-voce'}
                  style={{ width: `${Math.min(100, (agenda.pacote.realizado / agenda.pacote.meta) * 100)}%` }} />
              </span>
              <span className="contagem">{agenda.pacote.realizado} de {agenda.pacote.meta}</span>
            </div>
          </section>
        )}

        {/* Um cartão por gravação, e o cartão abre a gravação. A
            lista de linhas mostrava data e local e parava aí: o que
            estava marcado pra aquele dia ficava do lado de cá. */}
        <section className="secao">
          <span className="rotulo">Gravações marcadas</span>
          {!agenda?.agendadas.length ? (
            <p className="nota">Nenhuma gravação marcada por enquanto.</p>
          ) : (
            <div className="gravs">
              {agenda.agendadas.map((g, i) => (
                <button key={g.id || `${g.data}-${i}`} type="button" className="grav-card"
                  onClick={e => abrirGravacao(g, e.currentTarget)}>
                  <span className="qd">{dia(g.data)}</span>
                  <span className="nm">{g.nome}</span>
                  <span className="det">{horario(g) || 'Horário a combinar'}</span>
                  {g.local && <span className="det">{g.local}</span>}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* A gravação por dentro. A equipe só aparece quando o banco
            mandou uma: sem autorização a lista vem vazia, e a janela
            não fala do que não veio. */}
        {gravacaoAberta && (
          <div className="pedido-modal-fora" onClick={e => { if (e.target === e.currentTarget) setGravacaoAberta(null); }}>
            <div className="pedido-modal" ref={gravacaoModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="gravacao-titulo">
              <button type="button" className="fechar" onClick={() => setGravacaoAberta(null)} aria-label="Fechar">
                <IconeFechar />
              </button>
              <p className="rotulo">Gravação marcada</p>
              <h3 id="gravacao-titulo" className="pedido-titulo">{gravacaoAberta.nome}</h3>
              <p className="grav-quando">{dataPorExtenso(gravacaoAberta.data)}</p>

              <div className="grav-detalhe">
                <p><span className="rotulo">Horário</span><span>{horario(gravacaoAberta) || 'A combinar'}</span></p>
                {duracaoTexto(gravacaoAberta.duracao_horas) && (
                  <p><span className="rotulo">Duração</span><span>{duracaoTexto(gravacaoAberta.duracao_horas)}</span></p>
                )}
                <p><span className="rotulo">Onde</span><span>{gravacaoAberta.local || 'A combinar'}</span></p>
              </div>

              {gravacaoAberta.descricao?.trim() && (
                <p className="grav-desc">{gravacaoAberta.descricao}</p>
              )}

              {/* O dia por dentro, e só a parte que é do cliente. Só
                  existe quando a Lumos aprovou a ordem do dia
                  daquela gravação: rascunho não sai do banco, então
                  não há nada aqui pra esconder. */}
              {(() => {
                const d = noDia(gravacaoAberta);
                if (!d) return null;
                return (
                  <div className="grav-dia">
                    <div className="grav-dia-cabeca">
                      <span className="rotulo">No dia</span>
                      <button type="button" className="baixar" disabled={baixandoOrdemPdf}
                        onClick={() => baixarOrdemPdf(gravacaoAberta)}>
                        {baixandoOrdemPdf ? 'Gerando…' : 'Baixar ordem do dia'}
                      </button>
                    </div>
                    {erroOrdemPdf && <p className="nota alerta grav-dia-erro">{erroOrdemPdf}</p>}
                    {d.ponto && (
                      <div className="grav-ponto">
                        <span className="rt">Ponto de encontro</span>
                        <span className="nm">{d.ponto.nome || d.ponto.endereco}</span>
                        {d.ponto.nome && d.ponto.endereco && <span className="end">{d.ponto.endereco}</span>}
                      </div>
                    )}
                    {!!d.cronograma.length && (
                      <>
                        <span className="rt">Como vai ser o dia</span>
                        <ol className="grav-crono">
                          {d.cronograma.map((m, i) => (
                            <li key={i}>
                              <span className="hr">{m.hora?.slice(0, 5) || ''}</span>
                              <span className="oq">{m.descricao || 'A combinar'}</span>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                    {d.nota && (
                      <div className="grav-recado">
                        <span className="rt">O que você precisa providenciar</span>
                        <p>{d.nota}</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {!!gravacaoAberta.equipe?.length && (
                <div className="grav-equipe">
                  <span className="rotulo">Quem grava</span>
                  {gravacaoAberta.equipe.map((pessoa, i) => (
                    <div key={i} className="grav-pessoa">
                      <span className="nm">{pessoa.nome}</span>
                      {pessoa.funcao && <span className="fn">{pessoa.funcao}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <section className="secao">
          <span className="rotulo">Pedir uma data</span>
          {carregandoAgenda ? <span className="farol" /> : <Calendario dias={agenda?.dias || []} suas={suasGravacoes} escolhido={dataEscolhida} onEscolher={abrirPedido} />}
        </section>

        {!carregandoAgenda && dataEscolhida && (
          <div className="pedido-modal-fora" onClick={e => { if (e.target === e.currentTarget) setDataEscolhida(null); }}>
            <div className="pedido-modal" ref={pedidoModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="pedido-titulo">
              <button type="button" className="fechar" onClick={() => setDataEscolhida(null)} aria-label="Fechar">
                <IconeFechar />
              </button>
              <p className="rotulo">Pedir uma data</p>
              <h3 id="pedido-titulo" className="pedido-titulo">{dataPorExtenso(dataEscolhida)}</h3>

              <div className="pedido-form">
                <label>
                  <span className="rotulo">O que precisa gravar</span>
                  <textarea className="campo area" rows={3} value={pedDescricao}
                    onChange={e => setPedDescricao(e.target.value)}
                    placeholder="Ex.: depoimento do cliente X, sala de reunião" />
                </label>

                <div className="pedido-linha">
                  <label>
                    <span className="rotulo">Onde</span>
                    <input className="campo" value={pedLocal} onChange={e => setPedLocal(e.target.value)}
                      placeholder="Endereço ou local (opcional)" />
                  </label>
                  <label>
                    <span className="rotulo">Duração</span>
                    <select className="campo" value={pedDuracao} onChange={e => setPedDuracao(Number(e.target.value))}>
                      <option value={6}>6 horas</option>
                      <option value={10}>10 horas</option>
                      <option value={12}>12 horas</option>
                    </select>
                  </label>
                </div>

                {exigeLogin ? (
                  <>
                    <div className="pedido-linha">
                      <label>
                        <span className="rotulo">Seu nome</span>
                        <input className="campo" value={voce?.nome || nome} disabled />
                      </label>
                      <label>
                        <span className="rotulo">Seu e-mail</span>
                        <input className="campo" value={voce?.email || ''} disabled />
                      </label>
                    </div>
                    <p className="nota">Entrando como {voce?.nome || nome}.</p>
                  </>
                ) : (
                  <div className="pedido-linha">
                    <label>
                      <span className="rotulo">Seu nome</span>
                      <input className="campo" value={pedNome}
                        onChange={e => { pedNomeTocado.current = true; setPedNome(e.target.value); }}
                        placeholder="Seu nome" />
                    </label>
                    <label>
                      <span className="rotulo">Seu e-mail</span>
                      <input className="campo" type="email" value={pedEmail} onChange={e => setPedEmail(e.target.value)} placeholder="voce@empresa.com.br" />
                    </label>
                  </div>
                )}

                {pacoteDaData && pacoteDaData.meta > 0 && pacoteDaData.realizado >= pacoteDaData.meta && (
                  <p className="nota alerta">
                    Esta seria a {pacoteDaData.realizado + 1}ª diária de {pacoteDaData.meta} em {mesPorExtenso(dataEscolhida)}.
                    Ela entra como extra, e a Lumos vai orçar antes de confirmar.
                  </p>
                )}

                {erroPedido && <p className="nota alerta">{erroPedido}</p>}

                <button type="button" className="botao" style={{ marginTop: 4 }}
                  disabled={enviandoPedido || !pedDescricao.trim() || (!exigeLogin && (!pedNome.trim() || !pedEmail.trim()))}
                  onClick={enviarPedido}>
                  {enviandoPedido ? 'Enviando…' : 'Pedir esta data'}
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="secao">
          <span className="rotulo">Seus pedidos</span>
          {!agenda?.pedidos.length ? (
            <p className="nota">Nenhum pedido feito por aqui ainda.</p>
          ) : agenda.pedidos.map(p => {
            const est = ESTADO_PEDIDO[p.estado] || { label: p.estado, classe: 's-prod' };
            return (
              <div key={p.id} className="arquivo">
                <span className="nm">
                  {p.descricao}
                  <span>
                    {dia(p.data_desejada)}
                    {p.estado === 'recusado' && p.motivo_recusa ? `, ${p.motivo_recusa}` : ''}
                  </span>
                </span>
                <span className={`selo ${est.classe}`} style={{ margin: 0 }}>{est.label}</span>
                {p.estado === 'pendente' && (
                  <button type="button" className="baixar" disabled={cancelandoId === p.id}
                    onClick={() => cancelarPedido(p.id)}>
                    {cancelandoId === p.id ? 'Cancelando…' : 'Cancelar'}
                  </button>
                )}
              </div>
            );
          })}
          {erroCancelar && <p className="nota alerta">{erroCancelar}</p>}
        </section>
      </>
    )
  );
}
