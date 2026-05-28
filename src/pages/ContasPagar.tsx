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
  FileText,
  Check,
  AlertTriangle,
  FileDown
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { clsx } from 'clsx';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/common/Modal';
import { useToast } from '@/context/ToastContext';

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
  const toast = useToast();
  const [payables, setPayables] = useState<any[]>([]);
  const [appUsers, setAppUsers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'due_date', direction: 'desc' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);

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
      const [payablesRes, costsRes, usersRes, projectsRes] = await Promise.all([
        supabase.from('payables').select('*, project:projects(name), responsible:app_users!responsible_id(full_name)').order('due_date', { ascending: true }),
        supabase.from('project_costs').select('*, budget:budgets(project_name), responsible:app_users!responsible_id(full_name)').order('cost_date', { ascending: true }),
        supabase.from('app_users').select('id, full_name').eq('status', 'ativo').order('full_name', { ascending: true }),
        supabase.from('projects').select('id, name, code').order('name', { ascending: true })
      ]);

      const unifiedPayables = [
        ...(payablesRes.data || []).map(p => ({ ...p, _type: 'payable' })),
        ...(costsRes.data || []).map(c => ({ 
          ...c, 
          _type: 'project_cost', 
          due_date: c.cost_date,
          paid_at: c.paid_at || null
        }))
      ].sort((a, b) => new Date(b.due_date || b.created_at).getTime() - new Date(a.due_date || a.created_at).getTime());

      setPayables(unifiedPayables);
      setAppUsers(usersRes.data || []);
      setProjects(projectsRes.data || []);
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
    } catch (error: any) { toast.error(error.message); }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const { error } = await supabase.from('payables').delete().eq('id', deletingId);
      if (error) throw error;
      setIsDeleteModalOpen(false);
      setDeletingId(null);
      fetchData();
    } catch (error: any) { toast.error(error.message); }
  };

  const markAsPaid = async (item: any) => {
    try {
      const table = item._type === 'project_cost' ? 'project_costs' : 'payables';
      const updateData: any = { 
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (item._type === 'project_cost') {
        updateData.status = 'pago';
        updateData.paid_by = profile?.id;
      }
      const { error } = await supabase.from(table).update(updateData).eq('id', item.id);
      if (error) throw error;
      fetchData();
    } catch (error: any) { toast.error(error.message); }
  };

  const handleBatchPaid = async () => {
    const toPay = filtered.filter(p => selectedIds.has(p.id) && !p.paid_at);
    if (toPay.length === 0) return;

    try {
      const payablesIds = toPay.filter(p => p._type === 'payable').map(p => p.id);
      const projectCostsIds = toPay.filter(p => p._type === 'project_cost').map(p => p.id);

      const promises = [];
      if (payablesIds.length > 0) {
        promises.push(supabase.from('payables').update({ paid_at: new Date().toISOString() }).in('id', payablesIds));
      }
      if (projectCostsIds.length > 0) {
        promises.push(supabase.from('project_costs').update({ 
          paid_at: new Date().toISOString(),
          status: 'pago',
          paid_by: profile?.id
        }).in('id', projectCostsIds));
      }

      await Promise.all(promises);
      setSelectedIds(new Set());
      fetchData();
    } catch (error: any) { toast.error(error.message); }
  };

  const handleBatchDelete = async () => {
    const toDelete = filtered.filter(p => selectedIds.has(p.id));
    if (toDelete.length === 0) return;

    try {
      const payablesIds = toDelete.filter(p => p._type === 'payable').map(p => p.id);
      // Project costs usually only readonly in this page, so we only delete payables
      if (payablesIds.length > 0) {
        const { error } = await supabase.from('payables').delete().in('id', payablesIds);
        if (error) throw error;
      }
      
      setIsBatchDeleteModalOpen(false);
      setSelectedIds(new Set());
      fetchData();
    } catch (error: any) { toast.error(error.message); }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(p => p.id)));
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
      const matchesProject = projectFilter === 'all' || p.project_id === projectFilter;
      return matchesSearch && matchesCategory && matchesProject;
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
        <div className="flex gap-2">
          <button
            onClick={() => {
              const rows = filtered.map(p => ({
                'Descrição': p.description,
                'Fornecedor': p.supplier || '',
                'Categoria': p.category || '',
                'Valor (R$)': p.amount,
                'Vencimento': p.due_date ? new Date(p.due_date).toLocaleDateString('pt-BR') : '',
                'Status': p.paid_at ? 'Pago' : 'Pendente',
                'Pago em': p.paid_at ? new Date(p.paid_at).toLocaleDateString('pt-BR') : '',
                'Responsável': p.responsible?.full_name || '',
              }));
              const ws = XLSX.utils.json_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Contas a Pagar');
              XLSX.writeFile(wb, `contas-pagar-${new Date().toISOString().slice(0,10)}.xlsx`);
            }}
            className="btn-secondary h-10 px-4 flex items-center gap-2 text-sm"
          >
            <FileDown className="w-4 h-4" /> Excel
          </button>
          <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="btn-primary h-10 px-6 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Nova Despesa
          </button>
        </div>
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

      <div className="card p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-4 items-center w-full">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
            <input type="text" placeholder="Buscar por descrição ou fornecedor..." className="input-lumos pl-10 w-full" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <select className="input-lumos h-10 px-4 text-sm min-w-[180px]" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="all">Todas as Categorias</option>
            <option value="equipe">Equipe</option>
            <option value="equipamento">Equipamento</option>
            <option value="locacao">Locação</option>
            <option value="software">Software</option>
            <option value="impostos">Impostos</option>
          </select>
          <select className="input-lumos h-10 px-4 text-sm min-w-[200px]" value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
            <option value="all">Todos os Projetos</option>
            {projects.map(proj => (
              <option key={proj.id} value={proj.id}>
                {proj.code ? `#${proj.code} — ${proj.name}` : proj.name}
              </option>
            ))}
          </select>
        </div>
        {(searchTerm || categoryFilter !== 'all' || projectFilter !== 'all') && (
          <div className="flex items-center justify-between text-xs text-lumos-text-secondary pt-2 border-t border-lumos-border/30">
            <span>
              Mostrando <strong className="text-lumos-text-primary">{filtered.length}</strong> de {payables.length} contas
            </span>
            <button
              onClick={() => { setSearchTerm(''); setCategoryFilter('all'); setProjectFilter('all'); }}
              className="text-lumos-yellow hover:underline font-bold uppercase tracking-widest text-[10px]"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                <th className="px-6 py-4 w-10">
                  <div 
                    onClick={toggleSelectAll}
                    className={clsx(
                      "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                      selectedIds.size === filtered.length && filtered.length > 0
                        ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                        : "border-lumos-border hover:border-lumos-yellow/50"
                    )}
                  >
                    {selectedIds.size === filtered.length && filtered.length > 0 && <Check className="w-3.5 h-3.5" />}
                  </div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('due_date')}>
                  <div className="flex items-center gap-1">Vencimento <SortIcon column="due_date" /></div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('description')}>
                  <div className="flex items-center gap-1">Descrição <SortIcon column="description" /></div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('created_at')}>
                  <div className="flex items-center gap-1">Cadastro <SortIcon column="created_at" /></div>
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
                <tr><td colSpan={8} className="py-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-lumos-text-secondary text-sm italic">Nenhuma conta encontrada.</td></tr>
              ) : (
                filtered.map((p) => (
                  <tr 
                    key={p.id} 
                    className={clsx(
                      "hover:bg-lumos-text-primary/5 transition-colors group cursor-pointer",
                      selectedIds.has(p.id) && "bg-lumos-yellow/[0.03]"
                    )}
                    onClick={() => p._type === 'payable' ? handleEdit(p) : null}
                  >
                    <td className="px-6 py-4">
                      <div 
                        onClick={(e) => toggleSelect(p.id, e)}
                        className={clsx(
                          "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                          selectedIds.has(p.id)
                            ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                            : "border-lumos-border group-hover:border-lumos-yellow/50 opacity-0 group-hover:opacity-100",
                          selectedIds.size > 0 && "opacity-100"
                        )}
                      >
                        {selectedIds.has(p.id) && <Check className="w-3.5 h-3.5" />}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-lumos-text-primary">
                      {p.due_date ? new Date(p.due_date).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          {p.project_id ? (
                            <Link to={`/financeiro/custos-projeto/${p.project_id}`} className="text-sm font-bold text-lumos-text-primary hover:text-lumos-yellow transition-colors flex items-center gap-1.5 group/link">
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
                          {p._type === 'project_cost' 
                            ? `PROJETO: ${p.budget?.project_name}` 
                            : p.project?.name 
                              ? `PROJETO: ${p.project.name}` 
                              : p.category}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-lumos-text-secondary">
                      {p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '—'}
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

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
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
                onClick={handleBatchPaid}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-lumos-yellow text-lumos-bg font-black text-xs uppercase hover:scale-105 active:scale-95 transition-all"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Marcar Pago
              </button>
              
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
              <p className="text-xs text-lumos-text-secondary">Você selecionou {selectedIds.size} itens. Apenas despesas fixas (Contas a Pagar) serão removidas. Custos de projeto não serão alterados por esta ação.</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsBatchDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleBatchDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">Sim, Excluir</button>
          </div>
        </div>
      </Modal>

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
