import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Save, Download, FileStack, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';

interface Equip { id: string; name: string; }
interface Proj { id: string; name: string; code?: string | null; }
interface Item { id: string; equipment_id: string; quantity: number; }
interface Template { id: string; name: string; items: { equipment_id: string; quantity: number }[] }

export default function ListasTab({ equipment, projects }: { equipment: Equip[]; projects: Proj[] }) {
  const toast = useToast();
  const { profile } = useAuth();
  const [projectId, setProjectId] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [addEq, setAddEq] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [busy, setBusy] = useState(false);

  const nameOf = useMemo(() => Object.fromEntries(equipment.map(e => [e.id, e.name])), [equipment]);

  useEffect(() => { loadTemplates(); }, []);
  useEffect(() => { if (projectId) loadItems(); else setItems([]); }, [projectId]);

  async function loadItems() {
    setLoading(true);
    const { data } = await supabase.from('project_equipment').select('id, equipment_id, quantity').eq('project_id', projectId).order('created_at');
    setItems((data as Item[]) || []);
    setLoading(false);
  }
  async function loadTemplates() {
    const { data } = await supabase.from('equipment_list_templates').select('id, name, items').order('name');
    setTemplates((data as Template[]) || []);
  }

  const addItem = async () => {
    if (!projectId || !addEq) { toast.error('Escolha o projeto e o equipamento.'); return; }
    setBusy(true);
    const { error } = await supabase.from('project_equipment').insert([{ project_id: projectId, equipment_id: addEq, quantity: Number(addQty) || 1 }]);
    setBusy(false);
    if (error) { toast.error('Não foi possível adicionar.'); return; }
    setAddEq(''); setAddQty(1);
    loadItems();
  };

  const removeItem = async (id: string) => {
    const { error } = await supabase.from('project_equipment').delete().eq('id', id);
    if (error) { toast.error('Erro ao remover.'); return; }
    loadItems();
  };

  const saveAsTemplate = async () => {
    if (!items.length) { toast.error('A lista está vazia.'); return; }
    const name = window.prompt('Nome do template:');
    if (!name?.trim()) return;
    const { error } = await supabase.from('equipment_list_templates').insert([{
      name: name.trim(), items: items.map(i => ({ equipment_id: i.equipment_id, quantity: i.quantity })), created_by: profile?.id,
    }]);
    if (error) { toast.error('Não foi possível salvar o template.'); return; }
    toast.success('Template salvo ✓');
    loadTemplates();
  };

  const applyTemplate = async (t: Template) => {
    if (!projectId) { toast.error('Escolha um projeto primeiro.'); return; }
    if (!t.items?.length) { toast.error('Template vazio.'); return; }
    setBusy(true);
    const rows = t.items.map(i => ({ project_id: projectId, equipment_id: i.equipment_id, quantity: i.quantity || 1 }));
    const { error } = await supabase.from('project_equipment').insert(rows);
    setBusy(false);
    if (error) { toast.error('Não foi possível puxar o template.'); return; }
    toast.success(`Template "${t.name}" adicionado à lista.`);
    loadItems();
  };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase.from('equipment_list_templates').delete().eq('id', id);
    if (error) { toast.error('Erro ao excluir template.'); return; }
    loadTemplates();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Lista do projeto */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Projeto</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input-lumos w-full">
              <option value="">Selecione um projeto…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}
            </select>
          </div>
          {projectId && items.length > 0 && (
            <button onClick={saveAsTemplate} className="btn-secondary h-11 px-4 flex items-center gap-2 text-sm"><Save className="w-4 h-4" /> Salvar como template</button>
          )}
        </div>

        {!projectId ? (
          <div className="card p-12 text-center text-lumos-text-secondary text-sm italic">Escolha um projeto pra montar a lista de equipamento dele.</div>
        ) : (
          <div className="card p-4 space-y-3">
            {/* adicionar item */}
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={addEq} onChange={e => setAddEq(e.target.value)} className="input-lumos flex-1">
                <option value="">Adicionar equipamento…</option>
                {equipment.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <input type="number" min={1} value={addQty} onChange={e => setAddQty(Number(e.target.value))} className="input-lumos w-20" title="Quantidade" />
              <button onClick={addItem} disabled={busy || !addEq} className="btn-primary h-11 px-4 flex items-center gap-1.5"><Plus className="w-4 h-4" /> Adicionar</button>
            </div>

            {loading ? (
              <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow mx-auto" /></div>
            ) : items.length === 0 ? (
              <p className="text-sm text-lumos-text-secondary/70 italic py-4 text-center">Lista vazia. Adicione equipamentos acima ou puxe um template.</p>
            ) : (
              <ul className="divide-y divide-lumos-border/50">
                {items.map(i => (
                  <li key={i.id} className="flex items-center gap-2 py-2">
                    <span className="flex-1 text-sm text-lumos-text-primary truncate">{nameOf[i.equipment_id] || 'Equipamento'}</span>
                    <span className="text-xs font-bold text-lumos-text-secondary">×{i.quantity}</span>
                    <button onClick={() => removeItem(i.id)} className="p-1.5 text-lumos-text-secondary hover:text-red-500 rounded hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Templates */}
      <div className="space-y-3">
        <h3 className="text-sm font-black uppercase tracking-wider text-lumos-text-secondary flex items-center gap-2"><FileStack className="w-4 h-4" /> Templates de lista</h3>
        {templates.length === 0 ? (
          <div className="card p-6 text-center text-lumos-text-secondary text-xs italic">Nenhum template ainda. Monte a lista de um projeto e clique em “Salvar como template”.</div>
        ) : (
          <div className="space-y-2">
            {templates.map(t => (
              <div key={t.id} className="card p-3 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-lumos-text-primary truncate">{t.name}</div>
                  <div className="text-[11px] text-lumos-text-secondary">{t.items?.length || 0} item(ns)</div>
                </div>
                <button onClick={() => applyTemplate(t)} disabled={!projectId || busy} title={projectId ? 'Puxar pro projeto selecionado' : 'Escolha um projeto primeiro'}
                  className="flex items-center gap-1 text-xs font-bold text-lumos-yellow hover:bg-lumos-yellow/10 px-2 py-1.5 rounded border border-lumos-yellow/20 disabled:opacity-40"><Download className="w-3.5 h-3.5" /> Puxar</button>
                <button onClick={() => deleteTemplate(t.id)} className="p-1.5 text-lumos-text-secondary hover:text-red-500 rounded hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
