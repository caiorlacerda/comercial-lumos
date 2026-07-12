import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Camera, PartyPopper, IdCard, Phone, Briefcase, CreditCard, Shirt, Footprints, HeartPulse, MapPin, CalendarDays } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import UserAvatar from '@/components/common/UserAvatar';

// Campos preenchidos no onboarding (todos opcionais menos o que já vem do login)
const FIELDS = [
  'birth_date', 'whatsapp', 'cpf', 'rg', 'address', 'role_title', 'department',
  'joined_at', 'pix_key', 'emergency_contact', 'shirt_size', 'shoe_size', 'pants_size', 'notes',
] as const;
type FormState = Record<(typeof FIELDS)[number], string>;
const EMPTY: FormState = Object.fromEntries(FIELDS.map(f => [f, ''])) as FormState;

// Primeiro acesso: pede os dados da pessoa e salva na tabela da equipe, ligado
// ao login dela. Assim o aniversário/foto/etc. ficam automáticos por usuário.
export default function OnboardingGate() {
  const { profile, user, updateAvatar } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const [needs, setNeeds] = useState(false); // ainda não concluiu o cadastro
  const [existingId, setExistingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!profile?.id || checked) return;
    // O "pular" só evita o POP-UP automático nesta sessão — o banner de
    // "completar cadastro" continua aparecendo até a pessoa concluir.
    const skipped = sessionStorage.getItem('onboard-skip') === profile.id;
    supabase.from('team_members')
      .select('id, onboarded_at, ' + FIELDS.join(', '))
      .eq('app_user_id', profile.id)
      .maybeSingle()
      .then(({ data }: any) => {
        setChecked(true);
        if (data) {
          setExistingId(data.id);
          const filled: FormState = { ...EMPTY };
          FIELDS.forEach(f => { if (data[f]) filled[f] = data[f]; });
          setForm(filled);
          const notDone = !data.onboarded_at;
          setNeeds(notDone);
          if (notDone && !skipped) setOpen(true);
        } else {
          setNeeds(true);
          if (!skipped) setOpen(true);
        }
      });
  }, [profile?.id, checked]);

  const setField = (k: keyof FormState, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { toast.error('Use JPG, PNG ou WEBP.'); return; }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      await updateAvatar(`${publicUrl}?t=${Date.now()}`);
      toast.success('Foto atualizada!');
    } catch (err: any) {
      console.error(err);
      toast.error('Não foi possível enviar a foto.');
    } finally {
      setUploading(false);
    }
  };

  const finish = async () => {
    if (!profile?.id) return;
    setSaving(true);
    const payload: Record<string, any> = {};
    FIELDS.forEach(f => { payload[f] = form[f]?.trim() ? form[f] : null; });
    payload.app_user_id = profile.id;
    payload.full_name = profile.full_name;
    payload.onboarded_at = new Date().toISOString();
    try {
      if (existingId) {
        const { error } = await supabase.from('team_members').update(payload).eq('id', existingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('team_members').insert(payload);
        if (error) throw error;
      }
      toast.success('Tudo certo! Bem-vindo(a) à Lumos 🎉');
      setNeeds(false);
      setOpen(false);
    } catch (err: any) {
      console.error(err);
      toast.error('Não foi possível salvar seu cadastro.');
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    if (profile?.id) sessionStorage.setItem('onboard-skip', profile.id);
    setOpen(false);
  };

  if (!profile) return null;

  // Banner fixo enquanto o cadastro não foi concluído (quando o modal está fechado)
  const banner = needs && !open ? (
    <button
      onClick={() => setOpen(true)}
      className="w-full flex items-center gap-3 text-left rounded-lumos border border-lumos-yellow/40 bg-lumos-yellow/[0.07] hover:bg-lumos-yellow/10 transition-colors px-4 py-3"
    >
      <PartyPopper className="w-5 h-5 text-lumos-yellow flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-lumos-text-primary">Complete seu cadastro na Lumos</p>
        <p className="text-[11px] text-lumos-text-secondary">Leva 1 minutinho — foto, aniversário e seus dados. Clique para preencher.</p>
      </div>
      <span className="text-xs font-black uppercase tracking-wider text-black bg-lumos-yellow px-3 py-1.5 rounded-full flex-shrink-0">Completar</span>
    </button>
  ) : null;

  if (!open) return banner;

  return createPortal(
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto custom-scrollbar bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl">
        {/* Cabeçalho */}
        <div className="relative overflow-hidden px-6 py-6 bg-gradient-to-r from-lumos-yellow/15 via-pink-500/10 to-purple-500/10 border-b border-lumos-border text-center">
          <PartyPopper className="w-8 h-8 text-lumos-yellow mx-auto mb-2" />
          <h2 className="text-xl font-black text-lumos-text-primary tracking-tight">Bem-vindo(a) à Lumos, {profile.full_name?.split(' ')[0]}!</h2>
          <p className="text-xs text-lumos-text-secondary mt-1 font-semibold max-w-md mx-auto">
            Complete seu cadastro pra gente te conhecer melhor. Leva 1 minutinho — e sim, o aniversário vira confete no dia. 🎂
          </p>
        </div>

        <div className="p-6 space-y-5">
          {/* Foto */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <UserAvatar user={{ id: profile.id, full_name: profile.full_name, avatar_url: profile.avatar_url }} size={64} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-lumos-yellow text-black flex items-center justify-center shadow ring-2 ring-lumos-surface hover:scale-105 transition-transform disabled:opacity-60"
                title="Enviar foto">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handlePhoto} />
            </div>
            <div>
              <p className="text-sm font-bold text-lumos-text-primary">Sua foto</p>
              <p className="text-[11px] text-lumos-text-secondary">Aparece na equipe, tarefas e comentários. Clique na câmera pra enviar.</p>
            </div>
          </div>

          <Group title="Pessoal" icon={IdCard}>
            <Field label="Data de nascimento" type="date" v={form.birth_date} on={v => setField('birth_date', v)} icon={CalendarDays} />
            <Field label="CPF" v={form.cpf} on={v => setField('cpf', v)} />
            <Field label="RG" v={form.rg} on={v => setField('rg', v)} />
            <Field label="Endereço" v={form.address} on={v => setField('address', v)} icon={MapPin} full />
          </Group>

          <Group title="Contato" icon={Phone}>
            <Field label="WhatsApp" v={form.whatsapp} on={v => setField('whatsapp', v)} icon={Phone} />
            <Field label="Contato de emergência" v={form.emergency_contact} on={v => setField('emergency_contact', v)} icon={HeartPulse} />
          </Group>

          <Group title="Na Lumos" icon={Briefcase}>
            <Field label="Cargo / função" v={form.role_title} on={v => setField('role_title', v)} />
            <Field label="Setor" v={form.department} on={v => setField('department', v)} />
            <Field label="Entrou na Lumos" type="date" v={form.joined_at} on={v => setField('joined_at', v)} icon={CalendarDays} />
          </Group>

          <Group title="Tamanhos & pagamento" icon={Shirt}>
            <Field label="Camiseta" v={form.shirt_size} on={v => setField('shirt_size', v)} icon={Shirt} />
            <Field label="Calça / shorts" v={form.pants_size} on={v => setField('pants_size', v)} icon={Shirt} />
            <Field label="Calçado" v={form.shoe_size} on={v => setField('shoe_size', v)} icon={Footprints} />
            <Field label="Chave PIX" v={form.pix_key} on={v => setField('pix_key', v)} icon={CreditCard} />
          </Group>
        </div>

        <div className="sticky bottom-0 bg-lumos-surface border-t border-lumos-border px-6 py-3 flex items-center justify-between">
          <button onClick={skip} className="text-xs font-bold text-lumos-text-secondary hover:text-lumos-text-primary">Pular por enquanto</button>
          <button onClick={finish} disabled={saving} className="btn-primary h-10 px-6 text-sm font-bold flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Concluir cadastro
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Group({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-lumos-yellow flex items-center gap-1.5 mb-2"><Icon className="w-3.5 h-3.5" /> {title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Field({ label, v, on, type = 'text', full, icon: Icon }: {
  label: string; v: string; on: (v: string) => void; type?: string; full?: boolean; icon?: any;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </label>
      <input type={type} value={v} onChange={e => on(e.target.value)} className="input-lumos w-full h-9 text-sm" />
    </div>
  );
}
