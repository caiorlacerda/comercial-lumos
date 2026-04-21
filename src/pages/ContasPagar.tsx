import React, { useEffect, useState } from 'react';
import { 
  ArrowUpCircle, 
  Plus, 
  Search, 
  CheckCircle2, 
  Calendar, 
  MoreVertical,
  Edit2,
  Trash2,
  ChevronUp,
  ChevronDown,
  FileText
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/common/Modal';

const CurrencyInput = ({ value, onChange, className }: any) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, "");
    const numberValue = rawValue ? parseInt(rawValue) / 100 : 0;
    onChange(numberValue);
  };
  const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  return <input type="text" className={className} value={formattedValue} onChange={handleChange} />;
};

export default function ContasPagar() {
  const { profile } = useAuth();
  const [payables, setPayables] = useState<any[]>([]);
  const [appUsers, setAppUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'due_date', direction: 'desc' });

  const [formData, setFormData] = useState({
    description: '',
    amount: 0,
    due_date: new Date().toISOString().split('T')[0],
    category: 'equipe',
    supplier: '',
    responsible_id: '',
    payment_method: 'pix',
    notes: '',
    isRecurring: false,
    frequency: 'mensal'
  });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const [payablesRes, costsRes, usersRes] = await Promise.all([
        supabase.from('payables').select('*, responsible:app_users!responsible_id(full_name)').order('due_date', { ascending: true }),
        supabase.from('project_costs').select('*, budget:budgets(project_name), responsible:app_users!responsible_id(full_name)').order('cost_date', { ascending: true }),
        supabase.from('app_users').select('id, full_name').eq('status', 'ativo')
      ]);

      const unifiedPayables = [
        ...(payablesRes.data || []).map(p => ({ ...p, _type: 'payable' })),
        ...(costsRes.data || []).map(c => ({ 
          ...c, 
          _type: 'project_cost', 
          due_date: c.cost_date,
          paid_at: c.paid_at || null // project_costs pode ter paid_at? Assumindo que não por enquanto ou mapeando
        }))
      ].sort((a, b) => new Date(b.due_date || b.created_at).getTime() - new Date(a.due_date || a.created_at).getTime());

      setPayables(unifiedPayables);
      setAppUsers(usersRes.data || []);
    } catch (error) {
      console.error('Erro ao buscar dados:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        const { error } = await supabase.from('payables').update({
          description: formData.description,
          amount: formData.amount,
          due_date: formData.due_date,
          category: formData.category,
          supplier: formData.supplier,
          responsible_id: formData.responsible_id || null,
          payment_method: formData.payment_method,
          notes: formData.notes,
          updated_at: new Date().toISOString()
        }).eq('id', editingId);
        if (error) throw error;
      } else if (formData.isRecurring) {
        const occurrences = [];
        let currentDate = new Date(formData.due_date + 'T12:00:00'); // Use noon to avoid TZ issues
        const endDate = new Date();
        endDate.setFullYear(endDate.getFullYear() + 1);

        while (currentDate <= endDate) {
          occurrences.push({
            description: formData.description,
            amount: formData.amount,
            due_date: currentDate.toISOString().split('T')[0],
            category: formData.category,
            supplier: formData.supplier,
            responsible_id: formData.responsible_id || null,
            payment_method: formData.payment_method,
            notes: formData.notes,
            created_by: profile?.id
          });
          
          if (formData.frequency === 'semanal') currentDate.setDate(currentDate.getDate() + 7);
          else if (formData.frequency === 'mensal') currentDate.setMonth(currentDate.getMonth() + 1);
          else if (formData.frequency === 'bimestral') currentDate.setMonth(currentDate.getMonth() + 2);
          else if (formData.frequency === 'trimestral') currentDate.setMonth(currentDate.getMonth() + 3);
          else if (formData.frequency === 'semestral') currentDate.setMonth(currentDate.getMonth() + 6);
          else if (formData.frequency === 'anual') currentDate.setFullYear(currentDate.getFullYear() + 1);
          else break;
        }
        const { error } = await supabase.from('payables').insert(occurrences);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('payables').insert([{
          description: formData.description,
          amount: formData.amount,
          due_date: formData.due_date,
          category: formData.category,
          supplier: formData.supplier,
          responsible_id: formData.responsible_id || null,
          payment_method: formData.payment_method,
          notes: formData.notes,
          created_by: profile?.id
        }]);
        if (error) throw error;
      }
      setIsModalOpen(false);
      setEditingId(null);
      fetchData();
      resetForm();
    } catch (error: any) { alert(error.message); }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const { error } = await supabase.from('payables').delete().eq('id', deletingId);
      if (error) throw error;
      setIsDeleteModalOpen(false);
      setDeletingId(null);
      fetchData();
    } catch (error: any) { alert(error.message); }
  };

  const markAsPaid = async (item: any) => {
    try {
      const table = item._type === 'project_cost' ? 'project_costs' : 'payables';
      const { error } = await supabase.from(table).update({ 
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', item.id);
      if (error) throw error;
      fetchData();
    } catch (error: any) { alert(error.message); }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      description: '',
      amount: 0,
      due_date: new Date().toISOString().split('T')[0],
      category: 'equipe',
      supplier: '',
      responsible_id: '',
      payment_method: 'pix',
      notes: '',
      isRecurring: false,
      frequency: 'mensal'
    });
  };

  const handleEdit = (p: any) => {
    setEditingId(p.id);
    setFormData({
      description: p.description,
      amount: p.amount,
      due_date: p.due_date,
      category: p.category,
      supplier: p.supplier || '',
      responsible_id: p.responsible_id || '',
      payment_method: p.payment_method || 'pix',
      notes: p.notes || '',
      isRecurring: false,
      frequency: 'mensal'
    });
    setIsModalOpen(true);
    setActiveMenuId(null);
  };

  const stats = {
    pending: payables.filter(p => !p.paid_at).reduce((acc, p) => acc + p.amount, 0),
    paidMonth: payables.filter(p => p.paid_at && new Date(p.paid_at).getMonth() === new Date().getMonth()).reduce((acc, p) => acc + p.amount, 0),
    overdueCount: payables.filter(p => !p.paid_at && p.due_date && new Date(p.due_date) < new Date()).length
  };

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const filtered = payables
    .filter(p => {
      const matchesSearch = p.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           (p.supplier && p.supplier.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === 'status') {
        aVal = a.paid_at ? 'pago' : 'pendente';
        bVal = b.paid_at ? 'pago' : 'pendente';
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

  const SortIcon = ({ column }: { column: string }) => {
    if (sortConfig.key !== column) return null;
    return sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Contas a Pagar</h1>
          <p className="text-lumos-text-secondary text-sm">Gestão de despesas fixas, fornecedores e equipe.</p>
        </div>
        <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="btn-primary h-10 px-6 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nova Despesa
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5 border-l-4 border-lumos-yellow/50">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest mb-1">Total Pendente</p>
          <p className="text-2xl font-black text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.pending)}</p>
        </div>
        <div className="card p-5 border-l-4 border-green-500/50">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest mb-1">Pago no Mês</p>
          <p className="text-2xl font-black text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.paidMonth)}</p>
        </div>
        <div className="card p-5 border-l-4 border-red-500/50">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest mb-1">Contas Atrasadas</p>
          <p className="text-2xl font-black text-red-500">{stats.overdueCount}</p>
        </div>
      </div>

      <div className="card p-4 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input type="text" placeholder="Buscar por descrição ou fornecedor..." className="input-lumos pl-10 w-full" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <select className="input-lumos h-10 px-4 text-sm" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="all">Todas as Categorias</option>
          <option value="equipe">Equipe</option>
          <option value="equipamento">Equipamento</option>
          <option value="locacao">Locação</option>
          <option value="software">Software</option>
          <option value="impostos">Impostos</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                <th className="px-6 py-4 cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('due_date')}>
                  <div className="flex items-center gap-1">Vencimento <SortIcon column="due_date" /></div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('description')}>
                  <div className="flex items-center gap-1">Descrição <SortIcon column="description" /></div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('supplier')}>
                  <div className="flex items-center gap-1">Fornecedor <SortIcon column="supplier" /></div>
                </th>
                <th className="px-6 py-4 text-right cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('amount')}>
                  <div className="flex items-center justify-end gap-1">Valor <SortIcon column="amount" /></div>
                </th>
                <th className="px-6 py-4 text-center cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('status')}>
                  <div className="flex items-center justify-center gap-1">Status <SortIcon column="status" /></div>
                </th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {loading ? (
                <tr><td colSpan={6} className="py-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-lumos-text-secondary text-sm italic">Nenhuma conta encontrada.</td></tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-lumos-text-primary/5 transition-colors group">
                    <td className="px-6 py-4 text-sm font-bold text-lumos-text-primary">
                      {p.due_date ? new Date(p.due_date).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          {p._type === 'project_cost' ? (
                            <Link to={`/financeiro/custos-projeto/${p.budget_id}`} className="text-sm font-bold text-lumos-text-primary hover:text-lumos-yellow transition-colors flex items-center gap-1.5 group/link">
                              {p.description} <FileText className="w-3 h-3 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                            </Link>
                          ) : (
                            <span className="text-sm font-bold text-lumos-text-primary">{p.description}</span>
                          )}
                          {p._type === 'project_cost' && (
                            <span className="bg-blue-500/10 text-blue-500 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter border border-blue-500/20">Projeto</span>
                          )}
                        </div>
                        <span className="text-[10px] text-lumos-text-secondary uppercase tracking-tighter">
                          {p._type === 'project_cost' ? `PROJETO: ${p.budget?.project_name}` : p.category}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-lumos-text-secondary">{p.supplier || '—'}</td>
                    <td className="px-6 py-4 text-right text-sm font-black text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.amount)}</td>
                    <td className="px-6 py-4 text-center">
                      {p.paid_at ? (
                        <span className="inline-flex items-center text-[10px] font-bold text-green-500 uppercase bg-green-500/10 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-2.5 h-2.5 mr-1" /> Pago</span>
                      ) : p._type === 'payable' ? (
                        <span className="inline-flex items-center text-[10px] font-bold text-yellow-500 uppercase bg-yellow-500/10 px-2 py-0.5 rounded-full"><Calendar className="w-2.5 h-2.5 mr-1" /> Pendente</span>
                      ) : (
                        <span className="text-[10px] text-lumos-text-secondary italic">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 relative">
                        {!p.paid_at && <button onClick={() => markAsPaid(p)} className="btn-primary text-[10px] px-3 py-1.5 h-auto">Pagar</button>}
                        {p._type === 'payable' ? (
                          <div className="relative">
                            <button 
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setMenuPosition({ top: rect.bottom + 8, left: rect.right - 128 });
                                setActiveMenuId(activeMenuId === p.id ? null : p.id);
                              }}
                              className="p-2 text-lumos-text-secondary hover:text-lumos-text-primary rounded hover:bg-lumos-text-primary/5 transition-all"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            
                            {activeMenuId === p.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setActiveMenuId(null)}></div>
                                <div 
                                  className="fixed w-32 bg-lumos-surface border border-lumos-border rounded-lumos shadow-xl z-20 py-1 animate-in fade-in zoom-in-95 duration-100"
                                  style={{ top: menuPosition.top, left: menuPosition.left }}
                                >
                                  <button 
                                    onClick={() => handleEdit(p)}
                                    className="w-full text-left px-3 py-2 text-xs font-bold text-lumos-text-primary hover:bg-lumos-text-primary/5 flex items-center gap-2"
                                  >
                                    <Edit2 className="w-3 h-3 text-blue-500" /> Editar
                                  </button>
                                  <button 
                                    onClick={() => { setDeletingId(p.id); setIsDeleteModalOpen(true); setActiveMenuId(null); }}
                                    className="w-full text-left px-3 py-2 text-xs font-bold text-red-500 hover:bg-red-500/5 flex items-center gap-2"
                                  >
                                    <Trash2 className="w-3 h-3" /> Excluir
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-lumos-text-secondary italic">Somente leitura</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Nova Despesa">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Descrição</label>
            <input required type="text" className="input-lumos w-full" placeholder="Ex: Licença Adobe Creative Cloud" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Valor (R$)</label>
              <CurrencyInput className="input-lumos w-full font-bold" value={formData.amount} onChange={(val: number) => setFormData({...formData, amount: val})} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Vencimento</label>
              <input required type="date" className="input-lumos w-full" value={formData.due_date} onChange={e => setFormData({...formData, due_date: e.target.value})} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Categoria</label>
              <select className="input-lumos w-full" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                <option value="equipe">Equipe</option>
                <option value="equipamento">Equipamento</option>
                <option value="locacao">Locação</option>
                <option value="software">Software / SaaS</option>
                <option value="impostos">Impostos</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Responsável</label>
              <select className="input-lumos w-full" value={formData.responsible_id} onChange={e => setFormData({...formData, responsible_id: e.target.value})}>
                <option value="">Selecione um responsável</option>
                {appUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Fornecedor</label>
            <input type="text" className="input-lumos w-full" placeholder="Ex: Adobe Systems" value={formData.supplier} onChange={e => setFormData({...formData, supplier: e.target.value})} />
          </div>
          {!editingId && (
            <div className="p-4 bg-lumos-text-primary/5 rounded-lumos border border-lumos-border space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-lumos-text-primary uppercase tracking-widest">Despesa recorrente</p>
                  <p className="text-[10px] text-lumos-text-secondary italic">Repetir automaticamente nos próximos 12 meses</p>
                </div>
                <button 
                  type="button"
                  onClick={() => setFormData({ ...formData, isRecurring: !formData.isRecurring })}
                  className={`w-10 h-5 rounded-full transition-all relative ${formData.isRecurring ? 'bg-lumos-yellow' : 'bg-lumos-text-primary/20'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${formData.isRecurring ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
              {formData.isRecurring && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Frequência</label>
                  <select 
                    className="input-lumos w-full h-8 text-xs" 
                    value={formData.frequency} 
                    onChange={e => setFormData({...formData, frequency: e.target.value})}
                  >
                    <option value="semanal">Semanal</option>
                    <option value="mensal">Mensal</option>
                    <option value="bimestral">Bimestral (A cada 2 meses)</option>
                    <option value="trimestral">Trimestral (A cada 3 meses)</option>
                    <option value="semestral">Semestral (A cada 6 meses)</option>
                    <option value="anual">Anual</option>
                  </select>
                </div>
              )}
            </div>
          )}
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 h-10">{editingId ? 'Salvar Alterações' : 'Cadastrar Despesa'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Confirmar Exclusão">
        <div className="space-y-4">
          <p className="text-sm text-lumos-text-secondary">Tem certeza que deseja excluir esta despesa? Esta ação não pode ser desfeita.</p>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">Excluir permanentemente</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
