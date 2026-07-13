import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Users2, UserPlus, Search, Shield, Mail, Phone, Loader2, X, Trash2, Camera,
  Cake, CalendarDays, Briefcase, MapPin, CreditCard, Shirt, Footprints, HeartPulse, IdCard, ShieldAlert,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth, AppUserProfile, ROLE_DEFAULTS } from '@/hooks/useAuth';
import { useLayout } from '@/context/LayoutContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/components/ui/useConfirm';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { notify, getAdminUserIds } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';
import { logAudit } from '@/hooks/useAuditLog';
import UserAvatar from '@/components/common/UserAvatar';
import ViewToggle, { type ViewMode } from '@/components/common/ViewToggle';
import Select from '@/components/ui/Select';

type UserRole = 'admin' | 'producao' | 'atendimento' | 'editor' | 'social_media' | 'basico';

const ROLE_OPTS: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin' }, { value: 'producao', label: 'Produção' },
  { value: 'atendimento', label: 'Atendimento' }, { value: 'editor', label: 'Editor' },
  { value: 'social_media', label: 'Social Media' }, { value: 'basico', label: 'Básico' },
];
const roleLabel = (r?: string) => ROLE_OPTS.find(o => o.value === r)?.label || r || '—';
const roleBadge = (r?: string) => ({
  admin: 'bg-lumos-yellow/20 text-lumos-yellow border-lumos-yellow/30',
  producao: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  atendimento: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  editor: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  social_media: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
}[r || ''] || 'bg-lumos-text-primary/10 text-lumos-text-secondary border-lumos-border');

const PERM_OPTIONS = [
  { key: 'ordem_do_dia', label: 'Produção (Projetos, Ordem do Dia, views)' },
  { key: 'fornecedores', label: 'Fornecedores' },
  { key: 'cronograma_edicao', label: 'Cronograma de Edição' },
  { key: 'acessos', label: 'Acessos & Senhas (cofre)' },
  { key: 'equipe_dados', label: 'Dados da Equipe (RH)' },
  { key: 'reembolso', label: 'Reembolso' },
  { key: 'custos_projeto', label: 'Custos de Projeto' },
];

// Campos de RH (tabela team_members)
const HR_FIELDS = ['whatsapp', 'cpf', 'rg', 'birth_date', 'address', 'department', 'joined_at', 'pix_key', 'emergency_contact', 'shirt_size', 'pants_size', 'shoe_size', 'notes'] as const;
type HrForm = Record<(typeof HR_FIELDS)[number] | 'role_title', string>;
const EMPTY_HR: HrForm = { role_title: '', whatsapp: '', cpf: '', rg: '', birth_date: '', address: '', department: '', joined_at: '', pix_key: '', emergency_contact: '', shirt_size: '', pants_size: '', shoe_size: '', notes: '' };

interface TeamMember {
  id: string; app_user_id: string | null; full_name: string; role_title: string | null; department: string | null;
  whatsapp: string | null; cpf: string | null; rg: string | null; birth_date: string | null; address: string | null;
  joined_at: string | null; pix_key: string | null; emergency_contact: string | null;
  shirt_size: string | null; pants_size: string | null; shoe_size: string | null; notes: string | null; photo_url: string | null;
  app_user?: { avatar_url: string | null } | null;
}

// Uma "pessoa": um login (app_user) com o RH ligado, OU um RH sem login (freela)
interface Person { key: string; user: AppUserProfile | null; hr: TeamMember | null; }

const fmtBirthday = (d?: string | null) => { if (!d) return '—'; const [, m, day] = d.split('-'); return m && day ? `${day}/${m}` : d; };
const fmtDate = (d?: string | null) => { if (!d) return '—'; const [y, m, day] = d.split('-'); return y && m && day ? `${day}/${m}/${y}` : d; };

