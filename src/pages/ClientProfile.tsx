import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { 
  Building2, 
  Users, 
  Briefcase, 
  DollarSign, 
  Mail, 
  Phone, 
  ArrowLeft,
  ChevronRight,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  ExternalLink,
  Calendar
} from 'lucide-react';
import { formatCurrency } from '@/utils/financials';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { Edit2 } from 'lucide-react';
import ClientModal from '@/components/clients/ClientModal';

interface Client {
  id: string;
  name: string;
  agency_name?: string;
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  is_primary: boolean;
}

interface Budget {
  id: string;
  code: string;
  project_name: string;
  status: 'rascunho' | 'em_negociacao' | 'aprovado' | 'reprovado';
  created_at: string;
  total?: number;
}

export default function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [client, setClient] = useState<Client | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (id) {
      fetchClientData();
    }
  }, [id]);

  async function fetchClientData() {
    try {
      setLoading(true);
      
      // 1. Fetch Client
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .single();
        
      if (clientError) throw clientError;
      setClient(clientData);

      // 2. Fetch Contacts
      const { data: contactsData } = await supabase
        .from('client_contacts')
        .select('*')
        .eq('client_id', id)
        .order('is_primary', { ascending: false });
      setContacts(contactsData || []);

      // 3. Fetch Budgets with financials
      const { data: budgetsData } = await supabase
        .from('budgets')
        .select(`
          *,
          versions:budget_versions!budget_id(
            id,
            margin_pct,
            nf_pct,
            discount_value,
            items:budget_items!version_id(unit_cost, quantity, item_group)
          )
        `)
        .eq('client_id', id)
        .order('created_at', { ascending: false });

      const processedBudgets = (budgetsData || []).map(b => {
        const version = b.versions?.[0];
        let total = 0;
        if (version) {
          const sum = (group: string) =>
            (version.items || [])
              .filter((i: any) => i?.item_group === group)
              .reduce((acc: number, i: any) => acc + (Number(i?.unit_cost || 0) * Number(i?.quantity || 0)), 0);

          const totalCusto = sum('equipe') + sum('equipamentos') + sum('edicao') + sum('producao');
          const subtotal = totalCusto + (totalCusto * version.margin_pct);
          total = subtotal + (subtotal * version.nf_pct) - version.discount_value;
        }
        return { ...b, total };
      });

      setBudgets(processedBudgets);
    } catch (err) {
      console.error('Error fetching client data:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-lumos-yellow"></div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-black text-lumos-text-primary">Cliente não encontrado</h2>
        <button onClick={() => navigate('/clientes')} className="btn-secondary mt-4">Voltar para listagem</button>
      </div>
    );
  }

  const statusIcons = {
    rascunho: <Clock className="w-3.5 h-3.5" />,
    em_negociacao: <Clock className="w-3.5 h-3.5" />,
    aprovado: <CheckCircle className="w-3.5 h-3.5" />,
    reprovado: <XCircle className="w-3.5 h-3.5" />
  };

  const statusColors = {
    rascunho: 'bg-lumos-bg text-lumos-text-secondary border-lumos-border',
    em_negociacao: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    aprovado: 'bg-green-500/10 text-green-500 border-green-500/20',
    reprovado: 'bg-red-500/10 text-red-500 border-red-500/20'
  };

  const totalAprovado = budgets
    .filter(b => b.status === 'aprovado')
    .reduce((acc, b) => acc + (b.total || 0), 0);

  return (
    <div className="space-y-8 pb-20">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-xs font-black uppercase text-lumos-text-secondary hover:text-lumos-yellow transition-all"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar
      </button>

      {/* Header Profile */}
      <div className="card border-t-4 border-t-lumos-yellow">
        <div className="flex flex-col md:flex-row gap-8 items-start">
          <div className="w-20 h-20 rounded-lumos bg-lumos-bg border border-lumos-border flex items-center justify-center text-lumos-yellow shrink-0">
            <Building2 className="w-10 h-10" />
          </div>
            <div className="flex-1 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">{client.name}</h1>
                  {client.agency_name && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase text-lumos-yellow bg-lumos-yellow/10 px-2 py-0.5 rounded border border-lumos-yellow/20">Agência</span>
                      <p className="text-sm font-bold text-lumos-text-secondary">{client.agency_name}</p>
                    </div>
                  )}
                </div>
                <button 
                  onClick={() => setIsModalOpen(true)}
                  className="btn-secondary flex items-center gap-2 self-start md:self-center"
                >
                  <Edit2 className="w-4 h-4" />
                  Editar Cliente
                </button>
              </div>
            
            <div className="flex flex-wrap gap-6 pt-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-lumos-bg text-lumos-yellow">
                  <Briefcase className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[9px] font-black text-lumos-text-secondary uppercase">Orçamentos</p>
                  <p className="font-black text-lumos-text-primary uppercase">{budgets.length}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-lumos-bg text-green-500">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[9px] font-black text-lumos-text-secondary uppercase">Faturamento Aprovado</p>
                  <p className="font-black text-green-500">{formatCurrency(totalAprovado)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-lumos-bg text-lumos-text-secondary">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[9px] font-black text-lumos-text-secondary uppercase">Cliente desde</p>
                  <p className="font-black text-lumos-text-primary uppercase">{format(new Date(client.created_at), 'MM/yyyy')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Contacts column */}
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-lumos-border pb-2">
            <h2 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2">
              <Users className="w-4 h-4 text-lumos-yellow" />
              Contatos
            </h2>
          </div>
          
          <div className="space-y-3">
            {contacts.length === 0 ? (
              <p className="text-sm italic text-lumos-text-secondary">Nenhum contato cadastrado.</p>
            ) : contacts.map(contact => (
              <div key={contact.id} className={clsx(
                "p-4 rounded-lumos border transition-all",
                contact.is_primary ? "bg-lumos-yellow/5 border-lumos-yellow/30" : "bg-lumos-surface border-lumos-border"
              )}>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-black text-lumos-text-primary">{contact.name}</h3>
                  {contact.is_primary && (
                    <span className="text-[8px] font-black uppercase bg-lumos-yellow text-black px-1.5 py-0.5 rounded">Primário</span>
                  )}
                </div>
                {contact.role && (
                  <p className="text-[10px] font-black uppercase text-lumos-text-secondary mb-3 tracking-wider">{contact.role}</p>
                )}
                <div className="space-y-1.5 pt-3 border-t border-lumos-border/50">
                  {contact.email && (
                    <div className="flex items-center gap-2 text-xs text-lumos-text-secondary">
                      <Mail className="w-3.5 h-3.5 text-lumos-yellow" />
                      {contact.email}
                    </div>
                  )}
                  {contact.phone && (
                    <div className="flex items-center gap-2 text-xs text-lumos-text-secondary">
                      <Phone className="w-3.5 h-3.5 text-lumos-yellow" />
                      {contact.phone}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Budgets column */}
        <div className="xl:col-span-2 space-y-6">
          <div className="flex items-center justify-between border-b border-lumos-border pb-2">
            <h2 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-lumos-yellow" />
              Histórico de Orçamentos
            </h2>
          </div>

          <div className="card !p-0 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-lumos-bg/50 border-b border-lumos-border">
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest">Código / Projeto</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest">Status</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-right">Faturamento</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lumos-border">
                {budgets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center italic text-lumos-text-secondary">Nenhum orçamento encontrado.</td>
                  </tr>
                ) : budgets.map(budget => (
                  <tr key={budget.id} className="hover:bg-lumos-yellow/[0.02] transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-lumos-yellow uppercase tracking-tighter">{budget.code}</span>
                        <span className="font-black text-lumos-text-primary group-hover:text-lumos-yellow transition-colors">{budget.project_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={clsx(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider",
                        statusColors[budget.status]
                      )}>
                        {statusIcons[budget.status]}
                        {budget.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="font-black text-lumos-text-primary">{formatCurrency(budget.total || 0)}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => navigate(`/orcamentos/${budget.id}`)}
                        className="p-2 text-lumos-text-secondary hover:text-lumos-yellow hover:bg-lumos-yellow/10 rounded-full transition-all"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ClientModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchClientData}
        client={client}
      />
    </div>
  );
}
