import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Film, Play, Check, LayoutDashboard, Clapperboard, ArrowRight, FolderOpen,
  DollarSign, Headset, Camera, Sun, Moon, CircleCheckBig, RotateCcw, Image,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';

// ───────────────────────── Tipos (payload da RPC get_client_portal) ─────────
interface Entrega {
  file_name: string; versao: number; status: string;
  client_decision: string | null; client_decided_by: string | null; client_decided_at: string | null;
  thumb_url: string | null; entregue_em: string | null; review_token: string | null;
}
interface PortalData {
  portal: { show_financeiro: boolean };
  project: { name: string; code: string | null; status: string; data_fim: string | null };
  stages: Record<string, number>;
  entregas: Entrega[];
  arquivos: { name: string; url: string; kind: string }[];
  financeiro: { em_dia: boolean; proximo_vencimento: string | null } | null;
  contato: { nome: string; email: string } | null;
  atividade: { tipo: string; file_name: string; decisao?: string; quem?: string; versao?: number; quando: string }[];
}

// Status do vídeo traduzido pra régua do CLIENTE.
type ClientStatus = 'voce' | 'ok' | 'ajustes' | 'prod';
const clientStatus = (s: string): ClientStatus =>
  s === 'EM_REVISAO_CLIENTE' ? 'voce'
    : s === 'APROVADO' ? 'ok'
    : s === 'ALTERACOES_CLIENTE' ? 'ajustes'
    : 'prod';

const CS_UI: Record<ClientStatus, { label: string; chip: string }> = {
  voce: { label: 'Com você', chip: 'bg-lumos-yellow text-black' },
  ok: { label: 'Aprovado ✓', chip: 'bg-green-600 text-white' },
  ajustes: { label: 'Ajustes', chip: 'bg-red-500 text-white' },
  prod: { label: 'Em produção', chip: 'bg-sky-700 text-white' },
};

// Cores da barra de status, VALIDADAS pra daltonismo/contraste nos 2 temas
// (ordem fixa: Aprovadas → Na Lumos → Com você; gaps de 2px + legenda com
// rótulos são a codificação secundária exigida pelo validador).
const SEG = {
  dark: { ok: '#16a34a', lumos: '#0284c7', voce: '#a16207' },
  light: { ok: '#15803d', lumos: '#0369a1', voce: '#854d0e' },
};

