import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, Check, Clock, CloudRain, Copy, ExternalLink,
  Loader2, MapPin, Pencil, Plus, Shirt, Sun, Trash2, Users2, Video, Package, Camera,
  FileText, ArrowUp, ArrowDown, AlertTriangle, Megaphone, ScrollText, Wrench,
  Utensils, Coffee, Truck, SlidersHorizontal, FileDown, Eye, Search, UserPlus,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import QuickForm, { type QFField } from '@/components/common/QuickForm';
import Select from '@/components/ui/Select';
import { useConfirm } from '@/components/ui/useConfirm';
import { geocode, previsaoParaDiaria, type PrevisaoDia } from '@/lib/weather';
import { notify, getUserIdsWithPermission } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';
import type { AtividadePlano, MembroEquipe, Talento } from '@/types/ordemDoDia';

/**
 * ORDEM DO DIA 2.0 — a call sheet completa, no formato do benchmark:
 * 9 abas (Cronograma · Locações · Roteiros · Equipe · Elenco · Objetos ·
 * Figurino · Equipamentos · Outras Observações), com previsão do tempo
 * automática, call time por grupo, relógio de atraso ao vivo e cronograma
 * minuto a minuto. Os campos antigos continuam sendo a fonte (plano_acao =
 * cronograma, talentos = elenco, equipe = ficha técnica); os novos moram nas
 * colunas da migration 2026093000. Edição inline, salvando campo a campo.
 */

interface Loc { nome: string; endereco: string; obs?: string; incluida: boolean }
interface CallTime { grupo: string; hora: string }
interface Regras { vestimenta?: string; redes?: string; setup_camera?: string; outras?: string }
interface ItemSimples { nome: string; desc?: string; personagem?: string }

interface OD {
  id: string; codigo: string; titulo: string; data_producao: string | null;
  hora_inicio: string | null; hora_fim: string | null; aprovacao: string;
  clima: string | null;
  ponto_encontro: { nome: string; endereco: string } | null;
  locacao: { nome: string; endereco: string; observacoes: string } | null;
  locacoes: Loc[];
  call_times: CallTime[];
  regras: Regras;
  equipe: MembroEquipe[];
  plano_acao: AtividadePlano[];
  talentos: Talento[];
  objetos: ItemSimples[];
  figurino: ItemSimples[];
  equipamentos: ItemSimples[];
  roteiros: { id: string; name: string; url: string }[];
  contatos: { funcao: string; nome: string; telefone: string }[];
  /** O único campo desta página que o CLIENTE lê. Sai no portal dele, dentro
   *  da gravação marcada, quando a ordem está aprovada. Os outros campos de
   *  texto livre (regras, objetos, figurino) são internos e ficam aqui. */
  nota_cliente: string;
  project_id: string | null;
}

type Aba = 'cronograma' | 'locacoes' | 'roteiros' | 'equipe' | 'elenco' | 'objetos' | 'figurino' | 'equipamentos' | 'obs';

const ABAS: { key: Aba; label: string; icon: any }[] = [
  { key: 'cronograma', label: 'Cronograma', icon: Clock },
  { key: 'locacoes', label: 'Locações', icon: MapPin },
  { key: 'roteiros', label: 'Roteiros', icon: ScrollText },
  { key: 'equipe', label: 'Equipe', icon: Users2 },
  { key: 'elenco', label: 'Elenco', icon: Users2 },
  { key: 'objetos', label: 'Objetos', icon: Package },
  { key: 'figurino', label: 'Figurino', icon: Shirt },
  { key: 'equipamentos', label: 'Equipamentos', icon: Wrench },
  { key: 'obs', label: 'Outras Observações', icon: FileText },
];

const fmtDataLonga = (d?: string | null) => {
  if (!d) return 'Data a definir';
  const s = new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const minutos = (h?: string | null) => { if (!h) return null; const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0); };
// Data local (não UTC): depois das 21h de Brasília o toISOString já virou o
// dia seguinte e o relógio ao vivo não ligava no próprio dia da produção.
const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;



// ─────────────────────────────────────────────────────────────────────────────
// CRONOGRAMA PRINCIPAL 2.0 — momentos tipados, altura relativa ao tempo e a
// agulha do horário atual. Vive fora da página pelo mesmo motivo do CardRegra:
// o tick de 1s não pode remontar os inputs.
// ─────────────────────────────────────────────────────────────────────────────
type TipoMomento = 'gravacao' | 'producao' | 'desproducao' | 'almoco' | 'jantar' | 'lanche' | 'deslocamento' | 'intervalo' | 'personalizado';
interface Momento extends AtividadePlano { tipo?: TipoMomento; locacao?: string; chegada?: string; paralelo?: boolean }

const TIPOS: Record<TipoMomento, { label: string; Icon: any; cor: string; defMin: number }> = {
  gravacao:      { label: 'Gravação',      Icon: Video,     cor: '#ef4444', defMin: 60 },
  producao:      { label: 'Produção',      Icon: Wrench,    cor: '#3b82f6', defMin: 60 },
  desproducao:   { label: 'Desprodução',   Icon: Package,   cor: '#64748b', defMin: 45 },
  almoco:        { label: 'Almoço',        Icon: Utensils,  cor: '#22c55e', defMin: 60 },
  jantar:        { label: 'Jantar',        Icon: Utensils,  cor: '#16a34a', defMin: 60 },
  lanche:        { label: 'Lanche',        Icon: Coffee,    cor: '#84cc16', defMin: 15 },
  deslocamento:  { label: 'Deslocamento',  Icon: Truck,     cor: '#a855f7', defMin: 30 },
  intervalo:     { label: 'Intervalo',     Icon: Clock,     cor: '#14b8a6', defMin: 5 },
  personalizado: { label: 'Personalizado', Icon: Pencil,    cor: '#EFC700', defMin: 30 },
};

