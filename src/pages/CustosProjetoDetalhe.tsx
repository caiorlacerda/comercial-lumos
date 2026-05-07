import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Plus, AlertTriangle, Target, Edit2, Trash2, Check, Pencil } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/common/Modal';
import { useToast } from '@/context/ToastContext';

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

export default function CustosProjetoDetalhe() {
  const { id } = useParams(); // agora é o project id
  const navigate = useNavigate();
  const { profile } = useAuth();
  const toast = useToast();
  const [project, setProject] = useState<any>(null);
  const [costs, setCosts] = useState<any[]>([]);
  const [appUsers, setAppUsers] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isEditProjectModalOpen, setIsEditProjectModalOpen] = useState(false);
  const [editProjectData, setEditProjectData] = useState({ name: '', code: '', client_id: '', production_value: 0 });
  const [formData, setFormData] = useState({
    description: '',
    amount: 0,
    cost_date: new Date().toISOString().split('T')[0],
    payment_due_date: '',
    category: 'equipe',
    supplier: '',
    responsible_id: '',
    notes: '',
  });
  const [duePreset, setDuePreset] = useState<string>('30'); // dias padrão
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);

  // Categorias dinâmicas (defaults + as já cadastradas no banco)
  const [categories, setCategories] = useState<string[]>(['equipe', 'equipamento', 'locacao']);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  useEffect(() => { fetchProjectData(); }, [id]);
  useEffect(() => { fetchCategories(); }, []);

  // Busca todas as categorias já cadastradas no banco (em qualquer projeto)
  async function fetchCategories() {
    try {
      const { data } = await supabase
        .from('project_costs')
        .select('category')
        .not('category', 'is', null);
      const fromDb = (data || []).map((r: any) => (r.category || '').toLowerCase().trim()).filter(Boolean);
      const merged = Array.from(new Set(['equipe', 'equipamento', 'locacao', ...fromDb])).sort();
      setCategories(merged);
    } catch (err) {
      console.error('Erro ao buscar categorias:', err);
    }
  }

  // Adiciona uma categoria nova à lista e seleciona ela
  const confirmNewCategory = () => {
    const trimmed = newCategoryName.trim().toLowerCase();
    if (!trimmed) {
      setCreatingCategory(false);
      setNewCategoryName('');
      return;
    }
    setCategories(prev => Array.from(new Set([...prev, trimmed])).sort());
    setFormData(f => ({ ...f, category: trimmed }));
    setCreatingCategory(false);
    setNewCategoryName('');
  };

  // Helper pra exibir o nome da categoria com a primeira letra maiúscula
  const formatCategoryLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);

  async function fetchProjectData() {
    try {
      setLoading(true);

      // 1. Busca o projeto pelo id da tabela projects
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select(`
          id,
          name,
          code,
          budget_id,
          client_id,
          production_value,
          client:clients(name)
        `)
        .eq('id', id)
        .single();

      if (projectError) throw projectError;

      let budgetItems: any[] = [];
      let receivableAmount = 0;
      let budgetId = projectData.budget_id || null;

      // 2. Se tiver budget_id, busca itens do orçamento e contas a receber
      if (budgetId) {
        const { data: budgetData } = await supabase
          .from('budgets')
          .select('active_version_id, receivable:receivables(total_amount)')
          .eq('id', budgetId)
          .single();

        if (budgetData) {
          receivableAmount =
            (budgetData.receivable as any)?.total_amount ||
            (Array.isArray(budgetData.receivable) ? budgetData.receivable[0]?.total_amount : 0) ||
            0;

          if (budgetData.active_version_id) {
            const { data: itemsData } = await supabase
              .from('budget_items')
              .select('unit_cost, quantity, version_id')
              .eq('version_id', budgetData.active_version_id);
            budgetItems = itemsData || [];
          }
        }
      }

      // 3. Busca custos, usuários e clientes em paralelo
      const [costsRes, usersRes, clientsRes] = await Promise.all([
        supabase
          .from('project_costs')
          .select('*, responsible:app_users!responsible_id(full_name)')
          .eq('project_id', id)
          .order('cost_date', { ascending: false }),
        supabase
          .from('app_users')
          .select('id, full_name')
          .eq('status', 'ativo')
          .order('full_name', { ascending: true }),
        supabase
          .from('clients')
          .select('id, name')
          .order('name'),
      ]);

      setProject({ ...projectData, budget_items: budgetItems, receivable_amount: receivableAmount, budget_id: budgetId });
      setCosts(costsRes.data || []);
      setAppUsers(usersRes.data || []);
      setClients(clientsRes.data || []);
    } catch (error) {
      console.error('Erro ao carregar projeto:', error);
      navigate('/financeiro/custos-projeto');
    } finally {
      setLoading(false);
    }
  }

  const handleAddCost = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // normaliza payment_due_date — string vazia precisa virar null para o tipo DATE do Postgres
      const payload: any = {
        ...formData,
        payment_due_date: formData.payment_due_date || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from('project_costs')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('project_costs')
          .insert([{
            ...payload,
            project_id: id,
            // mantém budget_id para compatibilidade caso a coluna tenha constraint
            ...(project?.budget_id ? { budget_id: project.budget_id } : {}),
            created_by: profile?.id,
          }]);
        if (error) throw error;
      }
      setIsModalOpen(false);
      setEditingId(null);
      fetchProjectData();
      resetForm();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDeleteCost = async () => {
    if (!deletingId) return;
    try {
      const { error } = await supabase.from('project_costs').delete().eq('id', deletingId);
      if (error) throw error;
      setIsDeleteModalOpen(false);
      setDeletingId(null);
      fetchProjectData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const { error } = await supabase.from('project_costs').delete().in('id', ids);
      if (error) throw error;
      setIsBatchDeleteModalOpen(false);
      setSelectedIds(new Set());
      fetchProjectData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === costs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(costs.map(c => c.id)));
    }
  };

  const toggleSelect = (costId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(costId)) next.delete(costId);
    else next.add(costId);
    setSelectedIds(next);
  };

  // calcula data adicionando dias (formato YYYY-MM-DD)
  const addDaysToDate = (dateStr: string, days: number): string => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  const resetForm = () => {
    setEditingId(null);
    const today = new Date().toISOString().split('T')[0];
    setFormData({
      description: '',
      amount: 0,
      cost_date: today,
      payment_due_date: addDaysToDate(today, 30),
      category: 'equipe',
      supplier: '',
      responsible_id: '',
      notes: '',
    });
    setDuePreset('30');
  };

  const handleEdit = (c: any) => {
    setEditingId(c.id);
    setFormData({
      description: c.description,
      amount: c.amount,
      cost_date: c.cost_date,
      payment_due_date: c.payment_due_date || '',
      category: c.category,
      supplier: c.supplier || '',
      responsible_id: c.responsible_id || '',
      notes: c.notes || '',
    });
    // detecta preset baseado na diferença entre cost_date e payment_due_date
    if (c.payment_due_date && c.cost_date) {
      const diff = Math.round(
        (new Date(c.payment_due_date).getTime() - new Date(c.cost_date).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      const presets = [7, 15, 30, 45, 60];
      setDuePreset(presets.includes(diff) ? String(diff) : 'custom');
    } else {
      setDuePreset('custom');
    }
    setIsModalOpen(true);
  };

  // quando o preset de dias muda, recalcula a data de vencimento
  const applyDuePreset = (preset: string) => {
    setDuePreset(preset);
    if (preset !== 'custom' && formData.cost_date) {
      const newDueDate = addDaysToDate(formData.cost_date, parseInt(preset));
      setFormData(prev => ({ ...prev, payment_due_date: newDueDate }));
    }
  };

  // quando cost_date muda e há preset ativo, recalcula vencimento
  const handleCostDateChange = (newCostDate: string) => {
    setFormData(prev => {
      const updated = { ...prev, cost_date: newCostDate };
      if (duePreset !== 'custom' && newCostDate) {
        updated.payment_due_date = addDaysToDate(newCostDate, parseInt(duePreset));
      }
      return updated;
    });
  };

  const openEditProjectModal = () => {
    setEditProjectData({
      name: project.name || '',
      code: project.code || '',
      client_id: project.client_id || '',
      production_value: project.production_value || 0,
    });
    setIsEditProjectModalOpen(true);
  };

  const saveProjectEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        name: editProjectData.name.trim(),
        code: editProjectData.code.trim() || null,
        client_id: editProjectData.client_id || null,
        production_value: editProjectData.production_value > 0 ? editProjectData.production_value : null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('projects').update(payload).eq('id', id);
      if (error) throw error;
      setIsEditProjectModalOpen(false);
      toast.success('Projeto atualizado!');
      fetchProjectData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen bg-lumos-bg">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-lumos-yellow"></div>
      </div>
    );
  if (!project)
    return (
      <div className="flex items-center justify-center min-h-screen bg-lumos-bg text-lumos-text-secondary">
        Projeto não encontrado.
      </div>
    );

  // production_value manual do projeto sobrescreve o cálculo do orçamento, se setado
  const budgetProductionValue = (project.budget_items || []).reduce(
    (acc: number, item: any) => acc + item.unit_cost * item.quantity,
    0
  );
  const totalProductionValue =
    project.production_value && project.production_value > 0
      ? Number(project.production_value)
      : budgetProductionValue;
  const totalCosts = costs.reduce((acc, c) => acc + c.amount, 0);
  const margin = totalProductionValue - totalCosts;
  const consumptionPercent =
    totalProductionValue > 0 ? (totalCosts / totalProductionValue) * 100 : 0;

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/financeiro/custos-projeto')}
            className="p-2 bg-lumos-text-primary/5 rounded-full hover:bg-lumos-text-primary/10 transition-all"
          >
            <ArrowLeft className="w-5 h-5 text-lumos-text-primary" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              {project.code && (
                <span className="text-[10px] font-black text-lumos-yellow bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase tracking-tighter">
                  {project.code}
                </span>
              )}
              <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">
                {project.name}
              </h1>
            </div>
            {project.client?.name && (
              <p className="text-lumos-text-secondary text-sm flex items-center gap-1">
                <Target className="w-3 h-3" /> {project.client.name}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openEditProjectModal}
            className="btn-secondary flex items-center gap-2 h-10 px-4 text-xs"
            title="Editar projeto"
          >
            <Pencil className="w-4 h-4" /> Editar
          </button>
          {project.budget_id && (
            <Link
              to={`/orcamentos/${project.budget_id}`}
              className="btn-secondary flex items-center gap-2 h-10 px-4 text-xs"
            >
              <ExternalLink className="w-4 h-4" /> Ver Orçamento
            </Link>
          )}
          <button
            onClick={() => { resetForm(); setIsModalOpen(true); }}
            className="btn-primary h-10 px-6 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Registrar Custo
          </button>
        </div>
      </div>

      {totalProductionValue > 0 && consumptionPercent > 90 && (
        <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-lumos flex items-center gap-3 animate-pulse">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <p className="text-sm font-bold text-red-500 uppercase">
            Atenção Crítica: Consumo de {consumptionPercent.toFixed(1)}%!
          </p>
        </div>
      )}
      {totalProductionValue > 0 && consumptionPercent > 70 && consumptionPercent <= 90 && (
        <div className="bg-yellow-500/10 border border-yellow-500/50 p-4 rounded-lumos flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-500" />
          <p className="text-sm font-bold text-yellow-500 uppercase">
            Aviso: Consumo de {consumptionPercent.toFixed(1)}%.
          </p>
        </div>
      )}

      <div className={`grid grid-cols-1 gap-4 ${totalProductionValue > 0 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {totalProductionValue > 0 && (
          <div className="card p-6">
            <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">
              Valor Disponível para Produção
            </p>
            <p className="text-2xl font-black text-lumos-text-primary tracking-tight">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalProductionValue)}
            </p>
          </div>
        )}
        <div className="card p-6">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">Total de Custos</p>
          <p className="text-2xl font-black text-lumos-text-primary tracking-tight">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalCosts)}
          </p>
        </div>
        <div className="card p-6">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">
            {totalProductionValue > 0 ? 'Margem Real (Produção)' : 'Saldo de Custos'}
          </p>
          <p className={`text-2xl font-black tracking-tight ${totalProductionValue > 0 ? (margin >= 0 ? 'text-green-500' : 'text-red-500') : 'text-lumos-text-primary'}`}>
            {totalProductionValue > 0
              ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(margin)
              : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalCosts)}
          </p>
        </div>
      </div>

      {totalProductionValue > 0 && (
        <div className="card p-6 space-y-4">
          <div className="flex justify-between items-end">
            <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Saúde do Orçamento</p>
            <p className="text-xs font-black text-lumos-text-primary">{consumptionPercent.toFixed(1)}%</p>
          </div>
          <div className="w-full h-4 bg-lumos-text-primary/5 rounded-full overflow-hidden border border-lumos-border p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                consumptionPercent > 90
                  ? 'bg-red-500'
                  : consumptionPercent > 70
                  ? 'bg-yellow-500'
                  : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(consumptionPercent, 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                <th className="px-6 py-4 w-10">
                  <div
                    onClick={toggleSelectAll}
                    className={clsx(
                      'w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all',
                      selectedIds.size === costs.length && costs.length > 0
                        ? 'bg-lumos-yellow border-lumos-yellow text-lumos-bg'
                        : 'border-lumos-border hover:border-lumos-yellow/50'
                    )}
                  >
                    {selectedIds.size === costs.length && costs.length > 0 && (
                      <Check className="w-3.5 h-3.5" />
                    )}
                  </div>
                </th>
                <th className="px-6 py-4">Data</th>
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Categoria</th>
                <th className="px-6 py-4">Vencimento</th>
                <th className="px-6 py-4 text-right">Valor</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {costs.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-8 text-center text-lumos-text-secondary text-sm italic"
                  >
                    Nenhum custo registrado.
                  </td>
                </tr>
              ) : (
                costs.map(c => (
                  <tr
                    key={c.id}
                    className={clsx(
                      'hover:bg-lumos-text-primary/5 transition-colors cursor-pointer group',
                      selectedIds.has(c.id) && 'bg-lumos-yellow/[0.03]'
                    )}
                    onClick={() => handleEdit(c)}
                  >
                    <td className="px-6 py-4">
                      <div
                        onClick={e => toggleSelect(c.id, e)}
                        className={clsx(
                          'w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all',
                          selectedIds.has(c.id)
                            ? 'bg-lumos-yellow border-lumos-yellow text-lumos-bg'
                            : 'border-lumos-border group-hover:border-lumos-yellow/50 opacity-0 group-hover:opacity-100',
                          selectedIds.size > 0 && 'opacity-100'
                        )}
                      >
                        {selectedIds.has(c.id) && <Check className="w-3.5 h-3.5" />}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-lumos-text-secondary">
                      {new Date(c.cost_date).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-lumos-text-primary">{c.description}</td>
                    <td className="px-6 py-4 text-[10px] font-bold text-lumos-text-secondary uppercase">
                      {c.category ? formatCategoryLabel(c.category) : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {c.payment_due_date ? (
                        (() => {
                          const due = new Date(c.payment_due_date + 'T00:00:00');
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const isOverdue = due < today;
                          return (
                            <span className={clsx(
                              'font-bold',
                              isOverdue ? 'text-red-500' : 'text-lumos-text-secondary'
                            )}>
                              {due.toLocaleDateString('pt-BR')}
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-lumos-text-secondary/40 italic text-xs">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-lumos-text-primary">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c.amount)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={e => { e.stopPropagation(); handleEdit(c); }}
                          className="p-1.5 text-lumos-text-secondary hover:text-blue-500 transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setDeletingId(c.id); setIsDeleteModalOpen(true); }}
                          className="p-1.5 text-lumos-text-secondary hover:text-red-500 transition-colors"
                          >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-lumos-surface border border-lumos-yellow/20 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-full px-6 py-4 flex items-center gap-6 backdrop-blur-xl">
            <div className="flex items-center gap-3 pr-6 border-r border-lumos-border">
              <div className="w-8 h-8 rounded-full bg-lumos-yellow/20 flex items-center justify-center font-black text-lumos-yellow text-sm">
                {selectedIds.size}
              </div>
              <span className="text-sm font-bold text-lumos-text-primary uppercase tracking-tight">
                {selectedIds.size === 1 ? 'Item selecionado' : 'Itens selecionados'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsBatchDeleteModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 text-red-500 font-black text-xs uppercase hover:bg-red-500 hover:text-white transition-all active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" /> Excluir
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="p-2 text-lumos-text-secondary hover:text-lumos-text-primary transition-colors text-xs font-bold uppercase"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      <Modal isOpen={isBatchDeleteModalOpen} onClose={() => setIsBatchDeleteModalOpen(false)} title="Excluir Itens">
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-1">
              <p className="text-lumos-text-primary font-bold">Confirma a exclusão em lote?</p>
              <p className="text-xs text-lumos-text-secondary">
                Você selecionou {selectedIds.size} custos para exclusão permanente deste projeto. Esta ação não pode ser desfeita.
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsBatchDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleBatchDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">
              Sim, Excluir
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? 'Editar Custo' : 'Registrar Custo'}>
        <form onSubmit={handleAddCost} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Descrição</label>
            <input
              required
              type="text"
              className="input-lumos w-full"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Valor</label>
              <CurrencyInput
                className="input-lumos w-full font-bold"
                value={formData.amount}
                onChange={(val: number) => setFormData({ ...formData, amount: val })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Data do Custo</label>
              <input
                required
                type="date"
                className="input-lumos w-full"
                value={formData.cost_date}
                onChange={e => handleCostDateChange(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Pagamento em</label>
              <select
                className="input-lumos w-full"
                value={duePreset}
                onChange={e => applyDuePreset(e.target.value)}
              >
                <option value="7">7 dias</option>
                <option value="15">15 dias</option>
                <option value="30">30 dias</option>
                <option value="45">45 dias</option>
                <option value="60">60 dias</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Vencimento</label>
              <input
                type="date"
                className="input-lumos w-full"
                value={formData.payment_due_date}
                onChange={e => {
                  setFormData({ ...formData, payment_due_date: e.target.value });
                  setDuePreset('custom');
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Categoria</label>
              {creatingCategory ? (
                <div className="border border-lumos-yellow/40 rounded-lumos p-3 space-y-2 bg-lumos-yellow/[0.03]">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Nome da nova categoria"
                    className="input-lumos w-full"
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); confirmNewCategory(); }
                      if (e.key === 'Escape') { setCreatingCategory(false); setNewCategoryName(''); }
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setCreatingCategory(false); setNewCategoryName(''); }}
                      className="flex-1 min-w-0 h-9 px-2 rounded-lumos border border-lumos-border text-lumos-text-secondary text-[11px] font-bold uppercase tracking-widest hover:text-lumos-text-primary hover:bg-lumos-bg/50 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={confirmNewCategory}
                      disabled={!newCategoryName.trim()}
                      className="flex-1 min-w-0 h-9 px-2 rounded-lumos bg-lumos-yellow text-lumos-bg text-[11px] font-black uppercase tracking-widest hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                    >
                      Adicionar
                    </button>
                  </div>
                </div>
              ) : (
                <select
                  className="input-lumos w-full"
                  value={formData.category}
                  onChange={e => {
                    if (e.target.value === '__new__') {
                      setCreatingCategory(true);
                    } else {
                      setFormData({ ...formData, category: e.target.value });
                    }
                  }}
                >
                  {categories.map(c => (
                    <option key={c} value={c}>{formatCategoryLabel(c)}</option>
                  ))}
                  <option value="__new__">+ Criar nova categoria</option>
                </select>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Responsável</label>
              <select
                className="input-lumos w-full"
                value={formData.responsible_id}
                onChange={e => setFormData({ ...formData, responsible_id: e.target.value })}
              >
                <option value="">Selecione</option>
                {appUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 h-10">{editingId ? 'Salvar Alterações' : 'Salvar'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Confirmar Exclusão">
        <div className="space-y-4">
          <p className="text-sm text-lumos-text-secondary">
            Tem certeza que deseja excluir este custo? Esta ação não pode ser desfeita.
          </p>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleDeleteCost} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">
              Excluir permanentemente
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal de edição do projeto */}
      <Modal isOpen={isEditProjectModalOpen} onClose={() => setIsEditProjectModalOpen(false)} title="Editar Projeto">
        <form onSubmit={saveProjectEdit} className="space-y-4">
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
              Valor Total para Produção
            </label>
            <CurrencyInput
              className="input-lumos w-full font-bold"
              value={editProjectData.production_value}
              onChange={(val: number) => setEditProjectData({ ...editProjectData, production_value: val })}
            />
            {project.budget_id && (
              <p className="text-[10px] text-lumos-text-secondary italic">
                Deixe em R$ 0,00 para usar o cálculo automático do orçamento vinculado.
              </p>
            )}
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsEditProjectModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 h-10">Salvar Alterações</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
