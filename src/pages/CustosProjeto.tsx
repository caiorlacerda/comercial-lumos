import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Search, TrendingUp, TrendingDown, ChevronRight, Target, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';

export default function CustosProjeto() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  useEffect(() => { fetchProjects(); }, []);

  async function fetchProjects() {
    try {
      setLoading(true);

      // 1. Busca todos os projetos (tabela projects)
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select(`
          id,
          name,
          code,
          budget_id,
          client:clients(name),
          costs:project_costs(amount)
        `)
        .order('created_at', { ascending: false });

      if (projectsError) throw projectsError;

      // 2. Para projetos com budget_id, busca os itens da versão ativa
      const budgetIds = (projectsData || [])
        .map(p => p.budget_id)
        .filter(Boolean);

      let budgetVersionMap: Record<string, string> = {};
      let allItems: any[] = [];

      if (budgetIds.length > 0) {
        const { data: budgetsData } = await supabase
          .from('budgets')
          .select('id, active_version_id, project_name')
          .in('id', budgetIds);

        (budgetsData || []).forEach(b => {
          budgetVersionMap[b.id] = b.active_version_id;
        });

        const versionIds = Object.values(budgetVersionMap).filter(Boolean);
        if (versionIds.length > 0) {
          const { data: itemsData } = await supabase
            .from('budget_items')
            .select('unit_cost, quantity, version_id')
            .in('version_id', versionIds);
          allItems = itemsData || [];
        }
      }

      // 3. Processa os dados
      const processed = (projectsData || []).map(p => {
        const versionId = p.budget_id ? budgetVersionMap[p.budget_id] : null;
        const projectItems = versionId
          ? allItems.filter(item => item.version_id === versionId)
          : [];
        const totalProductionValue = projectItems.reduce(
          (acc: number, item: any) => acc + item.unit_cost * item.quantity,
          0
        );
        const totalCosts = p.costs?.reduce((acc: number, c: any) => acc + c.amount, 0) || 0;
        const margin = totalProductionValue - totalCosts;
        const marginPercent = totalProductionValue > 0 ? (margin / totalProductionValue) * 100 : 0;
        return { ...p, totalProductionValue, totalCosts, margin, marginPercent };
      });

      setProjects(processed);
    } catch (error) {
      console.error('Erro ao buscar projetos:', error);
    } finally {
      setLoading(false);
    }
  }

  const filtered = projects.filter(
    p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.client?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Custos de Projeto</h1>
          <p className="text-lumos-text-secondary text-sm">Lucratividade real de cada projeto.</p>
        </div>
      </div>

      <div className="card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input
            type="text"
            placeholder="Buscar projeto ou cliente..."
            className="input-lumos pl-10 w-full h-10"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading ? (
          <div className="card p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center text-lumos-text-secondary text-sm italic">
            Nenhum projeto.
          </div>
        ) : (
          filtered.map(p => (
            <div
              key={p.id}
              onClick={() => navigate(`/financeiro/custos-projeto/${p.id}`)}
              className={clsx(
                'card p-6 flex flex-col md:flex-row items-center gap-6 hover:border-lumos-yellow/30 cursor-pointer group relative transition-all',
                selectedIds.has(p.id) && 'border-lumos-yellow/50 bg-lumos-yellow/[0.02]'
              )}
            >
              <div
                onClick={e => toggleSelect(p.id, e)}
                className={clsx(
                  'w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all shrink-0',
                  selectedIds.has(p.id)
                    ? 'bg-lumos-yellow border-lumos-yellow text-lumos-bg'
                    : 'border-lumos-border group-hover:border-lumos-yellow/50 opacity-0 group-hover:opacity-100',
                  selectedIds.size > 0 && 'opacity-100'
                )}
              >
                {selectedIds.has(p.id) && <Check className="w-3.5 h-3.5" />}
              </div>

              <div className="flex-1 w-full">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black text-lumos-yellow bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase tracking-tighter">
                    {p.code || 'Projeto'}
                  </span>
                  <h3 className="text-lg font-bold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors">
                    {p.name}
                  </h3>
                </div>
                <p className="text-xs text-lumos-text-secondary flex items-center gap-1">
                  <Target className="w-3 h-3" /> {p.client?.name || '—'}
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 w-full md:w-auto border-t md:border-t-0 md:border-l border-lumos-border pt-4 md:pt-0 md:pl-8">
                <div>
                  <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Custo Base</p>
                  <p className="text-sm font-bold text-lumos-text-primary">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.totalProductionValue)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Custos Reais</p>
                  <p className="text-sm font-bold text-lumos-text-primary">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.totalCosts)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Margem Prod.</p>
                  <p className={`text-sm font-black ${p.margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.margin)}
                  </p>
                </div>
                <div className="flex items-center justify-end">
                  {p.totalProductionValue > 0 ? (
                    <div
                      className={`flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black ${
                        p.marginPercent > 30
                          ? 'bg-green-500/10 text-green-500'
                          : 'bg-yellow-500/10 text-yellow-500'
                      }`}
                    >
                      {p.marginPercent.toFixed(1)}%
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black bg-lumos-text-secondary/10 text-lumos-text-secondary">
                      S/ Orçamento
                    </div>
                  )}
                  <ChevronRight className="w-5 h-5 text-lumos-text-secondary ml-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
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
    </div>
  );
}