function CronogramaPrincipal({ od, canManage, agora, hoje, locsAtivas, onChange, confirm }: {
  od: { plano_acao: Momento[]; hora_inicio: string | null };
  canManage: boolean; agora: Date; hoje: boolean;
  locsAtivas: { nome: string }[];
  onChange: (lista: Momento[]) => void;
  confirm: (opts: { title?: string; message: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}) {
  const rows = od.plano_acao as Momento[];
  const [pickerAberto, setPickerAberto] = useState(false);
  const [cfg, setCfg] = useState<null | { tipo: TipoMomento; locacao: string; chegada: string; duracao: number; paralelo: boolean; descricao: string; manual: boolean; calculando: boolean }>(null);
  const [alturaRel, setAlturaRel] = useState(() => { try { return localStorage.getItem('lumos_od_altura') === '1'; } catch { return false; } });
  const [cfgAberto, setCfgAberto] = useState(false);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [agulhaTop, setAgulhaTop] = useState<number | null>(null);

  const toggleAltura = () => setAlturaRel(v => { try { localStorage.setItem('lumos_od_altura', v ? '0' : '1'); } catch { /* ignora */ } return !v; });

  // A agulha do agora: acha em qual linha (ou fronteira) o horário atual cai e
  // mede a posição real no DOM — funciona com e sem altura relativa.
  useEffect(() => {
    if (!hoje || !rows.length || !wrapRef.current) { setAgulhaTop(null); return; }
    const nowMin = agora.getHours() * 60 + agora.getMinutes() + agora.getSeconds() / 60;
    const wrapTop = wrapRef.current.getBoundingClientRect().top;
    let top: number | null = null;
    for (let i = 0; i < rows.length; i++) {
      const el = rowRefs.current[i]; if (!el) continue;
      const ri = minutos(rows[i].inicio); const rf = minutos(rows[i].fim);
      const r = el.getBoundingClientRect();
      if (ri != null && rf != null && rf > ri && nowMin >= ri && nowMin <= rf) {
        top = r.top - wrapTop + ((nowMin - ri) / (rf - ri)) * r.height; break;
      }
      if (ri != null && nowMin < ri) { top = r.top - wrapTop; break; }
      if (rf != null && nowMin > rf) top = r.bottom - wrapTop;
    }
    setAgulhaTop(top);
  }, [agora, rows, hoje, alturaRel]);

  const statusDe = (r: Momento): 'atrasado' | 'agora' | 'pendente' => {
    if (!hoje) return 'pendente';
    const nowMin = agora.getHours() * 60 + agora.getMinutes();
    const ri = minutos(r.inicio); const rf = minutos(r.fim);
    if (rf != null && nowMin > rf) return 'atrasado';
    if (ri != null && nowMin >= ri) return 'agora';
    return 'pendente';
  };

  const abrirCfg = (tipo: TipoMomento) => {
    setPickerAberto(false);
    setCfg({ tipo, locacao: locsAtivas[0]?.nome || '', chegada: locsAtivas[1]?.nome || locsAtivas[0]?.nome || '', duracao: TIPOS[tipo].defMin, paralelo: false, descricao: '', manual: false, calculando: false });
  };

  // Deslocamento: tenta calcular o trajeto de carro (geocode + OSRM, sem chave).
  const calcularTrajeto = async () => {
    if (!cfg) return;
    setCfg(c => c ? { ...c, calculando: true } : c);
    try {
      const [a, b] = await Promise.all([geocode(cfg.locacao), geocode(cfg.chegada)]);
      if (!a || !b) throw new Error('sem geo');
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
      const j = await r.json();
      const seg = j?.routes?.[0]?.duration;
      if (!seg) throw new Error('sem rota');
      setCfg(c => c ? { ...c, duracao: Math.max(5, Math.round(seg / 60 / 5) * 5), calculando: false } : c);
    } catch {
      setCfg(c => c ? { ...c, calculando: false, manual: true } : c);
    }
  };

  const criar = () => {
    if (!cfg) return;
    const ultimo = rows[rows.length - 1];
    const base = cfg.paralelo ? (ultimo?.inicio || od.hora_inicio || '08:00') : (ultimo?.fim || od.hora_inicio || '08:00');
    const ini = minutos(base) ?? 480;
    const t = TIPOS[cfg.tipo];
    const desc = cfg.descricao.trim()
      || (cfg.tipo === 'deslocamento' ? `Deslocamento: ${cfg.locacao || '?'} → ${cfg.chegada || '?'}` : t.label + (cfg.locacao ? `, ${cfg.locacao}` : ''));
    const novo: Momento = {
      inicio: fmtMin(ini), fim: fmtMin(Math.min(ini + Math.max(5, cfg.duracao), 1439)),
      descricao: desc, responsavel: '', destaque: cfg.tipo === 'gravacao',
      tipo: cfg.tipo, locacao: cfg.tipo === 'deslocamento' ? undefined : (cfg.locacao || undefined),
      chegada: cfg.tipo === 'deslocamento' ? cfg.chegada : undefined,
      paralelo: cfg.paralelo || undefined,
    };
    setCfg(null);
    onChange([...rows, novo]);
  };

  const editar = (i: number, campo: keyof Momento, valor: unknown) =>
    onChange(rows.map((x, j) => j === i ? { ...x, [campo]: valor } : x));

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-lumos-border flex items-center gap-2 flex-wrap">
        <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-primary">Cronograma principal</p>
        <div className="ml-auto flex items-center gap-2 relative">
          <button type="button" onClick={() => setCfgAberto(o => !o)} title="Exibição"
            className={clsx('p-2 rounded-lumos border', cfgAberto ? 'border-lumos-yellow text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}>
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
          {cfgAberto && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setCfgAberto(false)} />
              <div className="absolute right-0 top-10 w-72 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-40 p-3.5">
                <div className="flex items-start gap-3">
                  <button type="button" onClick={toggleAltura}
                    className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0 mt-0.5', alturaRel ? 'bg-lumos-yellow' : 'bg-lumos-text-secondary/30')}>
                    <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', alturaRel ? 'left-5' : 'left-0.5')} />
                  </button>
                  <span>
                    <span className="block text-xs font-bold text-lumos-text-primary">Altura relativa ao tempo</span>
                    <span className="block text-[10.5px] text-lumos-text-secondary leading-snug mt-0.5">A altura de cada linha fica proporcional à duração do momento. Desligado, todas as linhas têm a mesma altura.</span>
                  </span>
                </div>
              </div>
            </>
          )}
          {canManage && (
            <button type="button" onClick={() => setPickerAberto(true)}
              className="btn-primary h-8 px-3.5 text-[11px] font-black flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Novo momento</button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-xs text-lumos-text-secondary italic py-8">
          {canManage ? 'Nenhum momento no cronograma ainda. Toque em "Novo momento", ali em cima, pra criar o primeiro.' : 'Nenhum momento no cronograma ainda.'}
        </p>
      ) : (
        <div ref={wrapRef} className="relative">
          {/* cabeçalho */}
          <div className="grid grid-cols-[192px_76px_1fr_96px_92px] gap-2 px-4 py-2 border-b border-lumos-border text-[9px] font-black uppercase tracking-wider text-lumos-text-secondary max-lg:hidden">
            <span>Hora</span><span>Duração</span><span>Descrição</span><span>Ações</span><span>Status</span>
          </div>

          {rows.map((r, i) => {
            const t = TIPOS[(r.tipo as TipoMomento) || 'personalizado'] || TIPOS.personalizado;
            const st = statusDe(r);
            const dur = minutos(r.fim) != null && minutos(r.inicio) != null ? Math.max(0, minutos(r.fim)! - minutos(r.inicio)!) : null;
            const alturaMin = alturaRel && dur ? Math.min(Math.max(dur * 1.8, 44), 520) : undefined;
            return (
              <div key={i} ref={el => { rowRefs.current[i] = el; }}
                style={{ minHeight: alturaMin, borderLeft: `3px solid ${t.cor}` }}
                className={clsx('grid grid-cols-[192px_76px_1fr_96px_92px] max-lg:grid-cols-[96px_1fr_76px] gap-2 px-4 py-2 border-b border-lumos-border/60 items-start group',
                  r.destaque && 'bg-lumos-yellow/[0.04]')}>
                {/* hora: no celular os dois campos empilham, pra caber na coluna estreita */}
                <span className="flex items-center gap-1 min-h-8 max-lg:flex-col max-lg:items-stretch tabular-nums text-[11.5px] font-black text-lumos-text-primary">
                  {canManage ? (
                    <>
                      <input type="time" aria-label="Hora de início" defaultValue={r.inicio || ''} onBlur={e => e.target.value !== r.inicio && editar(i, 'inicio', e.target.value)} className="input-lumos h-8 text-[11px] w-[84px] max-lg:w-full px-1.5" />
                      <span className="text-lumos-text-secondary max-lg:hidden">–</span>
                      <input type="time" aria-label="Hora de término" defaultValue={r.fim || ''} onBlur={e => e.target.value !== r.fim && editar(i, 'fim', e.target.value)} className="input-lumos h-8 text-[11px] w-[84px] max-lg:w-full px-1.5" />
                    </>
                  ) : <>{r.inicio} – {r.fim}</>}
                </span>
                {/* duração */}
                <span className="text-[10.5px] text-lumos-text-secondary tabular-nums min-h-8 flex items-center max-lg:hidden">
                  {dur != null && dur > 0 ? (dur >= 60 ? `${Math.floor(dur / 60)}h${dur % 60 ? ` ${dur % 60}m` : ''}` : `${dur}min`) : 'Sem duração'}
                </span>
                {/* descrição + chips (o tipo virou chip com nome, o ícone sozinho não dizia nada) */}
                <span className="min-w-0">
                  {canManage ? (
                    <input defaultValue={r.descricao} onBlur={e => e.target.value !== r.descricao && editar(i, 'descricao', e.target.value)}
                      placeholder="O que acontece nesse bloco" className="input-lumos h-8 text-[12px] w-full" />
                  ) : <span className="text-[12.5px] font-bold text-lumos-text-primary min-h-8 flex items-center">{r.descricao}</span>}
                  <span className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span className="text-[9px] font-black uppercase tracking-wide rounded-full px-2 py-0.5 flex items-center gap-1"
                      style={{ color: t.cor, backgroundColor: `${t.cor}1f` }}>
                      <t.Icon className="w-2.5 h-2.5" /> {t.label}
                    </span>
                    {r.locacao && <span className="text-[9px] font-bold text-lumos-text-secondary bg-lumos-text-secondary/10 rounded-full px-2 py-0.5 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{r.locacao}</span>}
                    {r.tipo === 'deslocamento' && r.chegada && <span className="text-[9px] font-bold text-lumos-text-secondary bg-lumos-text-secondary/10 rounded-full px-2 py-0.5">→ {r.chegada}</span>}
                    {r.paralelo && <span className="text-[9px] font-black uppercase text-purple-400 bg-purple-500/10 rounded-full px-2 py-0.5">paralelo</span>}
                    {r.responsavel && <span className="text-[9px] font-bold text-lumos-text-secondary">resp.: {r.responsavel}</span>}
                  </span>
                </span>
                {/* ações */}
                <span className="min-h-8 flex items-center max-lg:hidden">
                  {canManage && (
                    <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" disabled={i === 0} onClick={() => { const l = [...rows]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; onChange(l); }}
                        className="p-1 text-lumos-text-secondary hover:text-lumos-text-primary disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button type="button" disabled={i === rows.length - 1} onClick={() => { const l = [...rows]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; onChange(l); }}
                        className="p-1 text-lumos-text-secondary hover:text-lumos-text-primary disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => editar(i, 'destaque', !r.destaque)} title="Destacar"
                        className={clsx('p-1', r.destaque ? 'text-lumos-yellow' : 'text-lumos-text-secondary hover:text-lumos-yellow')}>★</button>
                      <button type="button" onClick={async () => {
                        if (!await confirm({ title: `Apagar "${r.descricao || t.label}"`, message: 'O momento some do cronograma, sem desfazer.', confirmLabel: 'Apagar', danger: true })) return;
                        onChange(rows.filter((_, j) => j !== i));
                      }}
                        className="p-1 text-lumos-text-secondary hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </span>
                  )}
                </span>
                {/* status */}
                <span className={clsx('min-h-8 inline-flex items-center gap-1.5 text-[9.5px] font-black uppercase',
                  st === 'atrasado' ? 'text-red-500' : st === 'agora' ? 'text-lumos-yellow' : 'text-lumos-text-secondary')}>
                  <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', st === 'atrasado' ? 'bg-red-500' : st === 'agora' ? 'bg-lumos-yellow animate-pulse' : 'bg-lumos-text-secondary/40')} />
                  {st === 'atrasado' ? 'Atrasado' : st === 'agora' ? 'Agora' : 'Pendente'}
                </span>
              </div>
            );
          })}

          {/* A agulha do horário atual */}
          {agulhaTop != null && (
            <div className="absolute left-0 right-0 pointer-events-none z-10" style={{ top: agulhaTop }}>
              <div className="relative h-0">
                <div className="absolute left-0 right-0 h-[2px] bg-red-500/80" />
                <span className="absolute -left-0 -top-2.5 flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 ml-1" />
                  <span className="text-[9px] font-black text-white bg-red-500 rounded px-1.5 py-0.5 tabular-nums">
                    {String(agora.getHours()).padStart(2, '0')}:{String(agora.getMinutes()).padStart(2, '0')}
                  </span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Picker de tipo de momento */}
      {pickerAberto && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => setPickerAberto(false)}>
          <div className="bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-black text-lumos-text-primary mb-3">Novo momento</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TIPOS) as TipoMomento[]).map(k => (
                <button key={k} type="button" onClick={() => abrirCfg(k)}
                  className="border border-lumos-border rounded-lumos p-3 flex flex-col items-center gap-1.5 hover:border-lumos-yellow/60 hover:bg-lumos-yellow/[0.05] transition-colors">
                  {(() => { const I = TIPOS[k].Icon; return <I className="w-4 h-4" style={{ color: TIPOS[k].cor }} />; })()}
                  <span className="text-[10px] font-black text-lumos-text-primary">{TIPOS[k].label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Config do momento escolhido */}
      {cfg && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => setCfg(null)}>
          <div className="bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-black text-lumos-text-primary">Configurar {TIPOS[cfg.tipo].label}</p>

            {cfg.tipo === 'deslocamento' ? (
              <>
                <div>
                  <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Partida</label>
                  <Select value={cfg.locacao} onChange={v => setCfg({ ...cfg, locacao: v })} className="input-lumos w-full h-10 mt-1 text-sm"
                    options={[...locsAtivas.map(l => ({ value: l.nome, label: l.nome })), { value: '', label: 'Outro lugar' }]} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Chegada</label>
                  <Select value={cfg.chegada} onChange={v => setCfg({ ...cfg, chegada: v })} className="input-lumos w-full h-10 mt-1 text-sm"
                    options={[...locsAtivas.map(l => ({ value: l.nome, label: l.nome })), { value: '', label: 'Outro lugar' }]} />
                </div>
                <label className="flex items-center gap-2 text-[11.5px] font-bold text-lumos-text-primary">
                  <input type="checkbox" checked={cfg.manual} onChange={e => setCfg({ ...cfg, manual: e.target.checked })} className="accent-lumos-yellow" />
                  Inserir tempo manualmente
                </label>
                {!cfg.manual && (
                  <button type="button" onClick={calcularTrajeto} disabled={cfg.calculando}
                    className="w-full h-9 rounded-lumos border border-lumos-border text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary flex items-center justify-center gap-2 disabled:opacity-60">
                    {cfg.calculando ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculando trajeto…</> : <>Calcular trajeto de carro ({cfg.duracao} min)</>}
                  </button>
                )}
              </>
            ) : (
              <div>
                <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Locação</label>
                <Select value={cfg.locacao} onChange={v => setCfg({ ...cfg, locacao: v })} className="input-lumos w-full h-10 mt-1 text-sm"
                  options={[...locsAtivas.map(l => ({ value: l.nome, label: l.nome })), { value: '', label: 'Sem locação' }]} />
              </div>
            )}

            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Duração (minutos)</label>
              <div className="flex items-center gap-2 mt-1">
                <button type="button" onClick={() => setCfg({ ...cfg, duracao: Math.max(5, cfg.duracao - 5) })} className="w-9 h-9 rounded-lumos border border-lumos-border text-lumos-text-primary font-black">−</button>
                <input type="number" min={5} step={5} value={cfg.duracao} onChange={e => setCfg({ ...cfg, duracao: Number(e.target.value) || 5 })}
                  className="input-lumos h-9 flex-1 text-center text-sm font-bold" />
                <button type="button" onClick={() => setCfg({ ...cfg, duracao: cfg.duracao + 5 })} className="w-9 h-9 rounded-lumos border border-lumos-border text-lumos-text-primary font-black">+</button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-[11.5px] font-bold text-lumos-text-primary">
              <input type="checkbox" checked={cfg.paralelo} onChange={e => setCfg({ ...cfg, paralelo: e.target.checked })} className="accent-lumos-yellow" />
              Acontece em paralelo a outro momento
            </label>

            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Descrição (opcional)</label>
              <textarea rows={2} value={cfg.descricao} onChange={e => setCfg({ ...cfg, descricao: e.target.value })}
                placeholder="Adicione uma descrição…" className="input-lumos w-full mt-1 text-sm resize-y" />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={() => { setCfg(null); setPickerAberto(true); }} className="text-[11px] font-bold text-lumos-text-secondary px-2">← Voltar</button>
              <button type="button" onClick={criar} className="ml-auto btn-primary h-9 px-5 text-xs font-black flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Criar momento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Cartão de regra do set. Vive FORA do componente da página de propósito: a
// página re-renderiza a cada segundo (relógio AGORA) e um componente definido
// inline seria remontado a cada tick — o lápis fechava sozinho e o texto saía
// invertido (cursor voltava pro início). Aqui o estado local sobrevive.
function CardRegra({ valor, titulo, Icon, destaque, canManage, ajuda, vazio, onSave }: {
  valor: string; titulo: string; Icon: any; destaque?: boolean; canManage: boolean;
  /** Linha de ajuda embaixo do título, pra dizer quem lê aquele texto. */
  ajuda?: string;
  /** O que aparece quando o campo está vazio, no lugar do texto padrão. */
  vazio?: string;
  onSave: (v: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [draft, setDraft] = useState('');
  const tem = !!valor.trim();
  return (
    <div className={clsx('card p-4', destaque && tem && 'border-amber-500/50')}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={clsx('w-3.5 h-3.5', destaque && tem ? 'text-amber-500' : 'text-lumos-yellow')} />
        <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">{titulo}</p>
        {destaque && tem && <AlertTriangle className="w-3 h-3 text-amber-500 ml-auto" />}
        {canManage && !editando && (
          <button type="button" onClick={() => { setDraft(valor); setEditando(true); }}
            className={clsx('p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow', !(destaque && tem) && 'ml-auto')} title="Editar">
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
      {ajuda && <p className="text-[10.5px] leading-snug text-lumos-text-secondary mb-2">{ajuda}</p>}
      {editando ? (
        <div>
          <textarea autoFocus rows={2} value={draft} onChange={e => setDraft(e.target.value)}
            className="input-lumos w-full text-[12.5px] resize-y" />
          <div className="flex gap-2 mt-1.5">
            <button type="button" onClick={() => { setEditando(false); onSave(draft.trim()); }}
              className="bg-lumos-yellow text-black text-[10px] font-black rounded px-2.5 py-1">Salvar</button>
            <button type="button" onClick={() => setEditando(false)} className="text-[10px] font-bold text-lumos-text-secondary">Cancelar</button>
          </div>
        </div>
      ) : (
        <p className={clsx('text-[12.5px] leading-snug', tem ? 'text-lumos-text-primary' : 'text-lumos-text-secondary italic')}>
          {valor || vazio || 'Clique no lápis pra preencher.'}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FICHA TÉCNICA: escolher gente do cadastro GERAL da plataforma, não só de quem
// está no projeto. Mesmo desenho do modal de escalar das Diárias
// (ProjectDiarias): uma busca só, equipe do projeto em destaque, depois
// fornecedores e o time Lumos. Vive fora da página pelo mesmo motivo do
// CardRegra: o tick de 1s remontaria um componente declarado inline.
// ─────────────────────────────────────────────────────────────────────────────
interface PessoaCatalogo { tipo: 'user' | 'freela'; id: string; nome: string; funcao?: string | null; doProjeto?: boolean }

function EscolherDoCadastro({ projectId, jaNaFicha, onEscolher, onClose }: {
  projectId: string | null;
  /** Nomes já na ficha, em minúsculas, pra não oferecer quem já entrou. */
  jaNaFicha: Set<string>;
  onEscolher: (p: PessoaCatalogo) => void;
  onClose: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [catalogo, setCatalogo] = useState<PessoaCatalogo[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [pm, forn, users] = await Promise.all([
        projectId
          ? supabase.from('project_members').select('user_id, freela_id, funcao').eq('project_id', projectId)
          : Promise.resolve({ data: [] as any[], error: null }),
        supabase.from('fornecedores').select('id, nome').order('nome'),
        supabase.from('app_users').select('id, full_name, job_title').eq('status', 'ativo').order('full_name'),
      ]);
      if (!vivo) return;
      if (forn.error || users.error) {
        setErro('Não foi possível carregar o cadastro. Feche e tente de novo.');
        setCatalogo([]);
        return;
      }
      // A equipe do projeto só decide o destaque e a função sugerida: se ela
      // falhar, a lista completa continua servindo.
      const funcaoDe = new Map<string, string | null>();
      const doProjeto = new Set<string>();
      for (const m of ((pm.data as any[]) || [])) {
        const k = m.user_id ? `user:${m.user_id}` : `freela:${m.freela_id}`;
        doProjeto.add(k);
        funcaoDe.set(k, m.funcao || null);
      }
      setCatalogo([
        ...((forn.data as any[]) || []).map(f => ({
          tipo: 'freela' as const, id: f.id, nome: f.nome,
          funcao: funcaoDe.get(`freela:${f.id}`) || null, doProjeto: doProjeto.has(`freela:${f.id}`),
        })),
        ...((users.data as any[]) || []).map(u => ({
          tipo: 'user' as const, id: u.id, nome: u.full_name,
          funcao: funcaoDe.get(`user:${u.id}`) || u.job_title || null, doProjeto: doProjeto.has(`user:${u.id}`),
        })),
      ]);
    })();
    return () => { vivo = false; };
  }, [projectId]);

  const q = busca.trim().toLowerCase();
  const disponiveis = (catalogo || []).filter(p =>
    !jaNaFicha.has(p.nome.trim().toLowerCase()) && (!q || p.nome.toLowerCase().includes(q)));
  const grupos = [
    { titulo: 'Equipe do projeto', itens: disponiveis.filter(p => p.doProjeto) },
    { titulo: 'Fornecedores', itens: disponiveis.filter(p => !p.doProjeto && p.tipo === 'freela') },
    { titulo: 'Time Lumos', itens: disponiveis.filter(p => !p.doProjeto && p.tipo === 'user') },
  ].filter(g => g.itens.length > 0);

  return (
    <Modal isOpen onClose={onClose} title="Buscar no cadastro" maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary pointer-events-none" />
          <input autoFocus value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar pessoa ou fornecedor…" className="input-lumos pl-9 w-full h-10 text-sm" />
        </div>
        <p className="text-[10.5px] text-lumos-text-secondary">
          Todo o cadastro da plataforma, não só quem está neste projeto. Dá pra ajustar a função depois, no cartão da pessoa.
        </p>
        <div className="border border-lumos-border rounded-lumos max-h-72 overflow-y-auto custom-scrollbar divide-y divide-lumos-border/40">
          {catalogo === null ? (
            <p className="text-xs text-lumos-text-secondary italic p-4 flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando o cadastro…
            </p>
          ) : erro ? (
            <p className="text-xs text-red-400 p-4 text-center">{erro}</p>
          ) : grupos.length === 0 ? (
            <p className="text-xs text-lumos-text-secondary italic p-4 text-center">
              {q ? 'Ninguém encontrado com esse nome.' : 'Todo mundo do cadastro já está na ficha.'}
            </p>
          ) : grupos.map(g => (
            <div key={g.titulo}>
              <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary bg-lumos-bg/60 px-3 py-1.5 sticky top-0">{g.titulo}</p>
              {g.itens.map(pessoa => (
                <button key={`${pessoa.tipo}:${pessoa.id}`} type="button"
                  onClick={() => { onEscolher(pessoa); onClose(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-lumos-text-primary/5 transition-colors">
                  <span className={clsx('w-7 h-7 rounded-full text-[10px] font-black flex items-center justify-center flex-shrink-0',
                    pessoa.tipo === 'freela' ? 'bg-lumos-yellow/15 text-lumos-yellow' : 'bg-lumos-text-secondary/15 text-lumos-text-secondary')}>
                    {pessoa.nome.trim().split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase() || '').join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-xs font-bold text-lumos-text-primary block truncate">{pessoa.nome}</span>
                    <span className="text-[10px] text-lumos-text-secondary block truncate">
                      {pessoa.tipo === 'freela' ? 'Fornecedor' : 'Time Lumos'}{pessoa.funcao ? ` · ${pessoa.funcao}` : ''}
                    </span>
                  </span>
                  <UserPlus className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default function OrdemDoDiaDetalhe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, isAdmin, can } = useAuth();
  const canManage = isAdmin || can('ordem_do_dia');
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [od, setOd] = useState<OD | null>(null);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState(false);
  // A aba fica na URL (?tab=) pra sobreviver a reload e dar pra mandar link direto.
  const [searchParams, setSearchParams] = useSearchParams();
  const abaParam = searchParams.get('tab');
  const aba: Aba = ABAS.some(a => a.key === abaParam) ? (abaParam as Aba) : 'cronograma';
  const setAba = (a: Aba) => setSearchParams(prev => {
    const p = new URLSearchParams(prev);
    if (a === 'cronograma') p.delete('tab'); else p.set('tab', a);
    return p;
  }, { replace: true });
  const [clima, setClima] = useState<PrevisaoDia | null>(null);
  const [agora, setAgora] = useState(() => new Date());
  const [roteiros, setRoteiros] = useState<{ id: string; name: string; url: string }[]>([]);
  const [projetoNome, setProjetoNome] = useState<string | null>(null);
  // Formulário rápido do app (nada de prompt() do navegador).
  const [qf, setQf] = useState<null | { title: string; fields: QFField[]; submitLabel?: string; onSubmit: (v: Record<string, string>) => void }>(null);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  // Busca no cadastro geral pra ficha técnica (freela que não está no projeto).
  const [buscandoPessoa, setBuscandoPessoa] = useState(false);

  // ── Carga ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setErroCarga(false);
    const { data, error } = await supabase.from('ordens_do_dia').select('*').eq('id', id).maybeSingle();
    if (error) { setErroCarga(true); setLoading(false); return; }
    if (!data) { setLoading(false); return; }
    const o = data as any;
    // Locação única antiga vira a primeira da lista nova (sem tocar no banco).
    let locacoes: Loc[] = Array.isArray(o.locacoes) ? o.locacoes : [];
    if (!locacoes.length && o.locacao?.nome) {
      locacoes = [{ nome: o.locacao.nome, endereco: o.locacao.endereco || '', obs: o.locacao.observacoes || '', incluida: true }];
    }
    setOd({
      ...o,
      locacoes,
      call_times: Array.isArray(o.call_times) ? o.call_times : [],
      regras: o.regras || {},
      equipe: o.equipe || [],
      plano_acao: o.plano_acao || [],
      talentos: o.talentos || [],
      objetos: o.objetos || [],
      figurino: o.figurino || [],
      equipamentos: o.equipamentos || [],
      roteiros: Array.isArray(o.roteiros) ? o.roteiros : [],
      contatos: o.contatos || [],
      // Sem a migração 2026093337 a coluna não existe: a página abre igual, com
      // o recado vazio.
      nota_cliente: o.nota_cliente || '',
      aprovacao: o.aprovacao || 'rascunho',
    });
    setLoading(false);
    if (o.project_id) {
      supabase.from('projects').select('name').eq('id', o.project_id).maybeSingle()
        .then(({ data: p, error: errP }) => {
          if (errP) { toast.error('Não foi possível carregar o nome do projeto.'); return; }
          setProjetoNome((p as any)?.name || null);
        });
      supabase.from('project_roteiros').select('id, nome, url').eq('project_id', o.project_id).order('ordem').order('created_at')
        .then(({ data: docs, error: errR }) => {
          if (errR) { toast.error('Não foi possível carregar os roteiros do projeto.'); return; }
          setRoteiros(((docs as any[]) || []).map(d => ({ id: d.id, name: d.nome, url: d.url })));
        });
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Relógio do "AGORA" (só faz sentido no dia da produção).
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Previsão do tempo pela 1ª locação incluída + data.
  useEffect(() => {
    const l = od?.locacoes.find(x => x.incluida);
    if (!l || !od?.data_producao) { setClima(null); return; }
    previsaoParaDiaria(l.endereco || l.nome, od.data_producao).then(setClima);
  }, [od?.locacoes, od?.data_producao]);

  // ── Persistência campo a campo ────────────────────────────────────────
  const patch = async (fields: Partial<OD>, silencioso = false): Promise<boolean> => {
    if (!od) return false;
    const prev = od;
    setOd({ ...od, ...fields });
    const { error } = await supabase.from('ordens_do_dia')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', od.id);
    if (error) {
      setOd(prev);
      toast.error(/aprovacao|call_times|locacoes|regras|objetos|figurino|equipamentos|hora_inicio|roteiros|nota_cliente/.test(String(error.message))
        ? 'Falta rodar a migração da Ordem do Dia 2.0 no banco.'
        : 'Não foi possível salvar.');
      return false;
    }
    if (!silencioso) toast.success('Salvo ✓');
    return true;
  };

  // ── Derivados do cronograma ───────────────────────────────────────────
  const cron = useMemo(() => {
    const rows = (od?.plano_acao || []).slice().sort((a, b) => (minutos(a.inicio) ?? 9999) - (minutos(b.inicio) ?? 9999));
    const inicio = rows.length ? minutos(rows[0].inicio) : minutos(od?.hora_inicio);
    const fim = rows.length ? Math.max(...rows.map(r => minutos(r.fim) ?? minutos(r.inicio) ?? 0)) : minutos(od?.hora_fim);
    const total = inicio != null && fim != null && fim > inicio ? fim - inicio : null;

    const hoje = od?.data_producao === hojeLocal();
    const agoraMin = agora.getHours() * 60 + agora.getMinutes() + agora.getSeconds() / 60;
    let atual: AtividadePlano | null = null;
    let atrasoSeg = 0; let atrasados = 0;
    if (hoje && rows.length) {
      for (const r of rows) {
        const ri = minutos(r.inicio); const rf = minutos(r.fim) ?? (ri != null ? ri + 30 : null);
        if (ri != null && agoraMin >= ri) atual = r;
        if (rf != null && agoraMin > rf) atrasados++;
      }
      if (atual) {
        const rf = minutos(atual.fim);
        if (rf != null && agoraMin > rf) atrasoSeg = Math.round((agoraMin - rf) * 60);
      }
    }
    return { rows, inicio, fim, total, hoje, atual, atrasoSeg, atrasados: Math.max(0, atrasados - (atual && atrasoSeg > 0 ? 1 : 0)) };
  }, [od?.plano_acao, od?.hora_inicio, od?.hora_fim, od?.data_producao, agora]);

  // ── Helpers de listas ─────────────────────────────────────────────────
  const editarLista = <T,>(campo: keyof OD, lista: T[]) => patch({ [campo]: lista } as any, true);

  if (loading) return <div className="min-h-[50vh] grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" /></div>;
  if (!od) return (
    <div className="text-center py-20">
      <p className="text-sm font-bold text-lumos-text-primary">
        {erroCarga ? 'Não foi possível carregar esta ordem do dia. Verifique sua conexão e tente de novo.' : 'Ordem do dia não encontrada.'}
      </p>
      <div className="flex items-center justify-center gap-4 mt-2">
        {erroCarga && <button onClick={() => { setLoading(true); load(); }} className="text-xs text-lumos-yellow underline">Tentar de novo</button>}
        <button onClick={() => navigate('/ordem-do-dia')} className="text-xs text-lumos-yellow underline">Voltar pra lista</button>
      </div>
    </div>
  );

  const locsAtivas = od.locacoes.filter(l => l.incluida);
  const chuva = (clima?.chanceChuva ?? 0) >= 30;

  return (
    <div className="space-y-4 font-work-sans pb-16">
      {confirmDialog}
      {/* ═════════ Cabeçalho ═════════ */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate(od.project_id ? `/producao/projetos?projectId=${od.project_id}&tab=ordemdia` : '/ordem-do-dia')}
          className="p-2 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary flex-shrink-0" title="Voltar">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black text-lumos-yellow bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase">{od.codigo}</span>
            <h1 className="text-lg font-black text-lumos-text-primary font-heading truncate">{od.titulo}</h1>
            {canManage && (
              <button type="button" title="Renomear"
                onClick={() => setQf({ title: 'Renomear ordem do dia', fields: [{ key: 'titulo', label: 'Título', value: od.titulo, required: true }], onSubmit: v => void patch({ titulo: v.titulo.trim() }) })}
                className="p-1 text-lumos-text-secondary hover:text-lumos-yellow"><Pencil className="w-3.5 h-3.5" /></button>
            )}
          </div>
          {projetoNome && <p className="text-[11px] text-lumos-text-secondary truncate">{projetoNome}</p>}
        </div>

        {/* Status de aprovação, igual referência */}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" disabled={!canManage}
            onClick={async () => {
              const aprovando = od.aprovacao !== 'aprovada';
              if (!aprovando) {
                // Desaprovar tira a gravação do portal do cliente na hora: avisa antes de fazer.
                if (!await confirm({
                  title: 'Desaprovar ordem do dia',
                  message: 'A gravação sai do portal do cliente na hora. Ele deixa de ver os dados dela até você aprovar de novo.',
                  confirmLabel: 'Desaprovar', danger: true,
                })) return;
              }
              const ok = await patch({ aprovacao: aprovando ? 'aprovada' : 'rascunho' });
              // O time só é avisado quando a OD é APROVADA — rascunho não pinga ninguém.
              // E só quando o salvamento deu certo, senão o time recebe aviso de algo que não aconteceu.
              if (ok && aprovando) {
                getUserIdsWithPermission('ordem_do_dia').then(ids => notify({
                  userIds: ids,
                  event: NOTIFICATION_EVENTS.ORDEM_DIA_PUBLICADA,
                  title: 'Ordem do Dia aprovada 🎬',
                  body: `"${od.titulo}" está aprovada${od.data_producao ? ` pra ${fmtDataLonga(od.data_producao).toLowerCase()}` : ''}.`,
                  link: `/ordem-do-dia/${od.id}`,
                })).catch(() => {});
              }
            }}
            className={clsx('text-[11px] font-black rounded-full px-3.5 h-8 flex items-center gap-1.5 border transition-colors',
              od.aprovacao === 'aprovada'
                ? 'bg-green-600/15 border-green-600/50 text-green-500'
                : 'bg-lumos-text-secondary/10 border-lumos-border text-lumos-text-secondary')}>
            {od.aprovacao === 'aprovada' ? <><Check className="w-3.5 h-3.5" /> Aprovada</> : 'Rascunho'}
          </button>
          <button type="button" disabled={gerandoPdf}
            onClick={async () => {
              setGerandoPdf(true);
              try {
                const [{ pdf }, { OrdemDoDiaPDF }, React] = await Promise.all([
                  import('@react-pdf/renderer'), import('@/components/editor/OrdemDoDiaPDF'), import('react'),
                ]);
                // A call sheet da equipe leva TUDO o que foi preenchido nas nove
                // abas. Só as locações incluídas vão, que são as mesmas que a
                // tela usa no cronograma, no Maps e na previsão.
                const locs = od.locacoes.filter(x => x.incluida)
                  .map(l => ({ nome: l.nome, endereco: l.endereco, observacoes: l.obs || '' }));
                const ordem = {
                  codigo: od.codigo, titulo: od.titulo, data_producao: od.data_producao,
                  data_emissao: new Date().toISOString(), clima: od.clima,
                  ponto_encontro: od.ponto_encontro,
                  call_times: od.call_times,
                  locacoes: locs.length ? locs : (od.locacao?.nome ? [od.locacao] : []),
                  contatos: od.contatos, equipe: od.equipe, plano_acao: od.plano_acao, talentos: od.talentos,
                  objetos: od.objetos, figurino: od.figurino, equipamentos: od.equipamentos,
                  roteiros: od.roteiros, regras: od.regras, nota_cliente: od.nota_cliente,
                };
                const blob = await pdf(React.createElement(OrdemDoDiaPDF, { ordem }) as any).toBlob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `OD_${od.codigo.replace(/[^\w-]/g, '')}_Lumos_${od.titulo.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_')}.pdf`;
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(a.href);
              } catch { toast.error('Não foi possível gerar o PDF.'); }
              finally { setGerandoPdf(false); }
            }}
            className="text-[11px] font-bold border border-lumos-border rounded-lumos px-3 h-8 text-lumos-text-secondary hover:text-lumos-text-primary flex items-center gap-1.5 disabled:opacity-60">
            {gerandoPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} Exportar PDF
          </button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-lumos-border overflow-x-auto no-scrollbar -mx-1 px-1">
        {ABAS.map(t => (
          <button key={t.key} onClick={() => setAba(t.key)}
            className={clsx('px-3 py-2.5 text-[11px] font-black uppercase tracking-wider border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors flex-shrink-0',
              aba === t.key ? 'border-lumos-yellow text-lumos-yellow' : 'border-transparent text-lumos-text-secondary hover:text-lumos-text-primary')}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* Alerta de chuva (todas as abas, igual referência) */}
      {chuva && clima && (
        <div className="rounded-lumos border border-amber-500/40 bg-amber-500/[0.07] px-4 py-2.5 flex items-start gap-2.5">
          <CloudRain className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] leading-snug text-lumos-text-primary">
            Previsão de chuva em <b>{fmtDataLonga(od.data_producao)}</b>, {clima.chanceChuva}% de chance de precipitação
            {clima.chuvaMm > 0 ? `, ${clima.chuvaMm.toLocaleString('pt-BR')} mm previstos` : ''}{locsAtivas[0] ? `, em ${locsAtivas[0].nome}` : ''}.
          </p>
        </div>
      )}

      {/* ═════════ ABA CRONOGRAMA (o cockpit) ═════════ */}
      {aba === 'cronograma' && (<>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Data */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <CalendarDays className="w-3.5 h-3.5 text-lumos-yellow" />
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Data</p>
              {canManage && (
                <button type="button" title="Alterar data"
                  onClick={() => setQf({ title: 'Data da produção', fields: [{ key: 'data', label: 'Data', type: 'date', value: od.data_producao || '' }], onSubmit: v => void patch({ data_producao: v.data || null }) })}
                  className="ml-auto p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow"><Pencil className="w-3 h-3" /></button>
              )}
            </div>
            <p className="text-[15px] font-black text-lumos-text-primary">{fmtDataLonga(od.data_producao)}</p>
          </div>

          {/* Horário */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-3.5 h-3.5 text-lumos-yellow" />
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Horário</p>
            </div>
            {cron.inicio != null && cron.fim != null ? (
              <>
                <p className="text-[15px] font-black text-lumos-text-primary tabular-nums">{fmtMin(cron.inicio)} → {fmtMin(cron.fim)}</p>
                {cron.total != null && <p className="text-[10.5px] text-lumos-text-secondary">{Math.floor(cron.total / 60)}h {cron.total % 60 ? `${cron.total % 60}min` : ''} no total</p>}
              </>
            ) : (
              <p className="text-[12px] text-lumos-text-secondary italic">Sai do cronograma principal, preencha lá embaixo.</p>
            )}
          </div>

          {/* AGORA, o relógio de atraso ao vivo */}
          <div className={clsx('card p-4', cron.atrasoSeg > 0 && 'border-red-500/50')}>
            <div className="flex items-center gap-2 mb-1">
              <span className={clsx('w-2 h-2 rounded-full', cron.hoje ? 'bg-red-500 animate-pulse' : 'bg-lumos-text-secondary/40')} />
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Agora</p>
              {cron.atrasados > 0 && <span className="text-[9px] font-black bg-red-500/15 text-red-500 rounded-full px-2 py-0.5">+{cron.atrasados} atrasados</span>}
            </div>
            {!cron.hoje ? (
              <p className="text-[12px] text-lumos-text-secondary italic">O relógio ao vivo liga no dia da produção.</p>
            ) : !cron.atual ? (
              <p className="text-[12px] text-lumos-text-secondary">Nada rolando ainda, primeira atividade às {cron.inicio != null ? fmtMin(cron.inicio) : 'horário não definido'}.</p>
            ) : (
              <div className="flex items-end justify-between gap-3">
                <p className="text-[13px] font-black text-lumos-text-primary leading-tight">{cron.atual.descricao || 'Atividade atual'}</p>
                {cron.atrasoSeg > 0 && (
                  <div className="text-right flex-shrink-0">
                    <p className="text-[8.5px] font-black uppercase text-red-500">Atrasado</p>
                    <p className="text-[17px] font-black text-red-500 tabular-nums leading-none">
                      {Math.floor(cron.atrasoSeg / 3600) > 0 && `${Math.floor(cron.atrasoSeg / 3600)}h `}
                      {Math.floor((cron.atrasoSeg % 3600) / 60)}min {cron.atrasoSeg % 60}s
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {/* Previsão do tempo */}
          <div className={clsx('card p-4', chuva && 'border-amber-500/40')}>
            <div className="flex items-center gap-2 mb-2">
              {chuva ? <CloudRain className="w-3.5 h-3.5 text-amber-500" /> : <Sun className="w-3.5 h-3.5 text-lumos-yellow" />}
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Previsão do tempo</p>
            </div>
            {clima ? (
              <>
                <p className="text-[15px] font-black text-lumos-text-primary">{clima.tempMin}° a {clima.tempMax}° · {clima.chanceChuva}% de chuva</p>
                {locsAtivas[0] && <p className="text-[10.5px] text-lumos-text-secondary flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" /> {locsAtivas[0].nome}</p>}
              </>
            ) : (
              <p className="text-[12px] text-lumos-text-secondary italic">
                {!od.data_producao ? 'Defina a data pra buscar a previsão.'
                  : !locsAtivas.length ? 'Cadastre uma locação pra buscar a previsão.'
                  : 'Previsão disponível a partir de 15 dias antes.'}
              </p>
            )}
          </div>

          {/* Locações resumo */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-3.5 h-3.5 text-lumos-yellow" />
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Locações ({locsAtivas.length})</p>
              <button type="button" onClick={() => setAba('locacoes')} className="ml-auto text-[10px] font-bold text-lumos-yellow hover:underline">gerenciar</button>
            </div>
            {locsAtivas.length === 0 ? (
              <p className="text-[12px] text-lumos-text-secondary italic">Nenhuma locação na ordem ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {locsAtivas.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 min-w-0">
                    <span className="text-[9px] font-black bg-lumos-yellow/15 text-lumos-yellow rounded-full w-5 h-5 grid place-items-center flex-shrink-0">{i + 1}ª</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-bold text-lumos-text-primary truncate">{l.nome}</p>
                      {l.endereco && <p className="text-[10px] text-lumos-text-secondary truncate">{l.endereco}</p>}
                    </div>
                    <a href={`https://www.google.com/maps/search/${encodeURIComponent(l.endereco || l.nome)}`} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] font-bold text-lumos-yellow hover:underline flex items-center gap-0.5 flex-shrink-0">Maps <ExternalLink className="w-2.5 h-2.5" /></a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {/* Call time */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-3.5 h-3.5 text-lumos-yellow" />
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Call time</p>
              {canManage && (
                <button type="button" onClick={() => setQf({ title: 'Call time', submitLabel: 'Adicionar', fields: [
                  { key: 'grupo', label: 'Grupo', placeholder: 'Ex.: Direção e Produção', required: true },
                  { key: 'hora', label: 'Horário de chegada', type: 'time', value: '06:00', required: true },
                ], onSubmit: v => void editarLista('call_times', [...od.call_times, { grupo: v.grupo.trim(), hora: v.hora }]) })}
                  className="ml-auto p-1 text-lumos-text-secondary hover:text-lumos-yellow" title="Adicionar grupo"><Plus className="w-3.5 h-3.5" /></button>
              )}
            </div>
            {od.call_times.length === 0 ? (
              <p className="text-[12px] text-lumos-text-secondary italic">Horário de chegada de cada grupo (direção, arte, catering…).</p>
            ) : (
              <div className="space-y-1.5">
                {od.call_times.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 bg-lumos-bg/40 border border-lumos-border/60 rounded px-3 py-1.5 group">
                    <Users2 className="w-3 h-3 text-lumos-text-secondary flex-shrink-0" />
                    <span className="text-[12px] font-bold text-lumos-text-primary flex-1 truncate">{c.grupo}</span>
                    <span className="text-[12px] font-black text-lumos-yellow tabular-nums">{c.hora}</span>
                    {canManage && (
                      <button type="button" onClick={async () => {
                        if (!await confirm({ title: `Remover "${c.grupo}"`, message: 'O horário de chegada deste grupo sai da ordem do dia.', confirmLabel: 'Remover', danger: true })) return;
                        void editarLista('call_times', od.call_times.filter((_, j) => j !== i));
                      }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-lumos-text-secondary hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {od.ponto_encontro?.nome && (
              <p className="text-[10.5px] text-lumos-text-secondary mt-2">Ponto de encontro: <b className="text-lumos-text-primary">{od.ponto_encontro.nome}</b>{od.ponto_encontro.endereco ? `, ${od.ponto_encontro.endereco}` : ''}</p>
            )}
          </div>

          {/* Equipe resumo */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users2 className="w-3.5 h-3.5 text-lumos-yellow" />
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary">Equipe</p>
              <span className="text-[10px] text-lumos-text-secondary">· {od.equipe.length} pessoa{od.equipe.length !== 1 ? 's' : ''}</span>
              <button type="button" onClick={() => setAba('equipe')} className="ml-auto text-[10px] font-bold text-lumos-yellow hover:underline">ver todos</button>
            </div>
            {od.equipe.length === 0 ? (
              <p className="text-[12px] text-lumos-text-secondary italic">A ficha técnica da diária monta na aba Equipe.</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {od.equipe.slice(0, 6).map((m, i) => (
                  <div key={i} className="min-w-0">
                    <p className="text-[11.5px] font-bold text-lumos-text-primary truncate">{m.nome}</p>
                    <p className="text-[9.5px] text-lumos-text-secondary truncate">{m.funcao}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Regras do set em 4 cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <CardRegra valor={od.regras.vestimenta || ''} titulo="Vestimenta" Icon={Shirt} destaque canManage={canManage} onSave={v => void patch({ regras: { ...od.regras, vestimenta: v } }, true)} />
          <CardRegra valor={od.regras.redes || ''} titulo="Postagem em redes sociais" Icon={Megaphone} canManage={canManage} onSave={v => void patch({ regras: { ...od.regras, redes: v } }, true)} />
          <CardRegra valor={od.regras.setup_camera || ''} titulo="Setup de câmera" Icon={Camera} canManage={canManage} onSave={v => void patch({ regras: { ...od.regras, setup_camera: v } }, true)} />
          <CardRegra valor={od.regras.outras || ''} titulo="Outras observações" Icon={FileText} canManage={canManage} onSave={v => void patch({ regras: { ...od.regras, outras: v } }, true)} />
        </div>

        {/* O único campo desta página que sai do prédio: o cliente lê este
            texto no portal dele. Fica logo abaixo das regras do set, que são
            internas, com o aviso na cara pra ninguém confundir uma coisa com
            a outra. */}
        <CardRegra valor={od.nota_cliente} titulo="Recado para o cliente" Icon={Eye} canManage={canManage}
          ajuda="Esse texto o cliente lê no portal dele, dentro da gravação marcada, assim que a ordem for aprovada. Escreva o que ele precisa providenciar no dia."
          vazio="Nenhum recado para o cliente. Clique no lápis pra escrever."
          onSave={v => void patch({ nota_cliente: v }, true)} />

        <CronogramaPrincipal od={od} canManage={canManage} agora={agora} hoje={cron.hoje}
          locsAtivas={locsAtivas} onChange={lista => void editarLista('plano_acao', lista)} confirm={confirm} />
      </>)}

      {/* ═════════ ABA LOCAÇÕES ═════════ */}
      {aba === 'locacoes' && (
        <div className="space-y-3">
          <div className="flex items-center">
            <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2"><MapPin className="w-4 h-4 text-lumos-yellow" /> Locações</p>
            {canManage && (
              <button type="button" onClick={() => setQf({ title: 'Nova locação', submitLabel: 'Criar', fields: [
                { key: 'nome', label: 'Nome', placeholder: 'Ex.: Praia da Reserva', required: true },
                { key: 'endereco', label: 'Endereço completo', placeholder: 'Rua, número, bairro, cidade' },
              ], onSubmit: v => void editarLista('locacoes', [...od.locacoes, { nome: v.nome.trim(), endereco: v.endereco.trim(), incluida: true }]) })}
                className="ml-auto btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Criar locação</button>
            )}
          </div>
          {od.locacoes.length === 0 ? (
            <div className="card p-8 text-center">
              <MapPin className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" />
              <p className="text-sm font-bold text-lumos-text-primary">Nenhuma locação cadastrada.</p>
              <p className="text-xs text-lumos-text-secondary mt-1">As locações incluídas aparecem no cronograma, com link do Maps e previsão do tempo.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {od.locacoes.map((l, i) => (
                <div key={i} className={clsx('card p-4 flex items-center gap-3 group', !l.incluida && 'opacity-50')}>
                  {canManage && (
                    <span className="flex flex-col gap-0.5 flex-shrink-0">
                      <button type="button" disabled={i === 0} onClick={() => { const x = [...od.locacoes]; [x[i - 1], x[i]] = [x[i], x[i - 1]]; void editarLista('locacoes', x); }}
                        className="p-0.5 text-lumos-text-secondary hover:text-lumos-text-primary disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button type="button" disabled={i === od.locacoes.length - 1} onClick={() => { const x = [...od.locacoes]; [x[i + 1], x[i]] = [x[i], x[i + 1]]; void editarLista('locacoes', x); }}
                        className="p-0.5 text-lumos-text-secondary hover:text-lumos-text-primary disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                    </span>
                  )}
                  <span className="text-[10px] font-black bg-lumos-yellow/15 text-lumos-yellow rounded-full w-6 h-6 grid place-items-center flex-shrink-0">{i + 1}ª</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-black text-lumos-text-primary truncate">{l.nome}</p>
                    {l.endereco && <p className="text-[11px] text-lumos-text-secondary truncate">{l.endereco}</p>}
                    <div className="flex gap-3 mt-1">
                      <a href={`https://www.google.com/maps/search/${encodeURIComponent(l.endereco || l.nome)}`} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] font-bold text-lumos-yellow hover:underline flex items-center gap-0.5">Ver no Maps <ExternalLink className="w-2.5 h-2.5" /></a>
                      {l.endereco && (
                        <button type="button" onClick={() => { navigator.clipboard.writeText(l.endereco); toast.success('Endereço copiado ✓'); }}
                          className="text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary flex items-center gap-0.5"><Copy className="w-2.5 h-2.5" /> Copiar endereço</button>
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <>
                      <button type="button" onClick={() => setQf({ title: 'Editar locação', fields: [
                        { key: 'nome', label: 'Nome', value: l.nome, required: true },
                        { key: 'endereco', label: 'Endereço completo', value: l.endereco },
                      ], onSubmit: v => void editarLista('locacoes', od.locacoes.map((x, j) => j === i ? { ...x, nome: v.nome.trim(), endereco: v.endereco.trim() } : x)) })}
                        className="p-1.5 text-lumos-text-secondary hover:text-lumos-yellow opacity-0 group-hover:opacity-100" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={async () => {
                        if (!await confirm({ title: `Remover "${l.nome}"`, message: 'A locação sai do cronograma, do link do Maps e da previsão do tempo desta ordem do dia.', confirmLabel: 'Remover', danger: true })) return;
                        void editarLista('locacoes', od.locacoes.filter((_, j) => j !== i));
                      }}
                        className="p-1.5 text-lumos-text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => void editarLista('locacoes', od.locacoes.map((x, j) => j === i ? { ...x, incluida: !x.incluida } : x))}
                        className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0', l.incluida ? 'bg-green-600' : 'bg-lumos-text-secondary/30')}
                        title={l.incluida ? 'Na ordem do dia' : 'Não incluída'}>
                        <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', l.incluida ? 'left-5' : 'left-0.5')} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═════════ ABA ROTEIROS ═════════ */}
      {aba === 'roteiros' && (
        <div className="space-y-3">
          <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2"><ScrollText className="w-4 h-4 text-lumos-yellow" /> Roteiros</p>
          {!od.project_id ? (
            <div className="card p-8 text-center"><p className="text-sm font-bold text-lumos-text-primary">Esta ordem não está vinculada a um projeto.</p><p className="text-xs text-lumos-text-secondary mt-1">Vincule pela aba Ordem do dia do projeto pra puxar os roteiros de lá.</p></div>
          ) : roteiros.length === 0 ? (
            <div className="card p-8 text-center">
              <ScrollText className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" />
              <p className="text-sm font-bold text-lumos-text-primary">Nenhum roteiro no projeto.</p>
              <p className="text-xs text-lumos-text-secondary mt-1 max-w-md mx-auto">Cole o link do Google Docs na aba Roteiros do projeto e ele aparece aqui pra vincular à diária.</p>
            </div>
          ) : (
            <div className="card divide-y divide-lumos-border/60 overflow-hidden">
              {roteiros.map(r => {
                const nesta = od.roteiros.some(x => x.id === r.id);
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-lumos-text-primary/5 transition-colors">
                    <ScrollText className={clsx('w-4 h-4 flex-shrink-0', nesta ? 'text-lumos-yellow' : 'text-lumos-text-secondary')} />
                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                      className="text-[13px] font-bold text-lumos-text-primary truncate flex-1 hover:text-lumos-yellow flex items-center gap-1.5">
                      {r.name} <ExternalLink className="w-3 h-3 text-lumos-text-secondary flex-shrink-0" />
                    </a>
                    {canManage && (
                      <button type="button"
                        onClick={() => void patch({ roteiros: nesta ? od.roteiros.filter(x => x.id !== r.id) : [...od.roteiros, r] }, true)}
                        className={clsx('w-10 h-5 rounded-full relative transition-colors flex-shrink-0', nesta ? 'bg-green-600' : 'bg-lumos-text-secondary/30')}
                        title={nesta ? 'Nesta diária' : 'Fora desta diária'}>
                        <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', nesta ? 'left-5' : 'left-0.5')} />
                      </button>
                    )}
                    <span className={clsx('text-[9px] font-black uppercase flex-shrink-0', nesta ? 'text-green-500' : 'text-lumos-text-secondary/60')}>
                      {nesta ? 'Nesta diária' : 'Fora desta diária'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═════════ ABA EQUIPE ═════════ */}
      {aba === 'equipe' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2"><Users2 className="w-4 h-4 text-lumos-yellow" /> Ficha técnica · {od.equipe.length}</p>
            {canManage && (
              <span className="ml-auto flex gap-2">
                {od.project_id && (
                  <button type="button" onClick={async () => {
                    // Puxa a equipe do projeto (cadastrada + das tarefas) pra ficha.
                    const { data: members, error: errMembers } = await supabase.from('project_members').select('user_id, freela_id, funcao').eq('project_id', od.project_id!);
                    if (errMembers) { toast.error('Não foi possível carregar a equipe do projeto.'); return; }
                    const ids = (members || []).map(m => (m.user_id || m.freela_id) as string);
                    if (!ids.length) { toast.error('A equipe do projeto está vazia, monte na aba Equipe do projeto.'); return; }
                    const [users, freelas] = await Promise.all([
                      supabase.from('app_users').select('id, full_name, job_title').in('id', ids),
                      supabase.from('fornecedores').select('id, nome').in('id', ids),
                    ]);
                    const nomes = new Map<string, { nome: string; funcao: string }>();
                    for (const u of users.data || []) nomes.set(u.id, { nome: u.full_name, funcao: (u as any).job_title || '' });
                    for (const f of freelas.data || []) if (!nomes.has(f.id)) nomes.set(f.id, { nome: (f as any).nome, funcao: 'Freelancer' });
                    const jaTem = new Set(od.equipe.map(m => m.nome));
                    const novos = (members || [])
                      .map(m => { const meta = nomes.get((m.user_id || m.freela_id) as string); return meta ? { nome: meta.nome, funcao: m.funcao || meta.funcao } : null; })
                      .filter((x): x is MembroEquipe => !!x && !jaTem.has(x.nome));
                    if (!novos.length) { toast.success('Equipe do projeto já está toda na ficha.'); return; }
                    void editarLista('equipe', [...od.equipe, ...novos]);
                    toast.success(`${novos.length} pessoa(s) puxadas do projeto ✓`);
                  }} className="text-[11px] font-bold border border-lumos-yellow/50 text-lumos-yellow rounded-lumos px-3 h-9 hover:bg-lumos-yellow/10">
                    Puxar equipe do projeto
                  </button>
                )}
                <button type="button" onClick={() => setBuscandoPessoa(true)}
                  className="text-[11px] font-bold border border-lumos-border text-lumos-text-secondary rounded-lumos px-3 h-9 hover:text-lumos-text-primary flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" /> Buscar no cadastro
                </button>
                <button type="button" onClick={() => setQf({ title: 'Adicionar à ficha técnica', submitLabel: 'Adicionar', fields: [
                  { key: 'nome', label: 'Nome', required: true },
                  { key: 'funcao', label: 'Função nesta diária', placeholder: 'Ex.: Diretor de fotografia' },
                ], onSubmit: v => void editarLista('equipe', [...od.equipe, { nome: v.nome.trim(), funcao: v.funcao.trim() }]) })}
                  className="btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
              </span>
            )}
          </div>
          {od.equipe.length === 0 ? (
            <div className="card p-8 text-center"><Users2 className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" /><p className="text-sm font-bold text-lumos-text-primary">Ficha técnica vazia.</p><p className="text-xs text-lumos-text-secondary mt-1">Puxe a equipe do projeto, busque no cadastro geral ou adicione pessoa a pessoa.</p></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {od.equipe.map((m, i) => (
                <div key={i} className="card p-3.5 flex items-center gap-3 group">
                  <div className="w-9 h-9 rounded-full bg-lumos-yellow/15 text-lumos-yellow grid place-items-center text-[11px] font-black flex-shrink-0">
                    {m.nome.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-black text-lumos-text-primary truncate">{m.nome}</p>
                    <p className="text-[10.5px] text-lumos-text-secondary truncate">{m.funcao || 'Função a definir'}</p>
                  </div>
                  {canManage && (
                    <span className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => setQf({ title: `Função de ${m.nome}`, fields: [
                        { key: 'funcao', label: 'Função nesta diária', value: m.funcao },
                      ], onSubmit: v => void editarLista('equipe', od.equipe.map((x, j) => j === i ? { ...x, funcao: v.funcao.trim() } : x)) })}
                        className="p-1 text-lumos-text-secondary hover:text-lumos-yellow"><Pencil className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={async () => {
                        if (!await confirm({ title: `Remover "${m.nome}"`, message: 'A pessoa sai da ficha técnica desta diária.', confirmLabel: 'Remover', danger: true })) return;
                        void editarLista('equipe', od.equipe.filter((_, j) => j !== i));
                      }}
                        className="p-1 text-lumos-text-secondary hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {buscandoPessoa && (
            <EscolherDoCadastro
              projectId={od.project_id}
              jaNaFicha={new Set(od.equipe.map(m => m.nome.trim().toLowerCase()))}
              onEscolher={p => {
                void editarLista('equipe', [...od.equipe, { nome: p.nome, funcao: p.funcao || (p.tipo === 'freela' ? 'Freelancer' : '') }]);
                toast.success(`${p.nome} entrou na ficha técnica ✓`);
              }}
              onClose={() => setBuscandoPessoa(false)}
            />
          )}
        </div>
      )}

      {/* ═════════ ABA ELENCO ═════════ */}
      {aba === 'elenco' && (
        <div className="space-y-3">
          <div className="flex items-center">
            <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2"><Video className="w-4 h-4 text-lumos-yellow" /> Elenco · {od.talentos.length}</p>
            {canManage && (
              <button type="button" onClick={() => setQf({ title: 'Adicionar ao elenco', submitLabel: 'Adicionar', fields: [
                { key: 'nome', label: 'Nome do talento', required: true },
                { key: 'papel', label: 'Papel/personagem', placeholder: 'Ex.: Apresentadora' },
              ], onSubmit: v => void editarLista('talentos', [...od.talentos, { nome: v.nome.trim(), funcao: v.papel.trim(), horario_chegada: '', horario_gravacao: '', obs: '' }]) })}
                className="ml-auto btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
            )}
          </div>
          {od.talentos.length === 0 ? (
            <div className="card p-8 text-center"><Video className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" /><p className="text-sm font-bold text-lumos-text-primary">Sem elenco nesta diária.</p></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {od.talentos.map((t, i) => (
                <div key={i} className="card p-4 group">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-purple-500/15 text-purple-500 grid place-items-center text-[13px] font-black flex-shrink-0">
                      {t.nome.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-black text-lumos-text-primary truncate">{t.nome}</p>
                      <p className="text-[10.5px] text-lumos-text-secondary truncate">{t.funcao || 'Papel a definir'}</p>
                    </div>
                    {canManage && (
                      <span className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" onClick={() => setQf({ title: `Detalhes de ${t.nome}`, fields: [
                          { key: 'chegada', label: 'Horário de chegada', type: 'time', value: t.horario_chegada || '' },
                          { key: 'grava', label: 'Horário de gravação', type: 'time', value: t.horario_gravacao || '' },
                          { key: 'obs', label: 'Observações', type: 'textarea', value: t.obs || '' },
                        ], onSubmit: v => void editarLista('talentos', od.talentos.map((x, j) => j === i ? { ...x, horario_chegada: v.chegada, horario_gravacao: v.grava, obs: v.obs.trim() } : x)) })}
                          className="p-1 text-lumos-text-secondary hover:text-lumos-yellow"><Pencil className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={async () => {
                          if (!await confirm({ title: `Remover "${t.nome}"`, message: 'O talento sai do elenco desta diária.', confirmLabel: 'Remover', danger: true })) return;
                          void editarLista('talentos', od.talentos.filter((_, j) => j !== i));
                        }}
                          className="p-1 text-lumos-text-secondary hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                      </span>
                    )}
                  </div>
                  {(t.horario_chegada || t.horario_gravacao || t.obs) && (
                    <div className="mt-2.5 pt-2.5 border-t border-lumos-border/60 space-y-0.5 text-[10.5px] text-lumos-text-secondary">
                      {t.horario_chegada && <p>Chegada: <b className="text-lumos-text-primary tabular-nums">{t.horario_chegada}</b></p>}
                      {t.horario_gravacao && <p>Gravação: <b className="text-lumos-text-primary tabular-nums">{t.horario_gravacao}</b></p>}
                      {t.obs && <p>{t.obs}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═════════ ABAS OBJETOS / FIGURINO / EQUIPAMENTOS (mesma mecânica) ═════════ */}
      {(['objetos', 'figurino', 'equipamentos'] as const).map(campo => aba === campo && (
        <div key={campo} className="space-y-3">
          <div className="flex items-center">
            <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2 capitalize">
              {campo === 'objetos' ? <Package className="w-4 h-4 text-lumos-yellow" /> : campo === 'figurino' ? <Shirt className="w-4 h-4 text-lumos-yellow" /> : <Wrench className="w-4 h-4 text-lumos-yellow" />}
              {campo} · {od[campo].length}
            </p>
            {canManage && (
              <button type="button" onClick={() => setQf({
                title: campo === 'objetos' ? 'Novo objeto de cena' : campo === 'figurino' ? 'Novo look' : 'Novo equipamento',
                submitLabel: 'Adicionar',
                fields: [
                  { key: 'nome', label: campo === 'objetos' ? 'Objeto' : campo === 'figurino' ? 'Look/figurino' : 'Equipamento', required: true },
                  { key: 'desc', label: campo === 'figurino' ? 'De qual personagem? (opcional)' : 'Descrição (opcional)' },
                ],
                onSubmit: v => {
                  const item: ItemSimples = campo === 'figurino' ? { nome: v.nome.trim(), personagem: v.desc.trim() } : { nome: v.nome.trim(), desc: v.desc.trim() };
                  void editarLista(campo, [...od[campo], item]);
                },
              })} className="ml-auto btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
            )}
          </div>
          {od[campo].length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-sm font-bold text-lumos-text-primary">Nada por aqui ainda.</p>
              <p className="text-xs text-lumos-text-secondary mt-1">
                {campo === 'objetos' ? 'Props e objetos de cena que precisam estar no set.'
                  : campo === 'figurino' ? 'Looks por personagem, pro figurino não virar surpresa no dia.'
                  : 'O que precisa estar na van: câmeras, luz, áudio, drone. O vínculo com o inventário de Equipamentos vem numa próxima fase.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {od[campo].map((it, i) => (
                <div key={i} className="card p-3.5 flex items-center gap-3 group">
                  <div className="w-9 h-9 rounded bg-lumos-yellow/10 text-lumos-yellow grid place-items-center flex-shrink-0">
                    {campo === 'objetos' ? <Package className="w-4 h-4" /> : campo === 'figurino' ? <Shirt className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-black text-lumos-text-primary truncate">{it.nome}</p>
                    {(it.desc || it.personagem) && <p className="text-[10.5px] text-lumos-text-secondary truncate">{it.personagem ? `Figurino de ${it.personagem}` : it.desc}</p>}
                  </div>
                  {canManage && (
                    <button type="button" onClick={async () => {
                      const rotulo = campo === 'objetos' ? 'objeto' : campo === 'figurino' ? 'look' : 'equipamento';
                      if (!await confirm({ title: `Remover "${it.nome}"`, message: `Esse ${rotulo} sai da lista de ${campo} desta diária.`, confirmLabel: 'Remover', danger: true })) return;
                      void editarLista(campo, od[campo].filter((_, j) => j !== i));
                    }}
                      className="p-1 text-lumos-text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {qf && <QuickForm title={qf.title} fields={qf.fields} submitLabel={qf.submitLabel} onSubmit={qf.onSubmit} onClose={() => setQf(null)} />}

      {/* ═════════ ABA OUTRAS OBSERVAÇÕES ═════════ */}
      {aba === 'obs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <CardRegra valor={od.regras.vestimenta || ''} titulo="Regras de vestimenta" Icon={Shirt} destaque canManage={canManage} onSave={v => void patch({ regras: { ...od.regras, vestimenta: v } }, true)} />
          <CardRegra valor={od.regras.redes || ''} titulo="Regras de postagem da equipe em redes sociais" Icon={Megaphone} canManage={canManage} onSave={v => void patch({ regras: { ...od.regras, redes: v } }, true)} />
          <CardRegra valor={od.regras.setup_camera || ''} titulo="Setup de câmera" Icon={Camera} canManage={canManage} onSave={v => void patch({ regras: { ...od.regras, setup_camera: v } }, true)} />
          <CardRegra valor={od.regras.outras || ''} titulo="Outras observações" Icon={FileText} canManage={canManage} onSave={v => void patch({ regras: { ...od.regras, outras: v } }, true)} />
          <CardRegra valor={od.nota_cliente} titulo="Recado para o cliente" Icon={Eye} canManage={canManage}
            ajuda="Esse texto o cliente lê no portal dele, dentro da gravação marcada, assim que a ordem for aprovada. Escreva o que ele precisa providenciar no dia."
            vazio="Nenhum recado para o cliente. Clique no lápis pra escrever."
            onSave={v => void patch({ nota_cliente: v }, true)} />
        </div>
      )}
    </div>
  );
}
