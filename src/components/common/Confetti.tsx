import { useEffect, useRef } from 'react';

interface Props {
  /** Duração total em ms (fade-out no último segundo). */
  duration?: number;
  onDone?: () => void;
}

// Confete full-screen em canvas — sem dependência externa (CSP-safe). Cai por
// cima de tudo, sem bloquear cliques (pointer-events-none).
export default function Confetti({ duration = 6000, onDone }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);

    const colors = ['#EFC700', '#22c55e', '#3b82f6', '#ec4899', '#f97316', '#a855f7', '#ffffff'];
    const count = Math.min(240, Math.max(90, Math.floor(w / 6)));
    const parts = Array.from({ length: count }).map(() => ({
      x: Math.random() * w,
      y: Math.random() * -h,
      r: 4 + Math.random() * 7,
      c: colors[(Math.random() * colors.length) | 0],
      vx: -1.2 + Math.random() * 2.4,
      vy: 2 + Math.random() * 4.5,
      rot: Math.random() * Math.PI,
      vr: -0.12 + Math.random() * 0.24,
      rect: Math.random() > 0.45,
    }));

    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const elapsed = t - start;
      const fade = elapsed > duration - 1200 ? Math.max(0, (duration - elapsed) / 1200) : 1;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.rot += p.vr;
        if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w; p.vy = 2 + Math.random() * 4.5; }
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        if (p.rect) ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
        else { ctx.beginPath(); ctx.arc(0, 0, p.r / 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      if (elapsed < duration) raf = requestAnimationFrame(tick);
      else { ctx.clearRect(0, 0, w, h); doneRef.current?.(); }
    };
    raf = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [duration]);

  return <canvas ref={ref} className="fixed inset-0 z-[300] pointer-events-none" aria-hidden />;
}
