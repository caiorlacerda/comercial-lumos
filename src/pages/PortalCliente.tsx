import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Film, Play, Check, LayoutDashboard, Clapperboard, Headset, Sun, Moon,
  CircleCheckBig, RotateCcw, FolderOpen, DownloadCloud, Mail, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';

const STREAM_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/review-stream`;

// ───────────────────────── Tipos (payload da RPC get_client_portal) ─────────
interface Entrega {
  file_name: string; versao: number; status: string;
  client_decision: string | null; client_decided_by: string | null; client_decided_at: string | null;
  thumb_url: string | null; entregue_em: string | null; review_token: string | null;
  allow_download: boolean;
}
interface Blocks {
  kpis: boolean; status_bar: boolean; etapas: boolean; atividade: boolean; arquivos: boolean;
}
interface PortalData {
  portal: { show_financeiro: boolean; blocks: Blocks };
  project: { name: string; code: string | null; status: string; data_fim: string | null };
  stages: Record<string, number>;
  entregas: Entrega[];
  arquivos: { name: string; url: string; kind: string }[];
  financeiro: { em_dia: boolean; proximo_vencimento: string | null } | null;
  contatos: { nome: string; email: string; cargo: string | null }[];
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

// Cores da barra de status, validadas pra daltonismo/contraste nos 2 temas.
const SEG = {
  dark: { ok: '#16a34a', lumos: '#0284c7', voce: '#a16207' },
  light: { ok: '#15803d', lumos: '#0369a1', voce: '#854d0e' },
};

const fmtDay = (s?: string | null) => s ? new Date(s.length <= 10 ? s + 'T12:00:00' : s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : null;
const semExt = (n: string) => n.replace(/\.[^.]+$/, '');

const MARCOS = [
  { key: 'roteiro', label: 'Roteiro', stages: ['roteiro'] },
  { key: 'captacao', label: 'Captação', stages: ['captacao'] },
  { key: 'edicao', label: 'Edição', stages: ['em_progresso'] },
  { key: 'revisao', label: 'Sua revisão', stages: ['revisao_interna', 'revisao_cliente', 'alteracoes'] },
];

type Aba = 'dashboard' | 'entregas' | 'atendimento';

export default function PortalCliente() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [aba, setAba] = useState<Aba>('dashboard');
  const [filter, setFilter] = useState<'todas' | 'voce' | 'ok'>('todas');
  const [baixando, setBaixando] = useState<{ feito: number; total: number } | null>(null);
  const [painelDl, setPainelDl] = useState(false);
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
  const blocks: Blocks = data?.portal.blocks || { kpis: true, status_bar: true, etapas: true, atividade: true, arquivos: true };

  const derived = useMemo(() => {
    if (!data) return null;
    const list = data.entregas.map(e => ({ ...e, cs: clientStatus(e.status) }));
    const nOk = list.filter(e => e.cs === 'ok').length;
    const nVoce = list.filter(e => e.cs === 'voce').length;
    const nProd = list.filter(e => e.cs === 'prod').length;
    const nAj = list.filter(e => e.cs === 'ajustes').length;
    const total = list.length;
    const stages = data.stages || {};
    const pct = total > 0 ? Math.round((nOk / total) * 100) : 0;
    const openIn = (keys: string[]) => keys.reduce((a, k) => a + (stages[k] || 0), 0);
    let currentIdx = MARCOS.findIndex(m => openIn(m.stages) > 0);
    const projDone = data.project.status === 'concluido';
    if (currentIdx === -1) currentIdx = projDone ? MARCOS.length + 1 : MARCOS.length;
    const ultimaOk = list.filter(e => e.cs === 'ok' && e.client_decided_at)
      .sort((a, b) => (b.client_decided_at || '').localeCompare(a.client_decided_at || ''))[0];
    const baixaveis = list.filter(e => e.allow_download && e.review_token);
    return { list, nOk, nVoce, nProd, nAj, total, pct, currentIdx, projDone, ultimaOk, baixaveis };
  }, [data]);

  const shown = useMemo(() => {
    if (!derived) return [];
    const order: Record<ClientStatus, number> = { voce: 0, ajustes: 1, prod: 2, ok: 3 };
    return derived.list
      .filter(e => filter === 'todas' ? true : e.cs === filter)
      .sort((a, b) => order[a.cs] - order[b.cs] || (b.entregue_em || '').localeCompare(a.entregue_em || ''));
  }, [derived, filter]);

  const dlUrl = (e: Entrega) => `${STREAM_BASE}?token=${encodeURIComponent(e.review_token!)}&download=1`;

  // "Baixar tudo": o navegador BLOQUEIA vários downloads automáticos (o
  // primeiro passa, o resto é barrado sem avisar). Então: disparamos em
  // sequência com folga e deixamos a lista aberta com um botão por arquivo —
  // clique do usuário nunca é bloqueado, então sempre há um caminho que funciona.
  const baixarTudo = async () => {
    if (!derived?.baixaveis.length || baixando) return;
    const lista = derived.baixaveis;
    setBaixando({ feito: 0, total: lista.length });
    for (let i = 0; i < lista.length; i++) {
      const a = document.createElement('a');
      a.href = dlUrl(lista[i]);
      a.download = lista[i].file_name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setBaixando({ feito: i + 1, total: lista.length });
      await new Promise(r => setTimeout(r, 1500));
    }
    setTimeout(() => setBaixando(null), 2000);
  };

  const irPara = (a: Aba, f?: 'todas' | 'voce') => {
    setAba(a);
    if (f) setFilter(f);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
          <img src="/logo/Logotipo-Branco-Alpha.svg" alt="Lumos" className="h-9 mx-auto" />
          <p className="mt-5 text-sm text-lumos-text-primary font-bold">Este link de portal é inválido ou foi desativado.</p>
          <p className="mt-1 text-xs text-lumos-text-secondary">Fale com seu contato na Lumos pra receber um link novo.</p>
        </div>
      </div>
    );
  }

  const { nOk, nVoce, nProd, nAj, total, pct, currentIdx, projDone, ultimaOk, baixaveis } = derived;
  const naLumos = nProd + nAj;

  const ABAS: { key: Aba; label: string; icon: any; badge?: number }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'entregas', label: 'Entregas', icon: Clapperboard, badge: nVoce || undefined },
    { key: 'atendimento', label: 'Atendimento', icon: Headset },
  ];

  return (
    <div className={clsx(themeClass, 'min-h-screen bg-lumos-bg text-lumos-text-primary font-work-sans transition-colors')}>

      {/* Topbar + abas */}
      <header className="sticky top-0 z-40 border-b border-lumos-border bg-lumos-surface/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5">
          <div className="flex items-center gap-4 py-3">
            <img
              src={ptheme === 'dark' ? '/logo/Logotipo-Branco-Alpha.svg' : '/logo/Logotipo-Preto-Alpha.svg'}
              alt="Lumos" className="h-7 flex-shrink-0"
            />
            <div className="min-w-0 border-l border-lumos-border pl-4">
              <p className="text-[13px] font-bold truncate">{data.project.name}</p>
              <p className="text-[10.5px] text-lumos-text-secondary truncate">
                {data.project.code ? `${data.project.code} · ` : ''}portal do projeto
              </p>
            </div>
            <button onClick={() => setPtheme(t => t === 'dark' ? 'light' : 'dark')}
              className="ml-auto p-2 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary flex-shrink-0" title="Alternar tema">
              {ptheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>

          <nav className="flex gap-1">
            {ABAS.map(t => (
              <button key={t.key} onClick={() => irPara(t.key)}
                className={clsx('px-4 py-2.5 text-[12px] font-black uppercase tracking-wider border-b-2 flex items-center gap-2 transition-colors whitespace-nowrap',
                  aba === t.key ? 'border-lumos-yellow text-lumos-yellow' : 'border-transparent text-lumos-text-secondary hover:text-lumos-text-primary')}>
                <t.icon className="w-3.5 h-3.5" /> {t.label}
                {t.badge ? <span className="bg-lumos-yellow text-black text-[9.5px] font-black rounded-full px-1.5 py-0.5">{t.badge}</span> : null}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-5 pb-20 space-y-4">

        {/* ══════════════ DASHBOARD ══════════════ */}
        {aba === 'dashboard' && (<>
          {blocks.kpis && (
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
                  <button onClick={() => irPara('entregas', 'voce')}
                    className="mt-2 bg-lumos-yellow text-black text-[10.5px] font-black rounded px-3 py-1.5 w-fit flex items-center gap-1.5">
                    <Play className="w-3 h-3" fill="currentColor" /> Revisar agora
                  </button>
                )}
              </div>

              <div className="card p-4">
                <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Aprovadas</p>
                <p className="text-2xl font-black font-heading mt-1 tabular-nums text-green-500">{nOk}</p>
                <p className="text-[10.5px] text-lumos-text-secondary truncate">
                  {ultimaOk ? `a última: ${semExt(ultimaOk.file_name)}` : total > 0 ? `de ${total} entregas` : 'em breve'}
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
          )}

          {blocks.status_bar && total > 0 && (
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
                  {nProd > 0 && nAj > 0 && <span className="text-lumos-text-secondary font-semibold">({nProd} em produção, {nAj} em ajustes)</span>}
                  {nProd === 0 && nAj > 0 && <span className="text-lumos-text-secondary font-semibold">(em ajustes)</span>}
                </span>
                <span className="inline-flex items-center gap-2 text-[11px] font-bold bg-lumos-text-secondary/10 border border-lumos-border rounded-full px-3 py-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: seg.voce }} /> Com você · {nVoce}
                </span>
              </div>
            </div>
          )}

          {blocks.etapas && (
            <div className="card p-4">
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
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            {blocks.atividade && data.atividade.length > 0 && (
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
                          ? <><b className="text-lumos-text-primary">{a.quem || 'Cliente'}</b> {a.decisao === 'aprovado' ? 'aprovou' : 'pediu ajustes em'} {semExt(a.file_name)}</>
                          : <><b className="text-lumos-text-primary">Lumos</b> entregou {semExt(a.file_name)}{(a.versao || 1) > 1 ? ` (v${String(a.versao).padStart(2, '0')})` : ''}</>}
                      </p>
                      <span className="ml-auto text-[9px] text-lumos-text-secondary/70 flex-shrink-0 pt-0.5">{fmtDay(a.quando)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {data.financeiro && (
                <div className="card overflow-hidden">
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

              {blocks.arquivos && data.arquivos.length > 0 && (
                <div className="card overflow-hidden">
                  <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary px-4 py-3 border-b border-lumos-border">Arquivos</p>
                  <div className="py-1">
                    {data.arquivos.map((f, i) => (
                      <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2.5 px-4 py-2 text-[12px] font-bold hover:text-lumos-yellow">
                        <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>)}

        {/* ══════════════ ENTREGAS ══════════════ */}
        {aba === 'entregas' && (
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-lumos-border flex-wrap">
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Entregas</p>
              <span className="text-[11px] text-lumos-text-secondary tabular-nums">{total} itens</span>
              <div className="ml-auto flex gap-1.5 flex-wrap items-center">
                {baixaveis.length > 0 && (
                  <button onClick={() => setPainelDl(v => !v)}
                    className={clsx('text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-full border flex items-center gap-1.5',
                      painelDl ? 'bg-lumos-yellow border-lumos-yellow text-black' : 'border-lumos-yellow/50 text-lumos-yellow hover:bg-lumos-yellow/10')}>
                    <DownloadCloud className="w-3 h-3" /> Baixar tudo · {baixaveis.length}
                  </button>
                )}
                {([['todas', 'Todas'], ['voce', `Com você · ${nVoce}`], ['ok', `Aprovadas · ${nOk}`]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setFilter(k)}
                    className={clsx('text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full border',
                      filter === k ? 'bg-lumos-yellow border-lumos-yellow text-black' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Painel de download em lote */}
            {painelDl && baixaveis.length > 0 && (
              <div className="border-b border-lumos-border bg-lumos-bg/40 p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-bold text-lumos-text-primary">
                      {baixaveis.length} arquivo{baixaveis.length > 1 ? 's' : ''} disponíve{baixaveis.length > 1 ? 'is' : 'l'} para download
                    </p>
                    <p className="text-[11px] text-lumos-text-secondary mt-0.5">
                      Ao baixar todos de uma vez, o navegador costuma pedir permissão para vários downloads, é só clicar em <b className="text-lumos-text-primary">Permitir</b>. Se preferir, baixe um por um na lista abaixo.
                    </p>
                  </div>
                  <button onClick={baixarTudo} disabled={!!baixando}
                    className="bg-lumos-yellow text-black text-[11px] font-black rounded-lumos px-4 h-9 flex items-center gap-2 disabled:opacity-60 flex-shrink-0">
                    {baixando
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> baixando {baixando.feito}/{baixando.total}</>
                      : <><DownloadCloud className="w-3.5 h-3.5" /> Baixar todos automaticamente</>}
                  </button>
                </div>

                <div className="mt-3 border border-lumos-border rounded-lumos divide-y divide-lumos-border/60 max-h-64 overflow-y-auto custom-scrollbar">
                  {baixaveis.map((e, i) => (
                    <div key={e.file_name + i} className="flex items-center gap-3 px-3 py-2">
                      <span className="text-[10px] font-black text-lumos-text-secondary w-6 tabular-nums flex-shrink-0">{i + 1}</span>
                      <span className="text-[11.5px] font-bold truncate flex-1" title={e.file_name}>{semExt(e.file_name)}</span>
                      <a href={dlUrl(e)} download={e.file_name}
                        className="text-[10px] font-black uppercase tracking-wide px-2.5 py-1.5 rounded border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow/50 flex items-center gap-1.5 flex-shrink-0">
                        <DownloadCloud className="w-3 h-3" /> Baixar
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {shown.length === 0 ? (
              <p className="text-center text-xs text-lumos-text-secondary italic py-10">
                {total === 0 ? 'As entregas do projeto vão aparecer aqui.' : 'Nenhuma entrega nesse filtro.'}
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5 p-3.5">
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
                      <p className="text-[11px] font-bold truncate" title={e.file_name}>{semExt(e.file_name)}</p>
                      <p className="text-[9px] text-lumos-text-secondary truncate mt-0.5">
                        {e.cs === 'ok' && e.client_decided_by
                          ? `aprovado por ${e.client_decided_by} · ${fmtDay(e.client_decided_at)}`
                          : e.cs === 'ajustes' ? 'nova versão a caminho'
                          : e.entregue_em ? `entregue ${fmtDay(e.entregue_em)}` : ''}
                      </p>
                      {e.review_token && e.cs !== 'prod' && (
                        <div className="flex gap-1.5 mt-2">
                          <a href={`/revisao/${e.review_token}`} target="_blank" rel="noopener noreferrer"
                            className={clsx('flex-1 h-7 rounded flex items-center justify-center gap-1.5 text-[10px] font-black',
                              e.cs === 'voce' ? 'bg-lumos-yellow text-black' : 'border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/50')}>
                            <Play className="w-3 h-3" fill={e.cs === 'voce' ? 'currentColor' : 'none'} />
                            {e.cs === 'voce' ? 'Revisar e aprovar' : 'Assistir'}
                          </a>
                          {e.allow_download && (
                            <a href={`${STREAM_BASE}?token=${encodeURIComponent(e.review_token)}&download=1`} download={e.file_name}
                              title="Baixar" className="w-7 h-7 rounded border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow/50 grid place-items-center flex-shrink-0">
                              <DownloadCloud className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ ATENDIMENTO ══════════════ */}
        {aba === 'atendimento' && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-lumos-border">
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Fale com a gente</p>
              <p className="text-[11px] text-lumos-text-secondary mt-0.5">Qualquer dúvida sobre o projeto, é só chamar.</p>
            </div>
            {data.contatos.length === 0 ? (
              <p className="text-center text-xs text-lumos-text-secondary italic py-10">Nenhum contato cadastrado neste portal.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
                {data.contatos.map((c, i) => (
                  <div key={i} className="border border-lumos-border rounded-lumos p-4 flex items-center gap-3 bg-lumos-bg/30">
                    <span className="w-11 h-11 rounded-full bg-lumos-yellow/15 text-lumos-yellow grid place-items-center font-black text-[13px] flex-shrink-0">
                      {c.nome.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-black truncate">{c.nome}</p>
                      <p className="text-[10.5px] text-lumos-text-secondary truncate">{c.cargo || 'Produtora Lumos'}</p>
                      <a href={`mailto:${c.email}`} className="text-[10.5px] text-lumos-yellow font-bold truncate hover:underline">{c.email}</a>
                    </div>
                    <a href={`mailto:${c.email}`}
                      className="w-9 h-9 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow/50 grid place-items-center flex-shrink-0" title={`Escrever para ${c.nome}`}>
                      <Mail className="w-4 h-4" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-center text-[10.5px] text-lumos-text-secondary pt-4 leading-relaxed">
          Esta página é exclusiva do seu projeto, não compartilhe o link.<br />
          <img src={ptheme === 'dark' ? '/logo/Logotipo-Branco-Alpha.svg' : '/logo/Logotipo-Preto-Alpha.svg'} alt="Lumos" className="h-4 inline-block mt-2 opacity-60" />
        </p>
      </main>
    </div>
  );
}
