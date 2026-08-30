import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { PORTAL_CSS, LOGO_LUMOS, LOGO_LUMOS_ESCURO } from './portalCliente.css';

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
  portal: { show_financeiro: boolean; blocks: Record<string, boolean>; exige_login?: boolean };
  /** Quem entrou, quando o portal exige login. Nome verificado, não digitado. */
  voce?: { nome: string; email: string } | null;
  abrir_projeto: string | null;
  projetos: Projeto[];
  contatos: { nome: string; email: string; cargo: string | null; foto: string | null; whatsapp: string | null; slack: string | null }[];
  financeiro: { em_dia: boolean; proximo_vencimento: string | null } | null;
  atividade: { tipo: string; projeto: string; file_name: string; decisao?: string; quem?: string; versao?: number; quando: string }[];
}

/** A agenda de diárias de um projeto: calendário, gravações marcadas, pacote
 *  do mês e os pedidos em aberto. Vem inteira de `portal_agenda`. */
interface Agenda {
  antecedencia_dias: number;
  /** `motivo` é null quando não há motivo, e sempre null em dia ocupado (isso
   *  não é "fechado", é "já tem gravação"). Só existe depois da migração
   *  2026093334: sem ela, a chave nem vem, e o dia bloqueado mostra o texto
   *  genérico de sempre. */
  dias: { data: string; estado: 'livre' | 'ocupado' | 'bloqueado' | 'cedo'; motivo?: string | null }[];
  agendadas: { nome: string; data: string; hora_inicio: string | null; hora_fim: string | null; local: string | null }[];
  /** O pacote do MÊS CORRENTE, do bloco "Suas diárias neste mês". */
  pacote: { meta: number; realizado: number } | null;
  /** O pacote de cada mês que o calendário alcança, com a chave em 'AAAA-MM'.
   *  O aviso de diária extra tem que ler o mês da data escolhida, que é o mesmo
   *  mês que `portal_pedir_diaria` usa pra gravar `fora_do_pacote`. Mês sem
   *  contrato por volume não entra no mapa. Opcional porque só existe depois da
   *  migração 2026093333. */
  pacotes?: Record<string, { meta: number; realizado: number }>;
  pedidos: { id: string; data_desejada: string; estado: string; motivo_recusa: string | null; fora_do_pacote: boolean; descricao: string }[];
}

/** As quatro abas de dentro de um projeto. */
type AbaProjeto = 'geral' | 'entregas' | 'diarias' | 'arquivos';
const ABAS_PROJETO: readonly AbaProjeto[] = ['geral', 'entregas', 'diarias', 'arquivos'];

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

/** Como o cliente lê o estado de um pedido de diária. */
const ESTADO_PEDIDO: Record<string, { label: string; classe: string }> = {
  pendente: { label: 'Esperando a Lumos', classe: 's-prod' },
  aceito: { label: 'Aceito', classe: 's-ok' },
  recusado: { label: 'Recusado', classe: 's-aj' },
  cancelado: { label: 'Cancelado', classe: 's-prod' },
};

/** Motivo de recusa de `portal_pedir_diaria` e `portal_cancelar_pedido`, em
 *  português direto. Código que a função não devolve nunca (ou que a IA não
 *  previu) cai no genérico: botão que não responde é pior que aviso vago. */
const MOTIVOS: Record<string, string> = {
  cedo: 'Esta data é cedo demais. Escolha um dia com mais folga.',
  dia_ocupado: 'Este dia acabou de ser ocupado. Escolha outro.',
  dia_bloqueado: 'Este dia não está disponível.',
  dia_semana_fechado: 'Não gravamos neste dia da semana. Escolha outro dia.',
  repetido: 'Você já tem um pedido em aberto para este dia.',
  sem_descricao: 'Conte o que precisa gravar.',
  sem_nome: 'Diga seu nome e seu e-mail.',
  sem_acesso: 'Este projeto não está disponível para você.',
};
const MOTIVO_GENERICO = 'Não foi possível fazer isso agora. Tente de novo em instantes.';
const motivoPedido = (erro: string) => MOTIVOS[erro] || MOTIVO_GENERICO;
/** Cancelar tem seu próprio `sem_acesso`: aqui não é "projeto indisponível",
 *  é "este pedido não é seu" (portal com login, pedido de outra pessoa). */
