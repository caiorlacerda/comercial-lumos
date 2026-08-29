// Utilitários compartilhados entre a revisão pública (cliente) e a interna (time).
export type Point = { x: number; y: number }; // normalizados 0–1
export type Shape = { type: 'draw' | 'arrow' | 'rect'; color: string; points: Point[] };

// Vermelho primeiro: marcação em revisão é pedido de atenção, e o amarelo da
// marca se confunde com legenda e com elemento gráfico amarelo no vídeo.
export const COLORS = ['#ef4444', '#EFC700', '#3b82f6', '#22c55e', '#ffffff'];
export const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
export const STREAM_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/review-stream`;

// Timecode de edição no formato hh:mm:ss:ff (pedido do time: apontar o corte
// no frame exato, como no frame.io). O fps vem de estimarFps; 25 é o padrão
// enquanto o vídeo não roda.
export const timecode = (ms: number, fps = 25) => {
  const totalS = Math.floor(ms / 1000);
  const h = Math.floor(totalS / 3600), m = Math.floor((totalS % 3600) / 60), s = totalS % 60;
  const ff = Math.min(Math.max(Math.round(fps) - 1, 0), Math.floor(((ms / 1000) % 1) * fps));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(ff)}`;
};

// Mede o fps real do vídeo observando os frames apresentados (só funciona com
// o vídeo tocando). Arredonda pro fps de produção mais próximo; sem suporte do
// navegador, fica nos 25.
export function estimarFps(video: HTMLVideoElement, onFps: (fps: number) => void) {
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => void };
  if (typeof v.requestVideoFrameCallback !== 'function') { onFps(25); return; }
  const deltas: number[] = [];
  let ultimo = -1;
  const tick = (_now: number, meta: { mediaTime: number }) => {
    if (ultimo >= 0 && meta.mediaTime > ultimo) deltas.push(meta.mediaTime - ultimo);
    ultimo = meta.mediaTime;
    if (deltas.length < 12) { v.requestVideoFrameCallback!(tick); return; }
    deltas.sort((a, b) => a - b);
    const bruto = 1 / deltas[Math.floor(deltas.length / 2)];
    const comuns = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
    onFps(comuns.reduce((melhor, c) => (Math.abs(c - bruto) < Math.abs(melhor - bruto) ? c : melhor), 25));
  };
  v.requestVideoFrameCallback!(tick);
}

export const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h > 0 ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

/**
 * Espessura do traço em função do tamanho do canvas.
 *
 * Era 3px fixos, e 3px num canvas de 1920 é um fio de cabelo: a marcação
 * sumia justamente no player grande, que é onde a revisão acontece. Agora
 * acompanha a largura, então o traço tem o mesmo peso visual em qualquer
 * tamanho de tela.
 */
const espessura = (w: number) => Math.max(3, Math.round(w * 0.0045));

/**
 * Desenha duas vezes: um contorno escuro embaixo e a cor por cima.
 *
 * Sem isso, traço vermelho sobre cena escura e traço branco sobre céu claro
 * somem. O contorno garante que a marcação seja lida em qualquer imagem, que é
 * o pulo do gato dos players de revisão bons.
 */
function traçar(ctx: CanvasRenderingContext2D, cor: string, largura: number, desenhar: () => void) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = largura + Math.max(2, largura * 0.6);
  desenhar();
  ctx.strokeStyle = cor;
  ctx.lineWidth = largura;
  desenhar();
}

export function drawShape(ctx: CanvasRenderingContext2D, sh: Shape, w: number, h: number) {
  const lw = espessura(w);
  ctx.fillStyle = sh.color;
  const pts = sh.points.map(p => ({ x: p.x * w, y: p.y * h }));
  if (pts.length === 0) return;

  if (sh.type === 'draw') {
    traçar(ctx, sh.color, lw, () => {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
    });
  } else if (pts.length >= 2) {
    const [a, b] = [pts[0], pts[1]];
    if (sh.type === 'rect') {
      traçar(ctx, sh.color, lw, () => { ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); });
    } else { // seta
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = lw * 4.2;
      // A haste para antes da ponta, senão o traço vaza por dentro da cabeça e
      // engorda o bico.
      const fim = { x: b.x - head * 0.55 * Math.cos(ang), y: b.y - head * 0.55 * Math.sin(ang) };
      traçar(ctx, sh.color, lw, () => {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(fim.x, fim.y); ctx.stroke();
      });
      const cabeça = () => {
        ctx.beginPath(); ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
        ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
        ctx.closePath();
      };
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = Math.max(2, lw * 0.6);
      cabeça(); ctx.stroke();
      ctx.fillStyle = sh.color;
      cabeça(); ctx.fill();
    }
  }
}
