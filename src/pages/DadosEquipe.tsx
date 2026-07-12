import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Users2, Plus, Loader2, ShieldAlert, Search, Trash2, X, Cake, Phone,
  CalendarDays, Briefcase, MapPin, Mail, CreditCard, Shirt, HeartPulse, IdCard,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/components/ui/useConfirm';
import UserAvatar from '@/components/common/UserAvatar';

interface TeamMember {
  id: string;
  app_user_id: string | null;
  full_name: string;
  email: string | null;
  whatsapp: string | null;
  cpf: string | null;
  rg: string | null;
  birth_date: string | null;
  address: string | null;
  role_title: string | null;
  department: string | null;
  joined_at: string | null;
  pix_key: string | null;
  emergency_contact: string | null;
  shirt_size: string | null;
  photo_url: string | null;
  notes: string | null;
  ordem: number;
}

const EMPTY: Omit<TeamMember, 'id' | 'ordem' | 'app_user_id'> = {
  full_name: '', email: '', whatsapp: '', cpf: '', rg: '', birth_date: '', address: '',
  role_title: '', department: '', joined_at: '', pix_key: '', emergency_contact: '',
  shirt_size: '', photo_url: '', notes: '',
};

const fmtBirthday = (d: string | null) => {
  if (!d) return null;
  const [, m, day] = d.split('-');
  return m && day ? `${day}/${m}` : d;
};
const fmtDate = (d: string | null) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}/${m}/${y}` : d;
};
export default function DadosEquipe() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [rows, setRows] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TeamMember | 'new' | null>(null);
  const [form, setForm] = useState<Omit<TeamMember, 'id' | 'ordem' | 'app_user_id'>>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data } = await supabase.from('team_members').select('*').order('full_name', { ascending: true });
    setRows((data as TeamMember[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefetch(['team_members'], () => load(true));

  const openNew = () => { setForm(EMPTY); setEditing('new'); };
  const openEdit = (m: TeamMember) => {
    const { id, ordem, app_user_id, ...rest } = m;
    void id; void ordem; void app_user_id;
    setForm({ ...EMPTY, ...rest });
    setEditing(m);
  };
  const closeModal = () => { setEditing(null); setForm(EMPTY); };

  const setField = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!form.full_name.trim()) { toast.error('O nome é obrigatório.'); return; }
    setSaving(true);
    // Normaliza campos de data/texto vazios para null
    const payload: Record<string, any> = {};
    (Object.keys(form) as (keyof typeof form)[]).forEach(k => { payload[k] = (form[k] as string)?.trim() ? form[k] : null; });
    payload.full_name = form.full_name.trim();
    try {
      if (editing === 'new') {
        const ordem = rows.reduce((m, r) => Math.max(m, r.ordem), 0) + 10;
        const { error } = await supabase.from('team_members').insert({ ...payload, ordem });
        if (error) throw error;
        toast.success('Membro cadastrado!');
      } else if (editing) {
        const { error } = await supabase.from('team_members').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Dados atualizados!');
      }
      closeModal();
      load(true);
    } catch (err: any) {
      console.error(err);
      toast.error('Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: TeamMember) => {
    if (!(await confirm({ message: `Excluir ${m.full_name} da lista da equipe?`, confirmLabel: 'Excluir', danger: true }))) return;
    setRows(prev => prev.filter(x => x.id !== m.id));
    if (editing && editing !== 'new' && editing.id === m.id) closeModal();
    const { error } = await supabase.from('team_members').delete().eq('id', m.id);
    if (error) { toast.error('Não foi possível excluir.'); load(); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.full_name.toLowerCase().includes(q) ||
      (r.role_title || '').toLowerCase().includes(q) ||
      (r.department || '').toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight uppercase flex items-center gap-2">
            <Users2 className="w-7 h-7 text-lumos-yellow" /> Dados da Equipe
          </h1>
          <p className="text-sm font-medium text-lumos-text-secondary mt-1">
            Cadastro dos funcionários da Lumos. Os aniversários caem sozinhos no calendário e viram confete na home. 🎉
          </p>
        </div>
        <button onClick={openNew} className="btn-primary h-10 px-4 text-sm font-bold flex items-center gap-1.5 flex-shrink-0">
          <Plus className="w-4 h-4" /> Novo membro
        </button>
      </div>

      <div className="flex items-start gap-2 text-[11px] text-amber-500/90 bg-amber-500/[0.07] border border-amber-500/25 rounded-lumos px-3 py-2">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Dados sensíveis (CPF, endereço, PIX…) visíveis só para <b>admin</b> e <b>produção</b>. Só o <b>aniversário</b> (nome + dia) é usado no calendário e no confete para todo o time.</span>
      </div>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 text-lumos-text-secondary absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, cargo ou setor…"
          className="input-lumos w-full h-10 text-sm pl-9" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-lumos-yellow" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-lumos-text-secondary italic py-12 text-center">
          {rows.length === 0 ? 'Nenhum membro cadastrado ainda. Clique em "Novo membro".' : 'Ninguém encontrado com esse filtro.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(m => (
            <button key={m.id} onClick={() => openEdit(m)}
              className="card text-left border border-lumos-border bg-lumos-surface hover:border-lumos-yellow/40 hover:shadow-md transition-all p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar user={{ id: m.app_user_id, full_name: m.full_name, avatar_url: m.photo_url } as any} size={44} showStatus />
                <div className="min-w-0">
                  <p className="font-bold text-lumos-text-primary truncate">{m.full_name}</p>
                  <p className="text-[11px] text-lumos-text-secondary truncate">
                    {m.role_title || 'Função não definida'}{m.department ? ` · ${m.department}` : ''}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-lumos-text-secondary">
                {m.birth_date && <span className="flex items-center gap-1.5 truncate"><Cake className="w-3.5 h-3.5 text-lumos-yellow flex-shrink-0" /> {fmtBirthday(m.birth_date)}</span>}
                {m.whatsapp && <span className="flex items-center gap-1.5 truncate"><Phone className="w-3.5 h-3.5 flex-shrink-0" /> {m.whatsapp}</span>}
                {m.joined_at && <span className="flex items-center gap-1.5 truncate"><CalendarDays className="w-3.5 h-3.5 flex-shrink-0" /> desde {fmtDate(m.joined_at)}</span>}
                {m.email && <span className="flex items-center gap-1.5 truncate"><Mail className="w-3.5 h-3.5 flex-shrink-0" /> {m.email}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Modal de edição/criação */}
      {editing && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150" onClick={closeModal}>
          <div onClick={e => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl">
            <div className="sticky top-0 bg-lumos-surface border-b border-lumos-border px-5 py-3 flex items-center justify-between z-10">
              <h2 className="text-base font-black text-lumos-text-primary uppercase tracking-tight">
                {editing === 'new' ? 'Novo membro' : form.full_name || 'Editar membro'}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-lumos text-lumos-text-secondary hover:text-lumos-text-primary"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-5">
              <Section title="Pessoal" icon={IdCard}>
                <Field label="Nome completo *" value={form.full_name} onChange={v => setField('full_name', v)} full />
                <Field label="CPF" value={form.cpf || ''} onChange={v => setField('cpf', v)} />
                <Field label="RG" value={form.rg || ''} onChange={v => setField('rg', v)} />
                <Field label="Data de nascimento" type="date" value={form.birth_date || ''} onChange={v => setField('birth_date', v)} />
                <Field label="Endereço" value={form.address || ''} onChange={v => setField('address', v)} icon={MapPin} full />
              </Section>

              <Section title="Contato" icon={Phone}>
                <Field label="WhatsApp" value={form.whatsapp || ''} onChange={v => setField('whatsapp', v)} icon={Phone} />
                <Field label="E-mail" value={form.email || ''} onChange={v => setField('email', v)} icon={Mail} />
                <Field label="Contato de emergência" value={form.emergency_contact || ''} onChange={v => setField('emergency_contact', v)} icon={HeartPulse} full />
              </Section>

              <Section title="Na Lumos" icon={Briefcase}>
                <Field label="Cargo / função" value={form.role_title || ''} onChange={v => setField('role_title', v)} />
                <Field label="Setor" value={form.department || ''} onChange={v => setField('department', v)} />
                <Field label="Entrou na Lumos" type="date" value={form.joined_at || ''} onChange={v => setField('joined_at', v)} icon={CalendarDays} />
                <Field label="Foto (URL)" value={form.photo_url || ''} onChange={v => setField('photo_url', v)} />
              </Section>

              <Section title="Outros" icon={CreditCard}>
                <Field label="Chave PIX" value={form.pix_key || ''} onChange={v => setField('pix_key', v)} icon={CreditCard} />
                <Field label="Tamanho de camiseta" value={form.shirt_size || ''} onChange={v => setField('shirt_size', v)} icon={Shirt} />
                <div className="col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary block mb-1">Observações</label>
                  <textarea value={form.notes || ''} onChange={e => setField('notes', e.target.value)} rows={2} className="input-lumos w-full text-sm resize-none" />
                </div>
              </Section>
            </div>

            <div className="sticky bottom-0 bg-lumos-surface border-t border-lumos-border px-5 py-3 flex items-center justify-between gap-2">
              {editing !== 'new' ? (
                <button onClick={() => remove(editing)} className="text-xs font-bold text-red-400 hover:text-red-500 flex items-center gap-1.5">
                  <Trash2 className="w-4 h-4" /> Excluir
                </button>
              ) : <span />}
              <div className="flex items-center gap-2">
                <button onClick={closeModal} className="btn-secondary h-9 px-4 text-xs font-bold">Cancelar</button>
                <button onClick={save} disabled={saving} className="btn-primary h-9 px-5 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Salvar
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {dialog}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-lumos-yellow flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5" /> {title}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', full, icon: Icon }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; full?: boolean; icon?: any;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary block mb-1 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="input-lumos w-full h-9 text-sm" />
    </div>
  );
}
