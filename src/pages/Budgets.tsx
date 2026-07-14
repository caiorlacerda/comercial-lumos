import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { 
  Users,
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
  Copy,
  Calendar,
  Filter,
  ExternalLink,
  FileDown,
  Check,
  ChevronUp,
  ChevronDown,
  ArrowUpDown
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { pdf } from '@react-pdf/renderer';
import Modal from '@/components/common/Modal';
import Pagination from '@/components/common/Pagination';
import { BudgetPDF } from '@/components/editor/BudgetPDF';
import { calcFinancials, formatCurrency } from '@/utils/financials';
import { syncBudgetApprovalFlow } from '@/utils/financeiro';
import { formatBudgetCode } from '@/utils/formatters';
import { getPdfFileName } from '@/utils/pdfFileName';
import { useToast } from '@/context/ToastContext';
import { useSaveOsToDrive } from '@/hooks/useSaveOsToDrive';
import { logAudit } from '@/hooks/useAuditLog';

interface Budget {
  id: string;
  code: string;
  project_name: string;
  category: 'digital' | 'filme' | 'live';
  status: 'rascunho' | 'em_negociacao' | 'aprovado' | 'reprovado';
  created_at: string;
  updated_at: string;
  client_id: string;
  active_version_id: string;
  clients: { name: string; agency_name?: string | null };
  versions: any[];
}

function parseBudgetCodeNumeric(code: string): number {
  if (!code) return 0;
  const clean = code.startsWith('#') ? code.slice(1) : code;
  if (clean.includes('-')) {
    const parts = clean.split('-');
    const year = parseInt(parts[0], 10) || 0;
    const seq = parseInt(parts[1], 10) || 0;
    return year * 1000000 + seq;
  }
  const seq = parseInt(clean, 10) || 0;
  const currentYear = new Date().getFullYear();
  return currentYear * 1000000 + seq;
}

export default function Budgets() {
  const navigate = useNavigate();
  const toast = useToast();
  const { saveOsToDrive } = useSaveOsToDrive();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 15;
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  
  // Menu & Modal state
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState<string | null>(null);
  const [batchStatusMenuOpen, setBatchStatusMenuOpen] = useState(false);
  const [budgetToDelete, setBudgetToDelete] = useState<Budget | null>(null);
  const [budgetsToDelete, setBudgetsToDelete] = useState<Budget[]>([]);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [approvalMap, setApprovalMap] = useState<Record<string, { approved: boolean; approver_name: string | null } | 'pending'>>({});
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  
  // Sorting & Filtering
  const [sortField, setSortField] = useState<string>('code');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [allClients, setAllClients] = useState<any[]>([]);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const batchStatusRef = useRef<HTMLDivElement>(null);

  const statusOptions = [
    { value: 'rascunho', label: 'Rascunho', color: 'text-lumos-text-secondary bg-lumos-bg border-lumos-border' },
    { value: 'em_negociacao', label: 'Em Negociação', color: 'text-[#F5D87A] bg-[#F5D87A]/10 border-[#F5D87A]/20' },
    { value: 'aprovado', label: 'Aprovado', color: 'text-green-600 bg-green-500/10 border-green-500/20' },
    { value: 'reprovado', label: 'Reprovado', color: 'text-red-500 bg-red-500/10 border-red-500/20' }
  ];

  useEffect(() => {
    fetchBudgets();
    fetchClients();
    supabase.auth.getUser().then(({ data }) => setCurrentUser(data.user));
    
    // Click outside listener
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(null);
      }
      if (batchStatusRef.current && !batchStatusRef.current.contains(e.target as Node)) {
        setBatchStatusMenuOpen(false);
      }
    };

    // Esc to deselect
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedIds(new Set());
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Tempo real: orçamentos alterados por outros usuários aparecem sem spinner
  useRealtimeRefetch(['budgets', 'budget_items', 'clients'], () => { fetchBudgets(true); fetchClients(); });

  async function fetchBudgets(silent = false) {
    try {
      if (!silent) setLoading(true);
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
        .order('updated_at', { ascending: false });

      if (error) throw error;
      
      // Post-process to calculate final values
      const processed = (data || []).map(b => {
        const activeVersion = (b as any).active_version || b.versions?.[0];
        let valorFinal = 0;
        if (activeVersion) {
          const financials = calcFinancials(activeVersion.items || [], activeVersion);
          valorFinal = financials.valorFinal;
        }
        return { ...b, valorFinal, active_version: activeVersion };
      });
      
      setBudgets(processed);

      // Fetch approval status for versions with public tokens
      const { data: versionsWithToken } = await supabase
        .from('budget_versions')
        .select('id, budget_id, budget_approvals(approved, approver_name)')
        .not('public_token', 'is', null);

      if (versionsWithToken?.length) {
        const map: Record<string, { approved: boolean; approver_name: string | null } | 'pending'> = {};
        for (const v of versionsWithToken) {
          const approval = (v as any).budget_approvals?.[0];
          map[v.budget_id] = approval ? { approved: approval.approved, approver_name: approval.approver_name } : 'pending';
        }
        setApprovalMap(map);
      }
    } catch (err) {
      console.error('Error fetching budgets:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchClients() {
    try {
      const { data } = await supabase.from('clients').select('id, name').order('name');
      if (data) setAllClients(data);
    } catch (err) {
      console.error('Error fetching clients:', err);
    }
  }

  // Quando um orçamento é APROVADO via lista, sincroniza receivable + project
  // (mesmo comportamento do editor de orçamento).


  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('budgets')
        .update({ status: newStatus })
        .eq('id', id);

      if (error) throw error;

      // Sincroniza recebíveis e projeto quando aprovado
      if (newStatus === 'aprovado') {
        await syncBudgetApprovalFlow(id);
        // OS automática no Drive (silenciosa; só sobe se já estiver logado no Google).
        // Fire-and-forget pra não travar a UI (gera PDF + espera a pasta provisionar).
        (async () => {
          try {
            const { data: proj } = await supabase.from('projects').select('id').eq('budget_id', id).maybeSingle();
            if (proj?.id) {
              const r = await saveOsToDrive({ budgetId: id, projectId: proj.id, interactive: false });
              if (r.ok) toast.success('OS salva no Drive do projeto!');
            }
          } catch { /* silencioso */ }
        })();
      }

      setBudgets(prev => prev.map(b => b.id === id ? { ...b, status: newStatus as any } : b));
      setStatusMenuOpen(null);
      if (newStatus === 'aprovado') {
        toast.success('Orçamento aprovado! Projeto e contas a receber atualizados.');
      }
    } catch (err) {
      console.error('Error updating status:', err);
      toast.error('Erro ao atualizar status.');
    }
  };

  const handleBatchStatusUpdate = async (newStatus: string) => {
    if (selectedIds.size === 0) return;

    try {
      const idsToUpdate = Array.from(selectedIds);
      const { error } = await supabase
        .from('budgets')
        .update({ status: newStatus })
        .in('id', idsToUpdate);

      if (error) throw error;

      // Sincroniza cada orçamento aprovado em lote
      if (newStatus === 'aprovado') {
        await Promise.all(idsToUpdate.map(id => syncBudgetApprovalFlow(id)));
      }

      setBudgets(prev => prev.map(b => idsToUpdate.includes(b.id) ? { ...b, status: newStatus as any } : b));
      setSelectedIds(new Set());
      setBatchStatusMenuOpen(false);
      if (newStatus === 'aprovado') {
        toast.success(`${idsToUpdate.length} orçamento(s) aprovado(s)! Projetos e contas a receber atualizados.`);
      }
    } catch (err) {
      console.error('Error in batch status update:', err);
      toast.error('Erro ao atualizar status em lote.');
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

  const unlinkBudgetReferences = async (ids: string[]) => {
    await Promise.all([
      supabase.from('receivables').delete().in('budget_id', ids),
      supabase.from('project_costs').delete().in('budget_id', ids),
    ]);
  };

  const handleDeleteBudget = async () => {
    if (!budgetToDelete) return;

    try {
      await unlinkBudgetReferences([budgetToDelete.id]);

      const { error } = await supabase
        .from('budgets')
        .delete()
        .eq('id', budgetToDelete.id);

      if (error) throw error;

      setBudgets(prev => prev.filter(b => b.id !== budgetToDelete.id));
      logAudit('budget_deleted', `Orçamento "${budgetToDelete.project_name}" (#${budgetToDelete.code}) excluído`, { budget_id: budgetToDelete.id });
      setBudgetToDelete(null);
      setActiveMenu(null);
      toast.success('Orçamento excluído.');
    } catch (err: any) {
      console.error('Error deleting budget:', err);
      toast.error(`Erro ao deletar orçamento: ${err?.message || JSON.stringify(err)}`);
    }
  };

  const handleBatchDelete = async () => {
    if (budgetsToDelete.length === 0) return;

    try {
      const idsToDelete = budgetsToDelete.map(b => b.id);
      await unlinkBudgetReferences(idsToDelete);

      const { error } = await supabase
        .from('budgets')
        .delete()
        .in('id', idsToDelete);

      if (error) throw error;

      setBudgets(prev => prev.filter(b => !idsToDelete.includes(b.id)));
      logAudit('budget_deleted', `${idsToDelete.length} orçamento(s) excluído(s) em lote`, { budget_ids: idsToDelete });
      setBudgetsToDelete([]);
      setSelectedIds(new Set());
      toast.success(`${idsToDelete.length} orçamento(s) excluído(s).`);
    } catch (err: any) {
      console.error('Error in batch delete:', err);
      toast.error(`Erro ao deletar orçamentos: ${err?.message || JSON.stringify(err)}`);
    }
  };

  const handleExportPDF = async (budget: Budget, showAlerts = true) => {
    try {
      if (showAlerts) setExportingId(budget.id);
      setActiveMenu(null);

      // Fetch full budget data with all items details (just like the editor does)
      const { data: fullBudget, error } = await supabase
        .from('budgets')
        .select(`
          *,
          clients(name, agency_name, contact_name, email),
          active_version:budget_versions!budgets_active_version_fkey(
            *,
            contact:client_contacts(name, email, role),
            budget_items(
              id,
              item_group,
              name,
              description,
              unit_cost,
              quantity,
              unit_label,
              sort_order
            )
          )
        `)
        .eq('id', budget.id)
        .single();

      if (error) throw error;
      if (!fullBudget) throw new Error('Budget not found');

      const activeVersion = (fullBudget as any).active_version;
      if (!activeVersion) {
        if (showAlerts) toast.warning('Nenhuma versão encontrada para este orçamento.');
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
      if (showAlerts) toast.error('Erro ao gerar PDF: ' + (err as any).message);
    } finally {
      if (showAlerts) setExportingId(null);
    }
  };

  const handleBatchExport = async () => {
    const toExport = budgets.filter(b => selectedIds.has(b.id));
    if (toExport.length === 0) return;

    try {
      setExportProgress({ current: 0, total: toExport.length });
      for (let i = 0; i < toExport.length; i++) {
        setExportProgress({ current: i + 1, total: toExport.length });
        await handleExportPDF(toExport[i], false);
        // Small delay to avoid browser blocking multiple downloads
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.error('Error in batch export:', err);
      toast.error('Erro na exportação em lote.');
    } finally {
      setExportProgress(null);
      setSelectedIds(new Set());
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredBudgets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredBudgets.map(b => b.id)));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleDuplicateBudget = async (budget: Budget) => {
    try {
      setIsDuplicating(true);
      setActiveMenu(null);

      // 1. Get the original version and items
      const originalVersion = budget.versions?.find((v: any) => v.id === budget.active_version_id) || budget.versions?.[0];
      if (!originalVersion) throw new Error('Versão original não encontrada');

      const { data: originalItems } = await supabase
        .from('budget_items')
        .select('*')
        .eq('version_id', originalVersion.id);

      // 2. Create new budget (passing '----' to trigger auto code generation in database)
      const { data: newBudget, error: bError } = await supabase
        .from('budgets')
        .insert({
          code: '----',
          project_name: `${budget.project_name} (Cópia)`,
          category: budget.category,
          status: 'rascunho',
          client_id: budget.client_id
        })
        .select()
        .single();

      if (bError) throw bError;

      // 4. Create new version
      const { data: newVersion, error: vError } = await supabase
        .from('budget_versions')
        .insert({
          budget_id: newBudget.id,
          version_number: 1,
          margin_pct: originalVersion.margin_pct,
          nf_pct: originalVersion.nf_pct,
          discount_value: originalVersion.discount_value,
          notes_internal: originalVersion.notes_internal,
          notes_client: originalVersion.notes_client,
          payment_terms: originalVersion.payment_terms,
          validity_days: originalVersion.validity_days
        })
        .select()
        .single();

      if (vError) throw vError;

      // 5. Update budget with active version
      await supabase.from('budgets').update({ active_version_id: newVersion.id }).eq('id', newBudget.id);

      // 6. Clone items
      if (originalItems && originalItems.length > 0) {
        const clonedItems = originalItems.map(item => ({
          version_id: newVersion.id,
          item_group: item.item_group,
          name: item.name,
          unit_cost: item.unit_cost,
          quantity: item.quantity,
          unit_label: item.unit_label,
          sort_order: item.sort_order,
          catalog_item_id: item.catalog_item_id
        }));
        await supabase.from('budget_items').insert(clonedItems);
      }

      // 7. Refresh or Navigate
      navigate(`/orcamentos/${newBudget.id}`);
    } catch (err) {
      console.error('Error duplicating budget:', err);
      toast.error('Erro ao duplicar orçamento.');
    } finally {
      setIsDuplicating(false);
    }
  };

  const filteredBudgets = budgets
    .filter(b => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = b.project_name.toLowerCase().includes(searchLower) || 
                            b.clients?.name?.toLowerCase().includes(searchLower) ||
                            b.code.toLowerCase().includes(searchLower);
      const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || b.category === categoryFilter;
      const matchesClient = clientFilter === 'all' || b.client_id === clientFilter;
      return matchesSearch && matchesStatus && matchesCategory && matchesClient;
    })
    .sort((a, b) => {
      let valA: any = a[sortField as keyof Budget];
      let valB: any = b[sortField as keyof Budget];

      // Parse budget code numerically for precise sorting
      if (sortField === 'code') {
        valA = parseBudgetCodeNumeric(a.code);
        valB = parseBudgetCodeNumeric(b.code);
      }

      // Handle nested client name
      if (sortField === 'client') {
        valA = a.clients?.name || '';
        valB = b.clients?.name || '';
      }

      // Handle status priority
      if (sortField === 'status') {
        const weights: Record<string, number> = { rascunho: 1, em_negociacao: 2, aprovado: 3, reprovado: 4 };
        valA = weights[a.status] || 0;
        valB = weights[b.status] || 0;
      }

      // Handle numeric/date values
      if (sortField === 'valorFinal' || sortField === 'created_at' || sortField === 'updated_at') {
        valA = Number(valA || (a as any).valorFinal || 0);
        valB = Number(valB || (b as any).valorFinal || 0);
        if (sortField.includes('_at')) {
          valA = new Date(valA || (a as any)[sortField]).getTime();
          valB = new Date(valB || (b as any)[sortField]).getTime();
        }
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      
      // Secondary sort tie-breaker by code descending for client sorting
      if (sortField === 'client') {
        const codeA = parseBudgetCodeNumeric(a.code);
        const codeB = parseBudgetCodeNumeric(b.code);
        if (codeA < codeB) return 1;
        if (codeA > codeB) return -1;
      }
      
      return 0;
    });

  const totalPages = Math.ceil(filteredBudgets.length / PAGE_SIZE);
  const pagedBudgets = filteredBudgets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Orçamentos</h1>
          <p className="text-lumos-text-secondary mt-1 font-medium">Gerencie e visualize todos os seus projetos.</p>
        </div>
        <button
          onClick={() => navigate('/orcamentos/novo')}
          className="btn-primary flex items-center gap-2 text-sm shadow-xl shadow-lumos-yellow/20 hover:scale-105 active:scale-95 transition-all"
        >
          <Plus className="w-5 h-5" />
          Novo Orçamento
        </button>
      </div>

      {/* Filters Bar */}
      <div className="card space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
            <input 
              type="text" 
              placeholder="Buscar por projeto, cliente ou código..." 
              className="input-lumos w-full pl-10 h-11 text-sm font-medium"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
              <select
                className="input-lumos h-11 pl-10 pr-8 text-[10px] font-black uppercase tracking-widest min-w-[160px]"
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              >
                <option value="all">Status: Todos</option>
                <option value="rascunho">Rascunhos</option>
                <option value="em_negociacao">Em Negociação</option>
                <option value="aprovado">Aprovados</option>
                <option value="reprovado">Reprovados</option>
              </select>
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
              <select 
                className="input-lumos h-11 pl-10 pr-8 text-[10px] font-black uppercase tracking-widest min-w-[160px]"
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setCurrentPage(1); }}
              >
                <option value="all">Categoria: Todas</option>
                <option value="digital">Digital</option>
                <option value="filme">Filme</option>
                <option value="live">Live</option>
              </select>
            </div>
            <div className="relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
              <select 
                className="input-lumos h-11 pl-10 pr-8 text-[10px] font-black uppercase tracking-widest min-w-[160px]"
                value={clientFilter}
                onChange={(e) => { setClientFilter(e.target.value); setCurrentPage(1); }}
              >
                <option value="all">Cliente: Todos</option>
                {allClients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
              <select 
                className="input-lumos h-11 pl-10 pr-8 text-[10px] font-black uppercase tracking-widest min-w-[160px]"
                value={`${sortField}-${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split('-');
                  setSortField(field);
                  setSortOrder(order as 'asc' | 'desc');
                }}
              >
                <option value="code-desc">Código (Decrescente)</option>
                <option value="code-asc">Código (Crescente)</option>
                <option value="updated_at-desc">Mais recente</option>
                <option value="updated_at-asc">Mais antigo</option>
                <option value="valorFinal-desc">Maior valor</option>
                <option value="valorFinal-asc">Menor valor</option>
                <option value="project_name-asc">A → Z (Projeto)</option>
                <option value="project_name-desc">Z → A (Projeto)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Table Container with minimum height to prevent clipping when few items exist */}
      <div className="card !p-0 shadow-sm border-lumos-border animate-in fade-in slide-in-from-bottom-6 duration-700 min-h-[200px] overflow-visible">
        <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-lumos-bg/50 border-b border-lumos-border">
                <th className="px-6 py-4 w-10">
                  <div 
                    onClick={toggleSelectAll}
                    className={clsx(
                      "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                      selectedIds.size === filteredBudgets.length && filteredBudgets.length > 0
                        ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                        : "border-lumos-border hover:border-lumos-yellow/50"
                    )}
                  >
                    {selectedIds.size === filteredBudgets.length && filteredBudgets.length > 0 && <Check className="w-3.5 h-3.5" />}
                  </div>
                </th>
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
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-center">Info</th>
                <th 
                  className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-center cursor-pointer group/h"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center justify-center gap-2">
                    Status <SortIcon field="status" />
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-right cursor-pointer group/h"
                  onClick={() => handleSort('valorFinal')}
                >
                  <div className="flex items-center justify-end gap-2">
                    Valor Final <SortIcon field="valorFinal" />
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-right cursor-pointer group/h"
                  onClick={() => handleSort('updated_at')}
                >
                  <div className="flex items-center justify-end gap-2">
                    Datas <SortIcon field="updated_at" />
                  </div>
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-center">Aprovação</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase text-lumos-text-primary tracking-widest text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border relative">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="animate-pulse border-b border-lumos-border">
                    <td className="px-6 py-4"><div className="h-4 w-4 rounded bg-lumos-border" /></td>
                    <td className="px-6 py-4"><div className="h-3 w-20 rounded bg-lumos-border" /></td>
                    <td className="px-6 py-4"><div className="h-3 w-40 rounded bg-lumos-border" /></td>
                    <td className="px-6 py-4"><div className="h-3 w-28 rounded bg-lumos-border" /></td>
                    <td className="px-6 py-4"><div className="h-5 w-24 rounded-full bg-lumos-border" /></td>
                    <td className="px-6 py-4"><div className="h-3 w-24 rounded bg-lumos-border ml-auto" /></td>
                    <td className="px-6 py-4"><div className="h-5 w-20 rounded-full bg-lumos-border mx-auto" /></td>
                    <td className="px-6 py-4"><div className="h-3 w-20 rounded bg-lumos-border ml-auto" /></td>
                  </tr>
                ))
              ) : filteredBudgets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-lumos-text-secondary italic font-medium">
                    Nenhum orçamento encontrado.
                  </td>
                </tr>
              ) : (
                pagedBudgets.map((budget) => (
                  <tr 
                    key={budget.id} 
                    className={clsx(
                      "hover:bg-lumos-yellow/[0.02] transition-all group cursor-pointer",
                      selectedIds.has(budget.id) && "bg-lumos-yellow/[0.03]"
                    )}
                    onClick={() => navigate(`/orcamentos/${budget.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div 
                        onClick={(e) => toggleSelect(budget.id, e)}
                        className={clsx(
                          "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                          selectedIds.has(budget.id)
                            ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                            : "border-lumos-border group-hover:border-lumos-yellow/50 opacity-0 group-hover:opacity-100",
                          selectedIds.size > 0 && "opacity-100"
                        )}
                      >
                        {selectedIds.has(budget.id) && <Check className="w-3.5 h-3.5" />}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-lumos-yellow text-sm font-black whitespace-nowrap">
                      {formatBudgetCode(budget.code)}
                    </td>
                    <td className="px-6 py-4 max-w-[180px] md:max-w-[220px] lg:max-w-[280px] xl:max-w-[340px] 2xl:max-w-[420px]">
                      <span
                        className="text-lumos-text-primary font-bold group-hover:text-lumos-yellow transition-colors block truncate"
                        title={budget.project_name}
                      >
                        {budget.project_name}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[10px] text-lumos-text-secondary font-black uppercase tracking-tighter">
                        {budget.clients?.agency_name ? `${budget.clients.agency_name} + ${budget.clients.name}` : (budget.clients?.name || 'Cliente Direto')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="text-[10px] font-black uppercase py-0.5 px-2 bg-lumos-text-secondary/10 border border-lumos-border rounded-full text-lumos-text-primary">
                        {budget.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center relative" ref={statusMenuOpen === budget.id ? statusMenuRef : null}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setStatusMenuOpen(statusMenuOpen === budget.id ? null : budget.id);
                          }}
                          className={clsx(
                            "px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border transition-all hover:scale-105 active:scale-95",
                            budget.status === 'aprovado' ? 'text-green-600 bg-green-500/10 border-green-500/20' : 
                            budget.status === 'em_negociacao' ? 'text-[#F5D87A] bg-[#F5D87A]/10 border-[#F5D87A]/20' : 
                            budget.status === 'reprovado' ? 'text-red-500 bg-red-500/10 border-red-500/20' : 'text-lumos-text-secondary bg-lumos-bg border-lumos-border'
                          )}
                        >
                          {budget.status.replace('_', ' ')}
                        </button>

                        {statusMenuOpen === budget.id && (
                          <div className="absolute top-10 left-1/2 -translate-x-1/2 w-48 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-[9999] py-1 overflow-visible animate-in fade-in zoom-in-95 duration-200">
                            {statusOptions.map((opt) => (
                              <button
                                key={opt.value}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUpdateStatus(budget.id, opt.value);
                                }}
                                className="w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-lumos-bg transition-colors"
                              >
                                <span className={opt.color + " px-2 py-0.5 rounded-full"}>{opt.label}</span>
                                {budget.status === opt.value && <Check className="w-3.5 h-3.5 text-lumos-yellow" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-black text-lumos-text-primary text-sm font-mono">
                      {formatCurrency((budget as any).valorFinal || 0)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-1 text-[10px] text-lumos-text-secondary">
                          <Plus className="w-2.5 h-2.5" />
                          {format(new Date(budget.created_at), 'dd/MM/yy', { locale: ptBR })}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-lumos-yellow font-bold">
                          <Clock className="w-2.5 h-2.5" />
                          {format(new Date(budget.updated_at), 'dd/MM/yy', { locale: ptBR })}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {approvalMap[budget.id] ? (
                        <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full border whitespace-nowrap ${
                          approvalMap[budget.id] === 'pending'
                            ? 'text-lumos-yellow bg-lumos-yellow/10 border-lumos-yellow/20'
                            : (approvalMap[budget.id] as any).approved
                              ? 'text-green-400 bg-green-500/10 border-green-500/20'
                              : 'text-red-400 bg-red-500/10 border-red-500/20'
                        }`}>
                          {approvalMap[budget.id] === 'pending'
                            ? '⏳ Aguardando'
                            : (approvalMap[budget.id] as any).approved
                              ? '✓ Aprovado'
                              : '✗ Recusado'}
                        </span>
                      ) : (
                        <span className="text-lumos-border">—</span>
                      )}
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
                          <div className="absolute top-10 right-0 w-48 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-[9999] py-1 overflow-visible animate-in fade-in zoom-in-95 duration-200">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/orcamentos/${budget.id}`);
                              }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-lumos-text-primary hover:bg-lumos-bg transition-colors"
                            >
                              <Edit2 className="w-4 h-4 text-lumos-yellow" />
                              Abrir
                            </button>
                            <button
                              disabled={isDuplicating}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicateBudget(budget);
                              }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-lumos-text-primary hover:bg-lumos-bg transition-colors disabled:opacity-50"
                            >
                              <Copy className="w-4 h-4 text-blue-500" />
                              Duplicar
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
                )
              ))}
            </tbody>
          </table>
        </div>
          <div className="px-6 pb-4">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              totalItems={filteredBudgets.length}
              pageSize={PAGE_SIZE}
            />
          </div>
      </div>

      {/* Individual Delete Confirmation Modal */}
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
              Esta ação é <span className="text-red-500 font-bold uppercase">irreversível</span> e removerá permanentemente todas as versões e itens vinculados a este orçamento.
            </p>
          </div>
        </div>
      </Modal>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-lumos-surface border border-lumos-yellow/20 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-full px-6 py-4 flex flex-wrap items-center gap-4 backdrop-blur-xl">
            <div className="flex items-center gap-3 pr-6 border-r border-lumos-border">
              <div className="w-8 h-8 rounded-full bg-lumos-yellow/20 flex items-center justify-center font-black text-lumos-yellow text-sm">
                {selectedIds.size}
              </div>
              <span className="text-sm font-bold text-lumos-text-primary uppercase tracking-tight">
                {selectedIds.size === 1 ? 'Orçamento selecionado' : 'Orçamentos selecionados'}
              </span>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={handleBatchExport}
                disabled={!!exportProgress}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-lumos-yellow text-lumos-bg font-black text-xs uppercase hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
              >
                {exportProgress ? (
                  <>
                    <div className="w-3 h-3 border-2 border-lumos-bg border-t-transparent rounded-full animate-spin" />
                    {exportProgress.current}/{exportProgress.total}
                  </>
                ) : (
                  <>
                    <FileDown className="w-3.5 h-3.5" />
                    Gerar PDFs
                  </>
                )}
              </button>
              
              <button 
                onClick={() => setBudgetsToDelete(budgets.filter(b => selectedIds.has(b.id)))}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 text-red-500 font-black text-xs uppercase hover:bg-red-500 hover:text-white transition-all active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Deletar
              </button>

              <div className="relative" ref={batchStatusRef}>
                <button 
                  onClick={() => setBatchStatusMenuOpen(!batchStatusMenuOpen)}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-lumos-bg border border-lumos-border text-lumos-text-primary font-black text-xs uppercase hover:border-lumos-yellow transition-all active:scale-95"
                >
                  Alterar Status
                  <ChevronUp className={clsx("w-3.5 h-3.5 transition-transform", batchStatusMenuOpen && "rotate-180")} />
                </button>

                {batchStatusMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-3 w-48 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-[9999] py-1 overflow-visible animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <p className="px-4 py-2 text-[9px] font-black text-lumos-text-secondary uppercase tracking-widest border-b border-lumos-border">Novo Status:</p>
                    {statusOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => handleBatchStatusUpdate(opt.value)}
                        className="w-full flex items-center px-4 py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-lumos-bg transition-colors"
                      >
                        <span className={opt.color + " px-2 py-0.5 rounded-full"}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button 
                onClick={() => setSelectedIds(new Set())}
                className="p-2 text-lumos-text-secondary hover:text-lumos-text-primary transition-colors"
              >
                Deixar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      <Modal
        isOpen={budgetsToDelete.length > 0}
        onClose={() => setBudgetsToDelete([])}
        title="Excluir Orçamentos"
        footer={
          <>
            <button onClick={() => setBudgetsToDelete([])} className="btn-secondary">Cancelar</button>
            <button 
              onClick={handleBatchDelete}
              className="bg-red-500 text-white font-black py-2.5 px-6 rounded-lumos hover:bg-red-600 transition-all active:scale-95 text-xs uppercase"
            >
              Sim, Excluir {budgetsToDelete.length} itens
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-1">
              <p className="text-lumos-text-primary font-bold">Confirma a exclusão em lote?</p>
              <p className="text-xs text-lumos-text-secondary">Os orçamentos abaixo serão deletados permanentemente:</p>
            </div>
          </div>
          
          <div className="max-h-48 overflow-y-auto px-4 py-2 bg-lumos-bg rounded border border-lumos-border space-y-2">
            {budgetsToDelete.map(b => (
              <div key={b.id} className="flex justify-between items-center py-1 border-b border-lumos-border last:border-0">
                <span className="text-xs font-mono text-lumos-yellow font-bold">#{b.code}</span>
                <span className="text-xs font-bold text-lumos-text-primary truncate ml-4 flex-1 text-right">{b.project_name}</span>
              </div>
            ))}
          </div>
          
          <p className="text-[10px] text-red-500 font-black uppercase tracking-widest text-center mt-2">
            Esta ação não pode ser desfeita.
          </p>
        </div>
      </Modal>
    </div>
  );
}