const motivoCancelar = (erro: string) =>
  erro === 'sem_acesso' ? 'Este pedido é de outra pessoa.' : (MOTIVOS[erro] || MOTIVO_GENERICO);

/** `portal_agenda` também devolve `error`, e não tem as chaves de `Agenda`
 *  quando devolve: sem tratar, `agenda?.dias` etc. quebram o render (tela
 *  branca). O caso mais comum é sessão vencida num portal com login. */
const motivoAgenda = (erro: string, exigeLogin: boolean) => {
  if (erro === 'invalid') return 'Este link não está mais ativo. Fale com quem te mandou o link.';
  if (erro === 'sem_acesso') {
    return exigeLogin
      ? 'Sua sessão expirou. Entre de novo para ver as diárias deste projeto.'
      : 'Este projeto não está disponível para diárias agora.';
  }
  return MOTIVO_GENERICO;
};

const NOME_SALVO = 'rev_nome';
const EMAIL_SALVO = 'rev_email';

const Sol = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const Lua = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
const IconeZap = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.14c-.25.7-1.44 1.33-1.99 1.38-.53.05-1.02.24-3.44-.72-2.9-1.15-4.75-4.11-4.89-4.3-.14-.19-1.17-1.56-1.17-2.98 0-1.42.74-2.12 1-2.41.26-.29.57-.36.76-.36h.55c.18 0 .41-.03.64.49.25.6.84 2.07.91 2.22.07.15.12.32.02.51-.34.69-.71.66-.51 1 .74 1.27 1.48 1.71 2.6 2.28.19.1.3.08.42-.05.12-.14.48-.56.61-.75.13-.19.26-.16.44-.1.18.07 1.15.54 1.35.64.2.1.33.15.38.23.05.09.05.51-.2 1.21Z" />
  </svg>
);
const IconeSlack = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M6 15.2A2.1 2.1 0 1 1 3.9 13H6v2.2Zm1.1 0A2.1 2.1 0 0 1 9.2 13a2.1 2.1 0 0 1 2.1 2.2v5.3a2.1 2.1 0 1 1-4.2 0v-5.3ZM9.2 6.1A2.1 2.1 0 1 1 11.3 4v2.1H9.2Zm0 1.1a2.1 2.1 0 0 1 0 4.2H3.9a2.1 2.1 0 0 1 0-4.2h5.3ZM18 9.3a2.1 2.1 0 1 1 2.1 2.1H18V9.3Zm-1.1 0a2.1 2.1 0 0 1-4.2 0V3.9a2.1 2.1 0 1 1 4.2 0v5.4ZM14.8 18a2.1 2.1 0 1 1-2.1 2.1V18h2.1Zm0-1.1a2.1 2.1 0 0 1 0-4.2h5.3a2.1 2.1 0 0 1 0 4.2h-5.3Z" />
  </svg>
);
const IconeMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" />
  </svg>
);

