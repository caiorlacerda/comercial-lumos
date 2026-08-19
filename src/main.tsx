import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ThemeProvider } from '@/context/ThemeContext.tsx'
import { ToastProvider } from '@/context/ToastContext.tsx'
import { PrivacyProvider } from '@/context/PrivacyContext.tsx'
import './index.css'
import { GoogleOAuthProvider } from '@react-oauth/google'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// ── Auto-recuperação de build desatualizado ────────────────────────────────
// Depois de um deploy, os arquivos de /assets ganham hash novo e os antigos
// somem. Uma aba (ou o service worker) segurando o índice velho pede arquivos
// que não existem mais: dava TELA PRETA (JS) ou a página SEM ESTILO (CSS).
// Aqui a gente limpa o cache do PWA e recarrega uma única vez.
const RELOAD_KEY = 'lumos_recover_at';
const RELOAD_TRIES = 'lumos_recover_tries';

async function recoverStaleBuild(motivo: string) {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || '0');
  const tries = Number(sessionStorage.getItem(RELOAD_TRIES) || '0');
  // Guarda anti-loop: no máximo 2 tentativas, e nunca duas em menos de 10s.
  if (Date.now() - last < 10000 || tries >= 2) return;
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  sessionStorage.setItem(RELOAD_TRIES, String(tries + 1));
  console.warn(`[lumos] build desatualizado (${motivo}); limpando cache e recarregando…`);
  try {
    // O service worker do PWA é quem costuma servir o índice velho.
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs || []).map(r => r.unregister()));
    const keys = await caches?.keys?.();
    await Promise.all((keys || []).map(k => caches.delete(k)));
  } catch { /* segue pro reload mesmo assim */ }
  window.location.reload();
}

// 1) Chunk de rota (lazy) que não carregou.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  void recoverStaleBuild('chunk de rota');
});

// 2) Folha de estilo que não chegou. O índice velho aponta pra um CSS que já
//    não existe: a página abre com a cara "sem CSS" (foi o que o time viu).
//    O sinalizador --lumos-css-ok vive no index.css.
function checarCss() {
  const ok = getComputedStyle(document.documentElement).getPropertyValue('--lumos-css-ok').trim() === '1';
  if (!ok) void recoverStaleBuild('CSS não carregou');
}
if (document.readyState === 'complete') checarCss();
else window.addEventListener('load', checarCss);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <ThemeProvider>
        <ToastProvider>
          <PrivacyProvider>
            <App />
          </PrivacyProvider>
        </ToastProvider>
      </ThemeProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>,
)
