import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  DIAS_CURTOS, DIAS_LONGOS, MESES_CURTOS, dataDeIso, diasDaJanela, empilhar, hhmm, hojeIso, isoDe,
  minDe, navegarJanela, tituloDaJanela, trechosDoEvento,
  type EventoCal, type Granularidade, type Trecho,
} from './calendario';

/**
 * Calendário de compromissos no padrão Lumos: Mês, Semana e Dia. Semana e Dia são grades de horas, com o
 * bloco posicionado pelo horário e pela duração (a diária que vira a madrugada continua no dia seguinte).
 * No celular o Mês vira bolinhas + lista do dia escolhido, e Semana/Dia viram lista por dia.
 * Não guarda dados: quem usa passa os eventos e decide o que acontece ao clicar.
 */

const PX_HORA = 52;
const tint = (cor: string, pct: number) => `color-mix(in srgb, ${cor} ${pct}%, transparent)`;

/** Preenchimento SÓLIDO do evento. O que já passou fica um pouco mais apagado, mas sem transparência. */
const solido = (e: EventoCal) => (e.passado ? `color-mix(in srgb, ${e.cor} 70%, var(--color-lumos-surface))` : e.cor);
/** Texto escuro sobre cor clara e branco sobre cor escura (luminância da cor do evento). */
const textoSobre = (hex: string) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#161616' : '#ffffff';
};

const horarioTexto = (e: EventoCal) => {
  if (!e.hora) return 'Dia todo';
  const i = e.hora.slice(0, 5);
  if (!e.horaFim) return i;
  const f = e.horaFim.slice(0, 5);
  return f < i ? `${i} → ${f} (dia seguinte)` : `${i} → ${f}`;
};

// ───────────────────────── cartão de detalhes ao passar o mouse ─────────────────────────

function useCartaoDoEvento(e: EventoCal) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const alvo = useRef<HTMLElement | null>(null);
  // Só com mouse: no toque o clique já abre o evento.
  const temMouse = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

  const abrir = () => {
    if (!temMouse) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = alvo.current?.getBoundingClientRect();
      if (r) setPos({ x: r.left, y: r.bottom + 6 });
    }, 280);
  };
  const fechar = () => { if (timer.current) window.clearTimeout(timer.current); setPos(null); };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const cartao = pos ? createPortal(
    <div className="fixed z-[400] w-64 pointer-events-none rounded-lumos border border-lumos-border bg-lumos-surface p-3 shadow-2xl"
      style={{
        left: Math.max(8, Math.min(pos.x, window.innerWidth - 272)),
        top: pos.y + 140 > window.innerHeight ? Math.max(8, pos.y - 150) : pos.y,
      }}>
      <div className="flex items-start gap-2">
        <span className="mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: e.cor }} />
        <p className="text-[12.5px] font-black leading-snug text-lumos-text-primary">{e.titulo}</p>
      </div>
      <p className="mt-1.5 text-[11px] font-bold text-lumos-text-primary tabular-nums">{horarioTexto(e)}</p>
      {e.subtitulo && <p className="mt-0.5 text-[11px] text-lumos-text-secondary">{e.subtitulo}</p>}
      {e.detalhes?.map((l, i) => <p key={i} className="mt-0.5 text-[10.5px] text-lumos-text-secondary leading-snug">{l}</p>)}
      {e.selo && (
        <span className="mt-2 inline-block rounded-full border px-2 py-0.5 text-[9px] font-black uppercase"
          style={{ borderColor: tint(e.cor, 50), color: e.cor, background: tint(e.cor, 14) }}>{e.selo}</span>
      )}
    </div>,
    document.body,
  ) : null;

  return {
    ref: (el: HTMLElement | null) => { alvo.current = el; },
    handlers: { onMouseEnter: abrir, onMouseLeave: fechar, onFocus: abrir, onBlur: fechar },
    cartao,
  };
}

// ───────────────────────── peças ─────────────────────────

