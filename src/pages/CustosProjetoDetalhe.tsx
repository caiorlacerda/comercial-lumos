import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Plus, AlertTriangle, Target, Edit2, Trash2, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/common/Modal';

const CurrencyInput = ({ value, onChange, className }: any) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, "");
    const numberValue = rawValue ? parseInt(rawValue) / 100 : 0;
    onChange(numberValue);
  };
  return <input type="text" className={className} value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)} onChange={handleChange} />;
};

export default function CustosProjetoDetalhe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [project, setProject] = useState<any>(null);
  const [costs, setCosts] = useState<any[]>([]);
  const [appUsers, setAppUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ description: '', amount: 0, cost_date: new Date().toISOString().split('T')[0], category: 'equipe', supplier: '', responsible_id: '', notes: '' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);

  useEffect(() => { fetchProjectData(); }, [id]);

  async function fetchProjectData() {
    try {
      setLoading(true);
      const [projectRes, costsRes, usersRes] = await Promise.all([
        supabase.from('budgets').select('id, project_name, client:clients(name), receivable:receivables(total_amount)').eq('id', id).single(),
        supabase.from('project_costs').select('*, responsible:app_users!responsible_id(full_name)').eq('budget_id', id).order('cost_date', { ascending: false }),
        supabase.from('app_users').select('id, full_name').eq('status', 'ativo')
      ]);
      setProject(projectRes.data);
      setCosts(costsRes.data || []);
      setAppUsers(usersRes.data || []);
    } catch (error) { navigate('/financeiro/custos-projeto'); } finally { setLoading(false); }
  }

  const handleAddCost = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        const { error } = await supabase.from('project_costs').update({ ...formData, updated_at: new Date().toISOString() }).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('project_costs').insert([{ ...formData, budget_id: id, created_by: profile?.id }]);
        if (error) throw error;
      }
      setIsModalOpen(false);
      setEditingId(null);
      fetchProjectData();
      resetForm();
    } catch (error: any) { alert(error.message); }
  };

  const handleDeleteCost = async () => {
    if (!deletingId) return;
    try {
      const { error } = await supabase.from('project_costs').delete().eq('id', deletingId);
      if (error) throw error;
      setIsDeleteModalOpen(false);
      setDeletingId(null);
      fetchProjectData();
    } catch (error: any) { alert(error.message); }
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    try {
      const { error } = await supabase.from('project_costs').delete().in('id', ids);
      if (error) throw error;
      setIsBatchDeleteModalOpen(false);
      setSelectedIds(new Set());
      fetchProjectData();
    } catch (error: any) { alert(error.message); }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === costs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(costs.map(c => c.id)));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({ description: '', amount: 0, cost_date: new Date().toISOString().split('T')[0], category: 'equipe', supplier: '', responsible_id: '', notes: '' });
  };

  const handleEdit = (c: any) => {
    setEditingId(c.id);
    setFormData({
      description: c.description,
      amount: c.amount,
      cost_date: c.cost_date,
      category: c.category,
      supplier: c.supplier || '',
      responsible_id: c.responsible_id || '',
      notes: c.notes || ''
    });
    setIsModalOpen(true);
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen bg-lumos-bg"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-lumos-yellow"></div></div>;

  const totalAmount = project?.receivable?.[0]?.total_amount || 0;
  const totalCosts = costs.reduce((acc, c) => acc + c.amount, 0);
  const margin = totalAmount - totalCosts;
  const consumptionPercent = totalAmount > 0 ? (totalCosts / totalAmount) * 100 : 0;

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/financeiro/custos-projeto')} className="p-2 bg-lumos-text-primary/5 rounded-full hover:bg-lumos-text-primary/10 transition-all"><ArrowLeft className="w-5 h-5 text-lumos-text-primary" /></button>
          <div>
            <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">{project?.project_name}</h1>
            <p className="text-lumos-text-secondary text-sm">Cliente: <span className="text-lumos-text-primary font-bold">{project?.client?.name}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to={`/orcamentos/${project?.id}`} className="btn-secondary flex items-center gap-2 h-10 px-4 text-xs"><ExternalLink className="w-4 h-4" /> Ver Orçamento</Link>
          <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="btn-primary h-10 px-6 flex items-center gap-2"><Plus className="w-4 h-4" /> Registrar Custo</button>
        </div>
      </div>

      {consumptionPercent > 90 && <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-lumos flex items-center gap-3 animate-pulse"><AlertTriangle className="w-5 h-5 text-red-500" /><p className="text-sm font-bold text-red-500 uppercase">Atenção Crítica: Consumo de {consumptionPercent.toFixed(1)}%!</p></div>}
      {consumptionPercent > 70 && consumptionPercent <= 90 && <div className="bg-yellow-500/10 border border-yellow-500/50 p-4 rounded-lumos flex items-center gap-3"><AlertTriangle className="w-5 h-5 text-yellow-500" /><p className="text-sm font-bold text-yellow-500 uppercase">Aviso: Consumo de {consumptionPercent.toFixed(1)}%.</p></div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-6">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">Valor Disponível para Produção</p>
          <p className="text-2xl font-black text-lumos-text-primary tracking-tight">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalAmount)}</p>
        </div>
        <div className="card p-6">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">Total de Custos</p>
          <p className="text-2xl font-black text-lumos-text-primary tracking-tight">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalCosts)}</p>
        </div>
        <div className="card p-6">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">Margem Real</p>
          <p className={`text-2xl font-black tracking-tight ${margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(margin)}</p>
        </div>
      </div>

      <div className="card p-6 space-y-4">
        <div className="flex justify-between items-end"><p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Saúde do Orçamento</p><p className="text-xs font-black text-lumos-text-primary">{consumptionPercent.toFixed(1)}%</p></div>
        <div className="w-full h-4 bg-lumos-text-primary/5 rounded-full overflow-hidden border border-lumos-border p-0.5">
          <div className={`h-full rounded-full transition-all duration-1000 ${consumptionPercent > 90 ? 'bg-red-500' : consumptionPercent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(consumptionPercent, 100)}%` }} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                {profile?.role === 'admin' && (
                  <th className="px-6 py-4 w-10">
                    <div 
                      onClick={toggleSelectAll}
                      className={clsx(
                        "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                        selectedIds.size === costs.length && costs.length > 0
                          ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                          : "border-lumos-border hover:border-lumos-yellow/50"
                      )}
                    >
                      {selectedIds.size === costs.length && costs.length > 0 && <Check className="w-3.5 h-3.5" />}
                    </div>
                  </th>
                )}
                <th className="px-6 py-4">Data</th>
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Categoria</th>
                 <th className="px-6 py-4 text-right">Valor</th>
                {profile?.role === 'admin' && <th className="px-6 py-4 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {costs.map((c) => (
                <tr 
                  key={c.id} 
                  className={clsx(
                    "hover:bg-lumos-text-primary/5 transition-colors cursor-pointer group",
                    selectedIds.has(c.id) && "bg-lumos-yellow/[0.03]"
                  )}
                  onClick={() => profile?.role === 'admin' ? handleEdit(c) : null}
                >
                  {profile?.role === 'admin' && (
                    <td className="px-6 py-4">
                      <div 
                        onClick={(e) => toggleSelect(c.id, e)}
                        className={clsx(
                          "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                          selectedIds.has(c.id)
                            ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                            : "border-lumos-border group-hover:border-lumos-yellow/50 opacity-0 group-hover:opacity-100",
                          selectedIds.size > 0 && "opacity-100"
                        )}
                      >
                        {selectedIds.has(c.id) && <Check className="w-3.5 h-3.5" />}
                      </div>
                    </td>
                  )}
                  <td className="px-6 py-4 text-sm text-lumos-text-secondary">{new Date(c.cost_date).toLocaleDateString('pt-BR')}</td>
                  <td className="px-6 py-4 text-sm font-bold text-lumos-text-primary">{c.description}</td>
                  <td className="px-6 py-4 text-[10px] font-bold text-lumos-text-secondary uppercase">{c.category}</td>
                   <td className="px-6 py-4 text-right text-sm font-bold text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c.amount)}</td>
                  {profile?.role === 'admin' && (
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(c)} className="p-1.5 text-lumos-text-secondary hover:text-blue-500 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => { setDeletingId(c.id); setIsDeleteModalOpen(true); }} className="p-1.5 text-lumos-text-secondary hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Batch Action Bar */}
      {profile?.role === 'admin' && selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-lumos-surface border border-lumos-yellow/20 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-full px-6 py-4 flex items-center gap-6 backdrop-blur-xl">
            <div className="flex items-center gap-3 pr-6 border-r border-lumos-border">
              <div className="w-8 h-8 rounded-full bg-lumos-yellow/20 flex items-center justify-center font-black text-lumos-yellow text-sm">
                {selectedIds.size}
              </div>
              <span className="text-sm font-bold text-lumos-text-primary uppercase tracking-tight">
                {selectedIds.size === 1 ? 'Item selecionado' : 'Itens selecionados'}
              </span>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsBatchDeleteModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 text-red-500 font-black text-xs uppercase hover:bg-red-500 hover:text-white transition-all active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Excluir
              </button>

              <button 
                onClick={() => setSelectedIds(new Set())}
                className="p-2 text-lumos-text-secondary hover:text-lumos-text-primary transition-colors text-xs font-bold uppercase"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      <Modal
        isOpen={isBatchDeleteModalOpen}
        onClose={() => setIsBatchDeleteModalOpen(false)}
        title="Excluir Itens"
      >
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-1">
              <p className="text-lumos-text-primary font-bold">Confirma a exclusão em lote?</p>
              <p className="text-xs text-lumos-text-secondary">Você selecionou {selectedIds.size} custos para exclusão permanente deste projeto. Esta ação não pode ser desfeita.</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsBatchDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleBatchDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">Sim, Excluir</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? 'Editar Custo' : 'Registrar Custo'}>
        <form onSubmit={handleAddCost} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Descrição</label>
            <input required type="text" className="input-lumos w-full" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Valor</label>
              <CurrencyInput className="input-lumos w-full font-bold" value={formData.amount} onChange={(val: number) => setFormData({...formData, amount: val})} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Data</label>
              <input required type="date" className="input-lumos w-full" value={formData.cost_date} onChange={e => setFormData({...formData, cost_date: e.target.value})} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Categoria</label>
              <select className="input-lumos w-full" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                <option value="equipe">Equipe</option>
                <option value="equipamento">Equipamento</option>
                <option value="locacao">Locação</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Responsável</label>
              <select className="input-lumos w-full" value={formData.responsible_id} onChange={e => setFormData({...formData, responsible_id: e.target.value})}>
                <option value="">Selecione</option>
                {appUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 h-10">{editingId ? 'Salvar Alterações' : 'Salvar'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Confirmar Exclusão">
        <div className="space-y-4">
          <p className="text-sm text-lumos-text-secondary">Tem certeza que deseja excluir este custo? Esta ação não pode ser desfeita.</p>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleDeleteCost} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">Excluir permanentemente</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
