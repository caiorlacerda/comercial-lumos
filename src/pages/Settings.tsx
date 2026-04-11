import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { 
  User, 
  Save, 
  CheckCircle2, 
  AlertCircle,
  ArrowLeft,
  Moon
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/context/ThemeContext';
import { clsx } from 'clsx';
import ThemeToggle from '@/components/common/ThemeToggle';

export default function Settings() {
  const { user, updateProfile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.user_metadata?.full_name) {
      setFullName(user.user_metadata.full_name);
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);

    try {
      await updateProfile(fullName);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar perfil.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-lumos-bg rounded-full text-lumos-text-secondary transition-colors"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Configurações</h1>
          <p className="text-lumos-text-secondary mt-1 font-medium">Gerencie suas informações de perfil.</p>
        </div>
      </div>

      <div className="card space-y-6">
        <div className="flex items-center gap-4 pb-6 border-b border-lumos-border">
          <div className="w-16 h-16 rounded-full bg-lumos-yellow/20 flex items-center justify-center text-lumos-yellow">
            <User className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-black text-lumos-text-primary uppercase tracking-tight">Perfil do Usuário</h3>
            <p className="text-sm text-lumos-text-secondary font-medium">{user?.email}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest block">
              Nome Completo (Exibido nas assinaturas do PDF)
            </label>
            <input 
              type="text" 
              className="input-lumos w-full py-3 px-4 font-bold text-lg" 
              placeholder="Digite seu nome completo..."
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>

          <div className="flex items-center gap-4">
            <button 
              type="submit" 
              disabled={saving}
              className="btn-primary flex items-center gap-2 py-3 px-8 shadow-lg shadow-lumos-yellow/20 disabled:opacity-50"
            >
              {saving ? (
                <div className="w-5 h-5 border-2 border-black/30 border-t-black animate-spin rounded-full" />
              ) : (
                <Save className="w-5 h-5" />
              )}
              Salvar Alterações
            </button>

            {success && (
              <div className="flex items-center gap-2 text-green-500 font-bold animate-in fade-in slide-in-from-left-2">
                <CheckCircle2 className="w-5 h-5" />
                <span>Perfil atualizado!</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-500 font-bold">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </form>
      </div>
      
      {/* Appearance Section */}
      <div className="card space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
        <div className="flex items-center gap-4 pb-6 border-b border-lumos-border">
          <div className="w-16 h-16 rounded-full bg-lumos-yellow/20 flex items-center justify-center text-lumos-yellow">
            <Moon className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-black text-lumos-text-primary uppercase tracking-tight">Aparência</h3>
            <p className="text-sm text-lumos-text-secondary font-medium">Personalize o visual da plataforma.</p>
          </div>
        </div>

        <ThemeToggle showDescription={true} />
      </div>

      <div className="bg-lumos-yellow/5 border border-lumos-yellow/10 p-6 rounded-lumos space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-black text-lumos-text-primary uppercase">
          <AlertCircle className="w-4 h-4 text-lumos-yellow" />
          Importante
        </h4>
        <p className="text-xs text-lumos-text-secondary font-medium leading-relaxed">
          O nome cadastrado acima será utilizado automaticamente nos campos de assinatura dos orçamentos gerados em PDF. 
          Certifique-se de usar seu nome completo profissional.
        </p>
      </div>
    </div>
  );
}