/** WhatsApp aceita telefone escrito de qualquer jeito; o link precisa de dígitos. */
const linkZap = (n: string) => {
  const so = n.replace(/\D/g, '');
  if (so.length < 10) return null;
  return `https://wa.me/${so.length <= 11 ? '55' + so : so}`;
};
/** Slack pode vir como link ou como @nome; só o link vira botão que abre algo. */
const linkSlack = (s: string) => (/^https?:\/\//.test(s.trim()) ? s.trim() : null);

/** Setinha do menu, virada quando ele está aberto. */
const ChevronDown = ({ aberto }: { aberto: boolean }) => (
  <svg className={aberto ? 'seta virada' : 'seta'} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const IconeFechar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
/** Seta do cabeçalho do calendário: o mesmo chevron do menu, deitado. */
const SetaMes = ({ dir }: { dir: 'esq' | 'dir' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    style={{ transform: dir === 'esq' ? 'rotate(90deg)' : 'rotate(-90deg)' }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

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

/** O mês de uma data 'AAAA-MM-DD' por extenso, pro aviso dizer de que mês está
 *  falando: o calendário vai a 90 dias, e quase toda data escolhida cai num mês
 *  que não é o de hoje. */
const mesPorExtenso = (s: string) =>
  new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' });

/** A data por extenso, pro título da janela de pedido: "Terça-feira, 3 de
 *  setembro de 2026". */
const dataPorExtenso = (s: string) => {
  const t = new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** O mês de hoje em 'AAAA-MM', pelo relógio local. `toISOString()` é UTC e
 *  viraria o mês cedo demais na virada do dia, aqui no fuso do Brasil. */
const mesDeHoje = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
};

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

const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MES_NOME = ['janeiro','fevereiro','março','abril','maio','junho',
  'julho','agosto','setembro','outubro','novembro','dezembro'];
/** Plural do dia da semana, pra legenda de motivos ("Domingos: ..."). Mesmo
 *  índice do `Date#getDay()` (0 = domingo). */
const DIA_SEMANA_PLURAL = ['Domingos', 'Segundas-feiras', 'Terças-feiras',
  'Quartas-feiras', 'Quintas-feiras', 'Sextas-feiras', 'Sábados'];

function Calendario({ dias, escolhido, onEscolher }: {
  dias: { data: string; estado: string; motivo?: string | null }[];
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
    const i = meses.findIndex(m => m.chave === mesDeHoje());
    return i >= 0 ? i : 0;
  });
  // Guarda contra o mês sumir de baixo da pessoa se `dias` encolher.
  useEffect(() => {
    setIndice(i => Math.min(i, Math.max(0, meses.length - 1)));
  }, [meses.length]);

  const mes = meses[indice];

  /** Legenda dos motivos de indisponibilidade do mês em tela: o `title` do
   *  dia só existe pra quem passa o mouse, e no celular não tem hover — sem
   *  isto, o motivo de um dia bloqueado nunca chega ao cliente no celular.
   *  Agrupa por texto do motivo (sem repetir a mesma frase duas vezes): mais
   *  de um dia com o mesmo motivo, todos no mesmo dia da semana, vira
   *  "Domingos" (fechamento semanal); senão vira a(s) data(s) específica(s),
   *  tipo "21/09". Só dias com motivo escrito entram — 'ocupado' e 'cedo'
   *  não têm motivo de texto. */
  const legenda = useMemo(() => {
    if (!mes) return [];
    const porMotivo = new Map<string, string[]>();
    mes.dias.forEach(d => {
      if (d.estado !== 'bloqueado' || !d.motivo) return;
      const lista = porMotivo.get(d.motivo) || [];
      lista.push(d.data);
      porMotivo.set(d.motivo, lista);
    });
    return Array.from(porMotivo.entries()).map(([motivo, datas]) => {
      const semanas = new Set(datas.map(dt => new Date(`${dt}T12:00:00`).getDay()));
      const rotulo = datas.length > 1 && semanas.size === 1
        ? DIA_SEMANA_PLURAL[[...semanas][0]]
        : datas.map(dt => `${dt.slice(8, 10)}/${dt.slice(5, 7)}`).join(', ');
      return { rotulo, motivo };
    });
  }, [mes]);

  if (!mes) return null;

  // T12:00:00 e não T00:00:00: meia-noite em fuso negativo cai no dia
  // anterior, e o calendário inteiro anda uma casa.
  const vazios = new Date(mes.dias[0].data + 'T12:00:00').getDay();

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
        {Array.from({ length: vazios }, (_, i) => <span key={`v${i}`} />)}
        {mes.dias.map(d => {
          const livre = d.estado === 'livre';
          return (
            <button key={d.data} type="button" disabled={!livre}
              className={`dia ${d.estado}${escolhido === d.data ? ' escolhido' : ''}`}
              title={livre ? 'Pedir esta data'
                : d.estado === 'cedo' ? 'Cedo demais para pedir' : (d.motivo || 'Indisponível')}
              onClick={e => onEscolher(d.data, e.currentTarget)}>
              {Number(d.data.slice(8, 10))}
            </button>
          );
        })}
      </div>
      {!!legenda.length && (
        <div className="legenda-dias">
          {legenda.map((l, i) => (
            <p key={i}><b>{l.rotulo}:</b> {l.motivo}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PortalCliente() {
  const { token = '' } = useParams();
  const [dados, setDados] = useState<Portal | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** 'precisa_login' abre a tela de entrada; 'sem_acesso' explica e para por aí. */
  const [porta, setPorta] = useState<{ tipo: 'precisa_login' | 'sem_acesso'; cliente: string } | null>(null);
  const [emailLogin, setEmailLogin] = useState('');
  const [enviandoLink, setEnviandoLink] = useState(false);
  const [linkEnviado, setLinkEnviado] = useState(false);
  const [aba, setAba] = useState<string>('inicio');
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
  const [nome, setNome] = useState(() => localStorage.getItem(NOME_SALVO) || '');
  /**
   * Capas dos quadros, buscadas DEPOIS e só das que estão na tela.
   * A imagem mora dentro da linha do vídeo: mandar todas junto seriam 3,3 MB
   * antes de a tela aparecer.
   */
  const [capas, setCapas] = useState<Record<string, string | null>>({});
  const [digitando, setDigitando] = useState('');
  const [menuProjetos, setMenuProjetos] = useState(false);
  /** Tema do portal, lembrado por navegador. Começa escuro: é sala de projeção. */
  const [tema, setTema] = useState<'escuro' | 'claro'>(() => {
    try { return (localStorage.getItem('portal_tema') as 'escuro' | 'claro') || 'escuro'; } catch { return 'escuro'; }
  });
  useEffect(() => { try { localStorage.setItem('portal_tema', tema); } catch { /* ignore */ } }, [tema]);

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
    const falha = (data as any)?.error;
    if (falha === 'precisa_login' || falha === 'sem_acesso') {
      setPorta({ tipo: falha, cliente: (data as any)?.cliente?.nome || '' });
      return;
    }
    if (error || !data || falha) { setErro('Link inválido ou desativado.'); return; }
    const d = data as Portal;
    setPorta(null);
    // Nome verificado manda no digitado: é ele que assina as aprovações.
    if (d.voce?.nome) {
      setNome(d.voce.nome);
      try { localStorage.setItem(NOME_SALVO, d.voce.nome); } catch { /* ignore */ }
    }
    setDados(d);
    // Voltando do player: reabre na aba de onde a pessoa saiu — e, se era de
    // dentro de um projeto, na aba interna também (`sub`).
    const params = new URLSearchParams(window.location.search);
    const pedida = params.get('aba');
    const ehProjeto = !!pedida && d.projetos.some(p => p.id === pedida);
    if (pedida && (pedida === 'inicio' || pedida === 'atendimento' || ehProjeto)) {
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
        url: `/portal/${token}${aba !== 'inicio' ? `?aba=${aba}${sub}` : ''}`,
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
  const [pedEmail, setPedEmail] = useState(() => {
    try { return localStorage.getItem(EMAIL_SALVO) || ''; } catch { return ''; }
  });
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
  useEffect(() => { setDataEscolhida(null); setErroPedido(null); }, [abaProj, projetoAberto?.id]);

  // A janela de pedido (aberta quando há data escolhida) fecha pelo Esc, trava
  // a rolagem de trás enquanto está aberta, prende o foco lá dentro (Tab não
  // escapa pro conteúdo atrás) e devolve o foco pro dia que a abriu quando ela
  // fecha — sem isto, quem usa teclado ou leitor de tela continua "atrás" da
  // janela, mesmo com aria-modal="true".
  useEffect(() => {
    if (!dataEscolhida) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const modal = pedidoModalRef.current;
    modal?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDataEscolhida(null); return; }
      if (e.key === 'Tab' && modal) {
        const focaveis = Array.from(modal.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ));
        if (!focaveis.length) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primeiro.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      gatilhoPedidoRef.current?.focus();
    };
  }, [dataEscolhida]);

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
      try {
        localStorage.setItem(NOME_SALVO, pedNome.trim());
        localStorage.setItem(EMAIL_SALVO, pedEmail.trim());
      } catch { /* ignore */ }
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
        <style>{PORTAL_CSS}</style>
        <p className="rotulo">{erro}</p>
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
      // Confere antes de mandar, mas a tela responde a mesma coisa nos dois
      // casos: o portal não vira jeito de descobrir quem trabalha no cliente.
      const { data: pode } = await supabase.rpc('portal_pode_entrar', { p_token: token, p_email: email });
      if (pode) {
        await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
      }
      setEnviandoLink(false);
      setLinkEnviado(true);
    };
    return (
      <div className={`portal-lumos ${tema === 'claro' ? 'claro' : ''}`} style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <style>{PORTAL_CSS}</style>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <img className="logotipo" src={tema === 'claro' ? LOGO_LUMOS_ESCURO : LOGO_LUMOS} alt="Produtora Lumos" style={{ height: 26, marginBottom: 26 }} />
          <p className="rotulo">Portal de {porta.cliente}</p>
          {porta.tipo === 'sem_acesso' ? (
            <>
              <h1 style={{ fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400, textTransform: 'uppercase', fontSize: 32, lineHeight: 1.02, margin: '8px 0 14px' }}>
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
              <h1 style={{ fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400, textTransform: 'uppercase', fontSize: 32, lineHeight: 1.02, margin: '8px 0 14px' }}>
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
              <h1 style={{ fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400, textTransform: 'uppercase', fontSize: 32, lineHeight: 1.02, margin: '8px 0 14px' }}>
                Entre com<br />seu e-mail
              </h1>
              <input autoFocus type="email" className="campo" placeholder="voce@empresa.com.br"
                value={emailLogin} onChange={e => setEmailLogin(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') enviar(); }} />
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
        <style>{PORTAL_CSS}</style>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <img className="logotipo" src={tema === "claro" ? LOGO_LUMOS_ESCURO : LOGO_LUMOS} alt="Produtora Lumos" style={{ height: 26, marginBottom: 26 }} />
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

  const blocos = dados.portal.blocks || {};

  return (
    <div className={`portal-lumos ${tema === "claro" ? "claro" : ""}`}>
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
          <button type="button" className="link" aria-current={aba === 'inicio'}
            onClick={() => setAba('inicio')}>
            Início
          </button>

          <span className="menu-abre">
            {/* Sempre "Projetos": o rótulo é o nome do lugar, não o do item
                aberto. Qual projeto está aberto já está no título da página, e
                um botão que muda de nome faz a pessoa procurar o menu duas
                vezes. O destaque em amarelo é que diz que ela está num deles. */}
            <button type="button" className="link" aria-haspopup="menu" aria-expanded={menuProjetos}
              aria-current={!!projetoAberto}
              onClick={() => setMenuProjetos(o => !o)}>
              Projetos
              <ChevronDown aberto={menuProjetos} />
            </button>
            {menuProjetos && (
              <>
                <span className="fora" onClick={() => setMenuProjetos(false)} />
                <span className="menu" role="menu">
                  {dados.projetos.map(p => {
                    const n = p.entregas.filter(e => e.status === 'EM_REVISAO_CLIENTE').length;
                    return (
                      <button key={p.id} role="menuitem" type="button"
                        className={p.id === aba ? 'item atual' : 'item'}
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
            localStorage.removeItem(NOME_SALVO); setNome(''); setDigitando('');
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

            <nav className="fita fita-proj" aria-label="Seções do projeto">
              {([
                ['geral', 'Visão geral'],
                ['entregas', 'Entregas'],
                ['diarias', 'Diárias'],
                ['arquivos', 'Arquivos'],
              ] as const).map(([chave, rotulo]) => (
                (chave !== 'arquivos' || projetoAberto.arquivos.length > 0) && (
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

                  <section className="secao">
                    <span className="rotulo">Gravações marcadas</span>
                    {!agenda?.agendadas.length ? (
                      <p className="nota">Nenhuma gravação marcada por enquanto.</p>
                    ) : agenda.agendadas.map((g, i) => (
                      <div key={i} className="arquivo">
                        <span className="nm">{g.nome}<span>{dia(g.data)}{g.hora_inicio ? `, ${g.hora_inicio.slice(0,5)}` : ''}{g.local ? `, ${g.local}` : ''}</span></span>
                      </div>
                    ))}
                  </section>

                  <section className="secao">
                    <span className="rotulo">Pedir uma data</span>
                    {carregandoAgenda ? <span className="farol" /> : <Calendario dias={agenda?.dias || []} escolhido={dataEscolhida} onEscolher={abrirPedido} />}
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
    </div>
  );
}
