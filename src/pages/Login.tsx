import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { clsx } from 'clsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeoutMessage, setTimeoutMessage] = useState(false);
  // "Esqueci minha senha": form embutido no card. A resposta é sempre a mesma
  // (genérica), independente do e-mail existir — quem decide o que enviar é a
  // edge function forgot-password (redefinição ou reenvio de convite).
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('timeout') === 'true') {
      setTimeoutMessage(true);
    }
  }, [location]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      navigate('/');
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim() || forgotSending) return;
    setForgotSending(true);
    // Best-effort: mesmo se a função falhar, mostramos a mensagem genérica
    // (não dá pra saber daqui se o e-mail existe, e é assim que deve ser).
    await supabase.functions.invoke('forgot-password', { body: { email: forgotEmail.trim() } }).catch(() => {});
    setForgotSending(false);
    setForgotSent(true);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-lumos-bg px-4 transition-colors duration-300">
      <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-700">
        {/* Logo/Brand */}
        <div className="text-center mb-10 flex flex-col items-center">
          <img 
            src={theme === 'dark' ? "/logo/Logotipo-Branco-Alpha.svg" : "/logo/Logotipo-Preto-Alpha.svg"} 
            alt="Lumos Logo" 
            className="h-14 transition-all duration-300" 
          />
        </div>

        {/* Login Card */}
        <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-lumos-yellow" />
          
          <h2 className="text-2xl font-black mb-8 flex items-center gap-3 text-lumos-text-primary tracking-tight">
            <LogIn className="w-6 h-6 text-lumos-yellow" />
            Entrar
          </h2>

          {timeoutMessage && (
            <div className="mb-6 p-4 bg-lumos-yellow/10 border border-lumos-yellow/30 rounded-lumos text-lumos-yellow text-xs font-bold animate-in fade-in slide-in-from-top-2">
              Sua sessão expirou por inatividade. Por favor, faça login novamente.
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest mb-2">
                E-mail
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-lumos w-full h-12"
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest mb-2">
                Senha
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-lumos w-full h-12"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lumos text-red-500 text-sm font-medium animate-in shake-in duration-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 h-12 text-sm font-black uppercase tracking-widest shadow-lg shadow-lumos-yellow/20"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
              ) : (
                'Acessar Painel'
              )}
            </button>
          </form>

          {/* Esqueci minha senha */}
          <div className="mt-5">
            {!forgotOpen ? (
              <button
                type="button"
                onClick={() => { setForgotOpen(true); setForgotEmail(email); setForgotSent(false); }}
                className="w-full text-center text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-yellow transition-colors underline underline-offset-4"
              >
                Esqueci minha senha
              </button>
            ) : forgotSent ? (
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lumos text-green-500 text-xs font-bold animate-in fade-in slide-in-from-top-2">
                Se este e-mail estiver cadastrado, o link chega em instantes. Olhe também a caixa de spam. Se o seu convite estava pendente, vai chegar um convite novo.
              </div>
            ) : (
              <form onSubmit={handleForgot} className="p-4 bg-lumos-bg/40 border border-lumos-border rounded-lumos space-y-3 animate-in fade-in slide-in-from-top-2">
                <p className="text-[11px] font-bold text-lumos-text-primary">Digite seu e-mail e enviamos um link pra criar uma senha nova.</p>
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="input-lumos w-full h-10 text-sm"
                  placeholder="seu@email.com"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setForgotOpen(false)} className="btn-secondary flex-1 h-9 text-xs">Cancelar</button>
                  <button type="submit" disabled={forgotSending} className="btn-primary flex-1 h-9 text-xs font-black flex items-center justify-center gap-2">
                    {forgotSending ? <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : 'Enviar link'}
                  </button>
                </div>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-[10px] font-bold text-lumos-text-secondary uppercase tracking-tighter opacity-50">
            Acesso restrito a administradores Produtora Lumos.
          </p>
        </div>
      </div>
    </div>
  );
}
