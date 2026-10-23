import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate, useLocation } from 'react-router-dom';
import { carregarFontesDeck } from '@/lib/fontesDeck';
import SenhaInput from '@/components/common/SenhaInput';
import { lerManterConectado, definirManterConectado } from '@/lib/sessao';

// Visual do pitch deck da Lumos (skill lumos-pitch-deck): fundo de vidro canelado com luz
// dourada, cartão de vidro, DM Sans para texto e JetBrains Mono para rótulos. A tela é
// sempre escura, independente do tema do app. As fontes carregam só aqui.
const DM = "'DM Sans', Arial, sans-serif";
const SERIF = "'Instrument Serif', Georgia, serif";
const MONO = "'JetBrains Mono', 'Courier New', monospace";

const rotulo = 'block text-[11px] uppercase tracking-[3px] text-[#d5d3d0] mb-2';
const campo = 'w-full h-12 rounded-xl px-4 text-[15px] text-white placeholder:text-white/35 bg-[#161616]/55 '
  + 'border border-white/[0.22] outline-none transition-colors focus:border-[#efc700]';
const botaoAmarelo = 'flex items-center justify-center gap-2 rounded-full bg-[#efc700] text-[#161616] font-semibold '
  + 'transition hover:brightness-110 disabled:opacity-60';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [manter, setManter] = useState(lerManterConectado);
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

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('timeout') === 'true') {
      setTimeoutMessage(true);
    }
  }, [location]);

  // DM Sans e JetBrains Mono só para esta tela (o resto do app segue com Poppins/Work Sans).
  useEffect(() => { carregarFontesDeck(); }, []);

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
      definirManterConectado(manter);
      try { localStorage.setItem('lumos_last_activity', Date.now().toString()); } catch { /* ignora */ }
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
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#161616] text-white" style={{ fontFamily: DM }}>
      {/* Fundo: vidro canelado com a luz da Lumos */}
      <img
        src="/login/fundo-1920.jpg"
        srcSet="/login/fundo-1280.jpg 1280w, /login/fundo-1920.jpg 1920w"
        sizes="100vw"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: '68% 50%' }}
      />
      <div className="absolute inset-x-0 top-0 h-[300px] pointer-events-none" style={{ background: 'linear-gradient(180deg, #161616b3 0%, #16161600 100%)' }} />
      <div className="absolute inset-x-0 bottom-0 h-[300px] pointer-events-none" style={{ background: 'linear-gradient(180deg, #16161600 0%, #16161699 100%)' }} />
      {/* Leitura do texto à esquerda (no celular escurece tudo um pouco) */}
      <div className="absolute inset-0 pointer-events-none bg-[#161616]/35 xl:bg-transparent" />
      <div className="absolute inset-0 pointer-events-none hidden xl:block" style={{ background: 'linear-gradient(90deg, #161616cc 0%, #16161600 55%)' }} />

      <main
        className="relative z-10 flex min-h-[100dvh] flex-col px-6 sm:px-10 xl:px-32"
        style={{ paddingTop: 'max(2rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        {/* Topo: logotipo, linha fina e ano */}
        <header className="flex items-center gap-5 xl:gap-8">
          <img src="/login/logo-lumos-branco.svg" alt="Lumos" className="h-6 w-auto sm:h-[30px]" />
          <div className="h-px flex-1 bg-white/70" />
          <span className="text-[11px] sm:text-[13.5px] tracking-[3px]" style={{ fontFamily: MONO }}>{new Date().getFullYear()}</span>
        </header>

        {/* Texto e cartão ficam mais para dentro da tela que o logotipo e o rodapé (a partir de 1280px, 11% de cada lado) */}
        <div className="flex flex-1 flex-col justify-center gap-10 py-10 xl:flex-row xl:items-center xl:justify-between xl:gap-12 xl:px-[calc(11vw_-_128px)]">
          {/* Título */}
          <div className="animate-in fade-in duration-700">
            <div className="mb-[18px] flex items-center gap-3">
              <span className="block h-[9px] w-[9px] bg-[#efc700]" />
              <span className="text-[10px] uppercase tracking-[3px]" style={{ fontFamily: MONO }}>Acesso restrito</span>
            </div>
            {/* Duas linhas. O tamanho acompanha a largura livre ao lado do cartão para a primeira linha caber. */}
            <h1
              className="whitespace-nowrap font-normal leading-[1.04] tracking-[-0.01em] text-[clamp(28px,calc((100vw_-_48px)/11.1),74px)] xl:text-[clamp(46px,calc((78vw_-_488px)/10.95),96px)]"
              style={{ fontFamily: SERIF }}
            >
              Seja bem-vindo(a) à Lulu,<br />o App da Lumos.
            </h1>
          </div>

          {/* Cartão de vidro */}
          <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-700 xl:w-[440px] xl:shrink-0">
            <div className="rounded-xl border border-white/[0.22] bg-white/[0.08] p-7 sm:p-9 backdrop-blur-[20px]">
              <h2 className="mb-7 text-3xl font-semibold tracking-tight" style={{ fontFamily: DM }}>Entrar</h2>

              {timeoutMessage && (
                <div className="mb-6 rounded-xl border border-[#efc700]/40 bg-[#efc700]/10 p-4 text-sm font-medium text-[#efc700] animate-in fade-in slide-in-from-top-2">
                  Sua sessão expirou por inatividade. Por favor, faça login novamente.
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className={rotulo} style={{ fontFamily: MONO }}>E-mail</label>
                  <input
                    type="email"
                    name="email"
                    id="login-email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={campo}
                    placeholder="seu@email.com"
                  />
                </div>

                <div>
                  <label className={rotulo} style={{ fontFamily: MONO }}>Senha</label>
                  <SenhaInput
                    name="password"
                    id="login-senha"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={campo}
                    placeholder="••••••••"
                  />
                </div>

                {/* Caixa de marcar desenhada à mão (a nativa do navegador não combina com o vidro) */}
                <label className="group flex cursor-pointer select-none items-center gap-3 text-[11px] uppercase tracking-[2px] text-[#d5d3d0] transition-colors hover:text-white" style={{ fontFamily: MONO }}>
                  <span className="relative inline-flex h-[18px] w-[18px] flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={manter}
                      onChange={(e) => setManter(e.target.checked)}
                      className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-[5px] opacity-0"
                    />
                    <span className="pointer-events-none absolute inset-0 rounded-[5px] border border-white/[0.35] bg-[#161616]/55 transition-colors peer-checked:border-[#efc700] peer-checked:bg-[#efc700] peer-focus-visible:ring-2 peer-focus-visible:ring-[#efc700]/60 group-hover:border-white/60" />
                    <svg viewBox="0 0 16 16" className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-[#161616] opacity-0 transition-opacity peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3 8.5l3.2 3.2L13 4.8" />
                    </svg>
                  </span>
                  Manter conectado neste aparelho
                </label>

                {error && (
                  <div className="rounded-xl border border-red-400/40 bg-red-500/15 p-4 text-sm font-medium text-red-200 animate-in shake-in duration-300">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className={`${botaoAmarelo} h-12 w-full text-[15px] tracking-[2px] uppercase`}>
                  {loading ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                  ) : (
                    'Acessar painel'
                  )}
                </button>
              </form>

              {/* Entrada do robô de testes — SÓ em dev (import.meta.env.DEV) e só se
                  .env.local tiver VITE_TEST_EMAIL/VITE_TEST_PASSWORD. Nunca aparece
                  em produção nem em preview: o build da Vercel não é DEV e não tem
                  essas variáveis. Serve pra IA testar logada sem tocar em senha. */}
              {import.meta.env.DEV && import.meta.env.VITE_TEST_EMAIL && import.meta.env.VITE_TEST_PASSWORD && (
                <button
                  type="button"
                  onClick={async () => {
                    const { error } = await supabase.auth.signInWithPassword({
                      email: import.meta.env.VITE_TEST_EMAIL as string,
                      password: import.meta.env.VITE_TEST_PASSWORD as string,
                    });
                    if (error) setError('Robô de testes: ' + error.message);
                    else navigate('/');
                  }}
                  className="mt-3 h-10 w-full rounded-full border border-dashed border-[#efc700]/50 text-xs uppercase tracking-[2px] text-[#efc700] hover:bg-[#efc700]/10"
                  style={{ fontFamily: MONO }}
                >
                  🤖 Entrar como robô de testes
                </button>
              )}

              {/* Esqueci minha senha */}
              <div className="mt-6">
                {!forgotOpen ? (
                  <button
                    type="button"
                    onClick={() => { setForgotOpen(true); setForgotEmail(email); setForgotSent(false); }}
                    className="w-full text-center text-xs uppercase tracking-[2px] text-[#d5d3d0] underline underline-offset-4 transition-colors hover:text-[#efc700]"
                    style={{ fontFamily: MONO }}
                  >
                    Esqueci minha senha
                  </button>
                ) : forgotSent ? (
                  <div className="rounded-xl border border-green-400/40 bg-green-500/15 p-4 text-sm font-medium text-green-200 animate-in fade-in slide-in-from-top-2">
                    Se este e-mail estiver cadastrado, o link chega em instantes. Olhe também a caixa de spam. Se o seu convite estava pendente, vai chegar um convite novo.
                  </div>
                ) : (
                  <form onSubmit={handleForgot} className="space-y-3 rounded-xl border border-white/[0.22] bg-[#161616]/40 p-4 animate-in fade-in slide-in-from-top-2">
                    <p className="text-sm font-medium text-white/90">Digite seu e-mail e enviamos um link pra criar uma senha nova.</p>
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className={`${campo} h-11 text-sm`}
                      placeholder="seu@email.com"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setForgotOpen(false)}
                        className="h-10 flex-1 rounded-full border border-white/[0.22] text-xs uppercase tracking-[2px] text-white/90 transition-colors hover:bg-white/10"
                        style={{ fontFamily: MONO }}
                      >
                        Cancelar
                      </button>
                      <button type="submit" disabled={forgotSending} className={`${botaoAmarelo} h-10 flex-1 text-xs tracking-[2px] uppercase`}>
                        {forgotSending ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" /> : 'Enviar link'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <footer className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-[2px] text-[#d5d3d0] sm:text-[11px]" style={{ fontFamily: MONO }}>
          <span className="whitespace-nowrap">Produtora Lumos</span>
          <span className="text-right">Acesso restrito a administradores</span>
        </footer>
      </main>
    </div>
  );
}
