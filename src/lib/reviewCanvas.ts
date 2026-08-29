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
      /**
       * Seta cheia, que ENGROSSA conforme você arrasta.
       *
       * Antes era uma linha de espessura fixa com um bico: setinha tímida, do
       * mesmo peso pra marcar um detalhe ou para apontar do outro lado da tela.
       * Aqui o corpo é uma forma só, preenchida, cuja largura vem do próprio
       * comprimento — arrastou mais longe, seta mais forte. É o que dá o gesto
       * de "olha ISSO aqui" sem precisar de contorno.
       *
       * Sem contorno de propósito: preenchida e grossa ela já se sustenta em
       * cima da imagem, e a borda escura só sujava a silhueta.
       */
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const comprimento = Math.hypot(b.x - a.x, b.y - a.y);

      // Cresce com o arrasto, com piso (marcação curta ainda aparece) e teto
      // (arrasto de ponta a ponta não vira uma mancha em cima da cena).
      const corpo = Math.min(Math.max(comprimento * 0.055, lw * 1.2), w * 0.022);
      const cabeçaL = corpo * 2.9;   // largura da cabeça
      const cabeçaC = corpo * 3.2;   // comprimento da cabeça

      const baseCabeça = {
        x: b.x - cabeçaC * Math.cos(ang),
        y: b.y - cabeçaC * Math.sin(ang),
      };
      // Perpendicular ao eixo da seta, pra abrir as laterais.
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      const rabo = corpo * 0.30;     // afina no início: dá direção sem precisar de outra cor

      ctx.fillStyle = sh.color;
      ctx.beginPath();
      ctx.moveTo(a.x + nx * rabo, a.y + ny * rabo);
      ctx.lineTo(baseCabeça.x + nx * corpo * 0.5, baseCabeça.y + ny * corpo * 0.5);
      ctx.lineTo(baseCabeça.x + nx * cabeçaL * 0.5, baseCabeça.y + ny * cabeçaL * 0.5);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(baseCabeça.x - nx * cabeçaL * 0.5, baseCabeça.y - ny * cabeçaL * 0.5);
      ctx.lineTo(baseCabeça.x - nx * corpo * 0.5, baseCabeça.y - ny * corpo * 0.5);
      ctx.lineTo(a.x - nx * rabo, a.y - ny * rabo);
      ctx.closePath();
      ctx.fill();
    }
  }
}
