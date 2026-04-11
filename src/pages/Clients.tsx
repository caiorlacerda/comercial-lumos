import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Briefcase,
  UserPlus,
  Trash,
  Database,
  ArrowRight
} from 'lucide-react';
import { formatCurrency } from '@/utils/financials';
import { clsx } from 'clsx';
import Modal from '@/components/common/Modal';
import { runClientMigration } from '@/utils/migration_v2';

interface Client {
  id: string;
  name: string;
  agency_name?: string;
  created_at: string;
  budget_count?: number;
  total_approved?: number;
  contact_count?: number;
}

interface ContactFormData {
  id?: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

export default function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('lumos-clients-view') as 'grid' | 'list') || 'grid';
  });
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    agency_name: '',
  });
  const [contacts, setContacts] = useState<ContactFormData[]>([
    { name: '', email: '', phone: '', role: '' }
  ]);

  useEffect(() => {
    fetchClients();
  }, []);

  useEffect(() => {
    localStorage.setItem('lumos-clients-view', viewMode);
  }, [viewMode]);

  async function fetchClients() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('clients')
        .select(`
          *,
          contacts:client_contacts(count),
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
        const contactCount = client.contacts?.[0]?.count || 0;
        
        let totalApproved = 0;
        approvedBudgets.forEach((budget: any) => {
          const version = budget.versions?.[0];
          if (version) {
            const sum = (group: string) =>
              (version.items || [])
                .filter((i: any) => i?.item_group === group)
                .reduce((acc: number, i: any) => acc + (Number(i?.unit_cost || 0) * Number(i?.quantity || 0)), 0);

            const totalCusto = sum('equipe') + sum('equipamentos') + sum('edicao') + sum('producao');
            const subtotal = totalCusto + (totalCusto * version.margin_pct);
            const total = subtotal + (subtotal * version.nf_pct) - version.discount_value;
            totalApproved += total;
          }
        });

        return {
          ...client,
          budget_count: budgetCount,
          total_approved: totalApproved,
          contact_count: contactCount
        };
      });

      setClients(processedClients || []);
    } catch (err) {
      console.error('Error fetching clients:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleOpenModal = async (client?: Client) => {
    if (client) {
      setEditingClient(client);
      setFormData({
        name: client.name,
        agency_name: client.agency_name || '',
      });
      // Fetch contacts for this client
      const { data } = await supabase.from('client_contacts').select('*').eq('client_id', client.id).order('created_at');
      if (data && data.length > 0) {
        setContacts(data);
      } else {
        setContacts([{ name: '', email: '', phone: '', role: '' }]);
      }
    } else {
      setEditingClient(null);
      setFormData({ name: '', agency_name: '' });
      setContacts([{ name: '', email: '', phone: '', role: '' }]);
    }
    setIsModalOpen(true);
  };

  const addContactRow = () => {
    setContacts([...contacts, { name: '', email: '', phone: '', role: '' }]);
  };

  const removeContactRow = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index));
  };

  const updateContact = (index: number, field: keyof ContactFormData, value: string) => {
    const newContacts = [...contacts];
    newContacts[index] = { ...newContacts[index], [field]: value };
    setContacts(newContacts);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let clientId = editingClient?.id;

      // 1. Save/Update Client
      if (editingClient) {
        const { error } = await supabase.from('clients').update(formData).eq('id', clientId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('clients').insert(formData).select().single();
        if (error) throw error;
        clientId = data.id;
      }

      // 2. Save/Update Contacts
      // Delete existing if editing (simpler for this scope, or do a differential update)
      if (editingClient) {
        await supabase.from('client_contacts').delete().eq('client_id', clientId);
      }

      const contactsToInsert = contacts
        .filter(c => c.name.trim()) // Only keep those with a name
        .map((c, idx) => ({
          client_id: clientId,
          name: c.name,
          email: c.email,
          phone: c.phone,
          role: c.role,
          is_primary: idx === 0 // First one is primary as requested
        }));

      if (contactsToInsert.length > 0) {
        const { error: cError } = await supabase.from('client_contacts').insert(contactsToInsert);
        if (cError) throw cError;
      }

      setIsModalOpen(false);
      fetchClients();
    } catch (err) {
      console.error('Error saving client:', err);
      alert('Erro ao salvar cliente. Verifique o console.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este cliente e todos os seus contatos?')) return;
    try {
      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw error;
      fetchClients();
    } catch (err) {
      console.error('Error deleting client:', err);
    }
  };

  const handleMigration = async () => {
    if (!confirm('Deseja unificar os clientes duplicados e migrar contatos agora? Esta ação é irreversível.')) return;
    setIsMigrating(true);
    const result = await runClientMigration();
    setIsMigrating(false);
    if (result.success) {
      alert(result.message);
      fetchClients();
    } else {
      alert('Falha na migração: ' + JSON.stringify(result.error));
    }
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.agency_name && c.agency_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="animate-in fade-in slide-in-from-left-4 duration-500">
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Clientes</h1>
          <p className="text-lumos-text-secondary mt-1 font-medium">Empresas e agências cadastradas na plataforma.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleMigration}
            disabled={isMigrating}
            className="btn-secondary h-10 flex items-center gap-2 group"
          >
            <Database className="w-4 h-4 text-lumos-yellow group-hover:animate-pulse" />
            {isMigrating ? 'Migrando...' : 'Migrar Dados'}
          </button>
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
            className="btn-primary h-10 flex items-center gap-2"
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
          placeholder="Buscar clientes por empresa ou agência..." 
          className="input-lumos w-full pl-10 h-10 font-medium"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card h-48 animate-pulse" />
          ))}
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="py-20 text-center card italic text-lumos-text-secondary">
          Nenhum cliente cadastrado.
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in zoom-in-95 duration-500">
          {filteredClients.map((client) => (
            <div key={client.id} className="card group hover:shadow-lg transition-all relative border-t-4 border-t-lumos-yellow flex flex-col">
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
              
              <div className="flex-1">
                <h3 className="text-xl font-black text-lumos-text-primary tracking-tight">{client.name}</h3>
                {client.agency_name && (
                  <p className="text-xs font-bold text-lumos-text-secondary mt-1">
                    Via <span className="text-lumos-yellow">{client.agency_name}</span>
                  </p>
                )}
              </div>
              
              <div className="grid grid-cols-3 gap-2 mt-8 py-4 border-y border-lumos-border">
                <div>
                  <p className="text-[8px] font-black text-lumos-text-secondary uppercase">Contatos</p>
                  <div className="flex items-center gap-1 mt-1">
                    <Users className="w-3 h-3 text-lumos-yellow" />
                    <p className="text-sm font-black text-lumos-text-primary">{client.contact_count}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[8px] font-black text-lumos-text-secondary uppercase">Budgets</p>
                  <p className="text-sm font-black text-lumos-text-primary mt-1">{client.budget_count}</p>
                </div>
                <div className="text-right">
                  <p className="text-[8px] font-black text-lumos-text-secondary uppercase">Aprovado</p>
                  <p className="text-sm font-black text-green-500 mt-1">{formatCurrency(client.total_approved || 0)}</p>
                </div>
              </div>

              <button 
                onClick={() => navigate(`/clientes/${client.id}`)}
                className="w-full mt-4 flex items-center justify-between text-[10px] font-black uppercase text-lumos-text-secondary hover:text-lumos-yellow transition-all"
              >
                Ver Perfil Completo
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card !p-0 overflow-hidden shadow-sm animate-in fade-in zoom-in-95 duration-500">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-bg/50 border-b border-lumos-border">
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest">Empresa</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-center">Contatos</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-center">Projetos</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-right">Total Aprovado</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {filteredClients.map((client) => (
                <tr key={client.id} className="hover:bg-lumos-yellow/[0.02] transition-colors group cursor-pointer" onClick={() => navigate(`/clientes/${client.id}`)}>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lumos bg-lumos-bg border border-lumos-border flex items-center justify-center text-lumos-yellow">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-black text-lumos-text-primary group-hover:text-lumos-yellow transition-colors tracking-tight">{client.name}</p>
                        {client.agency_name && (
                          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Via {client.agency_name}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-center">
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-lumos-text-secondary">
                      <Users className="w-3.5 h-3.5 text-lumos-yellow" />
                      {client.contact_count}
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
                  <td className="px-6 py-5 text-right" onClick={(e) => e.stopPropagation()}>
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
        className="max-w-3xl"
        footer={
          <>
            <button onClick={() => setIsModalOpen(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleSave} className="btn-primary px-8">Salvar Cliente</button>
          </>
        }
      >
        <form onSubmit={handleSave} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-1">
            <div>
              <label className="block text-xs font-black text-lumos-text-secondary uppercase mb-2 tracking-widest">Nome da Empresa</label>
              <input 
                required
                className="input-lumos w-full h-11"
                placeholder="Ex: Coca-Cola"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-black text-lumos-text-secondary uppercase mb-2 tracking-widest">Agência (Opcional)</label>
              <input 
                className="input-lumos w-full h-11"
                placeholder="Ex: WMcCann"
                value={formData.agency_name}
                onChange={(e) => setFormData({...formData, agency_name: e.target.value})}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-lumos-border pb-2">
              <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2">
                <Users className="w-4 h-4 text-lumos-yellow" />
                Contatos da Empresa
              </h3>
              <button 
                type="button"
                onClick={addContactRow}
                className="text-[10px] font-black uppercase text-lumos-yellow hover:underline flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Adicionar Contato
              </button>
            </div>

            <div className="space-y-3">
              {contacts.map((contact, idx) => (
                <div key={idx} className="bg-lumos-bg/30 p-4 rounded-lumos border border-lumos-border grid grid-cols-1 md:grid-cols-12 gap-4 items-end relative group/contact">
                  <div className="md:col-span-3">
                    <label className="block text-[9px] font-black text-lumos-text-secondary uppercase mb-1">Nome</label>
                    <input 
                      className="input-lumos w-full h-9 text-sm"
                      value={contact.name}
                      onChange={(e) => updateContact(idx, 'name', e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-[9px] font-black text-lumos-text-secondary uppercase mb-1">E-mail</label>
                    <input 
                      className="input-lumos w-full h-9 text-sm"
                      value={contact.email}
                      onChange={(e) => updateContact(idx, 'email', e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-[9px] font-black text-lumos-text-secondary uppercase mb-1">Telefone</label>
                    <input 
                      className="input-lumos w-full h-9 text-sm"
                      value={contact.phone}
                      onChange={(e) => updateContact(idx, 'phone', e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[9px] font-black text-lumos-text-secondary uppercase mb-1">Cargo</label>
                    <input 
                      className="input-lumos w-full h-9 text-sm"
                      value={contact.role}
                      onChange={(e) => updateContact(idx, 'role', e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-1 flex justify-center pb-1">
                    {contacts.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => removeContactRow(idx)}
                        className="p-2 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {idx === 0 && (
                    <span className="absolute -top-2 -left-2 bg-lumos-yellow text-black text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter">Primário</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
