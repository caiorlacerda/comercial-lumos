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

// ── Quando NÃO baixar o vídeo para tirar a capa ─────────────────────────────
// Capturar um frame significa baixar o vídeo pela review-stream, e isso sai da
// cota de egress do Supabase. Três regras para não gastar à toa:
//  1) vídeo já no Cloudflare Stream usa a capa do próprio Stream (sem Supabase);
//  2) arquivo grande ou .mov (ProRes) não vale a captura: pesa e quase sempre falha;
//  3) quem já falhou neste navegador não é tentado de novo a cada visita.

/** Capa do Cloudflare Stream a partir do endereço do manifesto HLS, ou null se o vídeo não está pronto lá. */
export function capaDoStream(hls?: string | null, status?: string | null): string | null {
  if (status !== 'pronto' || !hls) return null;
  const m = hls.match(/^(https:\/\/[^/]+\/[^/]+)\/manifest\//);
  return m ? `${m[1]}/thumbnails/thumbnail.jpg?time=1s&height=270` : null;
}

const LIMITE_CAPA_BYTES = 300 * 1024 * 1024;

/** Vale a pena baixar este arquivo só para tirar uma capa? */
export function valeCapturarCapa(v: { size_bytes?: number | null; file_name?: string | null; mime_type?: string | null }): boolean {
  if (v.size_bytes && v.size_bytes > LIMITE_CAPA_BYTES) return false;
  if (/\.mov$/i.test(v.file_name || '') || /quicktime/i.test(v.mime_type || '')) return false;
  return true;
}

const CHAVE_FALHAS = 'lumos:capa-falhou';
const lerFalhas = (): string[] => {
  try { const j = JSON.parse(localStorage.getItem(CHAVE_FALHAS) || '[]'); return Array.isArray(j) ? j : []; }
  catch { return []; }
};
export const capaJaFalhou = (id: string) => lerFalhas().includes(id);
export function marcarCapaFalhou(id: string) {
  try {
    const l = lerFalhas();
    if (!l.includes(id)) localStorage.setItem(CHAVE_FALHAS, JSON.stringify([...l, id].slice(-500)));
  } catch { /* sem localStorage: segue sem lembrar */ }
}