export default function Equipe() {
  const { profile, isAdmin, can } = useAuth();
  const { getLiveStatus } = useLayout();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const canHR = isAdmin || can('equipe_dados');
  const fileRef = useRef<HTMLInputElement>(null);

  const [usersRows, setUsersRows] = useState<AppUserProfile[]>([]);
  const [teamRows, setTeamRows] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('lumos-equipe-view') as ViewMode) || 'list');
  useEffect(() => { localStorage.setItem('lumos-equipe-view', viewMode); }, [viewMode]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [u, t] = await Promise.all([
      supabase.from('app_users').select('*').order('full_name'),
      supabase.from('team_members').select('*, app_user:app_users(avatar_url)').order('full_name'),
    ]);
    setUsersRows((u.data as AppUserProfile[]) || []);
    setTeamRows((t.data as TeamMember[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefetch(['app_users', 'team_members'], () => load(true));

  // Une logins + RH numa lista de pessoas
  const people = useMemo<Person[]>(() => {
    const hrByUser = new Map<string, TeamMember>();
    const standalone: TeamMember[] = [];
    teamRows.forEach(t => { if (t.app_user_id) hrByUser.set(t.app_user_id, t); else standalone.push(t); });
    const list: Person[] = usersRows.map(u => ({ key: `u-${u.id}`, user: u, hr: hrByUser.get(u.id) || null }));
    standalone.forEach(t => list.push({ key: `t-${t.id}`, user: null, hr: t }));
    return list;
  }, [usersRows, teamRows]);

  const nameOf = (p: Person) => p.user?.full_name || p.hr?.full_name || 'Sem nome';
  const avatarOf = (p: Person) => ({ id: p.user?.id, full_name: nameOf(p), avatar_url: p.user?.avatar_url ?? p.hr?.app_user?.avatar_url ?? p.hr?.photo_url });
  const cargoOf = (p: Person) => p.user?.job_title || p.hr?.role_title || (p.user ? roleLabel(p.user.role) : 'Sem login');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter(p => {
      if (roleFilter !== 'all' && p.user?.role !== roleFilter) return false;
      if (!q) return true;
      return nameOf(p).toLowerCase().includes(q) || cargoOf(p).toLowerCase().includes(q) || (p.user?.email || '').toLowerCase().includes(q);
    });
  }, [people, search, roleFilter]);

  const onlineCount = people.filter(p => p.user && getLiveStatus(p.user.id) === 'online').length;

  // ── Detalhe da pessoa ─────────────────────────────────────────────────────
  const [detail, setDetail] = useState<Person | null>(null);
  const [access, setAccess] = useState({ role: 'basico' as UserRole, status: 'ativo' as 'ativo' | 'inativo', job_title: '', custom_permissions: {} as Record<string, boolean> });
  const [hr, setHr] = useState<HrForm>(EMPTY_HR);
  const [saving, setSaving] = useState(false);

  const openDetail = (p: Person) => {
    if (p.user) setAccess({ role: p.user.role as UserRole, status: p.user.status, job_title: p.user.job_title || '', custom_permissions: { ...(p.user.custom_permissions || {}) } });
    const h = p.hr; const f: HrForm = { ...EMPTY_HR, role_title: h?.role_title || '' };
    HR_FIELDS.forEach(k => { if (h?.[k]) f[k] = h[k] as string; });
    setHr(f);
    setDetail(p);
  };

  const setPerm = (key: string, mode: 'default' | 'allow' | 'block') =>
    setAccess(a => { const cp = { ...a.custom_permissions }; if (mode === 'default') delete cp[key]; else cp[key] = mode === 'allow'; return { ...a, custom_permissions: cp }; });

  // Salva acesso (cargo/status/permissões) do login
  const saveAccess = async () => {
    if (!detail?.user) return;
    setSaving(true);
    const { error } = await supabase.from('app_users').update({
      role: access.role, status: access.status, job_title: access.job_title || null, custom_permissions: access.custom_permissions,
    }).eq('id', detail.user.id);
    setSaving(false);
    if (error) { toast.error(`Erro: ${error.message}`); return; }
    if (access.role !== detail.user.role) {
      notify({ userIds: [detail.user.id], event: NOTIFICATION_EVENTS.PERMISSAO_ALTERADA, title: 'Suas permissões foram alteradas', body: `Seu nível de acesso foi alterado para "${roleLabel(access.role)}".`, link: '/configuracoes' });
    }
    if (access.status !== detail.user.status) logAudit(access.status === 'inativo' ? 'user_deactivated' : 'user_activated', `Usuário "${detail.user.full_name}" ${access.status === 'inativo' ? 'desativado' : 'reativado'}`, { user_id: detail.user.id });
    toast.success('Acesso atualizado!');
    load(true);
  };

  // Salva dados de RH (team_members) — cria a linha se não existir
  const saveHR = async () => {
    if (!detail) return;
    setSaving(true);
    const payload: Record<string, any> = { role_title: hr.role_title.trim() || null };
    HR_FIELDS.forEach(k => { payload[k] = (hr[k] || '').trim() ? hr[k] : null; });
    payload.full_name = nameOf(detail);
    try {
      if (detail.hr) {
        const { error } = await supabase.from('team_members').update(payload).eq('id', detail.hr.id);
        if (error) throw error;
      } else {
        payload.app_user_id = detail.user?.id || null;
        const { error } = await supabase.from('team_members').insert(payload);
        if (error) throw error;
      }
      toast.success('Dados salvos!');
      setDetail(null);
      load(true);
    } catch (e: any) { toast.error('Não foi possível salvar os dados.'); }
    finally { setSaving(false); }
  };

  const resendTour = async () => {
    if (!detail?.user) return;
    const { error } = await supabase.from('app_users').update({ tour_seen: false }).eq('id', detail.user.id);
    if (error) toast.error('Erro ao reenviar.'); else toast.success(`Tour reenviado — ${detail.user.full_name.split(' ')[0]} verá no próximo login.`);
  };

  const deleteUser = async () => {
    if (!detail?.user) return;
    if (!(await confirm({ message: `Excluir ${detail.user.full_name} da plataforma? A conta de acesso será removida.`, confirmLabel: 'Excluir', danger: true }))) return;
    const { data, error } = await supabase.functions.invoke('delete-user', { body: { ids: [detail.user.id] } });
    if (error || data?.error) { toast.error(`Erro ao excluir: ${error?.message || data?.error}`); return; }
    toast.success('Usuário excluído.');
    setDetail(null);
    load(true);
  };

  const uploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !detail?.user) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { toast.error('Use JPG, PNG ou WEBP.'); return; }
    setSaving(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${detail.user.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${publicUrl}?t=${Date.now()}`;
      await supabase.from('app_users').update({ avatar_url: url }).eq('id', detail.user.id);
      toast.success('Foto atualizada!');
      load(true);
    } catch { toast.error('Não foi possível enviar a foto.'); }
    finally { setSaving(false); }
  };

  // ── Convite ───────────────────────────────────────────────────────────────
  const [invite, setInvite] = useState<null | { full_name: string; email: string; role: UserRole; job_title: string }>(null);
  const [inviting, setInviting] = useState(false);
  const sendInvite = async () => {
    if (!invite?.email.trim() || !invite.full_name.trim()) { toast.error('Nome e e-mail são obrigatórios.'); return; }
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', { body: { email: invite.email, full_name: invite.full_name, role: invite.role, job_title: invite.job_title } });
      if (error) { let msg = error.message; try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch {} throw new Error(msg); }
      if (data?.error) throw new Error(data.error);
      logAudit('user_created', `Convite enviado para "${invite.full_name}" (${invite.email})`, { email: invite.email, role: invite.role });
      const admins = await getAdminUserIds();
      notify({ userIds: admins, event: NOTIFICATION_EVENTS.NOVO_USUARIO_ACESSO, title: 'Novo acesso solicitado', body: `Convite enviado para "${invite.full_name}" (${roleLabel(invite.role)}).`, link: '/equipe' });
      toast.success(`✓ Convite enviado para ${invite.email}.`);
      setInvite(null);
      load(true);
    } catch (e: any) { toast.error(`Erro: ${e.message}`); }
    finally { setInviting(false); }
  };

  const statusPill = (p: Person) => {
    if (!p.user) return <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-lumos-text-primary/10 text-lumos-text-secondary">Sem login</span>;
    if (p.user.status === 'inativo') return <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400">Inativo</span>;
    const s = getLiveStatus(p.user.id);
    return <span className={clsx('text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full', s === 'online' ? 'bg-green-500/15 text-green-500' : 'bg-lumos-text-primary/10 text-lumos-text-secondary')}>{s === 'online' ? 'Online' : 'Offline'}</span>;
  };

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight uppercase flex items-center gap-2">
            <Users2 className="w-7 h-7 text-lumos-yellow" /> Equipe
          </h1>
          <p className="text-sm font-medium text-lumos-text-secondary mt-1">
            {people.length} pessoas · {onlineCount} online. Contato, presença, acessos e dados, num lugar só.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ViewToggle value={viewMode} onChange={setViewMode} />
          {isAdmin && (
            <button onClick={() => setInvite({ full_name: '', email: '', role: 'basico', job_title: '' })} className="btn-primary h-10 px-4 text-sm font-bold flex items-center gap-1.5">
              <UserPlus className="w-4 h-4" /> Novo usuário
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-lumos-text-secondary absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, cargo ou e-mail…" className="input-lumos w-full h-10 text-sm pl-9" />
        </div>
        <div className="w-full md:w-52">
          <Select value={roleFilter} onChange={setRoleFilter} className="input-lumos h-10 text-sm"
            options={[{ value: 'all', label: 'Todos os cargos' }, ...ROLE_OPTS.map(o => ({ value: o.value, label: o.label }))]} />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-lumos-yellow" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-lumos-text-secondary italic py-12 text-center">Ninguém encontrado.</p>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(p => (
            <button key={p.key} onClick={() => openDetail(p)} className="card text-left border border-lumos-border bg-lumos-surface hover:border-lumos-yellow/40 hover:shadow-md transition-all p-4 flex items-center gap-3">
              <UserAvatar user={avatarOf(p) as any} size={44} showStatus />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><p className="font-bold text-lumos-text-primary truncate">{nameOf(p)}</p>{statusPill(p)}</div>
                <p className="text-[11px] text-lumos-text-secondary truncate">{cargoOf(p)}</p>
                {p.user?.email && <p className="text-[10px] text-lumos-text-secondary/70 truncate">{p.user.email}</p>}
              </div>
              {p.user && <span className={clsx('text-[9px] font-black uppercase px-2 py-0.5 rounded-full border flex-shrink-0', roleBadge(p.user.role))}>{roleLabel(p.user.role)}</span>}
            </button>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-lumos-bg/40 border-b border-lumos-border">
                <tr className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3 hidden md:table-cell">Cargo / nível</th>
                  <th className="px-4 py-3 hidden lg:table-cell">Contato</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lumos-border/50">
                {filtered.map(p => (
                  <tr key={p.key} onClick={() => openDetail(p)} className="hover:bg-lumos-text-secondary/[0.03] cursor-pointer transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar user={avatarOf(p) as any} size={32} showStatus />
                        <span className="font-bold text-lumos-text-primary truncate">{nameOf(p)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <span className="text-lumos-text-secondary truncate">{cargoOf(p)}</span>
                        {p.user && <span className={clsx('text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border', roleBadge(p.user.role))}>{roleLabel(p.user.role)}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-lumos-text-secondary hidden lg:table-cell truncate max-w-[220px]">{p.user?.email || p.hr?.whatsapp || '—'}</td>
                    <td className="px-4 py-2.5">{statusPill(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detalhe da pessoa */}
      {detail && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150" onClick={() => setDetail(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl max-h-[92vh] overflow-y-auto custom-scrollbar bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl">
            <div className="sticky top-0 bg-lumos-surface border-b border-lumos-border px-5 py-3 flex items-center justify-between z-10">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative">
                  <UserAvatar user={avatarOf(detail) as any} size={40} showStatus />
                  {detail.user && canHR && (
                    <button onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-lumos-yellow text-black flex items-center justify-center ring-2 ring-lumos-surface" title="Enviar foto"><Camera className="w-3 h-3" /></button>
                  )}
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadPhoto} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-black text-lumos-text-primary truncate">{nameOf(detail)}</h2>
                  <p className="text-[11px] text-lumos-text-secondary truncate">{cargoOf(detail)}</p>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="p-1.5 rounded-lumos text-lumos-text-secondary hover:text-lumos-text-primary"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-6">
              {/* Contato */}
              <Section title="Contato & presença" icon={Mail}>
                {detail.user?.email && <Info label="E-mail" value={detail.user.email} />}
                {(detail.user?.phone || detail.hr?.whatsapp) && <Info label="WhatsApp" value={detail.user?.phone || detail.hr?.whatsapp || ''} />}
                {detail.user && <Info label="Membro desde" value={fmtDate(detail.user.joined_at)} />}
                {detail.hr?.birth_date && canHR && <Info label="Aniversário" value={fmtBirthday(detail.hr.birth_date)} />}
              </Section>

              {/* Acesso & permissões (admin) */}
              {isAdmin && detail.user && (
                <Section title="Acesso & permissões" icon={Shield}>
                  <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Cargo / função (exibição)" value={access.job_title} onChange={v => setAccess(a => ({ ...a, job_title: v }))} />
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary block mb-1">Nível de acesso</label>
                      <Select value={access.role} onChange={v => setAccess(a => ({ ...a, role: v as UserRole }))} className="input-lumos h-9 text-sm" options={ROLE_OPTS} />
                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary block mb-1">Status</label>
                      <Select value={access.status} onChange={v => setAccess(a => ({ ...a, status: v as 'ativo' | 'inativo' }))} className="input-lumos h-9 text-sm"
                        options={[{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }]} />
                    </div>
                  </div>
                  {access.role !== 'admin' && (
                    <div className="sm:col-span-2 space-y-1.5">
                      <p className="text-[10px] text-lumos-text-secondary/70">Padrão = herda do cargo. Liberar/Bloquear sobrescreve só para esta pessoa.</p>
                      {PERM_OPTIONS.map(p => {
                        const roleGrants = (ROLE_DEFAULTS[access.role] || []).some(x => x === '*' || x === p.key);
                        const ov = access.custom_permissions[p.key];
                        const mode = ov === undefined ? 'default' : ov ? 'allow' : 'block';
                        const effective = ov === undefined ? roleGrants : ov;
                        return (
                          <div key={p.key} className="flex items-center justify-between gap-2 p-2 rounded-lumos border border-lumos-border/50 bg-lumos-bg/20">
                            <span className="text-[11px] font-semibold text-lumos-text-primary flex items-center gap-1.5 min-w-0">
                              <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', effective ? 'bg-green-500' : 'bg-lumos-text-secondary/40')} />
                              <span className="truncate">{p.label}</span>
                            </span>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {([['default', 'Padrão'], ['allow', 'Liberar'], ['block', 'Bloquear']] as const).map(([m, lbl]) => (
                                <button key={m} type="button" onClick={() => setPerm(p.key, m)}
                                  className={clsx('text-[9px] font-black uppercase px-2 py-1 rounded transition-colors', mode === m
                                    ? (m === 'allow' ? 'bg-green-500/20 text-green-500' : m === 'block' ? 'bg-red-500/20 text-red-400' : 'bg-lumos-yellow/20 text-lumos-yellow')
                                    : 'text-lumos-text-secondary hover:bg-lumos-text-secondary/10')}>{lbl}</button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                    <button onClick={saveAccess} disabled={saving} className="btn-primary h-9 px-4 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Salvar acesso
                    </button>
                    <button onClick={resendTour} className="h-9 px-3 text-xs font-bold rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow">🎬 Reenviar tour</button>
                    <button onClick={deleteUser} className="h-9 px-3 text-xs font-bold rounded-lumos text-red-400 hover:bg-red-500/10 flex items-center gap-1.5 ml-auto"><Trash2 className="w-3.5 h-3.5" /> Excluir</button>
                  </div>
                </Section>
              )}

              {/* Dados / RH (admin ou produção) */}
              {canHR ? (
                <Section title="Dados (RH)" icon={IdCard}>
                  <Field label="Cargo / função" value={hr.role_title} onChange={v => setHr(f => ({ ...f, role_title: v }))} icon={Briefcase} />
                  <Field label="Setor" value={hr.department} onChange={v => setHr(f => ({ ...f, department: v }))} />
                  <Field label="WhatsApp" value={hr.whatsapp} onChange={v => setHr(f => ({ ...f, whatsapp: v }))} icon={Phone} />
                  <Field label="Nascimento" type="date" value={hr.birth_date} onChange={v => setHr(f => ({ ...f, birth_date: v }))} icon={Cake} />
                  <Field label="CPF" value={hr.cpf} onChange={v => setHr(f => ({ ...f, cpf: v }))} />
                  <Field label="RG" value={hr.rg} onChange={v => setHr(f => ({ ...f, rg: v }))} />
                  <Field label="Endereço" value={hr.address} onChange={v => setHr(f => ({ ...f, address: v }))} icon={MapPin} full />
                  <Field label="Entrou na Lumos" type="date" value={hr.joined_at} onChange={v => setHr(f => ({ ...f, joined_at: v }))} icon={CalendarDays} />
                  <Field label="Contato de emergência" value={hr.emergency_contact} onChange={v => setHr(f => ({ ...f, emergency_contact: v }))} icon={HeartPulse} />
                  <Field label="Chave PIX" value={hr.pix_key} onChange={v => setHr(f => ({ ...f, pix_key: v }))} icon={CreditCard} />
                  <Field label="Camiseta" value={hr.shirt_size} onChange={v => setHr(f => ({ ...f, shirt_size: v }))} icon={Shirt} />
                  <Field label="Calça / shorts" value={hr.pants_size} onChange={v => setHr(f => ({ ...f, pants_size: v }))} icon={Shirt} />
                  <Field label="Calçado" value={hr.shoe_size} onChange={v => setHr(f => ({ ...f, shoe_size: v }))} icon={Footprints} />
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary block mb-1">Observações</label>
                    <textarea value={hr.notes} onChange={e => setHr(f => ({ ...f, notes: e.target.value }))} rows={2} className="input-lumos w-full text-sm resize-none" />
                  </div>
                  <div className="sm:col-span-2">
                    <button onClick={saveHR} disabled={saving} className="btn-primary h-9 px-5 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Salvar dados
                    </button>
                  </div>
                </Section>
              ) : (
                <div className="flex items-start gap-2 text-[11px] text-lumos-text-secondary bg-lumos-bg/40 border border-lumos-border rounded-lumos px-3 py-2">
                  <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" /> Dados de RH (CPF, endereço, PIX…) visíveis só para admin e produção.
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Convite de novo usuário */}
      {invite && createPortal(
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150" onClick={() => setInvite(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-6 space-y-4">
            <h2 className="text-base font-black uppercase tracking-tight text-lumos-text-primary flex items-center gap-2"><UserPlus className="w-5 h-5 text-lumos-yellow" /> Novo usuário</h2>
            <Field label="Nome completo *" value={invite.full_name} onChange={v => setInvite(i => i && { ...i, full_name: v })} full />
            <Field label="E-mail *" value={invite.email} onChange={v => setInvite(i => i && { ...i, email: v })} icon={Mail} full />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cargo (exibição)" value={invite.job_title} onChange={v => setInvite(i => i && { ...i, job_title: v })} />
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary block mb-1">Nível</label>
                <Select value={invite.role} onChange={v => setInvite(i => i && { ...i, role: v as UserRole })} className="input-lumos h-9 text-sm" options={ROLE_OPTS} />
              </div>
            </div>
            <p className="text-[11px] text-lumos-text-secondary">A pessoa recebe um e-mail para definir a própria senha.</p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setInvite(null)} className="btn-secondary flex-1 h-10 text-sm">Cancelar</button>
              <button onClick={sendInvite} disabled={inviting} className="btn-primary flex-1 h-10 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Enviar convite
              </button>
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
      <p className="text-[10px] font-black uppercase tracking-widest text-lumos-yellow flex items-center gap-1.5 mb-2"><Icon className="w-3.5 h-3.5" /> {title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary/60">{label}</p>
      <p className="text-sm text-lumos-text-primary break-words">{value}</p>
    </div>
  );
}
function Field({ label, value, onChange, type = 'text', full, icon: Icon }: { label: string; value: string; onChange: (v: string) => void; type?: string; full?: boolean; icon?: any }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1 flex items-center gap-1">{Icon && <Icon className="w-3 h-3" />} {label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="input-lumos w-full h-9 text-sm" />
    </div>
  );
}