const fmtDay = (s?: string | null) => s ? new Date(s.length <= 10 ? s + 'T12:00:00' : s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : null;

// Marcos: derivados das contagens de tarefas por etapa.
const MARCOS = [
  { key: 'roteiro', label: 'Roteiro', stages: ['roteiro'] },
  { key: 'captacao', label: 'Captação', stages: ['captacao'] },
  { key: 'edicao', label: 'Edição', stages: ['em_progresso'] },
  { key: 'revisao', label: 'Sua revisão', stages: ['revisao_interna', 'revisao_cliente', 'alteracoes'] },
];

export default function PortalCliente() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<'todas' | 'voce' | 'ok'>('todas');
  // Tema local do portal: nasce escuro (marca Lumos), o cliente pode alternar.
  const [ptheme, setPtheme] = useState<'dark' | 'light'>('dark');
  const themeClass = ptheme === 'dark' ? 'dark' : 'theme-light';

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabase.rpc('get_client_portal', { p_token: token });
    if (err || !res || (res as any).error) { setError(true); setLoading(false); return; }
    setData(res as PortalData);
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const seg = SEG[ptheme];

  const derived = useMemo(() => {
    if (!data) return null;
    const list = data.entregas.map(e => ({ ...e, cs: clientStatus(e.status) }));
    const nOk = list.filter(e => e.cs === 'ok').length;
    const nVoce = list.filter(e => e.cs === 'voce').length;
    const nProd = list.filter(e => e.cs === 'prod').length;
    const nAj = list.filter(e => e.cs === 'ajustes').length;
    const total = list.length;
    const stages = data.stages || {};
    const taskTotal = Object.values(stages).reduce((a, b) => a + b, 0);
    const taskDone = stages['concluido'] || 0;
    const pct = total > 0 ? Math.round((nOk / total) * 100) : (taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0);
    // Marcos: um marco está concluído se não tem tarefa aberta nas etapas dele
    // e o fluxo já passou por ali (alguma etapa seguinte tem atividade) ou o
    // projeto acabou. O atual é o primeiro com tarefa aberta.
    const openIn = (keys: string[]) => keys.reduce((a, k) => a + (stages[k] || 0), 0);
    let currentIdx = MARCOS.findIndex(m => openIn(m.stages) > 0);
    const projDone = data.project.status === 'concluido';
    if (currentIdx === -1) currentIdx = projDone ? MARCOS.length + 1 : MARCOS.length; // tudo limpo → Entrega final
    const ultimaOk = list.filter(e => e.cs === 'ok' && e.client_decided_at)
      .sort((a, b) => (b.client_decided_at || '').localeCompare(a.client_decided_at || ''))[0];
    return { list, nOk, nVoce, nProd, nAj, total, pct, currentIdx, projDone, ultimaOk };
  }, [data]);

  const shown = useMemo(() => {
    if (!derived) return [];
    const order: Record<ClientStatus, number> = { voce: 0, ajustes: 1, prod: 2, ok: 3 };
    return derived.list
      .filter(e => filter === 'todas' ? true : e.cs === filter)
      .sort((a, b) => order[a.cs] - order[b.cs] || (b.entregue_em || '').localeCompare(a.entregue_em || ''));
  }, [derived, filter]);

  const goEntregas = (f: 'todas' | 'voce') => {
    setFilter(f);
    document.getElementById('sec-entregas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (loading) {
    return (
      <div className="dark min-h-screen bg-lumos-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-lumos-yellow" />
      </div>
    );
  }
  if (error || !data || !derived) {
    return (
      <div className="dark min-h-screen bg-lumos-bg flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="font-heading font-black text-xl text-lumos-text-primary">LUMOS<span className="text-lumos-yellow">.</span></p>
          <p className="mt-4 text-sm text-lumos-text-primary font-bold">Este link de portal é inválido ou foi desativado.</p>
          <p className="mt-1 text-xs text-lumos-text-secondary">Fale com seu contato na Lumos pra receber um link novo.</p>
        </div>
      </div>
    );
  }

  const { list, nOk, nVoce, nProd, nAj, total, pct, currentIdx, projDone, ultimaOk } = derived;
  const naLumos = nProd + nAj;

  return (
    <div className={clsx(themeClass, 'min-h-screen bg-lumos-bg text-lumos-text-primary font-work-sans transition-colors')}>

      {/* Topbar */}
      <header className="sticky top-0 z-40 flex items-center gap-4 px-5 py-3 border-b border-lumos-border bg-lumos-surface/95 backdrop-blur">
        <span className="font-heading font-black text-lg tracking-tight">LUMOS<span className="text-lumos-yellow">.</span></span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold truncate">{data.project.name}</p>
          <p className="text-[10.5px] text-lumos-text-secondary truncate">
            {data.project.code ? `${data.project.code} · ` : ''}portal do projeto
          </p>
        </div>
        <button onClick={() => setPtheme(t => t === 'dark' ? 'light' : 'dark')}
          className="ml-auto p-2 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary" title="Alternar tema">
          {ptheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      <div className="flex max-w-6xl mx-auto">
        {/* Sidebar (desktop) */}
        <nav className="hidden lg:flex flex-col gap-1 w-48 flex-shrink-0 p-4 sticky top-16 self-start">
          {[
            { id: '', label: 'Visão geral', icon: LayoutDashboard },
            { id: 'sec-entregas', label: 'Entregas', icon: Clapperboard, badge: nVoce || undefined },
            { id: 'sec-etapas', label: 'Etapas', icon: ArrowRight },
            ...(data.arquivos.length ? [{ id: 'sec-arquivos', label: 'Arquivos', icon: FolderOpen }] : []),
            ...(data.financeiro ? [{ id: 'sec-fin', label: 'Financeiro', icon: DollarSign }] : []),
            ...(data.contato ? [{ id: 'sec-atend', label: 'Atendimento', icon: Headset }] : []),
          ].map((it: any) => (
            <button key={it.label}
              onClick={() => it.id ? document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth' }) : window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lumos text-[12px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 text-left">
              <it.icon className="w-3.5 h-3.5 flex-shrink-0" /> {it.label}
              {it.badge && <span className="ml-auto bg-lumos-yellow text-black text-[9.5px] font-black rounded-full px-1.5 py-0.5">{it.badge}</span>}
            </button>
          ))}
        </nav>

        <main className="flex-1 min-w-0 px-5 py-5 pb-20 space-y-4">

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card p-4">
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Progresso do projeto</p>
              <div className="flex items-center gap-3 mt-2">
                <div className="w-14 h-14 rounded-full grid place-items-center flex-shrink-0"
                  style={{ background: `conic-gradient(#EFC700 0 ${pct}%, ${ptheme === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)'} ${pct}% 100%)` }}>
                  <span className="w-10 h-10 rounded-full bg-lumos-surface grid place-items-center text-[12px] font-black font-heading tabular-nums">{pct}%</span>
                </div>
                <p className="text-[10.5px] text-lumos-text-secondary leading-snug">
                  {total > 0 ? <>{nOk} de {total} entregas aprovadas</> : 'as entregas vão aparecer aqui'}
                </p>
              </div>
            </div>

            <div className={clsx('card p-4', nVoce > 0 && 'border-lumos-yellow/50')}>
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Com você</p>
              <p className="text-2xl font-black font-heading mt-1 tabular-nums text-lumos-yellow">{nVoce}</p>
              <p className="text-[10.5px] text-lumos-text-secondary">{nVoce === 1 ? 'entrega aguardando sua revisão' : 'entregas aguardando sua revisão'}</p>
              {nVoce > 0 && (
                <button onClick={() => goEntregas('voce')}
                  className="mt-2 bg-lumos-yellow text-black text-[10.5px] font-black rounded px-3 py-1.5 w-fit flex items-center gap-1.5">
                  <Play className="w-3 h-3" fill="currentColor" /> Revisar agora
                </button>
              )}
            </div>

            <div className="card p-4">
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Aprovadas</p>
              <p className="text-2xl font-black font-heading mt-1 tabular-nums text-green-500">{nOk}</p>
              <p className="text-[10.5px] text-lumos-text-secondary truncate">
                {ultimaOk ? `a última: ${ultimaOk.file_name.replace(/\.[^.]+$/, '')}` : total > 0 ? `de ${total} entregas` : 'em breve'}
              </p>
            </div>

            <div className="card p-4">
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">{projDone ? 'Projeto' : 'Entrega final'}</p>
              <p className="text-2xl font-black font-heading mt-1 tabular-nums">
                {projDone ? '✓' : (fmtDay(data.project.data_fim) || '—')}
              </p>
              <p className="text-[10.5px] text-lumos-text-secondary">{projDone ? 'concluído' : data.project.data_fim ? 'data prevista' : 'data a combinar'}</p>
            </div>
          </div>

          {/* Barra por status */}
          {total > 0 && (
            <div className="card p-4">
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary mb-3 tabular-nums">{total} entregas por status</p>
              <div className="flex h-4 gap-[2px]">
                {nOk > 0 && <div className="rounded-l" style={{ width: `${(nOk / total) * 100}%`, background: seg.ok }} title={`Aprovadas: ${nOk}`}>
                  {nOk / total > 0.18 && <span className="w-full h-full grid place-items-center text-[9px] font-black text-white tabular-nums">{nOk}</span>}
                </div>}
                {naLumos > 0 && <div style={{ width: `${(naLumos / total) * 100}%`, background: seg.lumos }} title={`Na Lumos: ${naLumos}`} />}
                {nVoce > 0 && <div className="rounded-r" style={{ width: `${(nVoce / total) * 100}%`, background: seg.voce }} title={`Com você: ${nVoce}`} />}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold bg-lumos-text-secondary/10 border border-lumos-border rounded-full px-3 py-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: seg.ok }} /> Aprovadas · {nOk}
                </span>
                <span className="inline-flex items-center gap-2 text-[11px] font-bold bg-lumos-text-secondary/10 border border-lumos-border rounded-full px-3 py-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: seg.lumos }} /> Na Lumos · {naLumos}
                  {nAj > 0 && <span className="text-lumos-text-secondary font-semibold">({nProd} em produção, {nAj} em ajustes)</span>}
                </span>
                <span className="inline-flex items-center gap-2 text-[11px] font-bold bg-lumos-text-secondary/10 border border-lumos-border rounded-full px-3 py-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: seg.voce }} /> Com você · {nVoce}
                </span>
              </div>
            </div>
          )}

          {/* Etapas (marcos) */}
          <div className="card p-4" id="sec-etapas">
            <div className="flex items-center mb-4">
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Etapas do projeto</p>
              {data.project.data_fim && !projDone && (
                <p className="ml-auto text-[11px] text-lumos-text-secondary">entrega final <b className="text-lumos-text-primary">{fmtDay(data.project.data_fim)}</b></p>
              )}
            </div>
            <div className="flex">
              {[...MARCOS, { key: 'final', label: 'Entrega final', stages: [] }].map((m, i) => {
                const done = projDone || i < currentIdx;
                const now = !projDone && i === currentIdx;
                return (
                  <div key={m.key} className="flex-1 text-center relative">
                    {i > 0 && <span className={clsx('absolute top-[11px] right-1/2 w-full h-[3px]', done || now ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/15')} style={{ zIndex: 0 }} />}
                    <div className={clsx('w-[22px] h-[22px] rounded-full mx-auto mb-1.5 grid place-items-center text-[10px] font-black relative z-10 border-[3px]',
                      done ? 'bg-lumos-yellow border-lumos-yellow text-black'
                        : now ? 'bg-lumos-surface border-lumos-yellow text-lumos-yellow'
                        : 'bg-lumos-surface border-lumos-text-secondary/20 text-lumos-text-secondary')}>
                      {done ? <Check className="w-3 h-3" /> : i + 1}
                    </div>
                    <p className={clsx('text-[9px] font-black uppercase tracking-wide', done || now ? 'text-lumos-text-primary' : 'text-lumos-text-secondary')}>{m.label}</p>
                    <p className="text-[8.5px] text-lumos-text-secondary">
                      {done ? 'concluído' : now ? 'em andamento' : m.key === 'final' && data.project.data_fim ? `prevista ${fmtDay(data.project.data_fim)}` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_290px] gap-4 items-start">
            {/* Entregas */}
            <div className="card overflow-hidden" id="sec-entregas">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-lumos-border flex-wrap">
                <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Entregas</p>
                <span className="text-[11px] text-lumos-text-secondary tabular-nums">{total} itens</span>
                <div className="ml-auto flex gap-1.5">
                  {([['todas', `Todas`], ['voce', `Com você · ${nVoce}`], ['ok', `Aprovadas · ${nOk}`]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setFilter(k)}
                      className={clsx('text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full border',
                        filter === k ? 'bg-lumos-yellow border-lumos-yellow text-black' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {shown.length === 0 ? (
                <p className="text-center text-xs text-lumos-text-secondary italic py-10">
                  {total === 0 ? 'As entregas do projeto vão aparecer aqui.' : 'Nenhuma entrega nesse filtro.'}
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 p-3.5">
                  {shown.map(e => (
                    <div key={e.file_name + e.versao} className={clsx('rounded-lumos border overflow-hidden bg-lumos-bg/40',
                      e.cs === 'voce' ? 'border-lumos-yellow/50' : 'border-lumos-border')}>
                      <div className="relative aspect-video bg-black/40 grid place-items-center overflow-hidden">
                        {e.thumb_url
                          ? <img src={e.thumb_url} alt="" className="w-full h-full object-cover" />
                          : <Film className="w-6 h-6 text-lumos-text-secondary/30" />}
                        <span className="absolute top-1.5 left-1.5 text-[8px] font-black bg-black/60 text-white px-1.5 py-0.5 rounded-full">v{String(e.versao).padStart(2, '0')}</span>
                        <span className={clsx('absolute top-1.5 right-1.5 text-[8px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full', CS_UI[e.cs].chip)}>{CS_UI[e.cs].label}</span>
                      </div>
                      <div className="p-2.5">
                        <p className="text-[11px] font-bold truncate" title={e.file_name}>{e.file_name.replace(/\.[^.]+$/, '')}</p>
                        <p className="text-[9px] text-lumos-text-secondary truncate mt-0.5">
                          {e.cs === 'ok' && e.client_decided_by
                            ? `aprovado por ${e.client_decided_by} · ${fmtDay(e.client_decided_at)}`
                            : e.cs === 'ajustes' ? 'nova versão a caminho'
                            : e.entregue_em ? `entregue ${fmtDay(e.entregue_em)}` : ''}
                        </p>
                        {e.review_token && e.cs !== 'prod' && (
                          <a href={`/revisao/${e.review_token}`} target="_blank" rel="noopener noreferrer"
                            className={clsx('mt-2 h-7 rounded flex items-center justify-center gap-1.5 text-[10px] font-black',
                              e.cs === 'voce' ? 'bg-lumos-yellow text-black' : 'border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/50')}>
                            <Play className="w-3 h-3" fill={e.cs === 'voce' ? 'currentColor' : 'none'} />
                            {e.cs === 'voce' ? 'Revisar e aprovar' : 'Assistir'}
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Lateral */}
            <div className="space-y-4">
              {data.atividade.length > 0 && (
                <div className="card overflow-hidden">
                  <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary px-4 py-3 border-b border-lumos-border">Atividade</p>
                  <div className="py-1">
                    {data.atividade.map((a, i) => (
                      <div key={i} className="flex items-start gap-2.5 px-4 py-2 text-[11px]">
                        <span className="w-6 h-6 rounded-full bg-lumos-text-secondary/10 grid place-items-center flex-shrink-0 mt-px">
                          {a.tipo === 'decisao'
                            ? (a.decisao === 'aprovado' ? <CircleCheckBig className="w-3 h-3 text-green-500" /> : <RotateCcw className="w-3 h-3 text-red-400" />)
                            : <Clapperboard className="w-3 h-3 text-lumos-text-secondary" />}
                        </span>
                        <p className="text-lumos-text-secondary leading-snug min-w-0">
                          {a.tipo === 'decisao'
                            ? <><b className="text-lumos-text-primary">{a.quem || 'Cliente'}</b> {a.decisao === 'aprovado' ? 'aprovou' : 'pediu ajustes em'} <span className="truncate">{a.file_name.replace(/\.[^.]+$/, '')}</span></>
                            : <><b className="text-lumos-text-primary">Lumos</b> entregou {a.file_name.replace(/\.[^.]+$/, '')}{(a.versao || 1) > 1 ? ` (v${String(a.versao).padStart(2, '0')})` : ''}</>}
                        </p>
                        <span className="ml-auto text-[9px] text-lumos-text-secondary/70 flex-shrink-0 pt-0.5">{fmtDay(a.quando)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.financeiro && (
                <div className="card overflow-hidden" id="sec-fin">
                  <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary px-4 py-3 border-b border-lumos-border">Financeiro</p>
                  <div className={clsx('flex items-center gap-2.5 px-4 py-3.5 text-[12px] font-bold', data.financeiro.em_dia ? 'text-green-500' : 'text-amber-500')}>
                    <span className={clsx('w-6 h-6 rounded-full grid place-items-center flex-shrink-0', data.financeiro.em_dia ? 'bg-green-500/15' : 'bg-amber-500/15')}>
                      {data.financeiro.em_dia ? '✓' : '!'}
                    </span>
                    {data.financeiro.em_dia ? 'Pagamentos em dia' : 'Há pagamento pendente'}
                    {data.financeiro.proximo_vencimento && (
                      <span className="text-[10.5px] font-semibold text-lumos-text-secondary">· próximo vencimento {fmtDay(data.financeiro.proximo_vencimento)}</span>
                    )}
                  </div>
                </div>
              )}

              {data.arquivos.length > 0 && (
                <div className="card overflow-hidden" id="sec-arquivos">
                  <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary px-4 py-3 border-b border-lumos-border">Arquivos</p>
                  <div className="py-1">
                    {data.arquivos.map((f, i) => (
                      <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2.5 px-4 py-2 text-[12px] font-bold hover:text-lumos-yellow">
                        {f.kind === 'file' && /foto|imagem|photo/i.test(f.name) ? <Camera className="w-3.5 h-3.5 flex-shrink-0" /> : f.kind === 'link' ? <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" /> : <Image className="w-3.5 h-3.5 flex-shrink-0" />}
                        <span className="truncate">{f.name}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {data.contato && (
                <div className="card overflow-hidden" id="sec-atend">
                  <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary px-4 py-3 border-b border-lumos-border">Seu atendimento</p>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <span className="w-9 h-9 rounded-full bg-lumos-yellow/20 text-lumos-yellow grid place-items-center font-black text-[12px] flex-shrink-0">
                      {data.contato.nome.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-black truncate">{data.contato.nome}</p>
                      <p className="text-[10px] text-lumos-text-secondary truncate">atendimento Lumos</p>
                    </div>
                    <a href={`mailto:${data.contato.email}`} className="ml-auto text-[10px] font-black border border-lumos-border rounded px-2.5 py-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/50 flex-shrink-0">Falar ✉</a>
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-[10.5px] text-lumos-text-secondary pt-4 leading-relaxed">
            Esta página é exclusiva do seu projeto, não compartilhe o link.<br />
            <span className="font-heading font-black text-lumos-text-primary">LUMOS<span className="text-lumos-yellow">.</span></span>
          </p>
        </main>
      </div>
    </div>
  );
}
