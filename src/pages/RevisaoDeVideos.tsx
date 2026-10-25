import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Film, LayoutGrid, List, Loader2, MessageSquare, PenLine, Search, Timer } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { textoSobre } from '@/lib/cores';
import { formatBudgetCode } from '@/utils/formatters';
import Select from '@/components/ui/Select';
import Modal from '@/components/common/Modal';
import VideoThumb from '@/components/producao/VideoThumb';
import VideoReviewPanel from '@/components/producao/VideoReviewPanel';

/**
 * REVISÃO DE VÍDEOS — todos os vídeos que passam pela Lumos, de todos os projetos, num lugar só.
 * Um "vídeo" é um grupo de versões (group_id); vale a versão mais nova. Responde: o que precisa de
 * revisão, o que precisa de ajuste, o que está aprovado, o que ainda não foi aprovado e o que está parado.
 * Abrir um vídeo abre o player de revisão do projeto, na versão escolhida.
 */

const DIAS_PARADO = 3; // revisão ou ajuste sem movimento há mais que isso conta como "parado"

type Status = 'EM_REVISAO_INTERNA' | 'ALTERACOES_INTERNAS' | 'EM_REVISAO_CLIENTE' | 'ALTERACOES_CLIENTE' | 'APROVADO';
const ORDEM_STATUS: Status[] = ['EM_REVISAO_INTERNA', 'ALTERACOES_INTERNAS', 'EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO'];
const STATUS: Record<Status, { label: string; curto: string; cor: string }> = {
  EM_REVISAO_INTERNA: { label: 'Revisão interna', curto: 'Rev. interna', cor: '#a855f7' },
  ALTERACOES_INTERNAS: { label: 'Alterações internas', curto: 'Ajuste interno', cor: '#f97316' },
  EM_REVISAO_CLIENTE: { label: 'Revisão do cliente', curto: 'Com o cliente', cor: '#f59e0b' },
  ALTERACOES_CLIENTE: { label: 'Alterações do cliente', curto: 'Ajuste do cliente', cor: '#ef4444' },
  APROVADO: { label: 'Aprovado', curto: 'Aprovado', cor: '#16a34a' },
};
const PRECISA_REVISAO: Status[] = ['EM_REVISAO_INTERNA', 'EM_REVISAO_CLIENTE'];
const PRECISA_AJUSTE: Status[] = ['ALTERACOES_INTERNAS', 'ALTERACOES_CLIENTE'];

interface VV {
  id: string;
  project_id: string;
  group_id: string;
  task_id: string | null;
  versao: number;
  status: Status;
  file_name: string;
  created_at: string;
  updated_at: string;
  entregue_em?: string | null;
  project: { id: string; name: string; code: string | null; status: string; client: { name: string } | null } | null;
}
interface Video {
  atual: VV;
  versoes: number;
  nome: string;
  dias: number;      // dias sem movimento
  parado: boolean;
  abertos: number;   // comentários em aberto na versão atual
}

const diasDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const quando = (d: number) => (d < 1 ? 'hoje' : d === 1 ? 'ontem' : d < 30 ? `há ${d} dias` : `há ${Math.floor(d / 30)} mês(es)`);
/** "Masterclass_Masp_V1.mp4" -> "Masterclass Masp" */
const nomeLimpo = (f: string) => f.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_\s.-]*v\d+\s*$/i, '').replace(/_/g, ' ').trim() || f;

function Selo({ s, curto }: { s: Status; curto?: boolean }) {
  const d = STATUS[s];
  return (
    <span className="inline-flex items-center rounded-full px-2 py-1 text-[9.5px] font-black uppercase leading-none tracking-wide whitespace-nowrap"
      style={{ background: d.cor, color: textoSobre(d.cor) }}>{curto ? d.curto : d.label}</span>
  );
}

