import React, { useEffect, useState } from 'react';
import { 
  Receipt, 
  Plus, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  DollarSign,
  Upload,
  ChevronRight
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

const StatusBadge = ({ status }: { status: string }) => {
  const configs: any = {
    pendente: { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'Pendente', icon: Clock },
    aprovado: { color: 'bg-yellow-500/20 text-lumos-yellow border-lumos-yellow/30', label: 'Aprovado', icon: CheckCircle2 },
    pago: { color: 'bg-green-500/20 text-green-400 border-green-500/30', label: 'Pago', icon: DollarSign },
    rejeitado: { color: 'bg-red-500/20 text-red-400 border-red-500/30', label: 'Rejeitado', icon: XCircle },
  };
  const config = configs[status] || configs.pendente;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${config.color}`}>
      <Icon className="w-2.5 h-2.5 mr-1" /> {config.label.toUpperCase()}
    </span>
  );
};

export default function Reembolso() {
  const { profile, isAdmin } = useAuth();
  const [reimbursements, setReimbursements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    description: '',
    amount: 0,
    expense_date: new Date().toISOString().split('T')[0],
    payment_method: 'pix',
    notes: '',
    attachment: null as File | null
  });

  useEffect(() => {
    fetchReimbursements();
  }, [profile, isAdmin]);

  async function fetchReimbursements() {
    try {
      setLoading(true);
      let query = supabase.from('reimbursements').select('*, requester:app_users!requester_id(full_name)');
      if (!isAdmin) query = query.eq('requester_id', profile?.id);
      const { data, error } = await query.order('created_at', { ascending: false });
      setReimbursements(data || []);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      const { error } = await supabase.from('reimbursements').insert([{
        requester_id: profile.id,
        description: formData.description,
        amount: formData.amount,
        expense_date: formData.expense_date,
        payment_method: formData.payment_method,
        notes: formData.notes,
        status: 'pendente'
      }]);
      if (error) throw error;
      setIsModalOpen(false);
      fetchReimbursements();
      resetForm();
    } catch (error: any) { alert(error.message); }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const { error } = await supabase.from('reimbursements').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      fetchReimbursements();
    } catch (error: any) { alert(error.message); }
  };

  const resetForm = () => {
    setFormData({ description: '', amount: 0, expense_date: new Date().toISOString().split('T')[0], payment_method: 'pix', notes: '', attachment: null });
  };

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">{isAdmin ? 'Gestão de Reembolsos' : 'Meus Reembolsos'}</h1>
          <p className="text-lumos-text-secondary text-sm">{isAdmin ? 'Autorize as solicitações da equipe.' : 'Solicite e acompanhe seus pedidos.'}</p>
        </div>
        {!isAdmin && <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="btn-primary h-10 px-6 flex items-center gap-2"><Plus className="w-4 h-4" /> Novo Pedido</button>}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                {isAdmin && <th className="px-6 py-4">Funcionário</th>}
                <th className="px-6 py-4">Data</th>
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Valor</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {loading ? (
                <tr><td colSpan={6} className="py-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div></td></tr>
              ) : reimbursements.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-lumos-text-secondary text-sm italic">Nenhum reembolso.</td></tr>
              ) : (
                reimbursements.map((r) => (
                  <tr key={r.id} className="hover:bg-lumos-text-primary/5 transition-colors">
                    {isAdmin && <td className="px-6 py-4 text-sm font-bold text-lumos-text-primary">{r.requester?.full_name}</td>}
                    <td className="px-6 py-4 text-sm text-lumos-text-secondary">{new Date(r.expense_date).toLocaleDateString('pt-BR')}</td>
                     <td className="px-6 py-4 text-sm font-bold text-lumos-text-primary">{r.description}</td>
                    <td className="px-6 py-4 text-sm font-bold text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.amount)}</td>
                    <td className="px-6 py-4 text-center"><StatusBadge status={r.status} /></td>
                    <td className="px-6 py-4 text-right">
                      {isAdmin ? (
                        <div className="flex justify-end gap-2">
                          {r.status === 'pendente' && <><button onClick={() => updateStatus(r.id, 'aprovado')} className="p-1.5 text-green-500"><CheckCircle2 className="w-4 h-4" /></button><button onClick={() => updateStatus(r.id, 'rejeitado')} className="p-1.5 text-red-500"><XCircle className="w-4 h-4" /></button></>}
                          {r.status === 'aprovado' && <button onClick={() => updateStatus(r.id, 'pago')} className="btn-primary text-[10px] px-2 py-1 h-auto">Pagar</button>}
                        </div>
                      ) : <button className="p-1.5 text-lumos-text-secondary"><ChevronRight className="w-4 h-4" /></button>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Solicitar Reembolso">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Descrição</label>
            <input required type="text" className="input-lumos w-full" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase">Valor (R$)</label>
              <CurrencyInput className="input-lumos w-full font-bold" value={formData.amount} onChange={(val: number) => setFormData({...formData, amount: val})} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Data</label>
              <input required type="date" className="input-lumos w-full" value={formData.expense_date} onChange={e => setFormData({...formData, expense_date: e.target.value})} />
            </div>
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 h-10">Enviar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
