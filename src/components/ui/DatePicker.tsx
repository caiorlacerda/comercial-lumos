import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { format, startOfMonth, endOfMonth, getDay, addMonths, subMonths, isSameDay, isSameMonth, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

interface Props {
  /** ISO: 'YYYY-MM-DD' no modo 'date', 'YYYY-MM' ou 'YYYY-MM-DD' no modo 'month' (dia é ignorado). */
  value: string | null | undefined;
  /** Sempre devolve ISO 'YYYY-MM-DD' (dia 01 no modo month), ou null se limpar. */
  onChange: (value: string | null) => void;
  mode?: 'date' | 'month';
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  min?: string;
  max?: string;
  align?: 'left' | 'right';
}

function parseValue(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = value.length === 7 ? `${value}-01` : value;
  const d = parseISO(iso);
  return isValid(d) ? d : null;
}

function toISO(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Seletor de data/mês com a cara do app, em vez do calendário nativo do
 * navegador — mesmo padrão de popover em portal do AssigneePicker.
 */
export default function DatePicker({ value, onChange, mode = 'date', disabled, placeholder, className, min, max, align = 'left' }: Props) {
  const [open, setOpen] = useState(false);
  const selected = parseValue(value);
  const [view, setView] = useState<Date>(() => selected || new Date());
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const minDate = min ? parseValue(min) : null;
  const maxDate = max ? parseValue(max) : null;

  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const estH = mode === 'month' ? 220 : 320;
    const openUp = r.bottom + 4 + estH > window.innerHeight - 8 && r.top - estH - 4 > 8;
    setPos({ top: openUp ? r.top - estH - 4 : r.bottom + 4, left: r.left, width: r.width });
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    setView(selected || new Date());
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (date: Date) => { onChange(toISO(date)); setOpen(false); };
  const clear = (e: React.MouseEvent) => { e.stopPropagation(); onChange(null); setOpen(false); };

  const isOutOfRange = (d: Date) => (minDate && d < minDate) || (maxDate && d > maxDate);

  const label = !selected ? (placeholder ?? 'Selecionar') : mode === 'month'
    ? format(selected, 'MMM/yyyy', { locale: ptBR })
    : format(selected, 'dd/MM/yyyy', { locale: ptBR });

  // ── Grade de meses ──────────────────────────────────────────────────────
  const renderMonthGrid = () => (
    <>
      <div className="flex items-center justify-between mb-2 px-1">
        <button type="button" onClick={e => { e.stopPropagation(); setView(v => subMonths(v, 12)); }}
          className="p-1 rounded hover:bg-lumos-text-secondary/10 text-lumos-text-secondary">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-bold text-lumos-text-primary">{format(view, 'yyyy')}</span>
        <button type="button" onClick={e => { e.stopPropagation(); setView(v => addMonths(v, 12)); }}
          className="p-1 rounded hover:bg-lumos-text-secondary/10 text-lumos-text-secondary">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {MESES.map((m, i) => {
          const d = new Date(view.getFullYear(), i, 1);
          const isSel = selected && d.getFullYear() === selected.getFullYear() && d.getMonth() === selected.getMonth();
          const disabledCell = isOutOfRange(endOfMonth(d)) || (minDate && endOfMonth(d) < minDate);
          return (
            <button
              key={m} type="button" disabled={!!disabledCell}
              onClick={e => { e.stopPropagation(); pick(d); }}
              className={clsx('text-xs font-semibold py-2 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                isSel ? 'bg-lumos-yellow text-black' : 'text-lumos-text-primary hover:bg-lumos-text-secondary/10')}
            >
              {m}
            </button>
          );
        })}
      </div>
    </>
  );

  // ── Grade de dias ───────────────────────────────────────────────────────
  const renderDayGrid = () => {
    const start = startOfMonth(view);
    const end = endOfMonth(view);
    const leading = getDay(start);
    const totalDays = end.getDate();
    const cells: Date[] = [];
    for (let i = 0; i < leading; i++) cells.push(new Date(start.getFullYear(), start.getMonth(), i - leading + 1));
    for (let d = 1; d <= totalDays; d++) cells.push(new Date(start.getFullYear(), start.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(new Date(start.getFullYear(), start.getMonth(), totalDays + (cells.length - leading - totalDays) + 1));

    return (
      <>
        <div className="flex items-center justify-between mb-2 px-1">
          <button type="button" onClick={e => { e.stopPropagation(); setView(v => subMonths(v, 1)); }}
            className="p-1 rounded hover:bg-lumos-text-secondary/10 text-lumos-text-secondary">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-bold text-lumos-text-primary capitalize">{format(view, 'MMMM yyyy', { locale: ptBR })}</span>
          <button type="button" onClick={e => { e.stopPropagation(); setView(v => addMonths(v, 1)); }}
            className="p-1 rounded hover:bg-lumos-text-secondary/10 text-lumos-text-secondary">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {DIAS_SEMANA.map((d, i) => (
            <span key={i} className="text-[10px] font-bold text-lumos-text-secondary text-center py-1">{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((d, i) => {
            const inMonth = isSameMonth(d, view);
            const isSel = selected && isSameDay(d, selected);
            const isToday = isSameDay(d, new Date());
            const disabledCell = isOutOfRange(d);
            return (
              <button
                key={i} type="button" disabled={!!disabledCell}
                onClick={e => { e.stopPropagation(); pick(d); }}
                className={clsx('text-xs h-8 w-8 rounded transition-colors disabled:opacity-25 disabled:cursor-not-allowed',
                  !inMonth && 'text-lumos-text-secondary/40',
                  inMonth && !isSel && 'text-lumos-text-primary hover:bg-lumos-text-secondary/10',
                  isSel && 'bg-lumos-yellow text-black font-bold',
                  !isSel && isToday && inMonth && 'ring-1 ring-lumos-yellow/50')}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <>
      <button
        ref={triggerRef} type="button" disabled={disabled}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={clsx(
          'input-lumos flex items-center justify-between gap-2 text-left disabled:opacity-70',
          !selected && 'text-lumos-text-secondary',
          className ?? 'w-full text-xs',
        )}
      >
        <span className="truncate">{label}</span>
        <Calendar className="w-3.5 h-3.5 flex-shrink-0 text-lumos-text-secondary" />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: pos.top, minWidth: Math.max(pos.width, mode === 'month' ? 220 : 248),
            left: align === 'right' ? undefined : pos.left,
            right: align === 'right' ? Math.max(8, window.innerWidth - (pos.left + pos.width)) : undefined,
          }}
          className="z-[200] bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-2"
        >
          {mode === 'month' ? renderMonthGrid() : renderDayGrid()}
          {selected && (
            <button type="button" onClick={clear}
              className="w-full text-center text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-yellow transition-colors mt-2 pt-2 border-t border-lumos-border/60">
              Limpar
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
