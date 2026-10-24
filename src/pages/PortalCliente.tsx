import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { PORTAL_CSS, LOGO_LUMOS, LOGO_LUMOS_ESCURO } from './portalCliente.css';
import WelcomeDocPage from './welcome-doc/WelcomeDocPage';
import FundoDeck from '@/components/common/FundoDeck';
import type { Entrega, EscopoItem, FaseRaw, Projeto, Portal, Agenda, Gravacao, AbaProjeto } from './portal/tipos';
import { ABAS_PROJETO } from './portal/tipos';
import { ESTADO, ESTADO_PEDIDO, MARCOS, MOTIVO_GENERICO, motivoPedido, motivoCancelar, motivoAgenda } from './portal/motivos';
import { NOME_SALVO, EMAIL_SALVO, BILHETE, lerSalvo, gravarSalvo, apagarSalvo } from './portal/armazenamento';
import { dia, mesPorExtenso, dataPorExtenso, horario, noDia, duracaoTexto, mesDeHoje, quandoRelativo, nomeBonito, formato, linkZap, linkSlack } from './portal/formatacao';
import { Sol, Lua, IconeZap, IconeSlack, IconeMail, ChevronDown, IconeFechar } from './portal/icones';
import Calendario from './portal/Calendario';
import { useJanela } from './portal/useJanela';

/**
 * PORTAL DO CLIENTE — um link por cliente, uma aba por projeto.
 *
 * A tela é escura porque aqui se assiste filme, e a luz amarela da marca cai
 * sobre o que espera pelo cliente. Os vídeos aparecem no FORMATO REAL: o 9:16
 * é estreito e alto, o 1:1 é quadrado, o 16:9 é largo. É o vocabulário que a
 * Lumos e o cliente já usam, e conta o formato sem precisar de legenda.
 *
 * A primeira aba não é um projeto: é o que precisa dele em todos eles juntos.
 * Era a pergunta que o link por projeto não conseguia responder.
 */

