import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useLocation, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { notify, getAdminUserIds } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';

// Avisa os admins que a pessoa concluiu o cadastro. Roda em segundo plano e nunca
// bloqueia a entrada — nesse ponto a sessão já é a do usuário recém-cadastrado, então
// o insert de notificação vai no contexto autenticado dele (mesmo padrão dos demais
// notify() do app). O perfil em app_users já existe (criado no convite).
async function notifyAdminsNewSignup() {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const authId = auth?.user?.id;
    if (!authId) return;
    const { data: me } = await supabase
      .from('app_users')
      .select('id, full_name, job_title')
      .eq('auth_user_id', authId)
      .maybeSingle();
    if (!me) return;
    const adminIds = (await getAdminUserIds()).filter(id => id !== me.id);
    if (!adminIds.length) return;
    await notify({
      userIds: adminIds,
      event: NOTIFICATION_EVENTS.NOVO_USUARIO_ACESSO,
      title: `${me.full_name} entrou na Lumos`,
      body: me.job_title ? `${me.job_title} · concluiu o cadastro e já tem acesso` : 'Concluiu o cadastro e já tem acesso ao app',
      link: '/equipe',
      actorId: me.id,
    });
  } catch (err) {
    console.error('Falha ao notificar admins do novo cadastro:', err);
  }
}

export default function DefinirSenha() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const navigate = useNavigate();
  const { theme } = useTheme();
  // Mesmo componente atende dois fluxos: /definir-senha (primeiro acesso via
  // convite) e /redefinir-senha (recuperação via "Esqueci minha senha").
  const isReset = useLocation().pathname === '/redefinir-senha';

  // Ao chegar pelo link do convite, o Supabase estabelece a sessão a partir da
  // URL. Aguardamos essa sessão antes de permitir definir a senha.
  useEffect(() => {
    let settled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (settled) return;
      if (session) {
        setHasSession(true);
        setCheckingSession(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        settled = true;
        setHasSession(true);
        setCheckingSession(false);
      }
    });

    // Se após alguns segundos não houver sessão, o link é inválido/expirado.
    const timer = setTimeout(() => {
      if (!settled) setCheckingSession(false);
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }
    // Notifica os admins em segundo plano (não trava a entrada). Só no primeiro
    // acesso — redefinição de senha não é "fulano entrou na Lumos".
    if (!isReset) void notifyAdminsNewSignup();
    navigate('/');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-lumos-bg px-4 transition-colors duration-300">
      <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-700">
        <div className="text-center mb-10 flex flex-col items-center">
          <img
            src={theme === 'dark' ? "/logo/Logotipo-Branco-Alpha.svg" : "/logo/Logotipo-Preto-Alpha.svg"}
            alt="Lumos Logo"
            className="h-14 transition-all duration-300"
          />
        </div>

        <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-lumos-yellow" />

          <h2 className="text-2xl font-black mb-2 flex items-center gap-3 text-lumos-text-primary tracking-tight">
            <KeyRound className="w-6 h-6 text-lumos-yellow" />
            {isReset ? 'Redefinir senha' : 'Definir senha'}
          </h2>
          <p className="text-lumos-text-secondary text-sm mb-8">
            {isReset ? 'Crie uma senha nova pra sua conta. A antiga deixa de valer.' : 'Bem-vindo(a) à Lumos! Crie sua senha de acesso à plataforma.'}
          </p>

          {checkingSession ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-8 h-8 border-2 border-lumos-yellow/30 border-t-lumos-yellow rounded-full animate-spin" />
            </div>
          ) : !hasSession ? (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lumos text-red-500 text-sm font-medium">
              {isReset
                ? 'Este link é inválido ou expirou. Volte à tela de login e peça um novo em "Esqueci minha senha".'
                : 'Este link de convite é inválido ou expirou. Peça a um administrador para reenviar o convite.'}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest mb-2">
                  Nova senha
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

              <div>
                <label className="block text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest mb-2">
                  Confirmar senha
                </label>
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
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
                  'Criar senha e entrar'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
