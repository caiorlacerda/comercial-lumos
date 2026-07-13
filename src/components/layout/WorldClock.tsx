import { useEffect, useState } from 'react';
import { clsx } from 'clsx';

// Relógio duplo: horário de São Paulo (Brasil) e de Portugal (Lisboa/Porto —
// mesmo fuso). Útil porque temos gente trabalhando de Portugal no horário do BR.
const ZONES = [
  { key: 'br', flag: '🇧🇷', label: 'SP', tz: 'America/Sao_Paulo', city: 'São Paulo' },
  { key: 'pt', flag: '🇵🇹', label: 'PT', tz: 'Europe/Lisbon', city: 'Lisboa / Porto' },
];

function partsFor(tz: string, now: Date) {
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  // Offset em horas relativo ao horário local do usuário (pra mostrar a diferença).
  return { time };
}

export default function WorldClock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Alinha o tick à virada do minuto e depois atualiza a cada minuto.
    let interval: ReturnType<typeof setInterval>;
    const align = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, (60 - new Date().getSeconds()) * 1000);
    return () => { clearTimeout(align); if (interval) clearInterval(interval); };
  }, []);

  return (
    <div className={clsx('items-center gap-2', className)} title="São Paulo × Portugal">
      {ZONES.map((z, i) => (
        <div key={z.key} className="flex items-center gap-2">
          {i > 0 && <span className="text-lumos-border select-none">·</span>}
          <span className="flex items-center gap-1" title={z.city}>
            <span className="text-[13px] leading-none">{z.flag}</span>
            <span className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary">{z.label}</span>
            <span className="text-xs font-bold text-lumos-text-primary tabular-nums">{partsFor(z.tz, now).time}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