function PortalClienteConteudo() {
  const { token = '' } = useParams();
  const [dados, setDados] = useState<Portal | null>(null);
  /** `rede`: falha de conexão, que merece "tentar de novo". Link morto não tem
   *  o que tentar, então fica só o aviso. */
  const [erro, setErro] = useState<{ texto: string; rede: boolean } | null>(null);
  /** O que a URL pediu (`?aba=`, `?sub=`) vale só na primeira carga. Recarregar
   *  os dados depois (sessão renovada, nova tentativa) não pode puxar a pessoa
   *  de volta pra uma aba que ela já deixou. */
  const urlAplicada = useRef(false);
  /** 'precisa_login' abre a tela de entrada; 'sem_acesso' explica e para por aí. */
  const [porta, setPorta] = useState<{ tipo: 'precisa_login' | 'sem_acesso'; cliente: string } | null>(null);
  const [emailLogin, setEmailLogin] = useState('');
  const [enviandoLink, setEnviandoLink] = useState(false);
  const [linkEnviado, setLinkEnviado] = useState(false);
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const [aba, setAba] = useState<string>('boas_vindas');
  /** Aba de dentro do projeto. Volta pra "geral" ao trocar de projeto: manter
   *  "diarias" ao pular pra outro projeto mostraria o calendário de um projeto
   *  que a pessoa nem olhou ainda. */
  const [abaProj, setAbaProj] = useState<AbaProjeto>('geral');
  /**
   * Sub-aba que `carregar` leu da URL de volta, esperando ser aplicada.
   * O efeito abaixo reseta `abaProj` toda vez que `aba` muda — inclusive
   * quando é a própria restauração quem muda `aba` — então ele confere esta
   * ref antes de resetar, em vez de sempre voltar pra "geral".
   */
  const subRestaurada = useRef<AbaProjeto | null>(null);
  useEffect(() => {
    if (subRestaurada.current) {
      setAbaProj(subRestaurada.current);
      subRestaurada.current = null;
      return;
    }
    setAbaProj('geral');
  }, [aba]);
  const [nome, setNome] = useState(() => lerSalvo(NOME_SALVO));
  /**
   * Capas dos quadros, buscadas DEPOIS e só das que estão na tela.
   * A imagem mora dentro da linha do vídeo: mandar todas junto seriam 3,3 MB
   * antes de a tela aparecer.
   */
  const [capas, setCapas] = useState<Record<string, string | null>>({});
  const [digitando, setDigitando] = useState('');
  const [menuProjetos, setMenuProjetos] = useState(false);
  /** Tema do portal, lembrado por navegador. Começa escuro: é sala de projeção. */
  const [tema, setTema] = useState<'escuro' | 'claro'>(() => (lerSalvo('portal_tema') === 'claro' ? 'claro' : 'escuro'));
  useEffect(() => { gravarSalvo('portal_tema', tema); }, [tema]);

  // As fontes do portal (as do deck da Lumos) não são as do app: entram só aqui.
  useEffect(() => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300..700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400..600&display=swap';
    document.head.appendChild(l);
    return () => { document.head.removeChild(l); };
  }, []);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_client_portal_v2', { p_token: token });
    // Erro de transporte (sem internet, servidor fora) não é link inválido:
    // dizer "desativado" faria o cliente desistir de um link que está bom.
    if (error) {
      setErro({ texto: 'Não conseguimos abrir o portal agora. Confira sua conexão e tente de novo.', rede: true });
      return;
    }
    const falha = (data as any)?.error;
    if (falha === 'precisa_login' || falha === 'sem_acesso') {
      setPorta({ tipo: falha, cliente: (data as any)?.cliente?.nome || '' });
      return;
    }
    if (!data || falha) { setErro({ texto: 'Link inválido ou desativado.', rede: false }); return; }
    const d = data as Portal;
    setErro(null);
    setPorta(null);
    // Nome verificado manda no digitado: é ele que assina as aprovações.
    if (d.voce?.nome) {
      setNome(d.voce.nome);
      gravarSalvo(NOME_SALVO, d.voce.nome);
    }
    setDados(d);
    if (urlAplicada.current) return;
    urlAplicada.current = true;
    // Voltando do player: reabre na aba de onde a pessoa saiu — e, se era de
    // dentro de um projeto, na aba interna também (`sub`).
    const params = new URLSearchParams(window.location.search);
    const pedida = params.get('aba');
    const ehProjeto = !!pedida && d.projetos.some(p => p.id === pedida);
    // Usado o pedido, a URL volta a ser o endereço limpo do portal.
    if (pedida) {
      params.delete('aba');
      params.delete('sub');
      const resto = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${resto ? `?${resto}` : ''}${window.location.hash}`);
    }
    if (pedida && (pedida === 'inicio' || pedida === 'atendimento' || pedida === 'boas_vindas' || ehProjeto)) {
      if (ehProjeto) {
        const subPedida = params.get('sub');
        if (subPedida && (ABAS_PROJETO as readonly string[]).includes(subPedida)) {
          subRestaurada.current = subPedida as AbaProjeto;
        }
      }
      setAba(pedida);
    } else if (d.abrir_projeto) {
      // Link antigo, de projeto: abre já na aba daquele projeto.
      setAba(d.abrir_projeto);
    }
  }, [token]);
  useEffect(() => { carregar(); }, [carregar]);

  // O link de entrada volta com a sessão na URL: quando ela é criada, recarrega
  // os dados. Sem isso a pessoa clicava no e-mail e caía na tela de entrada de
  // novo, já logada.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED') carregar();
    });
    return () => data.subscription.unsubscribe();
  }, [carregar]);

  /** Pede as capas dos quadros que a aba atual mostra, em blocos pequenos. */
  const pedirCapas = useCallback(async (tokens: string[]) => {
    const faltando = [...new Set(tokens.filter(t => t && !(t in capas)))];
    if (!faltando.length) return;
    // Marca como pedidas antes de ir, pra não pedir duas vezes o mesmo quadro.
    setCapas(prev => ({ ...prev, ...Object.fromEntries(faltando.map(t => [t, null])) }));
    for (let i = 0; i < faltando.length; i += 6) {
      const lote = faltando.slice(i, i + 6);
      const { data } = await supabase.rpc('portal_capas', { p_token: token, p_review_tokens: lote });
      if (data?.length) {
        setCapas(prev => ({ ...prev, ...Object.fromEntries((data as any[]).map(r => [r.review_token, r.capa])) }));
      }
    }
  }, [token, capas]);

  const esperando = useMemo(() => {
    if (!dados) return [];
    return dados.projetos.flatMap(p =>
      p.entregas.filter(e => e.status === 'EM_REVISAO_CLIENTE').map(e => ({ ...e, projeto: p.nome })));
  }, [dados]);

  /** Deixa o bilhete de volta antes de sair pro player. */
  const marcarVolta = useCallback(() => {
    try {
      // Dentro de um projeto, o bilhete leva também a aba interna (`sub`):
      // sem ela, quem saiu de Entregas voltava sempre em Visão geral.
      const dentroProjeto = dados?.projetos.some(p => p.id === aba) ?? false;
      const sub = dentroProjeto ? `&sub=${abaProj}` : '';
      sessionStorage.setItem(BILHETE, JSON.stringify({
        // Sempre com a aba: sem `?aba=inicio` o portal reabria na aba padrão
        // (Bem-vindo) e quem abriu o vídeo pelo Início voltava pro lugar errado.
        url: `/portal/${token}?aba=${aba}${sub}`,
        rotulo: dados ? `Portal de ${dados.cliente.nome}` : 'Portal',
      }));
    } catch { /* navegador sem sessão: só não tem botão de voltar */ }
  }, [token, aba, dados, abaProj]);

  // Aba trocou: volta pro topo e pede as capas dos quadros que ela mostra.
  // Sem o topo, trocar de aba caía no meio da página anterior.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [aba]);

  useEffect(() => {
    if (!dados) return;
    if (aba === 'inicio') {
      pedirCapas(esperando.slice(0, 5).map(e => e.review_token || ''));
      return;
    }
    const p = dados.projetos.find(x => x.id === aba);
    if (p) pedirCapas(p.entregas.map(e => e.review_token || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, dados]);

  const total = useMemo(() => {
    const todas = (dados?.projetos || []).flatMap(p => p.entregas);
    return {
      aprovadas: todas.filter(e => e.status === 'APROVADO').length,
      ajustes: todas.filter(e => e.status === 'ALTERACOES_CLIENTE').length,
      projetos: (dados?.projetos || []).filter(p => p.status !== 'concluido').length,
    };
  }, [dados]);

  // Calculado aqui (e não perto do JSX) porque a aba Diárias precisa dele
  // pra buscar a agenda, e hook não pode vir depois de um retorno condicional.
  const projetoAberto = dados?.projetos.find(p => p.id === aba) || null;

  const exigeLogin = !!dados?.portal.exige_login;

  // Esc fecha o menu de projetos, como qualquer menu esperaria.
  useEffect(() => {
    if (!menuProjetos) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuProjetos(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuProjetos]);

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
    if (abaProj !== 'diarias' || !projetoAberto) return;
    const minhaGeracao = ++geracaoAgenda.current;
    setCarregandoAgenda(true);
    // Limpa o que sobrou do projeto anterior: sem isso, pacote/gravações/
    // pedidos de um projeto ficavam visíveis embaixo do nome do próximo
    // enquanto a busca nova ainda não voltou.
    setAgenda(null);
    setErroAgenda(null);
    supabase.rpc('portal_agenda', { p_token: token, p_project_id: projetoAberto.id })
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
  }, [abaProj, projetoAberto?.id, token, exigeLogin]);

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
  useEffect(() => { setDataEscolhida(null); setErroPedido(null); setGravacaoAberta(null); }, [abaProj, projetoAberto?.id]);

  // A janela de pedido (aberta quando há data escolhida) segue o mesmo
  // comportamento da janela da gravação.
  useJanela(!!dataEscolhida, pedidoModalRef, gatilhoPedidoRef, () => setDataEscolhida(null));

  const enviarPedido = useCallback(async () => {
    if (!projetoAberto || !dataEscolhida || enviandoRef.current) return;
    const minhaGeracao = geracaoAgenda.current;
    enviandoRef.current = true;
    setEnviandoPedido(true);
    setErroPedido(null);
    const { data, error } = await supabase.rpc('portal_pedir_diaria', {
      p_token: token,
      p_project_id: projetoAberto.id,
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
    const { data: nova, error: erroNova } = await supabase.rpc('portal_agenda', { p_token: token, p_project_id: projetoAberto.id });
    // Mesma guarda do efeito principal: se a pessoa já trocou de projeto
    // enquanto isto rodava, este resultado é velho e não vale mais nada.
    if (geracaoAgenda.current === minhaGeracao && !erroNova && !(nova as any)?.error) {
      setAgenda(nova as Agenda);
    }
  }, [token, projetoAberto, dataEscolhida, pedDuracao, pedLocal, pedDescricao, exigeLogin, pedNome, pedEmail]);

  const cancelarPedido = useCallback(async (id: string) => {
    if (!projetoAberto || cancelandoId) return;
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
    const { data: nova, error: erroNova } = await supabase.rpc('portal_agenda', { p_token: token, p_project_id: projetoAberto.id });
    if (geracaoAgenda.current === minhaGeracao && !erroNova && !(nova as any)?.error) {
      setAgenda(nova as Agenda);
    }
  }, [token, projetoAberto, cancelandoId]);

  if (erro) {
    return (
      <div className={`portal-lumos ${tema === "claro" ? "claro" : ""}`} style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <div className="fundo-portal" aria-hidden><FundoDeck tema={tema === 'claro' ? 'light' : 'dark'} /></div>
        <style>{PORTAL_CSS}</style>
        <div style={{ textAlign: 'center', padding: 24 }} role="alert">
          <p className="rotulo">{erro.texto}</p>
          {erro.rede && (
            <button type="button" className="botao" style={{ marginTop: 16 }}
              onClick={() => { setErro(null); carregar(); }}>
              Tentar de novo
            </button>
          )}
        </div>
      </div>
    );
  }
  // Vem ANTES do "carregando": com login ligado e ninguém logado, não há dados
  // pra esperar — ficar girando seria esconder a porta de entrada.
  // Porta fechada: portal com login ligado.
  if (porta) {
    const enviar = async () => {
      const email = emailLogin.trim().toLowerCase();
      if (!email || enviandoLink) return;
      setEnviandoLink(true);
      setErroLogin(null);
      // Só falha de transporte e limite de envios viram aviso. O resto responde
      // igual nos dois casos (e-mail liberado ou não): o portal não vira jeito
      // de descobrir quem trabalha no cliente.
      const transitorio = (e: { status?: number } | null) => !!e && (!e.status || e.status === 429 || e.status >= 500);
      const { data: pode, error: erroPode } = await supabase.rpc('portal_pode_entrar', { p_token: token, p_email: email });
      if (erroPode) {
        setErroLogin('Não foi possível enviar agora. Confira sua conexão e tente de novo.');
        setEnviandoLink(false);
        return;
      }
      if (pode) {
        const { error: erroOtp } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
        if (transitorio(erroOtp)) {
          setErroLogin(erroOtp?.status === 429
            ? 'Muitos pedidos seguidos. Espere um minuto e tente de novo.'
            : 'Não foi possível enviar agora. Confira sua conexão e tente de novo.');
          setEnviandoLink(false);
          return;
        }
      }
      setEnviandoLink(false);
      setLinkEnviado(true);
    };
    return (
      <div className={`portal-lumos ${tema === 'claro' ? 'claro' : ''}`} style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="fundo-portal" aria-hidden><FundoDeck tema={tema === 'claro' ? 'light' : 'dark'} /></div>
        <style>{PORTAL_CSS}</style>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <img className="logotipo" src={tema === 'claro' ? LOGO_LUMOS_ESCURO : LOGO_LUMOS} alt="Produtora Lumos" style={{ height: 26, marginBottom: 26 }} />
          <p className="rotulo">Portal de {porta.cliente}</p>
          {porta.tipo === 'sem_acesso' ? (
            <>
              <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontWeight: 400, fontSize: 42, lineHeight: 1.05, margin: '8px 0 14px' }}>
                Esta conta<br />não tem acesso
              </h1>
              <p className="nota">
                O e-mail com que você entrou não está liberado neste portal. Fale com quem te
                mandou o link que a gente libera na hora.
              </p>
              <button className="botao" style={{ marginTop: 16 }}
                onClick={async () => { await supabase.auth.signOut(); setPorta(null); setLinkEnviado(false); carregar(); }}>
                Entrar com outro e-mail
              </button>
            </>
          ) : linkEnviado ? (
            <>
              <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontWeight: 400, fontSize: 42, lineHeight: 1.05, margin: '8px 0 14px' }}>
                Olha<br />seu e-mail
              </h1>
              <p className="nota">
                Se <b>{emailLogin.trim()}</b> tiver acesso a este portal, o link de entrada acabou de
                chegar. Ele abre direto aqui, sem senha.
              </p>
              <button className="botao" style={{ marginTop: 16 }} onClick={() => setLinkEnviado(false)}>
                Usar outro e-mail
              </button>
            </>
          ) : (
            <>
              <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontWeight: 400, fontSize: 42, lineHeight: 1.05, margin: '8px 0 14px' }}>
                Entre com<br />seu e-mail
              </h1>
              <input autoFocus type="email" className="campo" placeholder="voce@empresa.com.br"
                aria-label="Seu e-mail" autoComplete="email"
                value={emailLogin} onChange={e => setEmailLogin(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') enviar(); }} />
              {erroLogin && <p className="nota alerta" role="alert" style={{ marginTop: 10 }}>{erroLogin}</p>}
              <button className="botao" style={{ marginTop: 12, width: '100%' }}
                disabled={!emailLogin.trim() || enviandoLink} onClick={enviar}>
                {enviandoLink ? 'Enviando…' : 'Receber link de entrada'}
              </button>
              <p className="nota" style={{ marginTop: 14 }}>
                Sem senha: a gente manda um link que abre o portal direto. Ele vale só pra você.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!dados) {
    return (
      <div className={`portal-lumos ${tema === "claro" ? "claro" : ""}`} style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <div className="fundo-portal" aria-hidden><FundoDeck tema={tema === 'claro' ? 'light' : 'dark'} /></div>
        <style>{PORTAL_CSS}</style>
        <span className="farol" />
      </div>
    );
  }

  // Quem está olhando. O mesmo nome da página de revisão, pra aprovação não
  // ficar sem dono agora que o link é da empresa inteira.
  if (!nome) {
    return (
      <div className={`portal-lumos ${tema === "claro" ? "claro" : ""}`} style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="fundo-portal" aria-hidden><FundoDeck tema={tema === 'claro' ? 'light' : 'dark'} /></div>
        <style>{PORTAL_CSS}</style>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <img className="logotipo" src={tema === "claro" ? LOGO_LUMOS_ESCURO : LOGO_LUMOS} alt="Produtora Lumos" style={{ height: 26, marginBottom: 26 }} />
          <p className="rotulo">Portal de {dados.cliente.nome}</p>
          <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontWeight: 400, fontSize: 44, lineHeight: 1.05, margin: '8px 0 18px' }}>
            Como<br />te chamamos?
          </h1>
          <input
            autoFocus aria-label="Seu nome" autoComplete="name" value={digitando} onChange={e => setDigitando(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && digitando.trim()) { gravarSalvo(NOME_SALVO, digitando.trim()); setNome(digitando.trim()); } }}
            placeholder="Seu nome"
            className="campo"
          />
          <button className="botao" style={{ marginTop: 12, width: '100%' }}
            disabled={!digitando.trim()}
            onClick={() => { gravarSalvo(NOME_SALVO, digitando.trim()); setNome(digitando.trim()); }}>
            Entrar
          </button>
          <p className="nota" style={{ marginTop: 14 }}>
            Serve pra sabermos quem aprovou cada vídeo. Sem senha e sem cadastro.
          </p>
        </div>
      </div>
    );
  }

  const blocos = dados.portal.blocks || {};

  return (
    <div className={`portal-lumos ${tema === "claro" ? "claro" : ""}`}>
        <div className="fundo-portal" aria-hidden><FundoDeck tema={tema === 'claro' ? 'light' : 'dark'} /></div>
      <style>{PORTAL_CSS}</style>

      {/* Cabeçalho em uma linha só: marca à esquerda, navegação no meio,
          quem está vendo à direita. Os projetos saíram da fita e viraram um
          menu — com sete abas abertas, a fita virava parede de texto e o
          Atendimento sumia no fim da rolagem. */}
      <header className="topo">
        <div className="topo-dentro">
        <span className="marca">
          <img className="logotipo" src={tema === "claro" ? LOGO_LUMOS_ESCURO : LOGO_LUMOS} alt="Produtora Lumos" />
          <span className="cliente">Portal de <b>{dados.cliente.nome}</b></span>
        </span>

        <nav className="navegacao" aria-label="Seções">
          <button type="button" className="link" aria-current={aba === 'boas_vindas'}
            onClick={() => setAba('boas_vindas')}>
            Bem-vindo à Lumos
          </button>

          <button type="button" className="link" aria-current={aba === 'inicio'}
            onClick={() => setAba('inicio')}>
            Início
          </button>

          <span className="menu-abre">
            {/* Sempre "Projetos": o rótulo é o nome do lugar, não o do item
                aberto. Qual projeto está aberto já está no título da página, e
                um botão que muda de nome faz a pessoa procurar o menu duas
                vezes. O destaque em amarelo é que diz que ela está num deles. */}
            <button type="button" className="link" aria-expanded={menuProjetos}
              aria-current={!!projetoAberto}
              onClick={() => setMenuProjetos(o => !o)}>
              Projetos
              <ChevronDown aberto={menuProjetos} />
            </button>
            {menuProjetos && (
              <>
                <span className="fora" onClick={() => setMenuProjetos(false)} />
                <span className="menu">
                  {dados.projetos.map(p => {
                    const n = p.entregas.filter(e => e.status === 'EM_REVISAO_CLIENTE').length;
                    return (
                      <button key={p.id} type="button"
                        className={p.id === aba ? 'item atual' : 'item'}
                        aria-current={p.id === aba}
                        onClick={() => { setAba(p.id); setMenuProjetos(false); }}>
                        <span className="rot">{p.nome.trim()}</span>
                        {n > 0 ? <span className="n">{n}</span>
                          : <span className="calmo">{p.entregas.length ? 'em dia' : '—'}</span>}
                      </button>
                    );
                  })}
                  {!dados.projetos.length && <span className="item calmo">Nenhum projeto por aqui ainda.</span>}
                </span>
              </>
            )}
          </span>

          <button type="button" className="link" aria-current={aba === 'atendimento'}
            onClick={() => setAba('atendimento')}>
            Atendimento
          </button>
        </nav>

        <span className="quem">
          <button type="button" className="tema"
            title={tema === 'escuro' ? 'Trocar para o tema claro' : 'Trocar para o tema escuro'}
            aria-label={tema === 'escuro' ? 'Trocar para o tema claro' : 'Trocar para o tema escuro'}
            onClick={() => setTema(t => (t === 'escuro' ? 'claro' : 'escuro'))}>
            {tema === 'escuro' ? <Sol /> : <Lua />}
          </button>
          <span className="rosto">{nome.trim().charAt(0).toUpperCase()}</span>
          <span className="so-grande">Você é <b>{nome}</b></span>
          <button className="trocar" onClick={async () => {
            if (dados.portal.exige_login) { await supabase.auth.signOut(); location.reload(); return; }
            apagarSalvo(NOME_SALVO); setNome(''); setDigitando('');
          }}>{dados.portal.exige_login ? 'sair' : 'trocar'}</button>
        </span>
        </div>
      </header>

      {/* ── INÍCIO ─────────────────────────────────────────────── */}
      {aba === 'inicio' && (
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
                    if (p) setAba(p.id);
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
                        setAba(p.id);
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
      )}

      {/* ── PROJETO ────────────────────────────────────────────── */}
      {projetoAberto && (
        <main className="painel">
          <div className="folha">
            <div className="cabeca-proj">
              <p className="rotulo">{projetoAberto.status === 'concluido' ? 'Projeto encerrado' : 'Projeto'}</p>
              <h2>{projetoAberto.nome.trim()}</h2>
              <div className="resumo-linha">
                {(() => {
                  const es = projetoAberto.entregas;
                  const voce = es.filter(e => e.status === 'EM_REVISAO_CLIENTE').length;
                  const ok = es.filter(e => e.status === 'APROVADO').length;
                  const aj = es.filter(e => e.status === 'ALTERACOES_CLIENTE').length;
                  return (
                    <>
                      {voce > 0 && <div><span className="v destaque mono">{String(voce).padStart(2, '0')}</span><span className="k">esperando você</span></div>}
                      <div><span className="v mono">{String(ok).padStart(2, '0')}</span><span className="k">aprovadas</span></div>
                      {aj > 0 && <div><span className="v mono">{String(aj).padStart(2, '0')}</span><span className="k">em ajuste</span></div>}
                      {projetoAberto.data_fim && <div><span className="v mono">{dia(projetoAberto.data_fim)}</span><span className="k">entrega prevista</span></div>}
                    </>
                  );
                })()}
              </div>
            </div>

            <nav className="fita fita-proj" aria-label="Seções do projeto">
              {([
                ['geral', 'Visão geral'],
                ['entregas', 'Entregas'],
                ['diarias', 'Diárias'],
                ['arquivos', 'Arquivos'],
              ] as const).map(([chave, rotulo]) => (
                (chave !== 'arquivos' || (blocos.arquivos !== false && projetoAberto.arquivos.length > 0)) && (
                  <button key={chave} type="button" className="link"
                    aria-current={abaProj === chave}
                    onClick={() => setAbaProj(chave)}>
                    {rotulo}
                    {chave === 'entregas' && projetoAberto.entregas.length > 0 && (
                      <span className="n">{projetoAberto.entregas.length}</span>
                    )}
                  </button>
                )
              ))}
            </nav>

            {abaProj === 'geral' && (
              <>
                {/* Meta zero não é pacote (seria "NaN%" e "3 de 0"): o item some. */}
                {blocos.escopo !== false && projetoAberto.escopo.some(it => it.meta > 0) && (
                  <section className="secao">
                    <span className="rotulo">Seu pacote neste mês</span>
                    {projetoAberto.escopo.filter(it => it.meta > 0).map((it, i) => (
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
                        const st = projetoAberto.stages || {};
                        const temAgora = MARCOS.map(m => m.status.some(s => (st[s] || 0) > 0));
                        const iAtual = temAgora.findIndex(Boolean);
                        return MARCOS.map((m, i) => {
                          const fase = projetoAberto.cronograma.find(c => m.status.includes(c.etapa));
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
            )}

            {abaProj === 'entregas' && (
              <section className="secao">
                <span className="rotulo">Entregas</span>
                {!projetoAberto.entregas.length ? (
                  <p className="nota">
                    Nada para ver ainda. Assim que o primeiro corte sair da edição, ele aparece aqui.
                  </p>
                ) : (
                  ['EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO'].map(st => {
                    const lista = projetoAberto.entregas.filter(e => e.status === st);
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
            )}

            {abaProj === 'diarias' && (
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
                                  <input className="campo" value={dados.voce?.nome || nome} disabled />
                                </label>
                                <label>
                                  <span className="rotulo">Seu e-mail</span>
                                  <input className="campo" value={dados.voce?.email || ''} disabled />
                                </label>
                              </div>
                              <p className="nota">Entrando como {dados.voce?.nome || nome}.</p>
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
            )}

            {abaProj === 'arquivos' && blocos.arquivos !== false && projetoAberto.arquivos.length > 0 && (
              <section className="secao">
                <span className="rotulo">Arquivos liberados</span>
                {projetoAberto.arquivos.map((a, i) => (
                  <div key={i} className="arquivo">
                    <span className="nm">{a.name}<span>{a.kind}</span></span>
                    <a className="baixar" href={a.url} target="_blank" rel="noopener noreferrer">Abrir</a>
                  </div>
                ))}
              </section>
            )}
          </div>
        </main>
      )}

      {/* ── ATENDIMENTO ───────────────────────────────────────── */}
      {aba === 'atendimento' && (
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
      )}

      {/* ── BEM-VINDO À LUMOS ─────────────────────────────────── */}
      {aba === 'boas_vindas' && (
        <main className="painel">
          <div className="folha">
            <WelcomeDocPage token={token} nomePessoa={nome || 'cliente'} />
          </div>
        </main>
      )}
    </div>
  );
}

/** Se qualquer parte da tela quebrar, o cliente vê um aviso com saída em vez de
 *  uma página em branco. */
class PortalErro extends Component<{ children: ReactNode }, { quebrou: boolean }> {
  state = { quebrou: false };
  static getDerivedStateFromError() { return { quebrou: true }; }
  componentDidCatch(erro: unknown) { console.error('[portal] erro de tela', erro); }
  render() {
    if (!this.state.quebrou) return this.props.children;
    const claro = lerSalvo('portal_tema') === 'claro';
    return (
      <div className={`portal-lumos ${claro ? 'claro' : ''}`} style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <style>{PORTAL_CSS}</style>
        <div style={{ textAlign: 'center' }} role="alert">
          <p className="rotulo">Algo deu errado ao mostrar o portal.</p>
          <button type="button" className="botao" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}

export default function PortalCliente() {
  return <PortalErro><PortalClienteConteudo /></PortalErro>;
}
