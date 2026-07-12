import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Eye, EyeOff, Copy, Loader2, ShieldAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';
import { useConfirm } from '@/components/ui/useConfirm';

interface Cred { id: string; service: string; login: string; password: string; assigned_to: string; ordem: number; }

const ASSIGNED = ['', 'Comercial', 'Sócios', 'Produção', 'Edição', 'Todos'].map(v => ({ value: v, label: v || '—' }));

export default function Acessos() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [rows, setRows] = useState<Cred[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [newService, setNewService] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data } = await supabase.from('access_credentials').select('*').order('service', { ascending: true }).order('ordem', { ascending: true });
    setRows((data as Cred[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Tempo real: alterações de outros usuários aparecem sem spinner
  useRealtimeRefetch(['access_credentials'], () => load(true));

  const toggleReveal = (id: string) => setRevealed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const patch = async (id: string, fields: Partial<Cred>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...fields } : r));
    const { error } = await supabase.from('access_credentials').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Não foi possível salvar.'); load(); }
  };

  const addRow = async (service: string) => {
    const ordem = (rows.filter(r => r.service === service).reduce((m, r) => Math.max(m, r.ordem), 0)) + 10;
    const { data, error } = await supabase.from('access_credentials').insert({ service, login: '', password: '', assigned_to: '', ordem }).select('*').single();
    if (error || !data) { toast.error('Não foi possível adicionar.'); return; }
    setRows(prev => [...prev, data as Cred]);
  };

  const addService = async () => {
    const s = newService.trim(); if (!s) return;
    setNewService('');
    await addRow(s);
  };

  const remove = async (r: Cred) => {
    if (!(await confirm({ message: `Excluir o acesso "${r.login || 'sem login'}" de ${r.service}?`, confirmLabel: 'Excluir', danger: true }))) return;
    setRows(prev => prev.filter(x => x.id !== r.id));
    const { error } = await supabase.from('access_credentials').delete().eq('id', r.id);
    if (error) { toast.error('Não foi possível excluir.'); load(); }
  };

  const renameService = async (oldName: string, newName: string) => {
    const clean = newName.trim();
    if (!clean || clean === oldName) return;
    setRows(prev => prev.map(r => r.service === oldName ? { ...r, service: clean } : r));
    await supabase.from('access_credentials').update({ service: clean }).eq('service', oldName);
  };

  const copy = async (text: string, label: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text).catch(() => {});
    toast.success(`${label} copiado ✓`);
  };

  // Agrupa por serviço mantendo a ordem
  const groups: { service: string; items: Cred[] }[] = [];
  for (const r of rows) {
    const g = groups.find(x => x.service === r.service);
    if (g) g.items.push(r); else groups.push({ service: r.service, items: [r] });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight uppercase flex items-center gap-2">
          <KeyRound className="w-7 h-7 text-lumos-yellow" /> Acessos & Senhas
        </h1>
        <p className="text-sm font-medium text-lumos-text-secondary mt-1">
          Logins e senhas dos serviços da Lumos, num lugar só. Clique no olho pra revelar.
        </p>
      </div>

      <div className="flex items-start gap-2 text-[11px] text-amber-500/90 bg-amber-500/[0.07] border border-amber-500/25 rounded-lumos px-3 py-2">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Visível só para <b>admin</b> e <b>produção</b>. As senhas ficam guardadas para uso do time — evite cadastrar aqui credenciais bancárias ou de altíssima sensibilidade.</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-lumos-yellow" /></div>
      ) : (
        <div className="space-y-5">
          {groups.map(group => (
            <div key={group.service} className="card border border-lumos-border bg-lumos-surface overflow-hidden">
              <div className="px-4 py-2.5 bg-lumos-yellow/10 border-b border-lumos-border">
                <input
                  defaultValue={group.service}
                  onBlur={e => renameService(group.service, e.target.value)}
                  className="bg-transparent text-sm font-black text-lumos-text-primary uppercase tracking-wide outline-none focus:text-lumos-yellow w-full"
                />
              </div>
              <div className="divide-y divide-lumos-border/40">
                {group.items.map(r => {
                  const shown = revealed.has(r.id);
                  return (
                    <div key={r.id} className="flex flex-col md:flex-row md:items-center gap-2 px-4 py-2.5 hover:bg-lumos-text-secondary/[0.02]">
                      {/* Login */}
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input value={r.login} onChange={e => setRows(p => p.map(x => x.id === r.id ? { ...x, login: e.target.value } : x))} onBlur={e => patch(r.id, { login: e.target.value })}
                          placeholder="login / e-mail" className="input-lumos h-8 text-xs w-full" />
                        <button onClick={() => copy(r.login, 'Login')} className="p-1.5 text-lumos-text-secondary hover:text-lumos-yellow flex-shrink-0" title="Copiar login"><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                      {/* Senha */}
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input type={shown ? 'text' : 'password'} value={r.password} onChange={e => setRows(p => p.map(x => x.id === r.id ? { ...x, password: e.target.value } : x))} onBlur={e => patch(r.id, { password: e.target.value })}
                          placeholder="senha" className="input-lumos h-8 text-xs w-full font-mono" />
                        <button onClick={() => toggleReveal(r.id)} className="p-1.5 text-lumos-text-secondary hover:text-lumos-yellow flex-shrink-0" title={shown ? 'Ocultar' : 'Revelar senha'}>
                          {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => copy(r.password, 'Senha')} className="p-1.5 text-lumos-text-secondary hover:text-lumos-yellow flex-shrink-0" title="Copiar senha"><Copy className="w-3.5 h-3.5" /></button>
                      </div>
                      {/* Tá com quem? */}
                      <div className="w-full md:w-40 flex-shrink-0">
                        <Select value={r.assigned_to || ''} onChange={v => patch(r.id, { assigned_to: v })} options={ASSIGNED} placeholder="Tá com quem?" className="input-lumos h-8 text-xs py-0" />
                      </div>
                      <button onClick={() => remove(r)} className="p-1.5 text-lumos-text-secondary hover:text-red-400 flex-shrink-0 self-end md:self-center" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  );
                })}
              </div>
              <button onClick={() => addRow(group.service)} className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/5 transition-colors border-t border-lumos-border/40">
                <Plus className="w-3.5 h-3.5" /> Adicionar acesso
              </button>
            </div>
          ))}

          {/* Novo serviço */}
          <div className="flex items-center gap-2">
            <input value={newService} onChange={e => setNewService(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addService(); }}
              placeholder="Novo serviço (ex.: Frame, Adobe, Envato…)" className="input-lumos flex-1 h-10 text-sm" />
            <button onClick={addService} disabled={!newService.trim()} className="btn-primary h-10 px-4 text-sm font-bold flex items-center gap-1.5 disabled:opacity-50">
              <Plus className="w-4 h-4" /> Adicionar serviço
            </button>
          </div>
        </div>
      )}

      {dialog}
    </div>
  );
}
