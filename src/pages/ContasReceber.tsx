import React, { useEffect, useState } from 'react';
import { 
  ArrowDownCircle, 
  Search, 
  CheckCircle2, 
  Calendar, 
  Building2, 
  FileText,
  DollarSign,
  Plus
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Link } from 'react-router-dom';
import Modal from '@/components/common/Modal';
import { useAuth } from '@/hooks/useAuth';

const CurrencyInput = ({ value, onChange, className }: any) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, "");
    const numberValue = rawValue ? parseInt(rawValue) / 100 : 0;
    onChange(numberValue);
  };
  const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  return <input type="text" className={className} value={formattedValue} onChange={handleChange} />;
};

export default function ContasReceber() {
  const { profile } = useAuth();
  const [receivables, setReceivables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [selectedReceivable, setSelectedReceivable] = useState<any>(null);
  const [newReceivableData, setNewReceivableData] = useState({
    description: '',
    client_id: '',
    total_amount: 0,
    due_date: new Date().toISOString().split('T')[0],
    notes: ''
  });
  const [paymentData, setPaymentData] = useState({
    amount: 0,
    received_at: new Date().toISOString().split('T')[0],
    payment_method: 'pix'
  });

  useEffect(() => {
    fetchReceivables();
    fetchClients();
  }, []);

  async function fetchClients() {
    const { data } = await supabase.from('clients').select('id, name').order('name');
    setClients(data || []);
  }

  async function fetchReceivables() {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('receivables').select('*, client:clients(name), budget:budgets(id, project_name)').order('due_date', { ascending: true });
      if (error) throw error;
      setReceivables(data || []);
    } catch (error) {
      console.error('Erro ao buscar recebíveis:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReceivable) return;
    const newReceivedAmount = Number(selectedReceivable.received_amount) + Number(paymentData.amount);
    const newStatus = newReceivedAmount >= selectedReceivable.total_amount ? 'recebido' : 'parcial';
    try {
      const { error } = await supabase.from('receivables').update({
        received_amount: newReceivedAmount,
        received_at: paymentData.received_at,
        payment_method: paymentData.payment_method,
        status: newStatus,
        updated_at: new Date().toISOString()
      }).eq('id', selectedReceivable.id);
      if (error) throw error;
      setIsPayModalOpen(false);
      fetchReceivables();
    } catch (error: any) { alert(error.message); }
  };

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) {
      alert("Você precisa estar logado para realizar esta ação.");
      return;
    }
    try {
      const { error } = await supabase.from('receivables').insert([{
        ...newReceivableData,
        status: 'aguardando',
        received_amount: 0,
        budget_id: null,
        created_by: profile.id
      }]);
      if (error) throw error;
      setIsNewModalOpen(false);
      setNewReceivableData({ description: '', client_id: '', total_amount: 0, due_date: new Date().toISOString().split('T')[0], notes: '' });
      fetchReceivables();
    } catch (error: any) { alert(error.message); }
  };

  const stats = {
    toReceive: receivables.filter(r => r.status !== 'recebido').reduce((acc, r) => acc + (r.total_amount - r.received_amount), 0),
    receivedMonth: receivables.filter(r => r.received_at && new Date(r.received_at).getMonth() === new Date().getMonth()).reduce((acc, r) => acc + r.received_amount, 0),
    overdue: receivables.filter(r => r.status !== 'recebido' && r.due_date && new Date(r.due_date) < new Date()).length
  };

  const filtered = receivables.filter(r => 
    r.description?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.client?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Contas a Receber</h1>
          <p className="text-lumos-text-secondary text-sm">Controle de faturamento e entradas de projetos.</p>
        </div>
        <button onClick={() => setIsNewModalOpen(true)} className="btn-primary h-10 px-6 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Novo Recebível
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-6 border-l-4 border-blue-500 shadow-lg">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">Total a Receber</p>
          <p className="text-2xl font-black text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.toReceive)}</p>
        </div>
        <div className="card p-6 border-l-4 border-green-500 shadow-lg">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">Recebido no Mês</p>
          <p className="text-2xl font-black text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.receivedMonth)}</p>
        </div>
        <div className="card p-6 border-l-4 border-red-500 shadow-lg">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">Títulos em Atraso</p>
          <p className="text-2xl font-black text-red-500">{stats.overdue}</p>
        </div>
      </div>

      <div className="card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input type="text" placeholder="Buscar por projeto ou cliente..." className="input-lumos pl-10 w-full h-10" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                <th className="px-6 py-4">Projeto / Cliente</th>
                <th className="px-6 py-4">Vencimento</th>
                <th className="px-6 py-4 text-right">Valor Total</th>
                <th className="px-6 py-4 text-right">Recebido</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {loading ? (
                <tr><td colSpan={6} className="py-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-lumos-text-secondary text-sm italic">Nenhum recebível registrado.</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-lumos-text-primary/5 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-lumos-text-primary">{r.description}</span>
                        <span className="text-[10px] text-lumos-text-secondary flex items-center gap-1 uppercase"><Building2 className="w-2.5 h-2.5" /> {r.client?.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-lumos-text-secondary">{r.due_date ? new Date(r.due_date).toLocaleDateString('pt-BR') : 'A definir'}</td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.total_amount)}</td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-bold text-green-500">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.received_amount)}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${r.status === 'recebido' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'}`}>{r.status.toUpperCase()}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {r.status !== 'recebido' && <button onClick={() => { setSelectedReceivable(r); setPaymentData({...paymentData, amount: r.total_amount - r.received_amount}); setIsPayModalOpen(true); }} className="btn-primary text-[10px] px-3 py-1.5 h-auto">Receber</button>}
                        {r.budget_id && <Link to={`/orcamentos/${r.budget_id}`} className="p-2 text-lumos-text-secondary hover:text-lumos-text-primary rounded"><FileText className="w-4 h-4" /></Link>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isPayModalOpen} onClose={() => setIsPayModalOpen(false)} title="Registrar Recebimento">
        <form onSubmit={handleRegisterPayment} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Valor Recebido (R$)</label>
            <CurrencyInput className="input-lumos w-full font-bold" value={paymentData.amount} onChange={(val: number) => setPaymentData({...paymentData, amount: val})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Data</label>
              <input type="date" className="input-lumos w-full" value={paymentData.received_at} onChange={e => setPaymentData({...paymentData, received_at: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Forma</label>
              <select className="input-lumos w-full" value={paymentData.payment_method} onChange={e => setPaymentData({...paymentData, payment_method: e.target.value})}>
                <option value="pix">PIX</option>
                <option value="boleto">Boleto</option>
                <option value="transferencia">Transferência</option>
              </select>
            </div>
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsPayModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 h-10">Confirmar</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} title="Novo Recebível Manual">
        <form onSubmit={handleCreateManual} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Descrição</label>
            <input required type="text" className="input-lumos w-full" placeholder="Ex: Adiantamento Projeto X" value={newReceivableData.description} onChange={e => setNewReceivableData({...newReceivableData, description: e.target.value})} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Cliente</label>
            <select required className="input-lumos w-full" value={newReceivableData.client_id} onChange={e => setNewReceivableData({...newReceivableData, client_id: e.target.value})}>
              <option value="">Selecione um cliente</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Valor Total (R$)</label>
              <CurrencyInput className="input-lumos w-full font-bold" value={newReceivableData.total_amount} onChange={(val: number) => setNewReceivableData({...newReceivableData, total_amount: val})} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Vencimento</label>
              <input required type="date" className="input-lumos w-full" value={newReceivableData.due_date} onChange={e => setNewReceivableData({...newReceivableData, due_date: e.target.value})} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Observações</label>
            <textarea className="input-lumos w-full h-20 py-2" value={newReceivableData.notes} onChange={e => setNewReceivableData({...newReceivableData, notes: e.target.value})} />
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsNewModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 h-10">Cadastrar Recebível</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
