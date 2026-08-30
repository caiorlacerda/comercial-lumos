import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { PORTAL_CSS, LOGO_LUMOS } from './portalCliente.css';

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

interface Entrega {
  file_name: string; versao: number; status: string;
  largura: number | null; altura: number | null;
  client_decision: string | null; client_decided_by: string | null; client_decided_at: string | null;
  entregue_em: string | null; review_token: string | null; allow_download: boolean;
}
interface EscopoItem { rotulo: string; meta: number; realizado: number }
interface FaseRaw { etapa: string; n: number; inicio: string | null; fim: string | null; prazo_cliente: string | null }
interface Projeto {
  id: string; nome: string; code: string | null; status: string;
  data_inicio: string | null; data_fim: string | null;
  entregas: Entrega[]; cronograma: FaseRaw[]; stages: Record<string, number>;
  escopo: EscopoItem[]; arquivos: { name: string; url: string; kind: string }[];
}
interface Portal {
  cliente: { nome: string };
  portal: { show_financeiro: boolean; blocks: Record<string, boolean> };
  abrir_projeto: string | null;
  projetos: Projeto[];
  contatos: { nome: string; email: string; cargo: string | null }[];
  financeiro: { em_dia: boolean; proximo_vencimento: string | null } | null;
  atividade: { tipo: string; projeto: string; file_name: string; decisao?: string; quem?: string; versao?: number; quando: string }[];
}

/** Como o cliente lê o estado de um vídeo. Etapa interna nunca chega aqui. */
const ESTADO: Record<string, { label: string; classe: string }> = {
  EM_REVISAO_CLIENTE: { label: 'Esperando você', classe: 's-voce' },
  APROVADO: { label: 'Aprovado por você', classe: 's-ok' },
  ALTERACOES_CLIENTE: { label: 'Ajustes pedidos', classe: 's-aj' },
};

const MARCOS = [
  { chave: 'roteiro', label: 'Roteiro', status: ['roteiro'] },
  { chave: 'captacao', label: 'Captação', status: ['captacao'] },
  { chave: 'edicao', label: 'Edição', status: ['em_progresso'] },
  { chave: 'revisao', label: 'Sua revisão', status: ['revisao_interna', 'revisao_cliente', 'alteracoes'] },
  { chave: 'entrega', label: 'Entrega final', status: ['concluido', 'entregue'] },
];

const NOME_SALVO = 'rev_nome';

/**
 * DE ONDE A PESSOA VEIO.
 *
 * Ao abrir um vídeo, o portal deixa um bilhete dizendo pra onde voltar. Vai na
 * sessão do navegador, e não na URL, porque o endereço do vídeo é o que o
 * cliente repassa por e-mail — e o do portal abre a conta inteira dele.
 * Quem chega pelo link do e-mail simplesmente não tem bilhete, e o player não
 * inventa um botão de voltar pra lugar nenhum.
 */
const BILHETE = 'lumos_voltar';

