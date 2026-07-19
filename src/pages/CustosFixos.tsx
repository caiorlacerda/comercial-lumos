import React, { useEffect, useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  AlertTriangle,
  Home,
  Users,
  Monitor,
  Briefcase,
  CreditCard,
  MoreHorizontal,
  ToggleLeft,
  ToggleRight,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import Modal from '@/components/common/Modal';
import { useToast } from '@/context/ToastContext';
import { MobileCardList, MobileCard } from '@/components/ui/MobileCards';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FixedCost {
  id: string;
  name: string;
  amount: number;
  category: string;
  payment_method: string;
  paid_by: string;
  is_active: boolean;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface FormData {
  name: string;
  amount: number;
  category: string;
  payment_method: string;
  paid_by: string;
  is_active: boolean;
  notes: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: { value: string; label: string; icon: React.FC<any> }[] = [
  { value: 'espaco', label: 'Espaço', icon: Home },
  { value: 'equipe', label: 'Equipe', icon: Users },
  { value: 'software', label: 'Software', icon: Monitor },
  { value: 'servicos', label: 'Serviços', icon: Briefcase },
  { value: 'parcelamento', label: 'Parcelamento', icon: CreditCard },
  { value: 'outros', label: 'Outros', icon: MoreHorizontal },
];

const PAYMENT_METHODS = [
  { value: 'manual', label: 'Manual' },
  { value: 'cartao', label: 'Cartão de Crédito' },
  { value: 'debito_auto', label: 'Débito Automático' },
];

const formatBRL = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const categoryMeta = (cat: string) =>
  CATEGORIES.find(c => c.value === cat) ?? CATEGORIES[CATEGORIES.length - 1];

// ─── CurrencyInput ────────────────────────────────────────────────────────────

const CurrencyInput = ({ value, onChange, className }: { value: number; onChange: (v: number) => void; className?: string }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    onChange(raw ? parseInt(raw) / 100 : 0);
  };
  return (
    <input
      type="text"
      className={className}
      value={formatBRL(value)}
      onChange={handleChange}
    />
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function CustosFixos() {
  const toast = useToast();
  const [costs, setCosts] = useState<FixedCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const defaultForm: FormData = {
    name: '',
    amount: 0,
    category: 'outros',
    payment_method: 'manual',
    paid_by: 'Lumos',
    is_active: true,
    notes: '',
  };
  const [formData, setFormData] = useState<FormData>(defaultForm);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('fixed_costs')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      setCosts(data || []);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }

  const resetForm = () => {
    setFormData(defaultForm);
    setEditingId(null);
  };

  const handleEdit = (cost: FixedCost) => {
    setEditingId(cost.id);
    setFormData({
      name: cost.name,
      amount: cost.amount,
      category: cost.category,
      payment_method: cost.payment_method || 'manual',
      paid_by: cost.paid_by || 'Lumos',
      is_active: cost.is_active,
      notes: cost.notes || '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return toast.error('Nome é obrigatório.');
    if (formData.amount <= 0) return toast.error('Valor deve ser maior que zero.');
    try {
      if (editingId) {
        const { error } = await supabase
          .from('fixed_costs')
          .update({ ...formData, updated_at: new Date().toISOString() })
          .eq('id', editingId);
        if (error) throw error;
        toast.success('Custo atualizado com sucesso.');
      } else {
        const { error } = await supabase.from('fixed_costs').insert([formData]);
        if (error) throw error;
        toast.success('Custo adicionado com sucesso.');
      }
      setIsModalOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const { error } = await supabase.from('fixed_costs').delete().eq('id', deletingId);
      if (error) throw error;
      toast.success('Custo removido.');
      setIsDeleteModalOpen(false);
      setDeletingId(null);
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const toggleActive = async (cost: FixedCost) => {
    try {
      const { error } = await supabase
        .from('fixed_costs')
        .update({ is_active: !cost.is_active, updated_at: new Date().toISOString() })
        .eq('id', cost.id);
      if (error) throw error;
      setCosts(prev => prev.map(c => c.id === cost.id ? { ...c, is_active: !c.is_active } : c));
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // ─── KPIs ──────────────────────────────────────────────────────────────────

  const activeCosts = costs.filter(c => c.is_active);
  const totalMonthly = activeCosts.reduce((acc, c) => acc + c.amount, 0);
  const totalAnnual = totalMonthly * 12;

  // ─── Grouped by category ───────────────────────────────────────────────────

  const grouped = CATEGORIES.map(cat => ({
    ...cat,
    items: costs.filter(c => c.category === cat.value),
  })).filter(g => g.items.length > 0);

  // ─── Loading skeleton ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 font-work-sans animate-pulse">
        <div className="h-8 w-64 bg-lumos-surface rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="card p-5 h-20" />)}
        </div>
        <div className="card h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6 font-work-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Custos Fixos Mensais</h1>
          <p className="text-lumos-text-secondary text-sm">Gerencie todos os custos recorrentes da Lumos.</p>
        </div>
        <button
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="btn-primary h-10 px-6 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Adicionar
        </button>
      </div>

      {/* KPI Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5 border-l-4 border-lumos-yellow/50">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest mb-1">Total Mensal</p>
          <p className="text-2xl font-black text-lumos-yellow">{formatBRL(totalMonthly)}</p>
        </div>
        <div className="card p-5 border-l-4 border-blue-500/50">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest mb-1">Total Anual</p>
          <p className="text-2xl font-black text-lumos-text-primary">{formatBRL(totalAnnual)}</p>
        </div>
        <div className="card p-5 border-l-4 border-green-500/50">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest mb-1">Itens Ativos</p>
          <p className="text-2xl font-black text-lumos-text-primary">{activeCosts.length}</p>
        </div>
      </div>

      {/* Table grouped by category */}
      <div className="card overflow-hidden">
        {grouped.length === 0 ? (
          <div className="py-16 text-center text-lumos-text-secondary text-sm italic">
            Nenhum custo fixo cadastrado. Clique em "Adicionar" para começar.
          </div>
        ) : (
          <>
          <div className="overflow-x-auto hidden lg:block">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                  <th className="px-6 py-4 w-10" />
                  <th className="px-6 py-4">Nome</th>
                  <th className="px-6 py-4 text-right">Valor (R$)</th>
                  <th className="px-6 py-4">Forma de Pagamento</th>
                  <th className="px-6 py-4">Pago por</th>
                  <th className="px-6 py-4 text-center">Ativo</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(group => {
                  const Icon = group.icon;
                  const subtotal = group.items.filter(i => i.is_active).reduce((acc, i) => acc + i.amount, 0);
                  const isCollapsed = collapsedCategories.has(group.value);
                  return (
                    <React.Fragment key={group.value}>
                      {/* Category header row */}
                      <tr
                        className="bg-lumos-text-primary/[0.03] border-y border-lumos-border cursor-pointer select-none"
                        onClick={() => toggleCategory(group.value)}
                      >
                        <td className="px-6 py-3" colSpan={7}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {isCollapsed
                                ? <ChevronRight className="w-4 h-4 text-lumos-text-secondary" />
                                : <ChevronDown className="w-4 h-4 text-lumos-text-secondary" />
                              }
                              <Icon className="w-4 h-4 text-lumos-yellow" />
                              <span className="text-[11px] font-black text-lumos-text-secondary uppercase tracking-widest">
                                {group.label}
                              </span>
                              <span className="text-[10px] text-lumos-text-secondary/60 ml-1">
                                ({group.items.length} {group.items.length === 1 ? 'item' : 'itens'})
                              </span>
                            </div>
                            <span className="text-sm font-black text-lumos-text-primary">
                              {formatBRL(subtotal)}
                              <span className="text-[10px] text-lumos-text-secondary font-normal ml-1">/mês</span>
                            </span>
                          </div>
                        </td>
                      </tr>

                      {/* Item rows */}
                      {!isCollapsed && group.items.map(cost => (
                        <tr
                          key={cost.id}
                          className={clsx(
                            'hover:bg-lumos-text-primary/5 transition-colors border-b border-lumos-border/50',
                            !cost.is_active && 'opacity-50'
                          )}
                        >
                          <td className="px-6 py-3 w-10">
                            <div className="w-1.5 h-1.5 rounded-full bg-lumos-border mx-auto" />
                          </td>
                          <td className="px-6 py-3">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-lumos-text-primary">{cost.name}</span>
                              {cost.notes && (
                                <span className="text-[10px] text-lumos-text-secondary italic">{cost.notes}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3 text-right text-sm font-black text-lumos-text-primary">
                            {formatBRL(cost.amount)}
                          </td>
                          <td className="px-6 py-3 text-sm text-lumos-text-secondary">
                            {PAYMENT_METHODS.find(m => m.value === cost.payment_method)?.label ?? cost.payment_method}
                          </td>
                          <td className="px-6 py-3 text-sm text-lumos-text-secondary">
                            {cost.paid_by || 'Lumos'}
                          </td>
                          <td className="px-6 py-3 text-center">
                            <button
                              onClick={() => toggleActive(cost)}
                              className="text-lumos-text-secondary hover:text-lumos-yellow transition-colors"
                              title={cost.is_active ? 'Desativar' : 'Ativar'}
                            >
                              {cost.is_active
                                ? <ToggleRight className="w-6 h-6 text-green-500" />
                                : <ToggleLeft className="w-6 h-6" />
                              }
                            </button>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => handleEdit(cost)}
                                className="p-2 text-lumos-text-secondary hover:text-blue-400 hover:bg-blue-500/10 rounded-lumos transition-all"
                                title="Editar"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => { setDeletingId(cost.id); setIsDeleteModalOpen(true); }}
                                className="p-2 text-lumos-text-secondary hover:text-red-400 hover:bg-red-500/10 rounded-lumos transition-all"
                                title="Excluir"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}

                {/* Grand total row */}
                <tr className="bg-lumos-yellow/5 border-t-2 border-lumos-yellow/30">
                  <td colSpan={2} className="px-6 py-4">
                    <span className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">
                      Total Mensal (itens ativos)
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-lg font-black text-lumos-yellow">{formatBRL(totalMonthly)}</span>
                  </td>
                  <td colSpan={4} />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile: cartões agrupados (a tabela acima fica só no desktop) */}
          <MobileCardList>
            {grouped.map(group => {
              const Icon = group.icon;
              const subtotal = group.items.filter(i => i.is_active).reduce((acc, i) => acc + i.amount, 0);
              const isCollapsed = collapsedCategories.has(group.value);
              return (
                <React.Fragment key={group.value}>
                  <div
                    className="px-4 py-2.5 bg-lumos-text-primary/[0.04] flex items-center justify-between gap-2 cursor-pointer select-none"
                    onClick={() => toggleCategory(group.value)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isCollapsed ? <ChevronRight className="w-4 h-4 text-lumos-text-secondary flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-lumos-text-secondary flex-shrink-0" />}
                      <Icon className="w-4 h-4 text-lumos-yellow flex-shrink-0" />
                      <span className="text-[11px] font-black text-lumos-text-secondary uppercase tracking-widest truncate">{group.label}</span>
                      <span className="text-[10px] text-lumos-text-secondary/60">({group.items.length})</span>
                    </div>
                    <span className="text-sm font-black text-lumos-text-primary whitespace-nowrap">{formatBRL(subtotal)}<span className="text-[10px] text-lumos-text-secondary font-normal ml-1">/mês</span></span>
                  </div>
                  {!isCollapsed && group.items.map(cost => (
                    <MobileCard key={cost.id} className={clsx(!cost.is_active && 'opacity-50')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-lumos-text-primary truncate">{cost.name}</div>
                          {cost.notes && <div className="text-[10px] text-lumos-text-secondary italic truncate">{cost.notes}</div>}
                        </div>
                        <span className="text-sm font-black text-lumos-text-primary whitespace-nowrap">{formatBRL(cost.amount)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <span className="text-[11px] text-lumos-text-secondary truncate">
                          {(PAYMENT_METHODS.find(m => m.value === cost.payment_method)?.label ?? cost.payment_method)} · {cost.paid_by || 'Lumos'}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => toggleActive(cost)} className="text-lumos-text-secondary hover:text-lumos-yellow transition-colors" title={cost.is_active ? 'Desativar' : 'Ativar'}>
                            {cost.is_active ? <ToggleRight className="w-6 h-6 text-green-500" /> : <ToggleLeft className="w-6 h-6" />}
                          </button>
                          <button onClick={() => handleEdit(cost)} className="p-1.5 text-lumos-text-secondary hover:text-blue-400 hover:bg-blue-500/10 rounded-lumos transition-all" title="Editar"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => { setDeletingId(cost.id); setIsDeleteModalOpen(true); }} className="p-1.5 text-lumos-text-secondary hover:text-red-400 hover:bg-red-500/10 rounded-lumos transition-all" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    </MobileCard>
                  ))}
                </React.Fragment>
              );
            })}
            <div className="px-4 py-3 bg-lumos-yellow/5 border-t-2 border-lumos-yellow/30 flex items-center justify-between gap-3">
              <span className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Total Mensal (ativos)</span>
              <span className="text-lg font-black text-lumos-yellow whitespace-nowrap">{formatBRL(totalMonthly)}</span>
            </div>
          </MobileCardList>
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={editingId ? 'Editar Custo Fixo' : 'Novo Custo Fixo'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Nome *</label>
            <input
              required
              type="text"
              className="input-lumos w-full"
              placeholder="Ex: Aluguel do escritório"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Valor (R$) *</label>
              <CurrencyInput
                className="input-lumos w-full font-bold"
                value={formData.amount}
                onChange={val => setFormData({ ...formData, amount: val })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Categoria *</label>
              <select
                className="input-lumos w-full"
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Forma de Pagamento</label>
              <select
                className="input-lumos w-full"
                value={formData.payment_method}
                onChange={e => setFormData({ ...formData, payment_method: e.target.value })}
              >
                {PAYMENT_METHODS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Pago por</label>
              <select
                className="input-lumos w-full"
                value={formData.paid_by}
                onChange={e => setFormData({ ...formData, paid_by: e.target.value })}
              >
                <option value="Lumos">Lumos</option>
                <option value="Sócio">Sócio</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Observações</label>
            <textarea
              className="input-lumos w-full resize-none"
              rows={2}
              placeholder="Detalhes adicionais (opcional)..."
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-lumos-text-primary/5 rounded-lumos border border-lumos-border">
            <div>
              <p className="text-xs font-bold text-lumos-text-primary uppercase tracking-widest">Item Ativo</p>
              <p className="text-[10px] text-lumos-text-secondary italic">Itens inativos não entram no total mensal</p>
            </div>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, is_active: !formData.is_active })}
              className={clsx(
                'w-10 h-5 rounded-full transition-all relative',
                formData.is_active ? 'bg-lumos-yellow' : 'bg-lumos-text-primary/20'
              )}
            >
              <div className={clsx(
                'absolute top-1 w-3 h-3 bg-white rounded-full transition-all',
                formData.is_active ? 'left-6' : 'left-1'
              )} />
            </button>
          </div>

          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => { setIsModalOpen(false); resetForm(); }} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button type="submit" className="btn-primary flex-1 h-10">
              {editingId ? 'Salvar Alterações' : 'Adicionar Custo'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => { setIsDeleteModalOpen(false); setDeletingId(null); }}
        title="Confirmar Exclusão"
      >
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-1">
              <p className="text-lumos-text-primary font-bold">Excluir este custo fixo?</p>
              <p className="text-xs text-lumos-text-secondary">Esta ação não pode ser desfeita.</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setIsDeleteModalOpen(false); setDeletingId(null); }} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">
              Excluir permanentemente
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
