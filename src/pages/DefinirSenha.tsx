import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useLocation, useNavigate } from 'react-router-dom';
import PaginaPublica, { MONO, SERIF, ROTULO_PUBLICO, CAMPO_PUBLICO, BOTAO_AMARELO, CARTAO_VIDRO } from '@/components/publico/PaginaPublica';
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
    <PaginaPublica rodape={isReset ? 'Redefinição de senha' : 'Primeiro acesso'}>
      <div className="mb-6 flex items-center gap-3">
        <span className="block h-[9px] w-[9px] bg-[#efc700]" />
        <span className="text-[10px] uppercase tracking-[3px]" style={{ fontFamily: MONO }}>
          {isReset ? 'Nova senha' : 'Bem-vindo(a) à Lumos'}
        </span>
      </div>
      <h1 className="mb-6 text-[44px] font-normal leading-[1.05] tracking-[-0.01em] sm:text-[56px]" style={{ fontFamily: SERIF }}>
        {isReset ? 'Redefinir senha' : 'Definir senha'}
      </h1>

      <div className={`${CARTAO_VIDRO} p-7 sm:p-9`}>
        <p className="mb-7 text-sm leading-relaxed text-[#d5d3d0]">
          {isReset ? 'Crie uma senha nova pra sua conta. A antiga deixa de valer.' : 'Crie sua senha de acesso à plataforma.'}
        </p>

        {checkingSession ? (
          <div className="flex items-center justify-center py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#efc700]/30 border-t-[#efc700]" />
          </div>
        ) : !hasSession ? (
          <div className="rounded-xl border border-red-400/40 bg-red-500/15 p-4 text-sm font-medium text-red-200">
            {isReset
              ? 'Este link é inválido ou expirou. Volte à tela de login e peça um novo em "Esqueci minha senha".'
              : 'Este link de convite é inválido ou expirou. Peça a um administrador para reenviar o convite.'}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className={ROTULO_PUBLICO} style={{ fontFamily: MONO }}>Nova senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${CAMPO_PUBLICO} h-12`}
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className={ROTULO_PUBLICO} style={{ fontFamily: MONO }}>Confirmar senha</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={`${CAMPO_PUBLICO} h-12`}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="animate-in shake-in rounded-xl border border-red-400/40 bg-red-500/15 p-4 text-sm font-medium text-red-200 duration-300">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className={`${BOTAO_AMARELO} h-12 w-full text-[15px] uppercase tracking-[2px]`}>
              {loading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
              ) : (
                'Criar senha e entrar'
              )}
            </button>
          </form>
        )}
      </div>
    </PaginaPublica>
  );
}
