import { useEffect, useState } from 'react';
import { Plus, Loader2, Wrench, Play, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';
import { clsx } from 'clsx';

type MStatus = 'aberta' | 'em_andamento' | 'concluida';
const MSTATUS: Record<MStatus, { label: string; cls: string }> = {
  aberta: { label: 'Aberta', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/25' },
  em_andamento: { label: 'Em andamento', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  concluida: { label: 'Concluída', cls: 'bg-green-500/15 text-green-500 border-green-500/25' },
};

interface Equip { id: string; name: string; }
interface Manut {
  id: string; equipment_id: string; issue: string; status: MStatus; notes: string | null;
  opened_at: string; closed_at: string | null;
  equipment?: { name: string } | null; reporter?: { full_name: string } | null;
}

const fmt = (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

export default function ManutencaoTab({ equipment, open, onClose }: { equipment: Equip[]; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { profile } = useAuth();
  const [rows, setRows] = useState<Manut[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ equipment_id: '', issue: '', notes: '' });

  useEffect(() => { load(); }, []);
  useRealtimeRefetch(['equipment_maintenance'], () => load(true));

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('equipment_maintenance')
      .select('*, equipment:equipment_id(name), reporter:app_users!reported_by(full_name)')
      .order('opened_at', { ascending: false });
    setRows((data as Manut[]) || []);
    setLoading(false);
  }

  const createManut = async () => {
    if (!form.equipment_id || !form.issue.trim()) { toast.error('Escolha o equipamento e descreva o problema.'); return; }
    setSaving(true);
    const { error } = await supabase.from('equipment_maintenance').insert([{
      equipment_id: form.equipment_id, reported_by: profile?.id, issue: form.issue.trim(), notes: form.notes.trim() || null, status: 'aberta',
    }]);
    if (!error) await supabase.from('equipment').update({ status: 'manutencao' }).eq('id', form.equipment_id);
    setSaving(false);
    if (error) { toast.error('Não foi possível abrir a manutenção.'); return; }
    toast.success('Manutenção aberta ✓');
    onClose();
    setForm({ equipment_id: '', issue: '', notes: '' });
    load();
  };

  const advance = async (m: Manut, status: MStatus) => {
    const patch: any = { status };
    if (status === 'concluida') patch.closed_at = new Date().toISOString();
    const { error } = await supabase.from('equipment_maintenance').update(patch).eq('id', m.id);
    if (error) { toast.error('Erro ao atualizar.'); return; }
    // Ao concluir, o equipamento volta a ficar disponível.
    if (status === 'concluida') await supabase.from('equipment').update({ status: 'disponivel' }).eq('id', m.equipment_id);
    toast.success('Manutenção atualizada.');
    load();
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="card p-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto" /></div>
      ) : rows.length === 0 ? (
        <div className="card p-12 text-center text-lumos-text-secondary text-sm italic">Nenhuma manutenção registrada.</div>
      ) : (
        <div className="space-y-2">
          {rows.map(m => (
            <div key={m.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <Wrench className="w-5 h-5 text-lumos-yellow flex-shrink-0 hidden sm:block" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-lumos-text-primary truncate">{m.equipment?.name || 'Equipamento'}</span>
                  <span className={clsx('text-[9px] font-black uppercase px-2 py-0.5 rounded-full border', MSTATUS[m.status].cls)}>{MSTATUS[m.status].label}</span>
                </div>
                <div className="text-[12.5px] text-lumos-text-primary/90 mt-0.5">{m.issue}</div>
                <div className="text-[11px] text-lumos-text-secondary">
                  Aberta em {fmt(m.opened_at)}{m.reporter?.full_name ? ` por ${m.reporter.full_name.split(' ')[0]}` : ''}{m.closed_at ? ` · concluída em ${fmt(m.closed_at)}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {m.status === 'aberta' && (
                  <button onClick={() => advance(m, 'em_andamento')} className="flex items-center gap-1 text-xs font-bold text-blue-400 hover:bg-blue-500/10 px-2.5 py-1.5 rounded border border-blue-500/20"><Play className="w-3.5 h-3.5" /> Iniciar</button>
                )}
                {m.status !== 'concluida' && (
                  <button onClick={() => advance(m, 'concluida')} className="flex items-center gap-1 text-xs font-bold text-green-500 hover:bg-green-500/10 px-2.5 py-1.5 rounded border border-green-500/20"><Check className="w-3.5 h-3.5" /> Concluir</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={open} onClose={() => onClose()} title="Abrir manutenção" maxWidth="max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Equipamento *</label>
            <Select value={form.equipment_id} onChange={v => setForm(f => ({ ...f, equipment_id: v }))} className="input-lumos w-full" placeholder="Selecione…"
              options={equipment.map(e => ({ value: e.id, label: e.name }))} />
          </div>
          <div>
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Problema *</label>
            <textarea value={form.issue} onChange={e => setForm(f => ({ ...f, issue: e.target.value }))} rows={2} className="input-lumos w-full" placeholder="Ex: lente com fungo, não liga…" />
          </div>
          <div>
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Observações</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="input-lumos w-full" />
          </div>
          <div className="flex gap-3">
            <button onClick={() => onClose()} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={createManut} disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">{saving && <Loader2 className="w-4 h-4 animate-spin" />} Abrir</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
