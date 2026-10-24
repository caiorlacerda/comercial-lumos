import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { LOGO_LUMOS, LOGO_LUMOS_ESCURO } from '../portalCliente.css';
import type { Portal, AbaProjeto } from './tipos';
import { ABAS_PROJETO } from './tipos';
import { useVisaoProjetos } from './useVisaoProjetos';
import { NOME_SALVO, BILHETE, lerSalvo, gravarSalvo, apagarSalvo } from './armazenamento';
import { dia } from './formatacao';
import { montarFileiras } from './catalogo';
import { Sol, Lua, ChevronDown } from './icones';
import Inicio from './abas/Inicio';
import Catalogo from './abas/Catalogo';
import Atendimento from './abas/Atendimento';
import BoasVindas from './abas/BoasVindas';
import Geral from './abas/projeto/Geral';
import Entregas from './abas/projeto/Entregas';
import Diarias from './abas/projeto/Diarias';
import Arquivos from './abas/projeto/Arquivos';
import PortalFrame from './PortalFrame';
import PortalErro from './PortalErro';

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
  /** O portal foi aberto com `?aba=catalogo`: a pessoa voltou do vídeo, então o catálogo restaura a rolagem. */
  const [voltouAoCatalogo, setVoltouAoCatalogo] = useState(false);
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
    if (pedida && (pedida === 'inicio' || (pedida === 'catalogo' && montarFileiras(d).length > 0) || pedida === 'atendimento' || pedida === 'boas_vindas' || ehProjeto)) {
      if (ehProjeto) {
        const subPedida = params.get('sub');
        if (subPedida && (ABAS_PROJETO as readonly string[]).includes(subPedida)) {
          subRestaurada.current = subPedida as AbaProjeto;
        }
      }
      if (pedida === 'catalogo') setVoltouAoCatalogo(true);
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

  /** A aba Catálogo só existe se houver vídeo para mostrar. */
  const temCatalogo = useMemo(() => !!dados && montarFileiras(dados).length > 0, [dados]);

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

  // Saiu do catálogo: a próxima visita não restaura rolagem de uma volta antiga
  // (`carregar` liga a flag e troca a aba no mesmo lote, então isto não a apaga cedo).
  useEffect(() => { if (aba !== 'catalogo') setVoltouAoCatalogo(false); }, [aba]);

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

  // Projeto da aba atual (null fora de um projeto): usado no menu e no painel do projeto.
  const projetoAberto = dados?.projetos.find(p => p.id === aba) || null;

  const exigeLogin = !!dados?.portal.exige_login;

  // Situação, pendências e equipe de cada projeto. Falhou ou ainda não existe: null, e a tela fica como era.
  const visao = useVisaoProjetos(token, !!dados && !porta, aba);

  // Esc fecha o menu de projetos, como qualquer menu esperaria.
  useEffect(() => {
    if (!menuProjetos) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuProjetos(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuProjetos]);

  if (erro) {
    return (
      <PortalFrame tema={tema} centralizado>
        <div style={{ textAlign: 'center', padding: 24 }} role="alert">
          <p className="rotulo">{erro.texto}</p>
          {erro.rede && (
            <button type="button" className="botao" style={{ marginTop: 16 }}
              onClick={() => { setErro(null); carregar(); }}>
              Tentar de novo
            </button>
          )}
        </div>
      </PortalFrame>
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
      <PortalFrame tema={tema} centralizado padding={24}>
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
      </PortalFrame>
    );
  }

  if (!dados) {
    return (
      <PortalFrame tema={tema} centralizado>
        <span className="farol" />
      </PortalFrame>
    );
  }

  // Quem está olhando. O mesmo nome da página de revisão, pra aprovação não
  // ficar sem dono agora que o link é da empresa inteira.
  if (!nome) {
    return (
      <PortalFrame tema={tema} centralizado padding={24}>
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
      </PortalFrame>
    );
  }

  const blocos = dados.portal.blocks || {};

  return (
    <PortalFrame tema={tema}>

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

          {temCatalogo && (
            <button type="button" className="link" aria-current={aba === 'catalogo'}
              onClick={() => setAba('catalogo')}>
              Catálogo
            </button>
          )}

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
        <Inicio dados={dados} esperando={esperando} capas={capas} blocos={blocos} token={token}
          marcarVolta={marcarVolta} irParaAba={setAba} visao={visao} />
      )}

      {/* ── CATÁLOGO ───────────────────────────────────────────── */}
      {aba === 'catalogo' && (
        <Catalogo dados={dados} capas={capas} pedirCapas={pedirCapas} marcarVolta={marcarVolta} restaurar={voltouAoCatalogo} />
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

            {abaProj === 'geral' && <Geral projeto={projetoAberto} blocos={blocos}
              visao={(visao?.projetos ?? []).find(v => v.id === projetoAberto.id) || null}
              esperando={projetoAberto.entregas.filter(e => e.status === 'EM_REVISAO_CLIENTE')}
              marcarVolta={marcarVolta} />}

            {abaProj === 'entregas' && <Entregas projeto={projetoAberto} capas={capas} marcarVolta={marcarVolta} />}

            {abaProj === 'diarias' && <Diarias key={projetoAberto.id} token={token} projeto={projetoAberto} voce={dados.voce} nome={nome} exigeLogin={exigeLogin} />}

            {abaProj === 'arquivos' && blocos.arquivos !== false && projetoAberto.arquivos.length > 0 && <Arquivos projeto={projetoAberto} />}
          </div>
        </main>
      )}

      {/* ── ATENDIMENTO ───────────────────────────────────────── */}
      {aba === 'atendimento' && <Atendimento dados={dados} />}

      {/* ── BEM-VINDO À LUMOS ─────────────────────────────────── */}
      {aba === 'boas_vindas' && <BoasVindas token={token} nome={nome} />}
    </PortalFrame>
  );
}

export default function PortalCliente() {
  return <PortalErro><PortalClienteConteudo /></PortalErro>;
}
