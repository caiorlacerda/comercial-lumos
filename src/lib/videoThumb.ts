// Captura um frame de um vídeo (via <video> + canvas) e devolve um data URL JPEG.
// Usado para gerar a thumbnail da revisão, já que o Drive não gera thumbnail para
// arquivos da service account.
//
// O `src` precisa ser servido com CORS liberado (a review-stream manda
// Access-Control-Allow-Origin: *), e usamos crossOrigin para o canvas não ficar
// "tainted" — senão o toDataURL falha.
export async function captureVideoThumb(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.src = src;

    let settled = false;
    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      try { v.removeAttribute('src'); v.load(); } catch { /* ignora */ }
      resolve(val);
    };

    const grab = () => {
      try {
        const vw = v.videoWidth, vh = v.videoHeight;
        if (!vw || !vh) return finish(null);
        const w = 480, h = Math.round((w * vh) / vw);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return finish(null);
        ctx.drawImage(v, 0, 0, w, h);
        const url = c.toDataURL('image/jpeg', 0.6);
        finish(url && url.length > 200 ? url : null);
      } catch { finish(null); }
    };

    v.addEventListener('error', () => finish(null));
    v.addEventListener('loadedmetadata', () => {
      // Um pouco depois do início evita frame preto de abertura.
      const t = Math.min(1, (isFinite(v.duration) ? v.duration : 2) * 0.1);
      v.addEventListener('seeked', grab, { once: true });
      try { v.currentTime = t; } catch { grab(); }
    }, { once: true });

    // Trava de segurança: não deixa pendurado se o vídeo não carregar.
    setTimeout(() => finish(null), 15000);
  });
}
