import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Users, 
  Plus, 
  Search, 
  Mail, 
  Phone, 
  Building2,
  X,
  Edit2,
  Trash2,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
  DollarSign,
  Briefcase
} from 'lucide-react';
import { calcFinancials, formatCurrency } from '@/utils/financials';
import { clsx } from 'clsx';
import Modal from '@/components/common/Modal';

interface Client {
  id: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  created_at: string;
  budget_count?: number;
  total_approved?: number;
}

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('lumos-clients-view') as 'grid' | 'list') || 'grid';
  });
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    contact_name: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    fetchClients();
  }, []);

  useEffect(() => {
    localStorage.setItem('lumos-clients-view', viewMode);
  }, [viewMode]);

  async function fetchClients() {
    try {
      setLoading(true);
      // Fetch clients with counts of budgets and details of approved ones
      const { data, error } = await supabase
        .from('clients')
        .select(`
          *,
          budgets:budgets!client_id(
            id,
            status,
            versions:budget_versions!budget_id(
              id,
              margin_pct,
              nf_pct,
              discount_value,
              items:budget_items!version_id(unit_cost, quantity, item_group)
            )
          )
        `)
        .order('name');

      if (error) throw error;
      
      const processedClients = data?.map(client => {
        const approvedBudgets = (client.budgets || []).filter((b: any) => b.status === 'aprovado');
        const budgetCount = (client.budgets || []).length;
        
        let totalApproved = 0;
        approvedBudgets.forEach((budget: any) => {
          // Get the latest version or any version if no active_version logic is used here
          const version = budget.versions?.[0];
          if (version) {
            try {
              const financials = calcFinancials(version.items || [], version);
              totalApproved += financials.valorFinal;
            } catch (calcError) {
              console.error(`Error calculating financials for budget ${budget.id}:`, calcError);
            }
          }
        });

        return {
          ...client,
          budget_count: budgetCount,
          total_approved: totalApproved
        };
      });

      setClients(processedClients || []);
    } catch (err) {
      console.error('Error fetching clients:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleOpenModal = (client?: Client) => {
    if (client) {
      setEditingClient(client);
      setFormData({
        name: client.name,
        contact_name: client.contact_name || '',
        email: client.email || '',
        phone: client.phone || '',
      });
    } else {
      setEditingClient(null);
      setFormData({ name: '', contact_name: '', email: '', phone: '' });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingClient) {
        const { error } = await supabase
          .from('clients')
          .update(formData)
          .eq('id', editingClient.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('clients')
          .insert(formData);
        if (error) throw error;
      }
      setIsModalOpen(false);
      fetchClients();
    } catch (err) {
      console.error('Error saving client:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este cliente?')) return;
    try {
      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw error;
      fetchClients();
    } catch (err) {
      console.error('Error deleting client:', err);
    }
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.contact_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="animate-in fade-in slide-in-from-left-4 duration-500">
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Clientes</h1>
          <p className="text-lumos-text-secondary mt-1 font-medium">Gerencie sua base de contatos e histórico de vendas.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-lumos-surface border border-lumos-border p-1 rounded-lumos">
            <button 
              onClick={() => setViewMode('grid')}
              className={clsx(
                "p-2 rounded-sm transition-all",
                viewMode === 'grid' ? "bg-lumos-yellow text-black shadow-sm" : "text-lumos-text-secondary hover:text-lumos-text-primary"
              )}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={clsx(
                "p-2 rounded-sm transition-all",
                viewMode === 'list' ? "bg-lumos-yellow text-black shadow-sm" : "text-lumos-text-secondary hover:text-lumos-text-primary"
              )}
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>
          <button 
            onClick={() => handleOpenModal()}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Novo Cliente
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="relative animate-in fade-in slide-in-from-bottom-2 duration-500">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
        <input 
          type="text" 
          placeholder="Buscar clientes por nome ou contato..." 
          className="input-lumos w-full pl-10 h-10 font-medium"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card h-40 animate-pulse" />
          ))}
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="py-20 text-center card italic text-lumos-text-secondary">
          Nenhum cliente cadastrado.
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid Layout */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in zoom-in-95 duration-500">
          {filteredClients.map((client) => (
            <div key={client.id} className="card group hover:shadow-lg transition-all relative border-t-4 border-t-lumos-yellow">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2.5 rounded-lumos bg-lumos-yellow/10 text-lumos-yellow">
                  <Building2 className="w-6 h-6" />
                </div>
                <div className="flex gap-1">
                  <button 
                    onClick={() => handleOpenModal(client)}
                    className="p-2 text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/10 rounded-full transition-all"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(client.id)}
                    className="p-2 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <h3 className="text-xl font-black text-lumos-text-primary mb-1 tracking-tight">{client.name}</h3>
              <p className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-widest mb-6 border-b border-lumos-border pb-2 inline-block">
                {client.contact_name || 'Individual'}
              </p>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-[9px] font-black text-lumos-text-secondary uppercase">Projetos</p>
                  <p className="text-lg font-black text-lumos-text-primary">{client.budget_count}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-lumos-text-secondary uppercase">Aprovado</p>
                  <p className="text-lg font-black text-green-500">{formatCurrency(client.total_approved || 0)}</p>
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t border-lumos-border">
                {client.email && (
                  <div className="flex items-center gap-2 text-xs font-medium text-lumos-text-secondary">
                    <Mail className="w-3.5 h-3.5 text-lumos-yellow" />
                    {client.email}
                  </div>
                )}
                {client.phone && (
                  <div className="flex items-center gap-2 text-xs font-medium text-lumos-text-secondary">
                    <Phone className="w-3.5 h-3.5 text-lumos-yellow" />
                    {client.phone}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* List Layout */
        <div className="card !p-0 overflow-hidden shadow-sm animate-in fade-in zoom-in-95 duration-500">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-bg/50 border-b border-lumos-border">
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest">Empresa</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest">Contato / Info</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-center">Projetos</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-right">Total Aprovado</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {filteredClients.map((client) => (
                <tr key={client.id} className="hover:bg-lumos-yellow/[0.02] transition-colors group">
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lumos bg-lumos-bg border border-lumos-border flex items-center justify-center text-lumos-yellow">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-black text-lumos-text-primary group-hover:text-lumos-yellow transition-colors tracking-tight">{client.name}</p>
                        <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">{client.contact_name || 'Individual'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-xs font-medium text-lumos-text-secondary">
                        <Mail className="w-3.5 h-3.5 text-lumos-yellow" />
                        {client.email || '—'}
                      </div>
                      <div className="flex items-center gap-2 text-xs font-medium text-lumos-text-secondary">
                        <Phone className="w-3.5 h-3.5 text-lumos-yellow" />
                        {client.phone || '—'}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-center">
                    <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-lumos-bg border border-lumos-border text-[10px] font-black uppercase text-lumos-text-primary">
                      <Briefcase className="w-3 h-3 text-lumos-yellow" />
                      {client.budget_count}
                    </div>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="inline-flex items-center gap-1 font-black text-green-500">
                      <DollarSign className="w-4 h-4" />
                      {formatCurrency(client.total_approved || 0)}
                    </div>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => handleOpenModal(client)}
                        className="p-2 text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/10 rounded-full transition-all"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(client.id)}
                        className="p-2 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      <Modal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingClient ? 'Editar Cliente' : 'Novo Cliente'}
        footer={
          <>
            <button onClick={() => setIsModalOpen(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleSave} className="btn-primary">Salvar Alterações</button>
          </>
        }
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-black text-lumos-text-secondary uppercase mb-2 tracking-widest">Nome da Empresa / Cliente</label>
            <input 
              required
              className="input-lumos w-full h-11"
              placeholder="Ex: Produtora Lumos"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-xs font-black text-lumos-text-secondary uppercase mb-2 tracking-widest">Contato Principal</label>
            <input 
              className="input-lumos w-full h-11"
              placeholder="Nome do contato"
              value={formData.contact_name}
              onChange={(e) => setFormData({...formData, contact_name: e.target.value})}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-lumos-text-secondary uppercase mb-2 tracking-widest">E-mail</label>
              <input 
                type="email"
                className="input-lumos w-full h-11"
                placeholder="email@cliente.com"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-black text-lumos-text-secondary uppercase mb-2 tracking-widest">Telefone</label>
              <input 
                className="input-lumos w-full h-11"
                placeholder="(00) 00000-0000"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
              />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
