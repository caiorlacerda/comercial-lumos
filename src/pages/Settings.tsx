import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  User,
  Save,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Moon,
  Plus,
  Lock,
  Eye,
  EyeOff
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/context/ThemeContext';
import { clsx } from 'clsx';
import ThemeToggle from '@/components/common/ThemeToggle';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { user, updateProfile, updateAvatar } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.user_metadata?.full_name) {
      setFullName(user.user_metadata.full_name);
    }
  }, [user]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validation
    if (file.size > 2 * 1024 * 1024) {
      setError('A imagem deve ter no máximo 2MB.');
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Formato inválido. Use JPG, PNG ou WEBP.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user?.id}/avatar.${fileExt}`;
      const filePath = fileName;

      // 1. Upload to Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { 
          upsert: true,
          contentType: file.type
        });

      if (uploadError) throw uploadError;

      // 2. Get Public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // 3. Update User metadata
      await updateAvatar(publicUrl);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('Avatar upload error:', err);
      setError(err.message || 'Erro ao carregar avatar.');
    } finally {
      setUploading(false);
    }
  };

  const getInitials = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.email?.charAt(0).toUpperCase() || 'U';
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não coincidem.');
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err: any) {
      setPasswordError(err.message || 'Erro ao atualizar senha.');
    } finally {
      setSavingPassword(false);
    }
  };

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

      {/* Profile Photo Section */}
      <div className="card space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-start gap-8">
          <div className="flex flex-col items-center gap-4">
            <div className="relative group">
              <div className="w-24 h-24 rounded-full border-4 border-lumos-surface shadow-2xl overflow-hidden bg-lumos-bg flex items-center justify-center">
                {user?.user_metadata?.avatar_url ? (
                  <img 
                    src={user.user_metadata.avatar_url} 
                    alt="Avatar" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-3xl font-black text-lumos-yellow">{getInitials()}</span>
                )}
                {uploading && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-lumos-yellow border-t-transparent animate-spin rounded-full" />
                  </div>
                )}
              </div>
              <label 
                className={clsx(
                  "absolute -bottom-1 -right-1 p-2 rounded-full cursor-pointer shadow-lg transition-all",
                  "bg-lumos-yellow text-black hover:scale-110",
                  uploading && "opacity-50 cursor-not-allowed"
                )}
              >
                <Plus className="w-4 h-4" />
                <input 
                  type="file" 
                  className="hidden" 
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarUpload}
                  disabled={uploading}
                />
              </label>
            </div>
            <p className="text-[10px] font-black text-lumos-text-secondary uppercase">Foto de Perfil</p>
          </div>

          <div className="flex-1 space-y-4 pt-1">
            <h3 className="text-xl font-black text-lumos-text-primary tracking-tight uppercase">Seu Avatar</h3>
            <p className="text-sm text-lumos-text-secondary leading-relaxed font-medium">
              A foto de perfil é exibida na barra lateral e nas atividades da plataforma. 
              Use uma imagem quadrada de pelo menos 200px para melhor qualidade. Max 2MB.
            </p>
            <div className="flex gap-2">
              <button 
                onClick={() => document.querySelector<HTMLInputElement>('label input[type="file"]')?.click()}
                className="text-xs font-black uppercase text-lumos-yellow hover:underline flex items-center gap-1"
                disabled={uploading}
              >
                {uploading ? 'Enviando...' : 'Alterar Foto'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card space-y-6">
        <div className="flex items-center gap-4 pb-6 border-b border-lumos-border">
          <div className="w-16 h-16 rounded-full bg-lumos-yellow/20 flex items-center justify-center text-lumos-yellow">
            <User className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-black text-lumos-text-primary uppercase tracking-tight">Informações de Perfil</h3>
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

      {/* Password Change Section */}
      <div className="card space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
        <div className="flex items-center gap-4 pb-6 border-b border-lumos-border">
          <div className="w-16 h-16 rounded-full bg-lumos-yellow/20 flex items-center justify-center text-lumos-yellow">
            <Lock className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-black text-lumos-text-primary uppercase tracking-tight">Segurança</h3>
            <p className="text-sm text-lumos-text-secondary font-medium">Altere sua senha de acesso.</p>
          </div>
        </div>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest block">Nova Senha</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className="input-lumos w-full py-3 px-4 pr-12 font-medium"
                placeholder="Mínimo 8 caracteres..."
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lumos-text-secondary hover:text-lumos-text-primary transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest block">Confirmar Nova Senha</label>
            <input
              type={showPassword ? 'text' : 'password'}
              className="input-lumos w-full py-3 px-4 font-medium"
              placeholder="Repita a nova senha..."
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={savingPassword}
              className="btn-primary flex items-center gap-2 py-3 px-8 shadow-lg shadow-lumos-yellow/20 disabled:opacity-50"
            >
              {savingPassword ? (
                <div className="w-5 h-5 border-2 border-black/30 border-t-black animate-spin rounded-full" />
              ) : (
                <Lock className="w-5 h-5" />
              )}
              Alterar Senha
            </button>
            {passwordSuccess && (
              <div className="flex items-center gap-2 text-green-500 font-bold animate-in fade-in slide-in-from-left-2">
                <CheckCircle2 className="w-5 h-5" />
                <span>Senha atualizada!</span>
              </div>
            )}
            {passwordError && (
              <div className="flex items-center gap-2 text-red-500 font-bold">
                <AlertCircle className="w-5 h-5" />
                <span className="text-sm">{passwordError}</span>
              </div>
            )}
          </div>
        </form>
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
