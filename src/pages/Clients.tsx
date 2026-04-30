import { useState, useEffect } from 'react';
import Pagination from '@/components/common/Pagination';
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
  ArrowRight
} from 'lucide-react';
import { formatCurrency } from '@/utils/financials';
import { clsx } from 'clsx';
import ClientModal from '@/components/clients/ClientModal';

interface Client {
  id: string;
  name: string;
  agency_name?: string;
  created_at: string;
  budget_count?: number;
  total_approved?: number;
  contact_count?: number;
}


export default function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 12;
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('lumos-clients-view') as 'grid' | 'list') || 'grid';
  });

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

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

  const handleOpenModal = (client?: Client) => {
    setEditingClient(client || null);
    setIsModalOpen(true);
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

  const filteredClients = clients.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.agency_name && c.agency_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );
  const totalPages = Math.ceil(filteredClients.length / PAGE_SIZE);
  const pagedClients = filteredClients.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="animate-in fade-in slide-in-from-left-4 duration-500">
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Clientes</h1>
          <p className="text-lumos-text-secondary mt-1 font-medium">Empresas e agências cadastradas na plataforma.</p>
        </div>
        <div className="flex items-center gap-3">
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
          onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
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
        <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in zoom-in-95 duration-500">
          {pagedClients.map((client) => (
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
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filteredClients.length} pageSize={PAGE_SIZE} />
        </div>
      ) : (
        <div className="space-y-4">
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
              {pagedClients.map((client) => (
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
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filteredClients.length} pageSize={PAGE_SIZE} />
        </div>
      )}

      {/* Modal Reutilizável */}
      <ClientModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchClients}
        client={editingClient}
      />
    </div>
  );
}
