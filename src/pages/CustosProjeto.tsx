import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Search, TrendingUp, TrendingDown, ChevronRight, ChevronUp, ChevronDown, Target, Check, Pencil, Plus, AlertTriangle, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import Modal from '@/components/common/Modal';
import ViewToggle, { type ViewMode } from '@/components/common/ViewToggle';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/hooks/useAuth';
import { formatBudgetCode } from '@/utils/formatters';

const CurrencyInput = ({ value, onChange, className }: any) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, '');
    const numberValue = rawValue ? parseInt(rawValue) / 100 : 0;
    onChange(numberValue);
  };
  return (
    <input
      type="text"
      className={className}
      value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
      onChange={handleChange}
    />
  );
};

export default function CustosProjeto() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile, isAdmin } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientFilter, setClientFilter] = useState<string>(''); // '' = todos
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null); // null = criação
  const [editProjectData, setEditProjectData] = useState({ name: '', code: '', client_id: '', production_value: 0 });
  // Ordenação por coluna clicável (mesmo padrão de Contas a Pagar/Orçamentos):
  // clicar no título alterna crescente/decrescente. O dropdown do modo grade
  // alimenta o mesmo estado.
  type SortKey = 'recente' | 'code' | 'name' | 'totalProductionValue' | 'totalCosts' | 'saldoProducao' | 'margin' | 'marginPercent' | 'tetoCustos';
  const NUMERIC_SORT_KEYS = new Set<SortKey>(['totalProductionValue', 'totalCosts', 'saldoProducao', 'margin', 'marginPercent', 'tetoCustos']);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'recente', direction: 'desc' });
  const handleSort = (key: SortKey) => {
    setSortConfig(prev =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: NUMERIC_SORT_KEYS.has(key) ? 'desc' : 'asc' } // números começam do maior; texto A→Z
    );
  };
  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortConfig.key !== column) {
      // Dica sutil de que a coluna é ordenável (aparece mais no hover do cabeçalho).
      return (
        <span className="inline-flex flex-col -space-y-2 opacity-0 group-hover/th:opacity-40 transition-opacity">
          <ChevronUp className="w-3 h-3" />
          <ChevronDown className="w-3 h-3" />
        </span>
      );
    }
    return sortConfig.direction === 'asc'
      ? <ChevronUp className="w-3 h-3 text-amber-600 dark:text-lumos-yellow" />
      : <ChevronDown className="w-3 h-3 text-amber-600 dark:text-lumos-yellow" />;
  };
  const [groupByClient, setGroupByClient] = useState(false);
  const [view, setView] = useState<ViewMode>(() => {
    try { return (localStorage.getItem('lumos_custos_view') as ViewMode) || 'list'; } catch { return 'list'; }
  });
  const changeView = (v: ViewMode) => {
    setView(v);
    try { localStorage.setItem('lumos_custos_view', v); } catch { /* ignora */ }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  useEffect(() => {
    fetchProjects();
    fetchClients();
  }, []);

  // Tempo real: custos/projetos alterados por outros usuários aparecem sem spinner
  // (vw_rentabilidade é uma view — assinamos as tabelas base)
  useRealtimeRefetch(['projetos_financeiro', 'project_costs', 'projects'], () => fetchProjects(true));

  async function fetchClients() {
    const { data } = await supabase.from('clients').select('id, name').order('name');
    setClients(data || []);
  }

  async function fetchProjects(silent = false) {
    try {
      if (!silent) setLoading(true);

      // Query from vw_rentabilidade to get calculations and dimensions
      const { data: rentData, error: rentError } = await supabase
        .from('vw_rentabilidade')
        .select(`
          *,
          client:clients(id, name),
          budget:budgets(
            id, 
            project_name, 
            code,
            active_version:budget_versions!active_version_id(
              id,
              margin_pct,
              nf_pct,
              discount_value,
              budget_items(unit_cost, quantity)
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (rentError) throw rentError;

      // Custos REAIS ao vivo, somados de project_costs por project_id — a MESMA
      // fonte do detalhe. O custos_total armazenado em projetos_financeiro (via
      // trigger) podia ficar defasado quando entravam custos/reembolsos, fazendo a
      // lista divergir do que aparece dentro do projeto. Somar ao vivo garante que
      // lista e detalhe mostrem exatamente o mesmo custo e o mesmo lucro.
      const { data: costsRows } = await supabase.from('project_costs').select('project_id, amount');
      const costByProject = new Map<string, number>();
      (costsRows || []).forEach((c: any) => {
        if (!c.project_id) return;
        costByProject.set(c.project_id, (costByProject.get(c.project_id) || 0) + Number(c.amount || 0));
      });

      const processed = (rentData || []).map(p => {
        // --- CÁLCULO DE CUSTOS E FATURAMENTO (IDÊNTICO AO DETALHE) ---
        let estimatedCost = 0;
        const budget = p.budget;
        let marginPct = 0.40; // default margin
        let budgetNfPct = 0.18; // alíquota do orçamento (reconstrói a venda)
        let discountValue = 0;

        if (budget?.active_version) {
          const version = budget.active_version;
          marginPct = Number(version.margin_pct ?? 0.40);
          budgetNfPct = Number(version.nf_pct ?? 0.18);
          discountValue = Number(version.discount_value ?? 0);

          const items = version.budget_items || [];
          estimatedCost = items.reduce(
            (acc: number, item: any) => acc + Number(item.unit_cost || 0) * Number(item.quantity || 0),
            0
          );
        }

        // Alíquota EFETIVA de NF (Dados Financeiros do projeto) — a que o detalhe
        // usa para deduzir imposto. Cai para a do orçamento e por fim 0.18.
        const effectiveNfPct = Number(p.nf_percent ?? budgetNfPct ?? 0.18);

        // Custos reais somados ao vivo (fallback ao armazenado se não houver id).
        const totalCosts = p.project_id != null
          ? (costByProject.get(p.project_id) ?? 0)
          : Number(p.custos_total || 0);

        // TETO DE CUSTOS (Custo Direto do Orçamento)
        const tetoCustos = p.proposta_id
          ? estimatedCost
          : Number(p.valor_vendido || 0) * (1 - effectiveNfPct) / (1 + 0.40);

        // Subtotal (Custo + Margem)
        const subtotalOrçado = estimatedCost * (1 + marginPct);

        // Faturamento Bruto (Venda) — valor contratado, reconstruído com a alíquota
        // do orçamento (não muda com a alíquota efetiva).
        const totalProductionValue = p.proposta_id
          ? (subtotalOrçado * (1 + budgetNfPct) - discountValue)
          : Number(p.valor_vendido || 0);

        // Faturamento Líquido (Receita sem imposto) = Bruto ÷ (1 + alíquota efetiva).
        const faturamentoLiquido = totalProductionValue / (1 + effectiveNfPct);

        // Lucro Líquido Real (com imposto deduzido)
        const margin = faturamentoLiquido - totalCosts;

        // Saldo de Produção = sobra do teto de custo (negativo = estourou o teto).
        const saldoProducao = tetoCustos - totalCosts;
        const consumoTetoPct = tetoCustos > 0 ? (totalCosts / tetoCustos) * 100 : 0;

        // Margem Real Alcançada % (Lucro / Faturamento)
        const marginPercent = totalProductionValue > 0 ? (margin / totalProductionValue) * 100 : 0;
        // -------------------------------------------------------------

        return {
          id: p.id,
          project_id: p.project_id || p.id,
          name: p.budget?.project_name || p.origem || 'Projeto Sem Nome',
          code: p.budget?.code || '',
          budget_id: p.proposta_id,
          client_id: p.cliente_id,
          client: p.client,
          totalProductionValue,
          totalCosts,
          margin,
          marginPercent,
          status_titulo: p.status_titulo,
          icp: p.icp,
          vencido: p.vencido,
          pendente_preenchimento: p.pendente_preenchimento,
          tetoCustos,
          saldoProducao,
          consumoTetoPct,
          created_at: p.created_at
        };
      });

      setProjects(processed);
    } catch (error) {
      console.error('Erro ao buscar projetos:', error);
      toast.error('Erro ao carregar dados dos projetos.');
    } finally {
      setLoading(false);
    }
  }

  const openEditModal = (project: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAdmin) return;
    setEditingProjectId(project.project_id);
    setEditProjectData({
      name: project.name || '',
      code: project.code || '',
      client_id: project.client_id || '',
      production_value: project.totalProductionValue ? Number(project.totalProductionValue) : 0,
    });
    setIsModalOpen(true);
  };

  const openCreateModal = () => {
    if (!isAdmin) return;
    setEditingProjectId(null);
    setEditProjectData({ name: '', code: '', client_id: '', production_value: 0 });
    setIsModalOpen(true);
  };

  const saveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!editProjectData.name.trim()) {
      toast.error('Informe o nome do projeto');
      return;
    }
    try {
      if (editingProjectId) {
        // Update both projects and projetos_financeiro
        const payload: any = {
          name: editProjectData.name.trim(),
          code: editProjectData.code.trim() || null,
          client_id: editProjectData.client_id || null,
          production_value: editProjectData.production_value > 0 ? editProjectData.production_value : null,
          updated_at: new Date().toISOString(),
        };
        const { error: pErr } = await supabase.from('projects').update(payload).eq('id', editingProjectId);
        if (pErr) throw pErr;

        // Also update valor_vendido in projetos_financeiro
        await supabase
          .from('projetos_financeiro')
          .update({
            valor_vendido: editProjectData.production_value,
            cliente_id: editProjectData.client_id || null
          })
          .eq('project_id', editingProjectId);

        toast.success('Projeto atualizado!');
      } else {
        // Create in projects
        const payload: any = {
          name: editProjectData.name.trim(),
          created_by: profile?.id || null,
        };
        if (editProjectData.code.trim()) payload.code = editProjectData.code.trim();
        if (editProjectData.client_id) payload.client_id = editProjectData.client_id;
        if (editProjectData.production_value > 0) payload.production_value = editProjectData.production_value;
        const { data: newProj, error: pErr } = await supabase.from('projects').insert([payload]).select().single();
        if (pErr) throw pErr;

        // Create projects_financeiro
        const { data: config } = await supabase.from('config_financeiro').select('nf_percent').eq('id', 1).single();
        await supabase.from('projetos_financeiro').insert([{
          proposta_id: null,
          project_id: newProj.id,
          cliente_id: editProjectData.client_id,
          valor_vendido: editProjectData.production_value,
          nf_percent: config?.nf_percent || 0.18,
          custos_total: 0,
          status_titulo: 'emitir_nf',
          origem: 'manual',
          pendente_preenchimento: false
        }]);

        toast.success('Projeto criado!');
      }
      setIsModalOpen(false);
      setEditingProjectId(null);
      fetchProjects();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filtered = projects.filter(p => {
    const term = searchTerm.toLowerCase();
    const matchSearch =
      !term ||
      p.name.toLowerCase().includes(term) ||
      p.client?.name?.toLowerCase().includes(term) ||
      (p.code && p.code.toLowerCase().includes(term)) ||
      (p.code && formatBudgetCode(p.code).toLowerCase().includes(term));
    const matchClient = !clientFilter || p.client_id === clientFilter;
    return matchSearch && matchClient;
  });

  const sortedProjects = React.useMemo(() => {
    const list = [...filtered];
    const { key, direction } = sortConfig;
    const dir = direction === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (key === 'recente') {
        return (new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()) * dir;
      }
      if (key === 'code') {
        return formatBudgetCode(a.code || '').localeCompare(formatBudgetCode(b.code || ''), 'pt-BR', { numeric: true }) * dir;
      }
      if (key === 'name') {
        return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }) * dir;
      }
      // Colunas numéricas (vendido, custos, saldo de produção, lucro, margem, teto).
      return ((Number(a[key]) || 0) - (Number(b[key]) || 0)) * dir;
    });
  }, [filtered, sortConfig]);

  const groupedProjects = React.useMemo(() => {
    if (!groupByClient) return null;
    const groups: { [key: string]: typeof projects } = {};
    
    sortedProjects.forEach(p => {
      const clientName = p.client?.name || 'Sem Cliente';
      if (!groups[clientName]) {
        groups[clientName] = [];
      }
      groups[clientName].push(p);
    });

    return Object.entries(groups).map(([clientName, items]) => {
      const totalVendidos = items.reduce((sum, item) => sum + (item.totalProductionValue || 0), 0);
      const totalCustos = items.reduce((sum, item) => sum + (item.totalCosts || 0), 0);
      const totalLucro = items.reduce((sum, item) => sum + (item.margin || 0), 0);
      const totalTeto = items.reduce((sum, item) => sum + (item.tetoCustos || 0), 0);
      
      return {
        clientName,
        items,
        totals: {
          totalVendidos,
          totalCustos,
          totalLucro,
          totalTeto
        }
      };
    });
  }, [sortedProjects, groupByClient]);

  const renderProjectCard = (p: any) => {
    const isPendente = p.pendente_preenchimento;
    const isVencido = p.vencido;
    const isSelected = selectedIds.has(p.id);

    // Margem cor baseada em faixas
    let marginBadgeClass = "bg-lumos-text-secondary/10 text-lumos-text-secondary";
    if (p.totalProductionValue > 0) {
      if (p.marginPercent >= 30) {
        marginBadgeClass = "bg-green-500/10 text-green-500 border border-green-500/20";
      } else if (p.marginPercent >= 15) {
        marginBadgeClass = "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20";
      } else {
        marginBadgeClass = "bg-red-500/10 text-red-500 border border-red-500/20";
      }
    }

    return (
      <div
        key={p.id}
        onClick={() => navigate(`/financeiro/custos-projeto/${p.project_id}`)}
        className={clsx(
          'bg-lumos-surface border rounded-lumos p-5 cursor-pointer transition-all duration-300 relative group flex flex-col justify-between hover:shadow-2xl hover:-translate-y-0.5',
          isSelected 
            ? 'border-amber-500/50 dark:border-lumos-yellow/50 bg-amber-500/[0.02] dark:bg-lumos-yellow/[0.02]' 
            : isPendente
            ? 'border-red-500/40 dark:border-red-500/30 bg-red-500/[0.02]'
            : 'border-lumos-border hover:border-amber-500/30 dark:hover:border-lumos-yellow/30'
        )}
      >
        {/* Selo Pendente Info ou Atrasado no topo direito */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
          {isPendente && (
            <span className="flex items-center gap-1 text-[9px] font-black bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 px-2 py-0.5 rounded uppercase tracking-wide animate-pulse">
              <AlertTriangle className="w-3 h-3" /> PENDENTE INFO
            </span>
          )}
          {isVencido && (
            <span className="text-[9px] font-black bg-red-600 text-white px-2 py-0.5 rounded uppercase tracking-wide">
              Atrasado
            </span>
          )}
        </div>

        {/* Info do Projeto */}
        <div className="space-y-3">
          <div className="flex items-start gap-2 pr-24">
            {isAdmin && (
              <div
                onClick={e => toggleSelect(p.id, e)}
                className={clsx(
                  'w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-all shrink-0 mt-1',
                  isSelected
                    ? 'bg-amber-600 dark:bg-lumos-yellow border-amber-600 dark:border-lumos-yellow text-white dark:text-black'
                    : 'border-lumos-border group-hover:border-amber-500/50 dark:group-hover:border-lumos-yellow/50 opacity-0 group-hover:opacity-100',
                  selectedIds.size > 0 && 'opacity-100'
                )}
              >
                {isSelected && <Check className="w-3 h-3" />}
              </div>
            )}
            
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {p.code && (
                  <span className="text-[10px] font-black text-amber-600 dark:text-lumos-yellow bg-amber-500/10 dark:bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase tracking-tight">
                    {formatBudgetCode(p.code)}
                  </span>
                )}
              </div>
              <h3 className="text-sm font-bold text-lumos-text-primary group-hover:text-amber-600 dark:group-hover:text-lumos-yellow transition-colors mt-1 line-clamp-2">
                {p.name}
              </h3>
              <p className="text-[11px] text-lumos-text-secondary flex items-center gap-1 mt-1 truncate">
                <Target className="w-3.5 h-3.5 text-lumos-text-secondary" /> {p.client?.name || 'Sem Cliente'}
              </p>
            </div>
          </div>
        </div>

        {/* Métricas e Ações */}
        <div className="border-t border-lumos-border/50 pt-4 mt-4 space-y-4">
          {isAdmin ? (
            /* Layout Admin: 2x2 Grid para Métricas de Faturamento, Custos, Lucro e Margem */
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-bold text-lumos-text-secondary uppercase">Vendido</span>
                  {!p.budget_id && (
                    <span className="text-[8px] font-black bg-amber-500/10 dark:bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow px-1 py-0.2 rounded uppercase scale-90">Est.</span>
                  )}
                </div>
                <p className="text-xs font-black text-lumos-text-primary mt-0.5 truncate">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.totalProductionValue)}
                </p>
              </div>

              <div>
                <span className="text-[9px] font-bold text-lumos-text-secondary uppercase">Custos</span>
                <p className="text-xs font-black text-lumos-text-primary mt-0.5 truncate">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.totalCosts)}
                </p>
              </div>

              <div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-bold text-lumos-text-secondary uppercase">Lucro Líq.</span>
                  {!p.budget_id && (
                    <span className="text-[8px] font-black bg-amber-500/10 dark:bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow px-1 py-0.2 rounded uppercase scale-90">Est.</span>
                  )}
                </div>
                <p className={`text-xs font-black mt-0.5 truncate ${p.margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.margin)}
                </p>
              </div>

              <div className="flex flex-col justify-end items-end">
                {p.totalProductionValue > 0 ? (
                  <div className={clsx("flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-black", marginBadgeClass)}>
                    {p.marginPercent.toFixed(1)}%
                  </div>
                ) : (
                  <div className="flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-black bg-lumos-text-secondary/15 text-lumos-text-secondary border border-lumos-border">
                    S/ Proposta
                  </div>
                )}
              </div>

              {/* Saldo de Produção: sobra do teto de custo (negativo = estourou). */}
              <div className="col-span-2 flex items-center justify-between border-t border-lumos-border/50 pt-2.5 mt-1">
                <span className="text-[9px] font-bold text-lumos-text-secondary uppercase">Saldo de Produção</span>
                <span
                  className={clsx('text-xs font-black', p.saldoProducao >= 0 ? 'text-green-500' : 'text-red-500')}
                  title={p.tetoCustos > 0 ? `Teto ${fmtBRL(p.tetoCustos)} · consumo ${p.consumoTetoPct.toFixed(1)}%` : undefined}
                >
                  {fmtBRL(p.saldoProducao)}
                </span>
              </div>
            </div>
          ) : (
            /* Layout Produção (Restrito): Sem faturamento/lucro/margem. Apenas Budget vs Custos */
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-bold text-lumos-text-secondary uppercase">Budget Disp.</span>
                  {!p.budget_id && (
                    <span className="text-[8px] font-black bg-amber-500/10 dark:bg-lumos-yellow/10 text-amber-600 dark:text-lumos-yellow px-1 py-0.2 rounded uppercase scale-90">Est.</span>
                  )}
                </div>
                <p className="text-xs font-black text-lumos-text-primary mt-0.5 truncate">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.tetoCustos)}
                </p>
              </div>

              <div>
                <span className="text-[9px] font-bold text-lumos-text-secondary uppercase">Custos Regist.</span>
                <p className="text-xs font-black text-lumos-text-primary mt-0.5 truncate">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.totalCosts)}
                </p>
              </div>
            </div>
          )}

          {/* Rodapé do Card com Ação */}
          <div className="flex items-center justify-between border-t border-lumos-border/30 pt-3 text-[10px] font-bold text-lumos-text-secondary uppercase">
            <span className="flex items-center gap-1 text-[9px] tracking-wider text-amber-600 dark:text-lumos-yellow">
              Ver Detalhes <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>

            {isAdmin && (
              <button
                onClick={e => openEditModal(p, e)}
                className="p-1.5 rounded-full hover:bg-amber-500/10 dark:hover:bg-lumos-yellow/10 text-lumos-text-secondary hover:text-amber-600 dark:hover:text-lumos-yellow transition-all"
                title="Editar projeto"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

  const renderProjectList = (items: any[]) => (
    <div className="bg-lumos-surface border border-lumos-border rounded-lumos overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider">
              {isAdmin && <th className="px-4 py-3 w-10" />}
              <th className="group/th px-4 py-3 cursor-pointer select-none hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('code')}>
                <div className="flex items-center gap-1">Código <SortIcon column="code" /></div>
              </th>
              <th className="group/th px-4 py-3 cursor-pointer select-none hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('name')}>
                <div className="flex items-center gap-1">Projeto <SortIcon column="name" /></div>
              </th>
              {isAdmin ? (
                <>
                  <th className="group/th px-4 py-3 text-right cursor-pointer select-none hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('totalProductionValue')}>
                    <div className="flex items-center justify-end gap-1">Vendido <SortIcon column="totalProductionValue" /></div>
                  </th>
                  <th className="group/th px-4 py-3 text-right cursor-pointer select-none hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('totalCosts')}>
                    <div className="flex items-center justify-end gap-1">Custos <SortIcon column="totalCosts" /></div>
                  </th>
                  <th className="group/th px-4 py-3 text-right cursor-pointer select-none hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('saldoProducao')}>
                    <div className="flex items-center justify-end gap-1">Saldo Prod. <SortIcon column="saldoProducao" /></div>
                  </th>
                  <th className="group/th px-4 py-3 text-right cursor-pointer select-none hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('margin')}>
                    <div className="flex items-center justify-end gap-1">Lucro Líq. <SortIcon column="margin" /></div>
                  </th>
                  <th className="group/th px-4 py-3 text-right cursor-pointer select-none hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('marginPercent')}>
                    <div className="flex items-center justify-end gap-1">Margem <SortIcon column="marginPercent" /></div>
                  </th>
                </>
              ) : (
                <>
                  <th className="group/th px-4 py-3 text-right cursor-pointer select-none hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('tetoCustos')}>
                    <div className="flex items-center justify-end gap-1">Budget Disp. <SortIcon column="tetoCustos" /></div>
                  </th>
                  <th className="group/th px-4 py-3 text-right cursor-pointer select-none hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('totalCosts')}>
                    <div className="flex items-center justify-end gap-1">Custos <SortIcon column="totalCosts" /></div>
                  </th>
                </>
              )}
              <th className="px-4 py-3 text-right w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-lumos-border">
            {items.map(p => {
              const isSelected = selectedIds.has(p.id);
              let marginBadgeClass = 'bg-lumos-text-secondary/10 text-lumos-text-secondary';
              if (p.totalProductionValue > 0) {
                if (p.marginPercent >= 30) marginBadgeClass = 'bg-green-500/10 text-green-500 border border-green-500/20';
                else if (p.marginPercent >= 15) marginBadgeClass = 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20';
                else marginBadgeClass = 'bg-red-500/10 text-red-500 border border-red-500/20';
              }
              return (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/financeiro/custos-projeto/${p.project_id}`)}
                  className={clsx(
                    'group cursor-pointer transition-colors hover:bg-lumos-text-primary/5',
                    isSelected && 'bg-amber-500/[0.04] dark:bg-lumos-yellow/[0.03]',
                    p.pendente_preenchimento && !isSelected && 'bg-red-500/[0.03]'
                  )}
                >
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div
                        onClick={e => toggleSelect(p.id, e)}
                        className={clsx(
                          'w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-all',
                          isSelected
                            ? 'bg-amber-600 dark:bg-lumos-yellow border-amber-600 dark:border-lumos-yellow text-white dark:text-black'
                            : 'border-lumos-border group-hover:border-amber-500/50 dark:group-hover:border-lumos-yellow/50 opacity-0 group-hover:opacity-100',
                          selectedIds.size > 0 && 'opacity-100'
                        )}
                      >
                        {isSelected && <Check className="w-3 h-3" />}
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {p.code ? (
                      <span className="text-[10px] font-black text-amber-600 dark:text-lumos-yellow bg-amber-500/10 dark:bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase tracking-tight">
                        {formatBudgetCode(p.code)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-lumos-text-secondary/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-lumos-text-primary group-hover:text-amber-600 dark:group-hover:text-lumos-yellow transition-colors truncate">{p.name}</span>
                          {p.pendente_preenchimento && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />}
                          {p.vencido && <span className="text-[8px] font-black bg-red-600 text-white px-1.5 py-0.5 rounded uppercase flex-shrink-0">Atrasado</span>}
                        </div>
                        <span className="text-[11px] text-lumos-text-secondary truncate block">{p.client?.name || 'Sem Cliente'}</span>
                      </div>
                    </div>
                  </td>
                  {isAdmin ? (
                    <>
                      <td className="px-4 py-3 text-right text-xs font-black text-lumos-text-primary whitespace-nowrap">{fmtBRL(p.totalProductionValue)}</td>
                      <td className="px-4 py-3 text-right text-xs font-black text-lumos-text-primary whitespace-nowrap">{fmtBRL(p.totalCosts)}</td>
                      <td
                        className={clsx('px-4 py-3 text-right text-xs font-black whitespace-nowrap', p.saldoProducao >= 0 ? 'text-green-500' : 'text-red-500')}
                        title={p.tetoCustos > 0 ? `Teto ${fmtBRL(p.tetoCustos)} · consumo ${p.consumoTetoPct.toFixed(1)}%` : undefined}
                      >
                        {fmtBRL(p.saldoProducao)}
                      </td>
                      <td className={clsx('px-4 py-3 text-right text-xs font-black whitespace-nowrap', p.margin >= 0 ? 'text-green-500' : 'text-red-500')}>{fmtBRL(p.margin)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {p.totalProductionValue > 0 ? (
                          <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black', marginBadgeClass)}>{p.marginPercent.toFixed(1)}%</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-lumos-text-secondary/15 text-lumos-text-secondary border border-lumos-border">S/ Proposta</span>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-right text-xs font-black text-lumos-text-primary whitespace-nowrap">{fmtBRL(p.tetoCustos)}</td>
                      <td className="px-4 py-3 text-right text-xs font-black text-lumos-text-primary whitespace-nowrap">{fmtBRL(p.totalCosts)}</td>
                    </>
                  )}
                  <td className="px-4 py-3 text-right">
                    {isAdmin ? (
                      <button
                        onClick={e => openEditModal(p, e)}
                        className="p-1.5 rounded-full hover:bg-amber-500/10 dark:hover:bg-lumos-yellow/10 text-lumos-text-secondary hover:text-amber-600 dark:hover:text-lumos-yellow transition-all"
                        title="Editar projeto"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <ChevronRight className="w-4 h-4 text-lumos-text-secondary inline group-hover:translate-x-0.5 transition-transform" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Custos de Projeto</h1>
          <p className="text-lumos-text-secondary text-sm">Acompanhamento de custos e rentabilidade dos projetos Lumos.</p>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle value={view} onChange={changeView} />
          {isAdmin && (
            <button
              onClick={openCreateModal}
              className="btn-primary h-10 px-6 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Novo Projeto
            </button>
          )}
        </div>
      </div>

      {/* BARRA DE CONTROLES */}
      <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-5 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">

          {/* Busca */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-lumos-text-secondary" />
            <input
              type="text"
              placeholder="Buscar por código, projeto ou cliente..."
              className="input-lumos pl-10 w-full h-10 text-sm font-medium"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Agrupar por cliente — botão pill com estado ativo claro */}
          <button
            type="button"
            onClick={() => setGroupByClient(!groupByClient)}
            aria-pressed={groupByClient}
            title={groupByClient ? 'Desagrupar' : 'Agrupar por cliente'}
            className={clsx(
              'h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lumos border text-sm font-bold whitespace-nowrap transition-all',
              groupByClient
                ? 'bg-amber-600 dark:bg-lumos-yellow border-amber-600 dark:border-lumos-yellow text-white dark:text-black shadow-sm'
                : 'bg-lumos-bg border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-amber-500/40 dark:hover:border-lumos-yellow/40'
            )}
          >
            <Users className="w-4 h-4" />
            Agrupar por cliente
          </button>

        </div>

        {(searchTerm || clientFilter || sortConfig.key !== 'recente' || groupByClient) && (
          <div className="flex items-center justify-between text-xs text-lumos-text-secondary pt-1 border-t border-lumos-border/50">
            <span>
              Mostrando <strong className="text-lumos-text-primary">{filtered.length}</strong> de {projects.length} projetos
            </span>
            <button
              onClick={() => {
                setSearchTerm('');
                setClientFilter('');
                setSortConfig({ key: 'recente', direction: 'desc' });
                setGroupByClient(false);
              }}
              className="text-amber-600 dark:text-lumos-yellow hover:underline font-bold uppercase tracking-widest text-[10px]"
            >
              Limpar filtros e ordenação
            </button>
          </div>
        )}
      </div>

      {/* RENDERIZAÇÃO DOS PROJETOS */}
      <div className="space-y-6">
        {loading ? (
          <div className="card p-12 text-center bg-lumos-surface border border-lumos-border rounded-lumos">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center text-lumos-text-secondary text-sm italic bg-lumos-surface border border-lumos-border rounded-lumos">
            Nenhum projeto encontrado.
          </div>
        ) : groupByClient && groupedProjects ? (
          // Exibição Agrupada por Cliente
          groupedProjects.map((group: any) => {
            const { clientName, items, totals } = group;
            return (
              <div key={clientName} className="space-y-4">
                {/* Cabeçalho do Cliente com Subtotais */}
                <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md bg-lumos-bg/10">
                  <div>
                    <h2 className="text-sm font-black text-lumos-text-primary uppercase tracking-tight flex items-center gap-2">
                      <Target className="w-4 h-4 text-amber-600 dark:text-lumos-yellow" />
                      {clientName}
                    </h2>
                    <p className="text-[10px] text-lumos-text-secondary uppercase font-bold mt-0.5">
                      {items.length} {items.length === 1 ? 'projeto' : 'projetos'}
                    </p>
                  </div>

                  {/* Subtotais do Cliente */}
                  <div className="flex items-center gap-6 text-xs font-bold uppercase tracking-wider flex-wrap border-t md:border-t-0 border-lumos-border/50 pt-3 md:pt-0">
                    {isAdmin ? (
                      <>
                        <div>
                          <span className="text-[9px] text-lumos-text-secondary block">Vendido Total</span>
                          <span className="text-lumos-text-primary font-black">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totals.totalVendidos)}
                          </span>
                        </div>
                        <div className="w-px h-6 bg-lumos-border hidden sm:block" />
                        <div>
                          <span className="text-[9px] text-lumos-text-secondary block">Custos Total</span>
                          <span className="text-lumos-text-primary font-black">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totals.totalCustos)}
                          </span>
                        </div>
                        <div className="w-px h-6 bg-lumos-border hidden sm:block" />
                        <div>
                          <span className="text-[9px] text-lumos-text-secondary block">Lucro Total</span>
                          <span className={`font-black ${totals.totalLucro >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totals.totalLucro)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <span className="text-[9px] text-lumos-text-secondary block">Budget Total</span>
                          <span className="text-lumos-text-primary font-black">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totals.totalTeto)}
                          </span>
                        </div>
                        <div className="w-px h-6 bg-lumos-border" />
                        <div>
                          <span className="text-[9px] text-lumos-text-secondary block">Custos Total</span>
                          <span className="text-lumos-text-primary font-black">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totals.totalCustos)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Projetos do Cliente (lista ou cards) */}
                {view === 'list' ? renderProjectList(items) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((p: any) => renderProjectCard(p))}
                  </div>
                )}
              </div>
            );
          })
        ) : view === 'list' ? (
          renderProjectList(sortedProjects)
        ) : (
          // Exibição Corrida (Grid Simples)
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedProjects.map(p => renderProjectCard(p))}
          </div>
        )}
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && isAdmin && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-lumos-surface border border-lumos-yellow/20 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-full px-6 py-4 flex items-center gap-6 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-lumos-yellow/20 flex items-center justify-center font-black text-lumos-yellow text-sm">
                {selectedIds.size}
              </div>
              <span className="text-sm font-bold text-lumos-text-primary uppercase tracking-tight">
                {selectedIds.size === 1 ? 'Projeto selecionado' : 'Projetos selecionados'}
              </span>
            </div>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-4 py-2 rounded-full bg-lumos-bg border border-lumos-border text-lumos-text-primary font-black text-xs uppercase hover:border-lumos-yellow transition-all active:scale-95 ml-4"
            >
              Cancelar Seleção
            </button>
          </div>
        </div>
      )}

      {/* Modal de criação/edição do projeto (apenas admin) */}
      {isAdmin && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={editingProjectId ? 'Editar Projeto' : 'Novo Projeto'}
        >
          <form onSubmit={saveProject} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Código</label>
                <input
                  type="text"
                  className="input-lumos w-full"
                  placeholder="192"
                  value={editProjectData.code}
                  onChange={e => setEditProjectData({ ...editProjectData, code: e.target.value })}
                />
              </div>
              <div className="col-span-2 space-y-2">
                <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Nome do projeto *</label>
                <input
                  required
                  type="text"
                  className="input-lumos w-full"
                  value={editProjectData.name}
                  onChange={e => setEditProjectData({ ...editProjectData, name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Cliente</label>
              <select
                className="input-lumos w-full"
                value={editProjectData.client_id}
                onChange={e => setEditProjectData({ ...editProjectData, client_id: e.target.value })}
              >
                <option value="">Sem cliente</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">
                Valor do Projeto (Faturamento)
              </label>
              <CurrencyInput
                className="input-lumos w-full font-bold"
                value={editProjectData.production_value}
                onChange={(val: number) => setEditProjectData({ ...editProjectData, production_value: val })}
              />
            </div>
            <div className="pt-4 flex gap-3">
              <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
              <button type="submit" className="btn-primary flex-1 h-10">
                {editingProjectId ? 'Salvar Alterações' : 'Criar Projeto'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
