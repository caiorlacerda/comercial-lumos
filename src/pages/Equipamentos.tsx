import { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Plus, Search, Edit2, Trash2, AlertTriangle, ImagePlus, Loader2, MapPin, Boxes, CalendarClock, Wrench, ListChecks } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import { MobileCardList, MobileCard } from '@/components/ui/MobileCards';
import { clsx } from 'clsx';
import ReservasTab from '@/components/equipamentos/ReservasTab';
import ManutencaoTab from '@/components/equipamentos/ManutencaoTab';
import ListasTab from '@/components/equipamentos/ListasTab';

type Tab = 'inventario' | 'reservas' | 'manutencao' | 'listas';
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'inventario', label: 'Inventário', icon: Boxes },
  { key: 'reservas', label: 'Reservas', icon: CalendarClock },
  { key: 'manutencao', label: 'Manutenção', icon: Wrench },
  { key: 'listas', label: 'Listas & Templates', icon: ListChecks },
];

type Status = 'disponivel' | 'em_uso' | 'manutencao' | 'inativo';
const STATUS: Record<Status, { label: string; cls: string; dot: string }> = {
  disponivel: { label: 'Disponível', cls: 'bg-green-500/15 text-green-500 border-green-500/25', dot: 'bg-green-500' },
  em_uso: { label: 'Em uso', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/25', dot: 'bg-blue-400' },
  manutencao: { label: 'Manutenção', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/25', dot: 'bg-amber-500' },
  inativo: { label: 'Inativo', cls: 'bg-lumos-text-secondary/15 text-lumos-text-secondary border-lumos-border', dot: 'bg-lumos-text-secondary' },
};
const STATUS_KEYS = Object.keys(STATUS) as Status[];

interface Equip {
  id: string; name: string; category: string | null; brand: string | null; model: string | null;
  serial_number: string | null; quantity: number; status: Status; location: string | null;
  photo_url: string | null; purchase_date: string | null; value: number | null; notes: string | null;
}

const EMPTY = {
  id: null as string | null, name: '', category: '', brand: '', model: '', serial_number: '',
  quantity: 1, status: 'disponivel' as Status, location: '', photo_url: '', purchase_date: '', value: '', notes: '',
};

export default function Equipamentos() {
  const toast = useToast();
  const { profile } = useAuth();
  const [items, setItems] = useState<Equip[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('inventario');
  const [projects, setProjects] = useState<{ id: string; name: string; code: string | null }[]>([]);

  useEffect(() => { fetchEquipment(); fetchProjects(); }, []);
  useRealtimeRefetch(['equipment'], () => fetchEquipment(true));

  async function fetchProjects() {
    const { data } = await supabase.from('projects').select('id, name, code').order('name');
    setProjects((data as any) || []);
  }

  async function fetchEquipment(silent = false) {
    if (!silent) setLoading(true);
    const { data, error } = await supabase.from('equipment').select('*').order('name');
    if (error) toast.error('Erro ao carregar equipamentos.');
    setItems((data as Equip[]) || []);
    setLoading(false);
  }

  const categories = useMemo(() => Array.from(new Set(items.map(i => i.category).filter(Boolean))).sort() as string[], [items]);

  const filtered = items.filter(i => {
    const t = search.toLowerCase();
    const matchSearch = !t || [i.name, i.brand, i.model, i.serial_number, i.category].some(v => v?.toLowerCase().includes(t));
    const matchCat = catFilter === 'all' || i.category === catFilter;
    const matchStatus = statusFilter === 'all' || i.status === statusFilter;
    return matchSearch && matchCat && matchStatus;
  });

  const openNew = () => { setForm({ ...EMPTY }); setModalOpen(true); };
  const openEdit = (e: Equip) => {
    setForm({
      id: e.id, name: e.name, category: e.category || '', brand: e.brand || '', model: e.model || '',
      serial_number: e.serial_number || '', quantity: e.quantity, status: e.status, location: e.location || '',
      photo_url: e.photo_url || '', purchase_date: e.purchase_date || '', value: e.value != null ? String(e.value) : '', notes: e.notes || '',
    });
    setModalOpen(true);
  };

  const handlePhoto = async (file: File) => {
    setUploading(true);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('equipamentos').upload(path, file, { contentType: file.type, upsert: false });
    if (error) { toast.error('Falha ao enviar a foto.'); setUploading(false); return; }
    const { data } = supabase.storage.from('equipamentos').getPublicUrl(path);
    setForm(f => ({ ...f, photo_url: data.publicUrl }));
    setUploading(false);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Dá um nome pro equipamento.'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(), category: form.category.trim() || null, brand: form.brand.trim() || null,
      model: form.model.trim() || null, serial_number: form.serial_number.trim() || null,
      quantity: Number(form.quantity) || 1, status: form.status, location: form.location.trim() || null,
      photo_url: form.photo_url || null, purchase_date: form.purchase_date || null,
      value: form.value === '' ? null : Number(form.value), notes: form.notes.trim() || null,
    };
    const { error } = form.id
      ? await supabase.from('equipment').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', form.id)
      : await supabase.from('equipment').insert([{ ...payload, created_by: profile?.id }]);
    setSaving(false);
    if (error) { toast.error('Não foi possível salvar.'); return; }
    toast.success(form.id ? 'Equipamento atualizado ✓' : 'Equipamento cadastrado ✓');
    setModalOpen(false);
    fetchEquipment();
  };

  const doDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('equipment').delete().eq('id', deleteId);
    if (error) { toast.error('Erro ao excluir.'); return; }
    toast.success('Equipamento excluído.');
    setDeleteId(null);
    fetchEquipment();
  };

  const inputCls = 'input-lumos w-full';

  return (
    <div className="space-y-6 font-work-sans">
      <div>
        <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Equipamentos</h1>
        <p className="text-lumos-text-secondary text-sm">Inventário, reservas, manutenção e listas de equipamento por projeto.</p>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-lumos-border overflow-x-auto no-scrollbar">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx('flex items-center gap-2 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors',
              tab === t.key ? 'border-lumos-yellow text-lumos-yellow' : 'border-transparent text-lumos-text-secondary hover:text-lumos-text-primary')}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'reservas' && <ReservasTab equipment={items} projects={projects} />}
      {tab === 'manutencao' && <ManutencaoTab equipment={items} />}
      {tab === 'listas' && <ListasTab equipment={items} projects={projects} />}

      {tab === 'inventario' && (
      <>
      <div className="flex justify-end">
        <button onClick={openNew} className="btn-primary h-10 px-6 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Novo equipamento
        </button>
      </div>

      {/* Busca + filtros */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="card p-3 relative flex-1">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input type="text" placeholder="Buscar por nome, marca, modelo, série…" className="input-lumos pl-9 w-full"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="input-lumos h-11 md:w-52">
          <option value="all">Todas as categorias</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-lumos h-11 md:w-44">
          <option value="all">Todos os status</option>
          {STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="card p-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center text-lumos-text-secondary text-sm italic">
          {items.length === 0 ? 'Nenhum equipamento cadastrado ainda. Clique em “Novo equipamento”.' : 'Nenhum equipamento encontrado com esses filtros.'}
        </div>
      ) : (
        <>
          {/* Grade (desktop/tablet) */}
          <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(e => (
              <div key={e.id} onClick={() => openEdit(e)}
                className="card overflow-hidden flex flex-col hover:border-lumos-yellow/30 cursor-pointer group border border-lumos-border transition-all">
                <div className="h-36 bg-lumos-bg/60 flex items-center justify-center overflow-hidden relative">
                  {e.photo_url
                    ? <img src={e.photo_url} alt={e.name} className="w-full h-full object-cover" />
                    : <Package className="w-10 h-10 text-lumos-text-secondary/30" />}
                  <span className={clsx('absolute top-2 left-2 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border', STATUS[e.status].cls)}>{STATUS[e.status].label}</span>
                  {e.quantity > 1 && <span className="absolute top-2 right-2 text-[10px] font-black px-2 py-0.5 rounded-full bg-black/40 text-white border border-white/10">×{e.quantity}</span>}
                </div>
                <div className="p-3.5 flex-1 flex flex-col">
                  <h3 className="font-bold text-lumos-text-primary line-clamp-1 group-hover:text-lumos-yellow transition-colors">{e.name}</h3>
                  <p className="text-[11px] text-lumos-text-secondary line-clamp-1">{[e.brand, e.model].filter(Boolean).join(' · ') || '—'}</p>
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-lumos-text-secondary">
                    {e.category && <span className="px-2 py-0.5 rounded bg-lumos-text-secondary/10 border border-lumos-border">{e.category}</span>}
                    {e.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{e.location}</span>}
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-lumos-border/40 flex items-center justify-end gap-1">
                    <button onClick={ev => { ev.stopPropagation(); openEdit(e); }} className="p-1.5 text-lumos-text-secondary hover:text-blue-500 rounded hover:bg-blue-500/10 transition-all" title="Editar"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={ev => { ev.stopPropagation(); setDeleteId(e.id); }} className="p-1.5 text-lumos-text-secondary hover:text-red-500 rounded hover:bg-red-500/10 transition-all" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Mobile: cartões */}
          <MobileCardList>
            {filtered.map(e => (
              <MobileCard key={e.id} onClick={() => openEdit(e)}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lumos bg-lumos-bg/60 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {e.photo_url ? <img src={e.photo_url} alt="" className="w-full h-full object-cover" /> : <Package className="w-5 h-5 text-lumos-text-secondary/40" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lumos-text-primary truncate">{e.name}</span>
                      <span className={clsx('text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border flex-shrink-0', STATUS[e.status].cls)}>{STATUS[e.status].label}</span>
                    </div>
                    <div className="text-[11px] text-lumos-text-secondary truncate">
                      {[e.category, [e.brand, e.model].filter(Boolean).join(' '), e.quantity > 1 ? `×${e.quantity}` : null].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <button onClick={ev => { ev.stopPropagation(); setDeleteId(e.id); }} className="p-1.5 text-lumos-text-secondary hover:text-red-500 rounded hover:bg-red-500/10 flex-shrink-0" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                </div>
              </MobileCard>
            ))}
          </MobileCardList>
        </>
      )}
      </>
      )}

      {/* Modal criar/editar */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Editar equipamento' : 'Novo equipamento'} maxWidth="max-w-2xl">
        <div className="space-y-4">
          {/* Foto */}
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-lumos bg-lumos-bg/60 border border-lumos-border flex items-center justify-center overflow-hidden flex-shrink-0">
              {form.photo_url ? <img src={form.photo_url} alt="" className="w-full h-full object-cover" /> : <Package className="w-8 h-8 text-lumos-text-secondary/30" />}
            </div>
            <div className="space-y-1.5">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoto(f); }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-secondary text-xs h-9 px-3 flex items-center gap-2">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />} {form.photo_url ? 'Trocar foto' : 'Adicionar foto'}
              </button>
              {form.photo_url && <button type="button" onClick={() => setForm(f => ({ ...f, photo_url: '' }))} className="block text-[11px] text-lumos-text-secondary hover:text-red-400">Remover foto</button>}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Nome *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="Ex: Sony FX3" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Categoria</label>
              <input list="equip-cats" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={inputCls} placeholder="Ex: Câmera, Lente, Luz, Áudio" />
              <datalist id="equip-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as Status }))} className={inputCls}>
                {STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Marca</label>
              <input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Modelo</label>
              <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Nº de série</label>
              <input value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Quantidade</label>
              <input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Localização</label>
              <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className={inputCls} placeholder="Ex: Armário 2" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Data de compra</label>
              <input type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Valor (R$)</label>
              <input type="number" min={0} step="0.01" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} className={inputCls} placeholder="0,00" />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Observações</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className={inputCls} />
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={save} disabled={saving || uploading} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {form.id ? 'Salvar' : 'Cadastrar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal excluir */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Confirmar exclusão">
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0"><AlertTriangle className="w-6 h-6 text-red-500" /></div>
            <p className="text-sm text-lumos-text-primary font-semibold pt-1">Excluir este equipamento? Não dá pra desfazer.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setDeleteId(null)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={doDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">Excluir</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
