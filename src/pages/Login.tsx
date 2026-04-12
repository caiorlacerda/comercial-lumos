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

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-lumos-bg px-4 transition-colors duration-300">
      <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-700">
        {/* Logo/Brand */}
        <div className="text-center mb-10 flex flex-col items-center">
          <img 
            src={theme === 'dark' ? "/logo/Logotipo-Branco-Alpha.svg" : "/logo/Logotipo-Preto-Alpha.svg"} 
            alt="Lumos Logo" 
            className="h-14 mb-4 transition-all duration-300" 
          />
          <p className="text-lumos-text-secondary font-black uppercase tracking-[0.2em] text-[10px]">
            Proposta — Plataforma Interna
          </p>
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

          <p className="mt-8 text-center text-[10px] font-bold text-lumos-text-secondary uppercase tracking-tighter opacity-50">
            Acesso restrito a administradores Produtora Lumos.
          </p>
        </div>
      </div>
    </div>
  );
}