const dia = (s?: string | null) =>
  s ? new Date(s.length <= 10 ? `${s}T12:00:00` : s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : null;

const quandoRelativo = (s: string) => {
  const d = Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
  if (d <= 0) return 'hoje';
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  return dia(s) || '';
};

/** Nome de arquivo vira nome de peça: sem extensão e sem underline. */
const nomeBonito = (f: string) => f.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

/** A classe do formato sai do tamanho real do vídeo. */
const formato = (l: number | null, a: number | null) => {
  if (!l || !a) return { classe: 'f169', rotulo: '16:9' };
  const r = l / a;
  if (r < 0.85) return { classe: 'f916', rotulo: '9:16' };
  if (r < 1.2) return { classe: 'f11', rotulo: '1:1' };
  return { classe: 'f169', rotulo: '16:9' };
};

export default function PortalCliente() {
  const { token = '' } = useParams();
  const [dados, setDados] = useState<Portal | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<string>('inicio');
  const [nome, setNome] = useState(() => localStorage.getItem(NOME_SALVO) || '');
  /**
   * Capas dos quadros, buscadas DEPOIS e só das que estão na tela.
   * A imagem mora dentro da linha do vídeo: mandar todas junto seriam 3,3 MB
   * antes de a tela aparecer.
   */
  const [capas, setCapas] = useState<Record<string, string | null>>({});
  const [digitando, setDigitando] = useState('');

  // As fontes do portal não são as do app: entram só aqui.
  useEffect(() => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Anton&family=DM+Mono:wght@400;500&family=Work+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(l);
    return () => { document.head.removeChild(l); };
  }, []);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_client_portal_v2', { p_token: token });
    if (error || !data || (data as any).error) { setErro('Link inválido ou desativado.'); return; }
    const d = data as Portal;
    setDados(d);
    // Voltando do player: reabre na aba de onde a pessoa saiu.
    const pedida = new URLSearchParams(window.location.search).get('aba');
    if (pedida && (pedida === 'inicio' || pedida === 'atendimento' || d.projetos.some(p => p.id === pedida))) {
      setAba(pedida);
    } else if (d.abrir_projeto) {
      // Link antigo, de projeto: abre já na aba daquele projeto.
      setAba(d.abrir_projeto);
    }
  }, [token]);
  useEffect(() => { carregar(); }, [carregar]);

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
      sessionStorage.setItem(BILHETE, JSON.stringify({
        url: `/portal/${token}${aba !== 'inicio' ? `?aba=${aba}` : ''}`,
        rotulo: dados ? `Portal de ${dados.cliente.nome}` : 'Portal',
      }));
    } catch { /* navegador sem sessão: só não tem botão de voltar */ }
  }, [token, aba, dados]);

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

  if (erro) {
    return (
      <div className="portal-lumos" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <style>{PORTAL_CSS}</style>
        <p className="rotulo">{erro}</p>
      </div>
    );
  }
  if (!dados) {
    return (
      <div className="portal-lumos" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <style>{PORTAL_CSS}</style>
        <span className="farol" />
      </div>
    );
  }

  // Quem está olhando. O mesmo nome da página de revisão, pra aprovação não
  // ficar sem dono agora que o link é da empresa inteira.
  if (!nome) {
    return (
      <div className="portal-lumos" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <style>{PORTAL_CSS}</style>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <img className="logotipo" src={LOGO_LUMOS} alt="Produtora Lumos" style={{ height: 26, marginBottom: 26 }} />
          <p className="rotulo">Portal de {dados.cliente.nome}</p>
          <h1 style={{ fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400, textTransform: 'uppercase', fontSize: 34, lineHeight: 1.02, margin: '8px 0 18px' }}>
            Como<br />te chamamos?
          </h1>
          <input
            autoFocus value={digitando} onChange={e => setDigitando(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && digitando.trim()) { localStorage.setItem(NOME_SALVO, digitando.trim()); setNome(digitando.trim()); } }}
            placeholder="Seu nome"
            className="campo"
          />
          <button className="botao" style={{ marginTop: 12, width: '100%' }}
            disabled={!digitando.trim()}
            onClick={() => { localStorage.setItem(NOME_SALVO, digitando.trim()); setNome(digitando.trim()); }}>
            Entrar
          </button>
          <p className="nota" style={{ marginTop: 14 }}>
            Serve pra sabermos quem aprovou cada vídeo. Sem senha e sem cadastro.
          </p>
        </div>
      </div>
    );
  }

  const projetoAberto = dados.projetos.find(p => p.id === aba) || null;
  const blocos = dados.portal.blocks || {};

  return (
    <div className="portal-lumos">
      <style>{PORTAL_CSS}</style>

      <header className="topo">
        <span className="marca"><img className="logotipo" src={LOGO_LUMOS} alt="Produtora Lumos" /></span>
        <span className="cliente">Portal de <b>{dados.cliente.nome}</b></span>
        <span className="quem">
          <span className="rosto">{nome.trim().charAt(0).toUpperCase()}</span>
          <span>Você é <b>{nome}</b></span>
          <button className="trocar" onClick={() => { localStorage.removeItem(NOME_SALVO); setNome(''); setDigitando(''); }}>trocar</button>
        </span>
      </header>

      <nav className="fita" role="tablist" aria-label="Projetos">
        <button className="aba" role="tab" aria-selected={aba === 'inicio'} onClick={() => setAba('inicio')}>
          Início {esperando.length > 0 && <span className="n">{esperando.length}</span>}
        </button>
        {dados.projetos.map(p => {
          const n = p.entregas.filter(e => e.status === 'EM_REVISAO_CLIENTE').length;
          return (
            <button key={p.id} className="aba" role="tab" aria-selected={aba === p.id} onClick={() => setAba(p.id)}>
              {p.nome.trim()} {n > 0 && <span className="n">{n}</span>}
            </button>
          );
        })}
        <button className="aba" role="tab" aria-selected={aba === 'atendimento'} onClick={() => setAba('atendimento')}>
          Atendimento
        </button>
      </nav>

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
                    <a key={p.id} className="proj" onClick={() => setAba(p.id)}>
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

            {blocos.escopo !== false && projetoAberto.escopo.length > 0 && (
              <section className="secao">
                <span className="rotulo">Seu pacote neste mês</span>
                {projetoAberto.escopo.map((it, i) => (
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

            {blocos.arquivos !== false && projetoAberto.arquivos.length > 0 && (
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
              {dados.contatos.length ? dados.contatos.map((c, i) => (
                <div key={i} className="pessoa">
                  <span className="rosto">{c.nome.charAt(0)}</span>
                  <span><span className="nm">{c.nome}</span><span className="fn">{c.cargo || 'Produtora Lumos'}</span></span>
                  <a href={`mailto:${c.email}`}>Escrever</a>
                </div>
              )) : (
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
    </div>
  );
}
