import React, { useEffect, useState } from 'react';
import { 
  ArrowUpCircle, 
  Plus, 
  Search, 
  CheckCircle2, 
  Calendar, 
  MoreVertical
} from 'lucide-react';
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [formData, setFormData] = useState({
    description: '',
    amount: 0,
    due_date: new Date().toISOString().split('T')[0],
    category: 'equipe',
    supplier: '',
    responsible_id: '',
    payment_method: 'pix',
    notes: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const [payablesRes, usersRes] = await Promise.all([
        supabase.from('payables').select('*, responsible:app_users!responsible_id(full_name)').order('due_date', { ascending: true }),
        supabase.from('app_users').select('id, full_name').eq('status', 'ativo')
      ]);
      setPayables(payablesRes.data || []);
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
      const { error } = await supabase.from('payables').insert([{
        ...formData,
        created_by: profile?.id,
        responsible_id: formData.responsible_id || null
      }]);
      if (error) throw error;
      setIsModalOpen(false);
      fetchData();
      resetForm();
    } catch (error: any) { alert(error.message); }
  };

  const markAsPaid = async (id: string) => {
    try {
      const { error } = await supabase.from('payables').update({ 
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', id);
      if (error) throw error;
      fetchData();
    } catch (error: any) { alert(error.message); }
  };

  const resetForm = () => {
    setFormData({
      description: '',
      amount: 0,
      due_date: new Date().toISOString().split('T')[0],
      category: 'equipe',
      supplier: '',
      responsible_id: '',
      payment_method: 'pix',
      notes: ''
    });
  };

  const stats = {
    pending: payables.filter(p => !p.paid_at).reduce((acc, p) => acc + p.amount, 0),
    paidMonth: payables.filter(p => p.paid_at && new Date(p.paid_at).getMonth() === new Date().getMonth()).reduce((acc, p) => acc + p.amount, 0),
    overdueCount: payables.filter(p => !p.paid_at && new Date(p.due_date) < new Date()).length
  };

  const filtered = payables.filter(p => {
    const matchesSearch = p.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         (p.supplier && p.supplier.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Contas a Pagar</h1>
          <p className="text-lumos-text-secondary text-sm">Gestão de despesas fixas, fornecedores e equipe.</p>
        </div>
        <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="btn-primary h-10 px-6 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nova Despesa
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5 border-l-4 border-lumos-yellow/50 bg-[#2a2a2a]">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest mb-1">Total Pendente</p>
          <p className="text-2xl font-black text-white">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.pending)}</p>
        </div>
        <div className="card p-5 border-l-4 border-green-500/50 bg-[#2a2a2a]">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest mb-1">Pago no Mês</p>
          <p className="text-2xl font-black text-white">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.paidMonth)}</p>
        </div>
        <div className="card p-5 border-l-4 border-red-500/50 bg-[#2a2a2a]">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest mb-1">Contas Atrasadas</p>
          <p className="text-2xl font-black text-red-500">{stats.overdueCount}</p>
        </div>
      </div>

      <div className="card p-4 flex flex-col md:flex-row gap-4 items-center bg-[#2a2a2a]">
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

      <div className="card overflow-hidden bg-[#2a2a2a]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-white/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                <th className="px-6 py-4">Vencimento</th>
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Fornecedor</th>
                <th className="px-6 py-4 text-right">Valor</th>
                <th className="px-6 py-4 text-center">Status</th>
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
                  <tr key={p.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4 text-sm font-bold text-white">{new Date(p.due_date).toLocaleDateString('pt-BR')}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-white">{p.description}</span>
                        <span className="text-[10px] text-lumos-text-secondary uppercase tracking-tighter">{p.category}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-lumos-text-secondary">{p.supplier || '—'}</td>
                    <td className="px-6 py-4 text-right text-sm font-black text-white">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.amount)}</td>
                    <td className="px-6 py-4 text-center">
                      {p.paid_at ? (
                        <span className="inline-flex items-center text-[10px] font-bold text-green-500 uppercase bg-green-500/10 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-2.5 h-2.5 mr-1" /> Pago</span>
                      ) : (
                        <span className="inline-flex items-center text-[10px] font-bold text-yellow-500 uppercase bg-yellow-500/10 px-2 py-0.5 rounded-full"><Calendar className="w-2.5 h-2.5 mr-1" /> Pendente</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {!p.paid_at && <button onClick={() => markAsPaid(p.id)} className="btn-primary text-[10px] px-3 py-1.5 h-auto">Pagar</button>}
                        <button className="p-2 text-lumos-text-secondary hover:text-white rounded"><MoreVertical className="w-4 h-4" /></button>
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
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 h-10">Cadastrar Despesa</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
