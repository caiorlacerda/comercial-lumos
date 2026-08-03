import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Plus,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  MoreVertical,
  Edit2,
  Trash2,
  AlertTriangle,
  FileDown,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  TrendingUp,
  Target,
  Users
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { pdf } from '@react-pdf/renderer';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';
import { BudgetPDF } from '@/components/editor/BudgetPDF';
import { calcFinancials, formatCurrency } from '@/utils/financials';
import { formatBudgetCode } from '@/utils/formatters';
import { getPdfFileName } from '@/utils/pdfFileName';
import { useToast } from '@/context/ToastContext';

interface Budget {
  id: string;
  code: string;
  project_name: string;
  category: 'digital' | 'filme' | 'live';
  status: 'rascunho' | 'em_negociacao' | 'aprovado' | 'reprovado';
  updated_at: string;
  active_version_id: string;
  clients: { name: string; agency_name?: string | null };
  versions: any[];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recentBudgets, setRecentBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalApprovedValue, setTotalApprovedValue] = useState(0);
  
  // Sorting
  const [sortField, setSortField] = useState<string>('updated_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Menu & Modal state
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [budgetToDelete, setBudgetToDelete] = useState<Budget | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
    supabase.auth.getUser().then(({ data }) => setCurrentUser(data.user));
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      // Fetch all budgets for KPIs (limit 1000 for safety, but effectively 'all')
      const { data, error } = await supabase
        .from('budgets')
        .select(`
          *,
          clients!client_id (name, agency_name),
          active_version:budget_versions!budgets_active_version_fkey (
            id,
            contact_id,
            contact:client_contacts(id, name, email),
            margin_pct,
            nf_pct,
            discount_value,
            items:budget_items!version_id (id, unit_cost, quantity, item_group)
          ),
          versions:budget_versions!budget_id (
            id,
            contact_id,
            contact:client_contacts(id, name, email),
            margin_pct,
            nf_pct,
            discount_value,
            items:budget_items!version_id (id, unit_cost, quantity, item_group)
          )
        `)
        .order('updated_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      
      const allBudgets = (data || []).map(b => {
        const activeVersion = (b as any).active_version || b.versions?.find((v: any) => v.id === b.active_version_id) || b.versions?.[0];
        let valorFinal = 0;
        if (activeVersion) {
          const financials = calcFinancials(activeVersion.items || [], activeVersion);
          valorFinal = financials.valorFinal;
        }
        return { ...b, valorFinal, active_version: activeVersion };
      });

      setBudgets(allBudgets);
      setRecentBudgets(allBudgets.slice(0, 5));
      
      // Calculate approved total
      const approvedTotal = allBudgets
        .filter(b => b.status === 'aprovado')
        .reduce((sum, b) => sum + ((b as any).valorFinal || 0), 0);
      setTotalApprovedValue(approvedTotal);

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleDeleteBudget = async () => {
    if (!budgetToDelete) return;
    try {
      const { error } = await supabase.from('budgets').delete().eq('id', budgetToDelete.id);
      if (error) throw error;
      setBudgets(prev => prev.filter(b => b.id !== budgetToDelete.id));
      setRecentBudgets(prev => prev.filter(b => b.id !== budgetToDelete.id));
      setBudgetToDelete(null);
      setActiveMenu(null);
    } catch (err) {
      console.error('Error deleting budget:', err);
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleExportPDF = async (budget: Budget) => {
    try {
      setExportingId(budget.id);
      setActiveMenu(null);

      const { data: fullBudget, error } = await supabase
        .from('budgets')
        .select(`
          *,
          clients(name, agency_name, contact_name, email),
          active_version:budget_versions!budgets_active_version_fkey(
            *,
            contact:client_contacts(name, email, role),
            budget_items(
              id, item_group, name, description,
              unit_cost, quantity, unit_label, sort_order
            )
          )
        `)
        .eq('id', budget.id)
        .single();

      if (error) throw error;
      if (!fullBudget) throw new Error('Budget not found');

      const activeVersion = (fullBudget as any).active_version;
      if (!activeVersion) {
        toast.warning('Nenhuma versão encontrada para este orçamento.');
        return;
      }

      const items = activeVersion.budget_items || [];
      const financials = calcFinancials(items, activeVersion);
      const fileName = getPdfFileName(
        fullBudget.code,
        fullBudget.clients?.name || 'Cliente',
        fullBudget.clients?.agency_name,
        fullBudget.project_name
      );

      const blob = await pdf(
        <BudgetPDF
          budget={fullBudget as any}
          version={activeVersion}
          contact={activeVersion.contact}
          items={items}
          financials={financials}
          userName={currentUser?.user_metadata?.full_name || 'Equipe Lumos'}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting PDF:', err);
      toast.error('Erro ao gerar PDF.');
    } finally {
      setExportingId(null);
    }
  };

  const stats = [
    { label: 'Total Aprovado', value: formatCurrency(totalApprovedValue), icon: CheckCircle2, color: 'text-green-500 bg-green-500/10' },
    { label: 'Em Negociação', value: budgets.filter(b => b.status === 'em_negociacao').length, icon: Clock, color: 'text-lumos-yellow bg-lumos-yellow/10' },
    { label: 'Rascunhos', value: budgets.filter(b => b.status === 'rascunho').length, icon: FileText, color: 'text-gray-400 bg-gray-400/10' },
    { label: 'Aprovados', value: budgets.filter(b => b.status === 'aprovado').length, icon: CheckCircle2, color: 'text-green-500 bg-green-500/10' },
  ];

  const sortedBudgets = [...budgets].sort((a, b) => {
    let valA: any = a[sortField as keyof Budget];
    let valB: any = b[sortField as keyof Budget];

    if (sortField === 'client') {
      valA = a.clients?.name || '';
      valB = b.clients?.name || '';
    }

    if (sortField === 'status') {
      const weights: Record<string, number> = { rascunho: 1, em_negociacao: 2, aprovado: 3, reprovado: 4 };
      valA = weights[a.status] || 0;
      valB = weights[b.status] || 0;
    }

    if (sortField === 'valorFinal' || sortField === 'updated_at') {
      valA = Number(valA || (a as any).valorFinal || 0);
      valB = Number(valB || (b as any).valorFinal || 0);
      if (sortField.includes('_at')) {
        valA = new Date(valA || (a as any)[sortField]).getTime();
        valB = new Date(valB || (b as any)[sortField]).getTime();
      }
    }

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const recentList = sortedBudgets.slice(0, 5);

  // Performance comercial
  const approvedBudgets = budgets.filter(b => b.status === 'aprovado');
  const decidedBudgets = budgets.filter(b => b.status === 'aprovado' || b.status === 'reprovado');
  const taxaAprovacao = decidedBudgets.length > 0
    ? Math.round((approvedBudgets.length / decidedBudgets.length) * 100)
    : 0;
  const ticketMedio = approvedBudgets.length > 0
    ? approvedBudgets.reduce((s, b) => s + ((b as any).valorFinal || 0), 0) / approvedBudgets.length
    : 0;

  const monthlyData = useMemo(() => {
    const months: Record<string, number> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      months[key] = 0;
    }
    approvedBudgets.forEach(b => {
      const d = new Date(b.updated_at);
      const key = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      if (key in months) months[key] += (b as any).valorFinal || 0;
    });
    return Object.entries(months).map(([mes, valor]) => ({ mes, valor }));
  }, [approvedBudgets]);

  const topClients = useMemo(() => {
    const map: Record<string, { name: string; total: number }> = {};
    approvedBudgets.forEach(b => {
      const name = b.clients?.name || 'Sem cliente';
      if (!map[name]) map[name] = { name, total: 0 };
      map[name].total += (b as any).valorFinal || 0;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [approvedBudgets]);

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-lumos-text-secondary opacity-30" />;
    return sortOrder === 'asc' 
      ? <ChevronUp className="w-3.5 h-3.5 text-lumos-yellow" /> 
      : <ChevronDown className="w-3.5 h-3.5 text-lumos-yellow" />;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="animate-in fade-in slide-in-from-left-4 duration-500">
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Dashboard</h1>
          <p className="text-lumos-text-secondary mt-1 font-medium">Resumo de performance e atividades recentes.</p>
        </div>
        <Link to="/orcamentos/novo" className="btn-primary flex items-center gap-2 text-sm shadow-xl shadow-lumos-yellow/20 hover:scale-105 active:scale-95 transition-all">
          <Plus className="w-5 h-5" />
          Novo Orçamento
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <div 
            key={stat.label} 
            className="card flex items-center gap-4 group hover:shadow-lg transition-all duration-300 animate-in fade-in slide-in-from-bottom-4"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className={clsx("p-3 rounded-lumos transition-transform group-hover:scale-110", stat.color)}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">{stat.label}</p>
              <p className={clsx("font-black text-lumos-text-primary mt-0.5", stat.label === 'Total Aprovado' ? 'text-xl' : 'text-2xl')}>
                {stat.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Performance Comercial */}
      {!loading && budgets.length > 0 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h2 className="text-lg font-black text-lumos-text-primary uppercase tracking-tight">Performance Comercial</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* KPIs */}
            <div className="space-y-4">
              <div className="card flex items-center gap-4">
                <div className="p-3 rounded-lumos bg-lumos-yellow/10 text-lumos-yellow">
                  <Target className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Taxa de Aprovação</p>
                  <p className="text-2xl font-black text-lumos-text-primary">{taxaAprovacao}%</p>
                  <p className="text-[10px] text-lumos-text-secondary">{decidedBudgets.length} decididos</p>
                </div>
              </div>
              <div className="card flex items-center gap-4">
                <div className="p-3 rounded-lumos bg-green-500/10 text-green-500">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Ticket Médio</p>
                  <p className="text-xl font-black text-lumos-text-primary">{formatCurrency(ticketMedio)}</p>
                  <p className="text-[10px] text-lumos-text-secondary">{approvedBudgets.length} aprovados</p>
                </div>
              </div>
            </div>

            {/* Gráfico mensal */}
            <div className="card">
              <p className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest mb-4">Aprovados por Mês (R$)</p>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={monthlyData} barSize={24}>
                  <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    formatter={(v: any) => [formatCurrency(Number(v)), 'Aprovado']}
                    contentStyle={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#aaa' }}
                    cursor={{ fill: 'rgba(239,199,0,0.05)' }}
                  />
                  <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                    {monthlyData.map((_, i) => (
                      <Cell key={i} fill={i === monthlyData.length - 1 ? '#EFC700' : '#EFC70040'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Top clientes */}
            <div className="card">
              <p className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest mb-4 flex items-center gap-2">
                <Users className="w-3 h-3" /> Top Clientes por Aprovado
              </p>
              {topClients.length === 0 ? (
                <p className="text-xs text-lumos-text-secondary italic">Nenhum orçamento aprovado ainda.</p>
              ) : (
                <div className="space-y-3">
                  {topClients.map((c, i) => {
                    const max = topClients[0].total;
                    return (
                      <div key={c.name}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-bold text-lumos-text-primary truncate max-w-[140px]">{c.name}</span>
                          <span className="text-lumos-text-secondary font-mono flex-shrink-0 ml-2">{formatCurrency(c.total)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-lumos-border overflow-hidden">
                          <div
                            className="h-full rounded-full bg-lumos-yellow transition-all duration-700"
                            style={{ width: `${(c.total / max) * 100}%`, opacity: 1 - i * 0.15 }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-lumos-text-primary uppercase tracking-tight">Atividades Recentes</h2>
            <Link to="/orcamentos" className="text-xs font-bold text-lumos-yellow hover:underline flex items-center gap-1 group sm:hidden">
              Ver todos <MoreVertical className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
          <Link to="/orcamentos" className="hidden sm:flex text-xs font-bold text-lumos-yellow hover:underline items-center gap-1 group">
            Ver todos os orçamentos <MoreVertical className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
          </Link>
          <div className="relative sm:ml-auto">
            <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary z-10 pointer-events-none" />
            <Select
              className="input-lumos h-9 pl-9 pr-6 text-[9px] font-black uppercase tracking-widest min-w-[150px] w-full sm:w-auto"
              value={`${sortField}-${sortOrder}`}
              onChange={(v) => { const [field, order] = v.split('-'); setSortField(field); setSortOrder(order as 'asc' | 'desc'); }}
              options={[
                { value: 'updated_at-desc', label: 'Recentes' },
                { value: 'updated_at-asc', label: 'Antigos' },
                { value: 'valorFinal-desc', label: 'Maior valor' },
                { value: 'valorFinal-asc', label: 'Menor valor' },
                { value: 'project_name-asc', label: 'A → Z' },
              ]}
            />
          </div>
        </div>

        {/* Budgets List (Recent 5) */}
        <div className="card overflow-visible !p-0 shadow-sm border-lumos-border animate-in fade-in slide-in-from-bottom-6 duration-700">
          <div className="overflow-x-auto">
            <table className="w-full text-left lumos-sticky-1">
              <thead>
                <tr className="bg-lumos-bg/50 border-b border-lumos-border">
                  <th 
                    className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest cursor-pointer group/h"
                    onClick={() => handleSort('code')}
                  >
                    <div className="flex items-center gap-2">
                      Código <SortIcon field="code" />
                    </div>
                  </th>
                  <th 
                    className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest cursor-pointer group/h"
                    onClick={() => handleSort('project_name')}
                  >
                    <div className="flex items-center gap-2">
                      Projeto <SortIcon field="project_name" />
                    </div>
                  </th>
                  <th 
                    className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest cursor-pointer group/h"
                    onClick={() => handleSort('client')}
                  >
                    <div className="flex items-center gap-2">
                      Cliente <SortIcon field="client" />
                    </div>
                  </th>
                  <th 
                    className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-center cursor-pointer group/h"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center justify-center gap-2">
                      Status <SortIcon field="status" />
                    </div>
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lumos-border relative">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={4} className="px-6 py-6 h-16"></td>
                    </tr>
                  ))
                ) : recentBudgets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-lumos-text-secondary italic font-medium">
                      Nenhum orçamento encontrado.
                    </td>
                  </tr>
                ) : (
                  recentList.map((budget) => (
                    <tr 
                      key={budget.id} 
                      className="hover:bg-lumos-yellow/[0.02] transition-all group cursor-pointer"
                      onClick={() => navigate(`/orcamentos/${budget.id}`)}
                    >
                      <td className="px-6 py-4 font-mono text-lumos-yellow text-sm font-black whitespace-nowrap">
                        {formatBudgetCode(budget.code)}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-lumos-text-primary font-bold group-hover:text-lumos-yellow transition-colors">{budget.project_name}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[10px] text-lumos-text-secondary font-black uppercase tracking-tighter">
                          {budget.clients?.agency_name ? `${budget.clients.agency_name} + ${budget.clients.name}` : (budget.clients?.name || 'Cliente Direto')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={clsx(
                          "px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                          budget.status === 'aprovado' ? 'text-green-600 bg-green-500/10' : 
                          budget.status === 'em_negociacao' ? 'text-lumos-yellow bg-lumos-yellow/10' : 
                          budget.status === 'reprovado' ? 'text-red-500 bg-red-500/10' : 'text-lumos-text-secondary bg-lumos-bg'
                        )}>
                          {budget.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end relative" ref={activeMenu === budget.id ? menuRef : null}>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenu(activeMenu === budget.id ? null : budget.id);
                            }}
                            className="p-2 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-bg rounded-lumos transition-all"
                          >
                            <MoreVertical className="w-5 h-5" />
                          </button>
                          
                          {/* Dropdown menu */}
                          {activeMenu === budget.id && (
                            <div className="absolute top-10 right-0 w-48 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-40 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/orcamentos/${budget.id}`);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-lumos-text-primary hover:bg-lumos-bg transition-colors"
                              >
                                <Edit2 className="w-4 h-4 text-lumos-yellow" />
                                Editar
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExportPDF(budget);
                                }}
                                disabled={exportingId === budget.id}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-lumos-text-primary hover:bg-lumos-bg transition-colors disabled:opacity-50"
                              >
                                <FileDown className={clsx("w-4 h-4 text-green-500", exportingId === budget.id && "animate-bounce")} />
                                {exportingId === budget.id ? 'Gerando...' : 'Gerar Orçamento PDF'}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setBudgetToDelete(budget);
                                  setActiveMenu(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-red-500 hover:bg-red-500/5 transition-colors border-t border-lumos-border"
                              >
                                <Trash2 className="w-4 h-4" />
                                Deletar
                              </button>
                            </div>
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
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!budgetToDelete}
        onClose={() => setBudgetToDelete(null)}
        title="Confirmar Exclusão"
        footer={
          <>
            <button onClick={() => setBudgetToDelete(null)} className="btn-secondary">Cancelar</button>
            <button 
              onClick={handleDeleteBudget}
              className="bg-red-500 text-white font-black py-2.5 px-6 rounded-lumos hover:bg-red-600 transition-all active:scale-95 text-xs uppercase"
            >
              Sim, Deletar Orçamento
            </button>
          </>
        }
      >
        <div className="flex gap-4 items-start">
          <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <div className="space-y-2">
            <p className="text-lumos-text-primary font-bold">
              Você está prestes a deletar o projeto:
            </p>
            <p className="text-xl font-black text-lumos-yellow truncate">
              {budgetToDelete?.project_name}
            </p>
            <p className="text-xs text-lumos-text-secondary leading-relaxed">
              Esta ação é <span className="text-red-500 font-bold uppercase">irreversível</span>.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
