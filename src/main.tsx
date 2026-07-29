import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ThemeProvider } from '@/context/ThemeContext.tsx'
import { ToastProvider } from '@/context/ToastContext.tsx'
import './index.css'
import { GoogleOAuthProvider } from '@react-oauth/google'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Recuperação de falha ao carregar um chunk de rota (lazy). Isso acontece após
// um novo deploy, quando o hash do arquivo antigo some do servidor e o service
// worker/aba servem um índice desatualizado — resultava em TELA PRETA. Em vez
// disso, recarregamos uma vez pra pegar os arquivos novos (com guarda anti-loop
// pra nunca ficar recarregando sem parar).
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const KEY = 'lumos_chunk_reload_at';
  const last = Number(sessionStorage.getItem(KEY) || '0');
  if (Date.now() - last > 10000) {
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>,
)
