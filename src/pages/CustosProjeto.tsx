import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Search, TrendingUp, TrendingDown, ChevronRight, Target, Check, Pencil, Plus, X, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import Modal from '@/components/common/Modal';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/hooks/useAuth';

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

  async function fetchClients() {
    const { data } = await supabase.from('clients').select('id, name').order('name');
    setClients(data || []);
  }

  async function fetchProjects() {
    try {
      setLoading(true);

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

      const processed = (rentData || []).map(p => {
        const totalProductionValue = Number(p.valor_vendido || 0);
        const totalCosts = Number(p.custos_total || 0);
        const margin = Number(p.lucro_liquido || 0);
        const marginPercent = Number(p.margem || 0) * 100;
        
        // --- CÁLCULO DO TETO DE CUSTOS (Cálculo herdado do detalhe) ---
        let estimatedCost = 0;
        const budget = p.budget;
        if (budget?.active_version) {
          const items = budget.active_version.budget_items || [];
          estimatedCost = items.reduce(
            (acc: number, item: any) => acc + Number(item.unit_cost || 0) * Number(item.quantity || 0),
            0
          );
        }

        const nfPercent = Number(p.nf_percent ?? 0.18);
        const defaultMarginPercent = 0.40;

        const tetoCustos = p.proposta_id
          ? estimatedCost
          : totalProductionValue * (1 - nfPercent) / (1 + defaultMarginPercent);
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
          tetoCustos
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
      (p.code && p.code.toLowerCase().includes(term));
    const matchClient = !clientFilter || p.client_id === clientFilter;
    return matchSearch && matchClient;
  });

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Custos de Projeto</h1>
          <p className="text-lumos-text-secondary text-sm">Acompanhamento de custos e rentabilidade dos projetos Lumos.</p>
        </div>
        {isAdmin && (
          <button
            onClick={openCreateModal}
            className="btn-primary h-10 px-6 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Novo Projeto
          </button>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
            <input
              type="text"
              placeholder="Buscar por código, projeto ou cliente..."
              className="input-lumos pl-10 w-full h-10"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="relative">
            <select
              className="input-lumos w-full h-10 appearance-none pr-9"
              value={clientFilter}
              onChange={e => setClientFilter(e.target.value)}
            >
              <option value="">Todos os clientes</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {clientFilter && (
              <button
                onClick={() => setClientFilter('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lumos-text-secondary hover:text-lumos-text-primary"
                title="Limpar filtro"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {(searchTerm || clientFilter) && (
          <div className="flex items-center justify-between text-xs text-lumos-text-secondary">
            <span>
              Mostrando <strong className="text-lumos-text-primary">{filtered.length}</strong> de {projects.length} projetos
            </span>
            <button
              onClick={() => { setSearchTerm(''); setClientFilter(''); }}
              className="text-lumos-yellow hover:underline font-bold uppercase tracking-widest text-[10px]"
            >
              Limpar filtros
            </button>
          </div>
        )}
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
              onClick={() => navigate(`/financeiro/custos-projeto/${p.project_id}`)}
              className={clsx(
                'card p-6 flex flex-col md:flex-row items-center gap-6 hover:border-lumos-yellow/30 cursor-pointer group relative transition-all',
                selectedIds.has(p.id) && 'border-lumos-yellow/50 bg-lumos-yellow/[0.02]'
              )}
            >
              {isAdmin && (
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
              )}

              <div className="flex-1 w-full">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {p.code && (
                    <span className="text-[10px] font-black text-lumos-yellow bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase tracking-tighter">
                      {p.code}
                    </span>
                  )}
                  <h3 className="text-lg font-bold text-lumos-text-primary group-hover:text-lumos-yellow transition-colors">
                    {p.name}
                  </h3>
                  {p.pendente_preenchimento && (
                    <span className="flex items-center gap-1 text-[9px] font-black bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded uppercase tracking-wide">
                      <AlertTriangle className="w-3 h-3" /> Pendente Info
                    </span>
                  )}
                  {p.vencido && (
                    <span className="text-[9px] font-black bg-red-500 text-white px-2 py-0.5 rounded uppercase tracking-wide">
                      Atrasado
                    </span>
                  )}
                </div>
                <p className="text-xs text-lumos-text-secondary flex items-center gap-1">
                  <Target className="w-3 h-3" /> {p.client?.name || '—'}
                </p>
              </div>

              {/* Conditional columns display for RLS visual implementation */}
              {isAdmin ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 w-full md:w-auto border-t md:border-t-0 md:border-l border-lumos-border pt-4 md:pt-0 md:pl-8">
                  <div>
                    <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Valor Vendido</p>
                    <p className="text-sm font-bold text-lumos-text-primary">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.totalProductionValue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Custos Totais</p>
                    <p className="text-sm font-bold text-lumos-text-primary">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.totalCosts)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Lucro Líquido</p>
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
                    <button
                      onClick={e => openEditModal(p, e)}
                      className="ml-4 p-2 rounded-full hover:bg-lumos-yellow/10 text-lumos-text-secondary hover:text-lumos-yellow transition-all"
                      title="Editar projeto"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-5 h-5 text-lumos-text-secondary ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-8 w-full md:w-auto border-t md:border-t-0 md:border-l border-lumos-border pt-4 md:pt-0 md:pl-8">
                  <div>
                    <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Budget Disponível</p>
                    <p className="text-sm font-bold text-lumos-text-primary">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.tetoCustos)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Custos Registrados</p>
                    <p className="text-sm font-bold text-lumos-text-primary">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.totalCosts)}
                    </p>
                  </div>
                  <div className="flex items-center justify-end">
                    <ChevronRight className="w-5 h-5 text-lumos-text-secondary group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              )}
            </div>
          ))
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