/** Chip de uma linha (visão Mês). */
function ChipEvento({ e, onAbrir }: { e: EventoCal; onAbrir: (e: EventoCal) => void }) {
  const c = useCartaoDoEvento(e);
  return (
    <>
      <button type="button" ref={c.ref as any} {...c.handlers}
        onClick={ev => { ev.stopPropagation(); onAbrir(e); }}
        className="w-full flex items-center gap-1 rounded px-1.5 py-[3px] text-left text-[10px] font-bold transition-[filter] hover:brightness-110"
        style={{ background: solido(e), color: textoSobre(e.cor) }}>
        {e.hora && <span className="tabular-nums opacity-80 flex-shrink-0">{e.hora.slice(0, 5)}</span>}
        <span className="truncate">{e.titulo}</span>
      </button>
      {c.cartao}
    </>
  );
}

/** Bloco posicionado na grade de horas. */
function BlocoEvento({ t, col, cols, onAbrir }: { t: Trecho; col: number; cols: number; onAbrir: (e: EventoCal) => void }) {
  const e = t.evento;
  const c = useCartaoDoEvento(e);
  const alto = Math.max(22, ((t.fim - t.ini) / 60) * PX_HORA - 2);
  const baixo = alto < 40;
  return (
    <>
      <button type="button" ref={c.ref as any} {...c.handlers}
        onClick={ev => { ev.stopPropagation(); onAbrir(e); }}
        aria-label={`${e.titulo}, ${horarioTexto(e)}`}
        className="absolute overflow-hidden rounded-md px-2 py-1.5 text-left transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-lumos-yellow"
        style={{
          top: (t.ini / 60) * PX_HORA + 1, height: alto,
          left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`,
          background: solido(e), color: textoSobre(e.cor),
          boxShadow: '0 0 0 1px var(--color-lumos-surface)',
          ...(t.continuacao ? { borderTop: '3px dashed rgba(0,0,0,0.35)' } : {}),
        }}>
        <span className={clsx('block text-[11px] font-black leading-snug break-words', baixo ? 'truncate' : 'line-clamp-3')}>
          {t.continuacao && '↳ '}{e.titulo}
        </span>
        {!baixo && (
          <span className="block mt-0.5 text-[10px] font-semibold leading-snug tabular-nums opacity-85">
            {t.continuacao ? `até ${hhmm(t.fim)}` : t.continua ? `${hhmm(t.ini)} → dia seguinte` : `${hhmm(t.ini)} – ${hhmm(t.fim)}`}
          </span>
        )}
        {!baixo && e.subtitulo && <span className="block mt-0.5 text-[10px] leading-snug break-words line-clamp-3 opacity-85">{e.subtitulo}</span>}
      </button>
      {c.cartao}
    </>
  );
}

/** Linha de lista (celular, e dia escolhido no Mês do celular). */
function LinhaEvento({ e, onAbrir }: { e: EventoCal; onAbrir: (e: EventoCal) => void }) {
  return (
    <button type="button" onClick={() => onAbrir(e)}
      className={clsx('w-full flex items-stretch gap-3 px-3 py-2.5 text-left hover:bg-lumos-text-primary/5 border-b border-lumos-border/50 last:border-0', e.passado && 'opacity-60')}>
      <span className="w-1 rounded-full flex-shrink-0" style={{ background: e.cor }} />
      <span className="w-[74px] flex-shrink-0 text-[11px] font-black tabular-nums text-lumos-text-primary leading-snug">
        {e.hora ? <>{e.hora.slice(0, 5)}{e.horaFim && <span className="block font-semibold text-lumos-text-secondary">{e.horaFim.slice(0, 5)}</span>}</> : <span className="font-semibold text-lumos-text-secondary">Dia todo</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-bold text-lumos-text-primary truncate">{e.titulo}</span>
        {e.subtitulo && <span className="block text-[10.5px] text-lumos-text-secondary truncate">{e.subtitulo}</span>}
      </span>
      {e.selo && (
        <span className="self-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase flex-shrink-0"
          style={{ borderColor: tint(e.cor, 50), color: e.cor, background: tint(e.cor, 14) }}>{e.selo}</span>
      )}
    </button>
  );
}

// ───────────────────────── componente ─────────────────────────

interface Props {
  eventos: EventoCal[];
  gran: Granularidade;
  cursor: Date;
  onAbrir: (e: EventoCal) => void;
  /** Clique no número do dia ou em "+N mais": a tela costuma abrir o Dia. */
  onEscolherDia?: (d: Date) => void;
  /** Clique num espaço vazio (com hora, na grade): criar algo ali. */
  onNovoNoDia?: (dataIso: string, hora?: string) => void;
  /** Dia fechado (agenda bloqueada): devolve o motivo/rótulo, ou null se está aberto. */
  diaFechado?: (dataIso: string) => string | null;
  className?: string;
}

export default function CalendarioEventos({ eventos, gran, cursor, onAbrir, onEscolherDia, onNovoNoDia, diaFechado, className }: Props) {
  const desktop = useMediaQuery('(min-width: 768px)');
  const hoje = hojeIso();
  const dias = useMemo(() => diasDaJanela(cursor, gran), [cursor, gran]);

  const porDia = useMemo(() => {
    const m = new Map<string, EventoCal[]>();
    for (const e of eventos) {
      if (!m.has(e.data)) m.set(e.data, []);
      m.get(e.data)!.push(e);
    }
    for (const l of m.values()) l.sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99') || a.titulo.localeCompare(b.titulo, 'pt-BR'));
    return m;
  }, [eventos]);

  // ── celular ─────────────────────────────────────────────────────────────
  const [diaCel, setDiaCel] = useState<string>(() => hoje);
  useEffect(() => {
    // Ao mudar de mês, o dia escolhido acompanha: hoje se estiver no mês, senão o dia 1.
    if (gran !== 'mes') return;
    const noMes = (iso: string) => { const d = dataDeIso(iso); return d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear(); };
    if (!noMes(diaCel)) setDiaCel(noMes(hoje) ? hoje : isoDe(new Date(cursor.getFullYear(), cursor.getMonth(), 1)));
  }, [cursor, gran]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── grade de horas: rola até o primeiro compromisso do período ─────────────
  const scroll = useRef<HTMLDivElement>(null);
  const isosVisiveis = useMemo(() => new Set(dias.map(isoDe)), [dias]);
  useEffect(() => {
    if (gran === 'mes' || !scroll.current) return;
    const inicios = eventos.filter(e => isosVisiveis.has(e.data) && e.hora).map(e => minDe(e.hora)!);
    const alvo = inicios.length ? Math.max(0, Math.min(...inicios) - 60) : 7 * 60;
    scroll.current.scrollTop = (alvo / 60) * PX_HORA;
  }, [gran, cursor, desktop]); // eslint-disable-line react-hooks/exhaustive-deps

  // linha do "agora"
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setAgora(new Date()), 60000); return () => window.clearInterval(t); }, []);
  const minAgora = agora.getHours() * 60 + agora.getMinutes();

  const fechado = (iso: string) => diaFechado?.(iso) ?? null;

  // ═════════ CELULAR ═════════
  if (!desktop) {
    if (gran === 'mes') {
      const lista = porDia.get(diaCel) || [];
      return (
        <div className={clsx('space-y-3', className)}>
          <div className="card !p-2">
            <div className="grid grid-cols-7 mb-1">
              {DIAS_CURTOS.map(d => <div key={d} className="text-center text-[9px] font-black uppercase text-lumos-text-secondary py-1">{d.charAt(0)}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {dias.map(d => {
                const iso = isoDe(d);
                const doDia = porDia.get(iso) || [];
                const fora = d.getMonth() !== cursor.getMonth();
                const sel = iso === diaCel;
                return (
                  <button key={iso} type="button" onClick={() => setDiaCel(iso)}
                    className={clsx('relative flex flex-col items-center gap-1 rounded-lumos py-1.5', fora && 'opacity-35', sel && 'bg-lumos-yellow/15 ring-1 ring-lumos-yellow/60', fechado(iso) && 'bg-lumos-text-primary/5')}>
                    <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold tabular-nums',
                      iso === hoje ? 'bg-lumos-yellow text-[#161616] font-black' : 'text-lumos-text-primary')}>{d.getDate()}</span>
                    <span className="flex h-1.5 gap-0.5">
                      {doDia.slice(0, 3).map(e => <span key={e.id} className="h-1.5 w-1.5 rounded-full" style={{ background: e.cor }} />)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card !p-0 overflow-hidden">
            <p className="flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary border-b border-lumos-border">
              {DIAS_LONGOS[dataDeIso(diaCel).getDay()]}, {dataDeIso(diaCel).getDate()} de {MESES_CURTOS[dataDeIso(diaCel).getMonth()]}
              {diaCel === hoje && <span className="text-lumos-yellow">· hoje</span>}
              {fechado(diaCel) && <span className="text-amber-500 normal-case tracking-normal font-bold">· {fechado(diaCel)}</span>}
              {onNovoNoDia && (
                <button type="button" onClick={() => onNovoNoDia(diaCel)} className="ml-auto flex items-center gap-1 text-lumos-yellow normal-case tracking-normal font-bold">
                  <Plus className="w-3 h-3" /> Novo
                </button>
              )}
            </p>
            {lista.length === 0
              ? <p className="px-3 py-5 text-center text-xs italic text-lumos-text-secondary">Nada neste dia.</p>
              : lista.map(e => <LinhaEvento key={e.id} e={e} onAbrir={onAbrir} />)}
          </div>
        </div>
      );
    }
    // semana / dia: lista por dia
    const comEventos = dias.filter(d => (porDia.get(isoDe(d)) || []).length > 0 || gran === 'dia');
    return (
      <div className={clsx('space-y-3', className)}>
        {comEventos.length === 0 && (
          <div className="card p-6 text-center">
            <CalendarDays className="w-7 h-7 text-lumos-text-secondary/30 mx-auto mb-2" />
            <p className="text-sm font-bold text-lumos-text-primary">Nada com data neste período.</p>
          </div>
        )}
        {comEventos.map(d => {
          const iso = isoDe(d);
          const doDia = porDia.get(iso) || [];
          return (
            <div key={iso} className="card !p-0 overflow-hidden">
              <p className={clsx('flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest border-b border-lumos-border',
                iso === hoje ? 'text-lumos-yellow' : 'text-lumos-text-secondary')}>
                {DIAS_LONGOS[d.getDay()]}, {d.getDate()} de {MESES_CURTOS[d.getMonth()]}{iso === hoje && ' · hoje'}
                {fechado(iso) && <span className="text-amber-500 normal-case tracking-normal font-bold">· {fechado(iso)}</span>}
              </p>
              {doDia.length === 0
                ? <p className="px-3 py-5 text-center text-xs italic text-lumos-text-secondary">Nada neste dia.</p>
                : doDia.map(e => <LinhaEvento key={e.id} e={e} onAbrir={onAbrir} />)}
            </div>
          );
        })}
      </div>
    );
  }

  // ═════════ DESKTOP · MÊS ═════════
  if (gran === 'mes') {
    return (
      <div className={clsx('card !p-0 overflow-hidden', className)}>
        <div className="grid grid-cols-7 border-b border-lumos-border">
          {DIAS_LONGOS.map(d => (
            <div key={d} className="px-2 py-2 text-center text-[9.5px] font-black uppercase tracking-wider text-lumos-text-secondary">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {dias.map((d, idx) => {
            const iso = isoDe(d);
            const doDia = porDia.get(iso) || [];
            const fora = d.getMonth() !== cursor.getMonth();
            const motivo = fechado(iso);
            return (
              <div key={iso} title={motivo ? `Agenda fechada: ${motivo}` : undefined}
                onClick={() => onNovoNoDia?.(iso)}
                className={clsx('group min-h-[112px] border-b border-lumos-border/60 p-1.5 space-y-1',
                  idx % 7 !== 6 && 'border-r', fora && 'opacity-40', iso === hoje && 'bg-lumos-yellow/[0.06]',
                  motivo && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgba(127,127,127,0.08)_6px,rgba(127,127,127,0.08)_12px)]',
                  onNovoNoDia && 'cursor-pointer')}>
                <div className="flex items-center">
                  <button type="button" onClick={ev => { ev.stopPropagation(); onEscolherDia?.(d); }}
                    className={clsx('flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[11.5px] font-bold tabular-nums',
                      iso === hoje ? 'bg-lumos-yellow text-[#161616] font-black' : 'text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-primary/10')}>
                    {d.getDate()}
                  </button>
                  {onNovoNoDia && (
                    <Plus className="ml-auto h-3.5 w-3.5 text-lumos-text-secondary opacity-0 group-hover:opacity-60 transition-opacity" />
                  )}
                </div>
                {doDia.slice(0, 3).map(e => <ChipEvento key={e.id} e={e} onAbrir={onAbrir} />)}
                {doDia.length > 3 && (
                  <button type="button" onClick={ev => { ev.stopPropagation(); onEscolherDia?.(d); }}
                    className="px-1 text-[10px] font-black text-lumos-text-secondary hover:text-lumos-yellow">+ {doDia.length - 3} mais</button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ═════════ DESKTOP · SEMANA / DIA (grade de horas) ═════════
  const colunas = dias.map(d => isoDe(d));
  const trechosPorDia = new Map<string, Trecho[]>();
  for (const e of eventos) for (const t of trechosDoEvento(e)) {
    if (!isosVisiveis.has(t.dia)) continue;
    if (!trechosPorDia.has(t.dia)) trechosPorDia.set(t.dia, []);
    trechosPorDia.get(t.dia)!.push(t);
  }
  const diaTodo = (iso: string) => (porDia.get(iso) || []).filter(e => !e.hora);
  const temDiaTodo = colunas.some(iso => diaTodo(iso).length > 0);
  const cols = `52px repeat(${colunas.length}, minmax(0, 1fr))`;

  return (
    <div className={clsx('card !p-0 overflow-hidden', className)}>
      {/* cabeçalho dos dias */}
      <div className="grid border-b border-lumos-border" style={{ gridTemplateColumns: cols }}>
        <div />
        {dias.map(d => {
          const iso = isoDe(d);
          const motivo = fechado(iso);
          return (
            <button key={iso} type="button" onClick={() => gran === 'semana' && onEscolherDia?.(d)}
              className={clsx('py-2 text-center border-l border-lumos-border/60', gran === 'semana' && onEscolherDia && 'hover:bg-lumos-text-primary/5', motivo && 'bg-lumos-text-primary/5')}
              title={motivo ? `Agenda fechada: ${motivo}` : undefined}>
              <span className="block text-[9.5px] font-black uppercase tracking-wider text-lumos-text-secondary">{DIAS_LONGOS[d.getDay()]}</span>
              <span className={clsx('mx-auto mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[14px] font-bold tabular-nums',
                iso === hoje ? 'bg-lumos-yellow text-[#161616] font-black' : 'text-lumos-text-primary')}>{d.getDate()}</span>
              {motivo && <span className="block text-[9px] font-bold text-amber-500 truncate px-1">{motivo}</span>}
            </button>
          );
        })}
      </div>

      {/* faixa "dia todo" / sem hora */}
      {temDiaTodo && (
        <div className="grid border-b border-lumos-border bg-lumos-text-primary/[0.02]" style={{ gridTemplateColumns: cols }}>
          <div className="px-1 py-1.5 text-right text-[9px] font-black uppercase text-lumos-text-secondary leading-tight">sem hora</div>
          {colunas.map(iso => (
            <div key={iso} className="border-l border-lumos-border/60 p-1 space-y-1 min-h-[30px]">
              {diaTodo(iso).map(e => <ChipEvento key={e.id} e={e} onAbrir={onAbrir} />)}
            </div>
          ))}
        </div>
      )}

      {/* grade de horas */}
      <div ref={scroll} className="max-h-[68vh] overflow-y-auto">
        <div className="grid relative" style={{ gridTemplateColumns: cols }}>
          <div>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="relative text-right pr-1.5" style={{ height: PX_HORA }}>
                {h > 0 && <span className="absolute -top-[7px] right-1.5 text-[9.5px] tabular-nums text-lumos-text-secondary">{String(h).padStart(2, '0')}:00</span>}
              </div>
            ))}
          </div>
          {colunas.map(iso => {
            const motivo = fechado(iso);
            const itens = empilhar(trechosPorDia.get(iso) || []);
            return (
              <div key={iso}
                className={clsx('relative border-l border-lumos-border/60', onNovoNoDia && 'cursor-pointer', iso === hoje && 'bg-lumos-yellow/[0.04]',
                  motivo && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgba(127,127,127,0.07)_6px,rgba(127,127,127,0.07)_12px)]')}
                style={{
                  height: 24 * PX_HORA,
                  backgroundImage: 'linear-gradient(to bottom, var(--color-lumos-border) 1px, transparent 1px)',
                  backgroundSize: `100% ${PX_HORA}px`,
                }}
                onClick={ev => {
                  if (!onNovoNoDia) return;
                  const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                  onNovoNoDia(iso, `${String(Math.min(23, Math.floor(y / PX_HORA))).padStart(2, '0')}:00`);
                }}>
                {itens.map(({ t, col, cols: n }) => (
                  <BlocoEvento key={`${t.evento.id}-${t.dia}`} t={t} col={col} cols={n} onAbrir={onAbrir} />
                ))}
                {iso === hoje && (
                  <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: (minAgora / 60) * PX_HORA }}>
                    <div className="h-[2px] bg-red-500" />
                    <span className="absolute -left-1 -top-[4px] h-2.5 w-2.5 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── barra de navegação (título, setas, Hoje, Mês/Semana/Dia) ─────────────────────────

export function BarraDoCalendario({
  cursor, gran, onCursor, onGran, extra,
}: {
  cursor: Date;
  gran: Granularidade;
  onCursor: (d: Date) => void;
  onGran: (g: Granularidade) => void;
  /** Botões à direita (ex.: filtros da tela). */
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" onClick={() => onCursor(navegarJanela(cursor, gran, -1))} aria-label="Anterior"
        className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary"><ChevronLeft className="w-4 h-4" /></button>
      <button type="button" onClick={() => onCursor(navegarJanela(cursor, gran, 1))} aria-label="Próximo"
        className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary"><ChevronRight className="w-4 h-4" /></button>
      <p className="text-sm font-black text-lumos-text-primary capitalize">{tituloDaJanela(cursor, gran)}</p>
      <div className="ml-auto flex items-center gap-1.5 flex-wrap">
        {extra}
        <button type="button" onClick={() => onCursor(new Date())}
          className="h-8 px-3 rounded-lumos border border-lumos-border text-[11px] font-black text-lumos-text-secondary hover:text-lumos-text-primary">Hoje</button>
        <div className="segmentado-lumos flex items-center border border-lumos-border rounded-lumos overflow-hidden">
          {([['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => onGran(key)} aria-pressed={gran === key}
              className={clsx('segmento-lumos h-8 px-3 text-[10.5px] font-black uppercase transition-colors',
                gran === key ? 'bg-lumos-text-primary/10 text-lumos-text-primary' : 'text-lumos-text-secondary hover:text-lumos-text-primary')}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

