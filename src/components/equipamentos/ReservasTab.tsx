import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, AlertTriangle, Check, X, CornerDownLeft, CalendarClock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';
import { clsx } from 'clsx';

type RStatus = 'solicitada' | 'aprovada' | 'recusada' | 'devolvida';
const RSTATUS: Record<RStatus, { label: string; cls: string }> = {
  solicitada: { label: 'Solicitada', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/25' },
  aprovada: { label: 'Aprovada', cls: 'bg-green-500/15 text-green-500 border-green-500/25' },
  recusada: { label: 'Recusada', cls: 'bg-red-500/15 text-red-400 border-red-500/25' },
  devolvida: { label: 'Devolvida', cls: 'bg-lumos-text-secondary/15 text-lumos-text-secondary border-lumos-border' },
};

interface Equip { id: string; name: string; }
interface Proj { id: string; name: string; code?: string | null; }
interface Reserva {
  id: string; equipment_id: string; project_id: string | null; start_date: string; end_date: string;
  status: RStatus; notes: string | null;
  equipment?: { name: string } | null; project?: { name: string } | null; requester?: { full_name: string } | null;
}

const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart;

export default function ReservasTab({ equipment, projects, open, onClose }: { equipment: Equip[]; projects: Proj[]; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { profile } = useAuth();
  const [rows, setRows] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ equipment_id: '', project_id: '', start_date: '', end_date: '', notes: '' });

  useEffect(() => { load(); }, []);
  useRealtimeRefetch(['equipment_reservations'], () => load(true));

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('equipment_reservations')
      .select('*, equipment:equipment_id(name), project:project_id(name), requester:app_users!requested_by(full_name)')
      .order('created_at', { ascending: false });
    setRows((data as Reserva[]) || []);
    setLoading(false);
  }

  // Conflito: reservas APROVADAS do mesmo equipamento que cruzam o período.
  const conflict = useMemo(() => {
    if (!form.equipment_id || !form.start_date || !form.end_date) return null;
    const hit = rows.find(r => r.equipment_id === form.equipment_id && r.status === 'aprovada' && overlaps(form.start_date, form.end_date, r.start_date, r.end_date));
    return hit || null;
  }, [form, rows]);

  const createReserva = async () => {
    if (!form.equipment_id || !form.start_date || !form.end_date) { toast.error('Escolha o equipamento e as datas.'); return; }
    if (form.end_date < form.start_date) { toast.error('A data final não pode ser antes da inicial.'); return; }
    setSaving(true);
    const { error } = await supabase.from('equipment_reservations').insert([{
      equipment_id: form.equipment_id, project_id: form.project_id || null, requested_by: profile?.id,
      start_date: form.start_date, end_date: form.end_date, notes: form.notes.trim() || null, status: 'solicitada',
    }]);
    setSaving(false);
    if (error) { toast.error('Não foi possível solicitar.'); return; }
    toast.success('Reserva solicitada ✓');
    onClose();
    setForm({ equipment_id: '', project_id: '', start_date: '', end_date: '', notes: '' });
    load();
  };

  const setStatus = async (r: Reserva, status: RStatus) => {
    const patch: any = { status };
    if (status === 'aprovada' || status === 'recusada') { patch.decided_by = profile?.id; patch.decided_at = new Date().toISOString(); }
    const { error } = await supabase.from('equipment_reservations').update(patch).eq('id', r.id);
    if (error) { toast.error('Erro ao atualizar.'); return; }
    // Espelha no status do equipamento (aprovada → em uso; devolvida → disponível).
    if (status === 'aprovada') await supabase.from('equipment').update({ status: 'em_uso' }).eq('id', r.equipment_id);
    if (status === 'devolvida') await supabase.from('equipment').update({ status: 'disponivel' }).eq('id', r.equipment_id);
    toast.success('Reserva atualizada.');
    load();
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="card p-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto" /></div>
      ) : rows.length === 0 ? (
        <div className="card p-12 text-center text-lumos-text-secondary text-sm italic">Nenhuma reserva ainda.</div>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <CalendarClock className="w-5 h-5 text-lumos-yellow flex-shrink-0 hidden sm:block" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-lumos-text-primary truncate">{r.equipment?.name || 'Equipamento'}</span>
                  <span className={clsx('text-[9px] font-black uppercase px-2 py-0.5 rounded-full border', RSTATUS[r.status].cls)}>{RSTATUS[r.status].label}</span>
                </div>
                <div className="text-[12px] text-lumos-text-secondary">
                  {fmt(r.start_date)} → {fmt(r.end_date)}
                  {r.project?.name ? ` · ${r.project.name}` : ''}
                  {r.requester?.full_name ? ` · por ${r.requester.full_name.split(' ')[0]}` : ''}
                </div>
                {r.notes && <div className="text-[11px] text-lumos-text-secondary/80 italic mt-0.5">{r.notes}</div>}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {r.status === 'solicitada' && (
                  <>
                    <button onClick={() => setStatus(r, 'aprovada')} className="flex items-center gap-1 text-xs font-bold text-green-500 hover:bg-green-500/10 px-2.5 py-1.5 rounded border border-green-500/20"><Check className="w-3.5 h-3.5" /> Aprovar</button>
                    <button onClick={() => setStatus(r, 'recusada')} className="flex items-center gap-1 text-xs font-bold text-red-400 hover:bg-red-500/10 px-2.5 py-1.5 rounded border border-red-500/20"><X className="w-3.5 h-3.5" /> Recusar</button>
                  </>
                )}
                {r.status === 'aprovada' && (
                  <button onClick={() => setStatus(r, 'devolvida')} className="flex items-center gap-1 text-xs font-bold text-lumos-text-secondary hover:bg-lumos-text-secondary/10 px-2.5 py-1.5 rounded border border-lumos-border"><CornerDownLeft className="w-3.5 h-3.5" /> Devolver</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={open} onClose={() => onClose()} title="Solicitar reserva" maxWidth="max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Equipamento *</label>
            <Select value={form.equipment_id} onChange={v => setForm(f => ({ ...f, equipment_id: v }))} className="input-lumos w-full" placeholder="Selecione…"
              options={equipment.map(e => ({ value: e.id, label: e.name }))} />
          </div>
          <div>
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Projeto (opcional)</label>
            <Select value={form.project_id} onChange={v => setForm(f => ({ ...f, project_id: v }))} className="input-lumos w-full" placeholder="Sem projeto"
              options={[{ value: '', label: 'Sem projeto' }, ...projects.map(p => ({ value: p.id, label: `${p.name}${p.code ? ` (${p.code})` : ''}` }))]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Início *</label>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="input-lumos w-full" />
            </div>
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Fim *</label>
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className="input-lumos w-full" />
            </div>
          </div>
          {conflict && (
            <div className="flex items-start gap-2 text-xs bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 rounded-lumos p-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Atenção: já existe reserva <b>aprovada</b> desse equipamento de {fmt(conflict.start_date)} a {fmt(conflict.end_date)}. Você pode solicitar mesmo assim, mas verifique a disponibilidade.</span>
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Observações</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="input-lumos w-full" />
          </div>
          <div className="flex gap-3">
            <button onClick={() => onClose()} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={createReserva} disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">{saving && <Loader2 className="w-4 h-4 animate-spin" />} Solicitar</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