type Rapida = 'todos' | 'revisao' | 'ajuste' | 'aprovados' | 'nao_aprovados' | 'sem_ajuste' | 'parados';
const RAPIDAS: { value: Rapida; label: string }[] = [
  { value: 'todos', label: 'Tudo' },
  { value: 'revisao', label: 'Precisa de revisão' },
  { value: 'ajuste', label: 'Precisa de ajuste' },
  { value: 'aprovados', label: 'Aprovados' },
  { value: 'nao_aprovados', label: 'Ainda não aprovados' },
  { value: 'sem_ajuste', label: 'Sem ajuste pendente' },
  { value: 'parados', label: `Parados (${DIAS_PARADO}+ dias)` },
];
const passaRapida = (v: Video, r: Rapida) => {
  const s = v.atual.status;
  switch (r) {
    case 'revisao': return PRECISA_REVISAO.includes(s);
    case 'ajuste': return PRECISA_AJUSTE.includes(s);
    case 'aprovados': return s === 'APROVADO';
    case 'nao_aprovados': return s !== 'APROVADO';
    case 'sem_ajuste': return !PRECISA_AJUSTE.includes(s);
    case 'parados': return v.parado;
    default: return true;
  }
};

const POR_PAGINA = 40;

export default function RevisaoDeVideos() {
  const [rows, setRows] = useState<VV[]>([]);
  const [abertosPorVersao, setAbertosPorVersao] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [visao, setVisao] = useState<'lista' | 'quadro'>(() => {
    try { return localStorage.getItem('lumos_revisao_visao') === 'quadro' ? 'quadro' : 'lista'; } catch { return 'lista'; }
  });
  const mudarVisao = (v: 'lista' | 'quadro') => { setVisao(v); try { localStorage.setItem('lumos_revisao_visao', v); } catch { /* sem armazenamento */ } };
  const [rapida, setRapida] = useState<Rapida>('todos');
  const [statusSel, setStatusSel] = useState<Set<Status>>(new Set());
  const [projetoFiltro, setProjetoFiltro] = useState('');
  const [clienteFiltro, setClienteFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<'recentes' | 'parados' | 'projeto' | 'status'>('recentes');
  const [comEncerrados, setComEncerrados] = useState(false);
  const [limite, setLimite] = useState(POR_PAGINA);

  const [capas, setCapas] = useState<Record<string, string | null>>({});
  const [aberto, setAberto] = useState<Video | null>(null);
  const [tarefasAbertas, setTarefasAbertas] = useState<{ id: string; titulo: string; status?: string }[]>([]);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    const proj = 'project:projects(id, name, code, status, client:clients(name))';
    // entregue_em pode não existir (migration pendente): cai pro select sem a coluna.
    let res: any = await supabase.from('video_versions')
      .select(`id, project_id, group_id, task_id, versao, status, file_name, created_at, updated_at, entregue_em, ${proj}`)
      .order('updated_at', { ascending: false });
    if (res.error) {
      res = await supabase.from('video_versions')
        .select(`id, project_id, group_id, task_id, versao, status, file_name, created_at, updated_at, ${proj}`)
        .order('updated_at', { ascending: false });
    }
    setRows((res.data as VV[]) || []);
    // Comentários em aberto (poucos): contados por versão.
    const c = await supabase.from('review_comments').select('video_version_id').eq('resolved', false);
    const m: Record<string, number> = {};
    for (const r of (c.data as { video_version_id: string }[]) || []) m[r.video_version_id] = (m[r.video_version_id] || 0) + 1;
    setAbertosPorVersao(m);
    setLoading(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useRealtimeRefetch(['video_versions', 'review_comments'], () => carregar(true));

  // Um vídeo = um grupo de versões; vale a versão mais nova.
  const videos = useMemo<Video[]>(() => {
    const g = new Map<string, { atual: VV; versoes: number }>();
    for (const r of rows) {
      if (!r.project) continue;
      const cur = g.get(r.group_id);
      if (!cur) g.set(r.group_id, { atual: r, versoes: 1 });
      else {
        cur.versoes++;
        if (r.versao > cur.atual.versao || (r.versao === cur.atual.versao && r.updated_at > cur.atual.updated_at)) cur.atual = r;
      }
    }
    return [...g.values()].map(({ atual, versoes }) => {
      const dias = diasDesde(atual.updated_at);
      return { atual, versoes, nome: nomeLimpo(atual.file_name), dias, parado: atual.status !== 'APROVADO' && dias >= DIAS_PARADO, abertos: abertosPorVersao[atual.id] || 0 };
    });
  }, [rows, abertosPorVersao]);

  // Escopo (projetos ativos, cliente, projeto, busca): os números dos cards e das opções vêm daqui.
  const noEscopo = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return videos.filter(v => {
      const p = v.atual.project!;
      if (!comEncerrados && p.status === 'concluido') return false;
      if (projetoFiltro && p.id !== projetoFiltro) return false;
      if (clienteFiltro && (p.client?.name || '') !== clienteFiltro) return false;
      if (q && !`${v.atual.file_name} ${p.name} ${p.code || ''} ${p.client?.name || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [videos, comEncerrados, projetoFiltro, clienteFiltro, busca]);

  const contagem = useMemo(() => {
    const c: Record<Status, number> = { EM_REVISAO_INTERNA: 0, ALTERACOES_INTERNAS: 0, EM_REVISAO_CLIENTE: 0, ALTERACOES_CLIENTE: 0, APROVADO: 0 };
    let parados = 0;
    noEscopo.forEach(v => { c[v.atual.status]++; if (v.parado) parados++; });
    return { c, parados, total: noEscopo.length };
  }, [noEscopo]);

  const lista = useMemo(() => {
    const f = noEscopo.filter(v => passaRapida(v, rapida) && (statusSel.size === 0 || statusSel.has(v.atual.status)));
    const ord = [...f];
    if (ordem === 'recentes') ord.sort((a, b) => b.atual.updated_at.localeCompare(a.atual.updated_at));
    if (ordem === 'parados') ord.sort((a, b) => (Number(b.atual.status !== 'APROVADO') - Number(a.atual.status !== 'APROVADO')) || b.dias - a.dias);
    if (ordem === 'projeto') ord.sort((a, b) => a.atual.project!.name.localeCompare(b.atual.project!.name, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));
    if (ordem === 'status') ord.sort((a, b) => ORDEM_STATUS.indexOf(a.atual.status) - ORDEM_STATUS.indexOf(b.atual.status) || b.atual.updated_at.localeCompare(a.atual.updated_at));
    return ord;
  }, [noEscopo, rapida, statusSel, ordem]);

  const visiveis = visao === 'lista' ? lista.slice(0, limite) : lista.slice(0, 120);
  useEffect(() => { setLimite(POR_PAGINA); }, [rapida, statusSel, projetoFiltro, clienteFiltro, busca, comEncerrados, ordem]);

  // Capas: só dos vídeos que aparecem (a miniatura é uma imagem inteira dentro da linha do banco).
  useEffect(() => {
    const faltando = visiveis.map(v => v.atual.id).filter(id => !(id in capas));
    if (!faltando.length) return;
    let vivo = true;
    (async () => {
      const novo: Record<string, string | null> = {};
      faltando.forEach(id => { novo[id] = null; });
      for (let i = 0; i < faltando.length; i += 20) {
        const { data } = await supabase.from('video_versions').select('id, thumb_url').in('id', faltando.slice(i, i + 20));
        (data || []).forEach((r: any) => { novo[r.id] = r.thumb_url ?? null; });
      }
      if (vivo) setCapas(prev => ({ ...prev, ...novo }));
    })();
    return () => { vivo = false; };
  }, [visiveis]); // eslint-disable-line react-hooks/exhaustive-deps

  const projetos = useMemo(() => {
    const m = new Map<string, string>();
    videos.forEach(v => { const p = v.atual.project!; if (comEncerrados || p.status !== 'concluido') m.set(p.id, p.name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [videos, comEncerrados]);
  const clientes = useMemo(() => {
    const s = new Set<string>();
    videos.forEach(v => { const p = v.atual.project!; if ((comEncerrados || p.status !== 'concluido') && p.client?.name) s.add(p.client.name); });
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [videos, comEncerrados]);

  const abrir = async (v: Video) => {
    setAberto(v);
    setTarefasAbertas([]);
    const { data } = await supabase.from('project_tasks').select('id, titulo, status').eq('project_id', v.atual.project_id).is('deleted_at', null);
    setTarefasAbertas((data as any) || []);
  };

  const temFiltro = rapida !== 'todos' || statusSel.size > 0 || !!projetoFiltro || !!clienteFiltro || !!busca.trim();
  const limpar = () => { setRapida('todos'); setStatusSel(new Set()); setProjetoFiltro(''); setClienteFiltro(''); setBusca(''); };

  // Cards: cada um é um atalho para a visão rápida correspondente.
  const cards: { k: Rapida; titulo: string; n: number; sub: string; cor: string; Icon: any }[] = [
    { k: 'revisao', titulo: 'Precisa de revisão', n: contagem.c.EM_REVISAO_INTERNA + contagem.c.EM_REVISAO_CLIENTE, sub: `${pl(contagem.c.EM_REVISAO_INTERNA, 'interna', 'internas')} · ${contagem.c.EM_REVISAO_CLIENTE} com o cliente`, cor: '#a855f7', Icon: Clock },
    { k: 'ajuste', titulo: 'Precisa de ajuste', n: contagem.c.ALTERACOES_INTERNAS + contagem.c.ALTERACOES_CLIENTE, sub: `${pl(contagem.c.ALTERACOES_INTERNAS, 'interno', 'internos')} · ${contagem.c.ALTERACOES_CLIENTE} do cliente`, cor: '#ef4444', Icon: PenLine },
    { k: 'aprovados', titulo: 'Aprovados', n: contagem.c.APROVADO, sub: `de ${contagem.total} vídeos`, cor: '#16a34a', Icon: CheckCircle2 },
    { k: 'parados', titulo: 'Parados', n: contagem.parados, sub: `sem movimento há ${DIAS_PARADO}+ dias`, cor: '#f59e0b', Icon: Timer },
  ];

  const Capa = ({ v, className }: { v: Video; className?: string }) => <VideoThumb src={capas[v.atual.id]} className={className} iconSize="w-8 h-8" />;
  const Projeto = ({ v }: { v: Video }) => (
    <span className="block text-[11px] text-lumos-text-secondary truncate">
      {v.atual.project!.code && <span className="font-black text-amber-600 dark:text-lumos-yellow">{formatBudgetCode(v.atual.project!.code!)} </span>}
      {v.atual.project!.name}{v.atual.project!.client?.name ? ` · ${v.atual.project!.client.name}` : ''}
    </span>
  );
  const Marcas = ({ v }: { v: Video }) => (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {v.parado && <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-500"><Timer className="w-3 h-3" />parado {quando(v.dias)}</span>}
      {v.abertos > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-black text-lumos-text-secondary"><MessageSquare className="w-3 h-3" />{v.abertos} em aberto</span>}
    </span>
  );

  return (
    <div className="space-y-4 font-work-sans pb-16">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight font-heading flex items-center gap-2"><Film className="w-6 h-6 text-lumos-yellow" /> Revisão de vídeos</h1>
          <p className="text-lumos-text-secondary text-sm mt-0.5">Todos os vídeos que passam pela Lumos, de todos os projetos: o que precisa de revisão, de ajuste e o que já foi aprovado.</p>
        </div>
        <div className="segmentado-lumos ml-auto flex items-center border border-lumos-border rounded-lumos overflow-hidden">
          {([['lista', 'Lista', List], ['quadro', 'Quadro', LayoutGrid]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => mudarVisao(k)} aria-pressed={visao === k}
              className={clsx('segmento-lumos h-9 px-3.5 text-[11px] font-black uppercase tracking-wide flex items-center gap-1.5 transition-colors',
                visao === k ? 'bg-lumos-yellow text-black' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Resumo: clicar filtra a lista */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(c => {
          const ativo = rapida === c.k;
          return (
            <button key={c.k} type="button" onClick={() => setRapida(ativo ? 'todos' : c.k)} aria-pressed={ativo}
              className={clsx('card !p-4 text-left transition-all hover:border-lumos-yellow/40', ativo && 'ring-2 ring-lumos-yellow border-lumos-yellow/60')}>
              <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">
                <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: c.cor, color: textoSobre(c.cor) }}><c.Icon className="w-3.5 h-3.5" /></span>
                {c.titulo}
              </span>
              <span className="mt-2 block text-3xl font-black text-lumos-text-primary tabular-nums leading-none">{c.n}</span>
              <span className="mt-1.5 block text-[10.5px] text-lumos-text-secondary">{c.sub}</span>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-52 max-md:flex-1">
            <Select value={rapida} onChange={v => setRapida(v as Rapida)} ariaLabel="Mostrar" className="input-lumos h-9 w-full text-xs font-bold" options={RAPIDAS} />
          </div>
          <div className="w-48 max-md:flex-1">
            <Select value={clienteFiltro} onChange={setClienteFiltro} searchable className="input-lumos h-9 w-full text-xs"
              options={[{ value: '', label: 'Todos os clientes' }, ...clientes.map(c => ({ value: c, label: c }))]} />
          </div>
          <div className="w-56 max-md:flex-1">
            <Select value={projetoFiltro} onChange={setProjetoFiltro} searchable className="input-lumos h-9 w-full text-xs"
              options={[{ value: '', label: 'Todos os projetos' }, ...projetos.map(([id, nome]) => ({ value: id, label: nome }))]} />
          </div>
          <div className="w-44 max-md:flex-1">
            <Select value={ordem} onChange={v => setOrdem(v as typeof ordem)} className="input-lumos h-9 w-full text-xs" ariaLabel="Ordenar"
              options={[
                { value: 'recentes', label: 'Mais recentes' },
                { value: 'parados', label: 'Mais tempo parado' },
                { value: 'status', label: 'Por status' },
                { value: 'projeto', label: 'Por projeto' },
              ]} />
          </div>
          <div className="relative ml-auto max-md:ml-0 max-md:w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary" />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar vídeo, projeto ou cliente…" className="input-lumos h-9 pl-8 w-64 max-md:w-full text-xs" />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 max-md:w-full max-md:overflow-x-auto no-scrollbar">
            {ORDEM_STATUS.map(s => {
              const ativo = statusSel.has(s);
              return (
                <button key={s} type="button" aria-pressed={ativo}
                  onClick={() => setStatusSel(prev => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; })}
                  className={clsx('chip-lumos h-8 px-3 rounded-full border text-[10.5px] font-black flex items-center gap-1.5 transition-colors flex-shrink-0 whitespace-nowrap',
                    ativo ? 'border-transparent' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}
                  style={ativo ? { background: STATUS[s].cor, color: textoSobre(STATUS[s].cor) } : undefined}>
                  <span className="w-2 h-2 rounded-full" style={{ background: ativo ? textoSobre(STATUS[s].cor) : STATUS[s].cor }} />
                  {STATUS[s].label} <span className="tabular-nums opacity-80">{contagem.c[s]}</span>
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-lumos-text-secondary cursor-pointer ml-auto">
            <input type="checkbox" checked={comEncerrados} onChange={e => setComEncerrados(e.target.checked)} className="rounded border-lumos-border text-lumos-yellow focus:ring-lumos-yellow" />
            Incluir projetos encerrados
          </label>
          {temFiltro && <button type="button" onClick={limpar} className="text-[11px] font-bold text-lumos-yellow hover:underline">Limpar filtros</button>}
        </div>
      </div>

      {loading ? (
        <div className="min-h-[30vh] grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" /></div>
      ) : lista.length === 0 ? (
        <div className="card p-10 text-center">
          <Film className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" />
          <p className="text-sm font-bold text-lumos-text-primary">{videos.length === 0 ? 'Nenhum vídeo em revisão ainda.' : 'Nenhum vídeo com esses filtros.'}</p>
          {temFiltro && <button type="button" onClick={limpar} className="mt-2 text-xs font-bold text-lumos-yellow hover:underline">Limpar filtros</button>}
        </div>
      ) : visao === 'lista' ? (
        <>
          <p className="text-[11px] text-lumos-text-secondary">{lista.length} {lista.length === 1 ? 'vídeo' : 'vídeos'}</p>
          <div className="card !p-0 overflow-hidden divide-y divide-lumos-border/60">
            {visiveis.map(v => (
              <button key={v.atual.group_id} type="button" onClick={() => abrir(v)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-lumos-text-primary/5 transition-colors">
                <Capa v={v} className="w-24 aspect-video rounded flex-shrink-0 max-md:w-20" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-bold text-lumos-text-primary truncate">{v.nome}</span>
                    <span className="text-[10px] font-black text-lumos-text-secondary flex-shrink-0">v{v.atual.versao}{v.versoes > 1 ? ` · ${v.versoes} versões` : ''}</span>
                  </span>
                  <Projeto v={v} />
                  <span className="md:hidden mt-1 flex items-center gap-2 flex-wrap"><Selo s={v.atual.status} curto /><Marcas v={v} /></span>
                </span>
                <span className="hidden md:flex flex-col items-start gap-1 w-44 flex-shrink-0"><Selo s={v.atual.status} /><Marcas v={v} /></span>
                <span className="hidden md:block w-24 flex-shrink-0 text-right text-[11px] text-lumos-text-secondary">{quando(v.dias)}</span>
              </button>
            ))}
          </div>
          {lista.length > visiveis.length && (
            <button type="button" onClick={() => setLimite(l => l + POR_PAGINA)} className="btn-secondary h-9 px-4 text-xs font-bold mx-auto block">
              Mostrar mais ({lista.length - visiveis.length})
            </button>
          )}
        </>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 items-start">
          {ORDEM_STATUS.map(s => {
            const col = visiveis.filter(v => v.atual.status === s);
            return (
              <div key={s} className="card !p-3 w-[270px] flex-shrink-0 space-y-2">
                <p className="flex items-center gap-2 px-1 text-[10px] font-black uppercase tracking-widest">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS[s].cor }} />
                  <span className="text-lumos-text-primary">{STATUS[s].label}</span>
                  <span className="ml-auto tabular-nums text-lumos-text-secondary">{lista.filter(v => v.atual.status === s).length}</span>
                </p>
                {col.length === 0 ? <p className="px-1 py-3 text-[11px] italic text-lumos-text-secondary">Nada aqui.</p> : col.map(v => (
                  <button key={v.atual.group_id} type="button" onClick={() => abrir(v)}
                    className="w-full text-left rounded-lumos border border-lumos-border bg-lumos-bg/40 overflow-hidden hover:border-lumos-yellow/40 transition-colors">
                    <Capa v={v} className="w-full aspect-video" />
                    <span className="block p-2.5 space-y-1">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[12px] font-bold text-lumos-text-primary truncate">{v.nome}</span>
                        <span className="text-[9.5px] font-black text-lumos-text-secondary flex-shrink-0">v{v.atual.versao}</span>
                      </span>
                      <Projeto v={v} />
                      <span className="flex items-center justify-between gap-2"><Marcas v={v} /><span className="text-[10px] text-lumos-text-secondary">{quando(v.dias)}</span></span>
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {aberto && (
        <Modal isOpen onClose={() => setAberto(null)} title={aberto.atual.project!.name} maxWidth="max-w-6xl" padding="p-4" portal
          header={(
            <div className="flex items-center gap-2 min-w-0">
              <Film className="w-4 h-4 text-lumos-yellow flex-shrink-0" />
              <h3 className="text-sm font-black uppercase tracking-tight text-lumos-text-primary truncate">
                {aberto.atual.project!.code && <span className="text-amber-600 dark:text-lumos-yellow">{formatBudgetCode(aberto.atual.project!.code!)} </span>}
                {aberto.atual.project!.name}
              </h3>
            </div>
          )}>
          <VideoReviewPanel projectId={aberto.atual.project_id} tasks={tarefasAbertas} abrirVersao={aberto.atual.id} />
        </Modal>
      )}
    </div>
  );
}
