import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGoBack } from '@/hooks/useGoBack';
import { formatBudgetCode } from '@/utils/formatters';
import { Archive, ArrowLeft, ArrowLeftRight, ExternalLink, Plus, AlertTriangle, Target, Edit2, Trash2, Check, CalendarClock, Pencil, RotateCcw, TrendingUp } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import Select from '@/components/ui/Select';
import ParcelamentoModal from '@/components/financeiro/ParcelamentoModal';
import EncerrarProjetoModal from '@/components/financeiro/EncerrarProjetoModal';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/common/Modal';
import { useToast } from '@/context/ToastContext';
import { MobileCardList, MobileCard, MobileCardEmpty } from '@/components/ui/MobileCards';

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
  const goBack = useGoBack('/financeiro/custos-projeto');
  const { profile } = useAuth();
  const toast = useToast();
  const [project, setProject] = useState<any>(null);
  const [finRegistro, setFinRegistro] = useState<any>(null);
  const [encerrandoProj, setEncerrandoProj] = useState(false);
  const [parcelando, setParcelando] = useState(false);
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

  // Módulo Financeiro (Fase 1)
  const [projectFinanceiro, setProjectFinanceiro] = useState<any>(null);

  // Preferência pessoal do admin: o 3º card mostra "Saldo de Produção" ou
  // "Lucro Líquido Real". Persistida por usuário no localStorage.
  const [saldoMode, setSaldoMode] = useState<'saldo' | 'lucro'>(() => {
    try {
      return localStorage.getItem(`lumos_saldo_mode_${profile?.id ?? 'anon'}`) === 'lucro' ? 'lucro' : 'saldo';
    } catch {
      return 'saldo';
    }
  });

  const toggleSaldoMode = () => {
    setSaldoMode(prev => {
      const next = prev === 'saldo' ? 'lucro' : 'saldo';
      try { localStorage.setItem(`lumos_saldo_mode_${profile?.id ?? 'anon'}`, next); } catch { /* ignora */ }
      return next;
    });
  };
  const [financeCategorias, setFinanceCategorias] = useState<any[]>([]);
  const [financeTiposServico, setFinanceTiposServico] = useState<any[]>([]);
  const [isEditingFinance, setIsEditingFinance] = useState(false);
  const [financeForm, setFinanceForm] = useState({
    cliente_id: '',
    categoria_id: '',
    tipo_servico_id: '',
    icp: '',
    data_recebimento_negociada: '',
    status_titulo: 'emitir_nf',
    data_recebido: '',
    nf_percent: 0.18,
    valor_vendido: 0
  });

  // Categorias dinâmicas (defaults + as já cadastradas no banco)
  const [categories, setCategories] = useState<string[]>(['equipe', 'equipamento', 'locacao']);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [fornecedores, setFornecedores] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [selectedFornecedorId, setSelectedFornecedorId] = useState<string>('');
  const [selectedServicoId, setSelectedServicoId] = useState<string>('');

  useEffect(() => { fetchProjectData(); }, [id]);
  useEffect(() => { fetchCategories(); }, []);

  useEffect(() => {
    if (selectedFornecedorId) {
      fetchSupplierServices(selectedFornecedorId);
    } else {
      setServices([]);
    }
  }, [selectedFornecedorId]);

  async function fetchSupplierServices(fornecedorId: string) {
    try {
      const { data, error } = await supabase
        .from('fornecedor_servicos')
        .select('id, tipo_servico, valor')
        .eq('fornecedor_id', fornecedorId)
        .order('tipo_servico');
      if (error) throw error;
      setServices(data || []);
    } catch (err) {
      console.error('Error fetching services:', err);
    }
  }

  const handleFornecedorChange = (fornecedorId: string) => {
    setSelectedFornecedorId(fornecedorId);
    setSelectedServicoId('');
    if (fornecedorId) {
      const selectedF = fornecedores.find(f => f.id === fornecedorId);
      if (selectedF) {
        setFormData(prev => ({
          ...prev,
          supplier: selectedF.nome
        }));
      }
    } else {
      setFormData(prev => ({ ...prev, supplier: '' }));
    }
  };

  const handleServicoChange = (serviceId: string) => {
    setSelectedServicoId(serviceId);
    if (serviceId) {
      const selectedService = services.find(s => s.id === serviceId);
      if (selectedService) {
        setFormData(prev => ({
          ...prev,
          description: selectedService.tipo_servico,
          amount: Number(selectedService.valor || 0)
        }));
      }
    }
  };

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

  // Cartão de custo para o celular (usado nas duas tabelas: Equipe e Produção).
  const renderCostCard = (c: any) => {
    const paid = c.status === 'pago' || c.paid_at;
    let dueEl = null;
    if (c.payment_due_date) {
      const due = new Date(c.payment_due_date + 'T00:00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isOverdue = due < today && !paid;
      dueEl = <span className={clsx('font-bold', isOverdue ? 'text-red-500' : 'text-lumos-text-secondary')}>vence {due.toLocaleDateString('pt-BR')}</span>;
    }
    return (
      <MobileCard key={c.id} onClick={() => handleEdit(c)} className={clsx(paid && 'opacity-65')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-lumos-text-primary truncate">{c.description}</div>
            {c.fornecedor?.nome && (
              <div className="text-[10px] text-lumos-yellow font-bold uppercase tracking-widest truncate mt-0.5">Fornecedor: {c.fornecedor.nome}</div>
            )}
          </div>
          <span className="text-sm font-black text-lumos-text-primary whitespace-nowrap">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c.amount)}</span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-lumos-text-secondary">
          <span>{new Date(c.cost_date).toLocaleDateString('pt-BR')}</span>
          {c.category && <span className="uppercase font-bold">· {formatCategoryLabel(c.category)}</span>}
          {dueEl && <span>· {dueEl}</span>}
        </div>
        <div className="flex items-center justify-between gap-2 mt-2" onClick={e => e.stopPropagation()}>
          {paid ? (
            <button
              onClick={() => handleTogglePaid(c.id, false)}
              className="inline-flex items-center text-[9px] font-black text-green-500 uppercase bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full"
            >
              Pago · desfazer
            </button>
          ) : (
            <button
              onClick={() => handleTogglePaid(c.id, true)}
              className="inline-flex items-center text-[9px] font-black text-yellow-500 uppercase bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 px-2.5 py-1 rounded-full transition-all"
            >
              Marcar Pago
            </button>
          )}
          <div className="flex items-center gap-1">
            <button onClick={() => handleEdit(c)} className="p-1.5 text-lumos-text-secondary hover:text-blue-500 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
            <button onClick={() => { setDeletingId(c.id); setIsDeleteModalOpen(true); }} className="p-1.5 text-lumos-text-secondary hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </MobileCard>
    );
  };

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
      let activeVersionData: any = null;
      let receivableAmount = 0;
      let budgetId = projectData.budget_id || null;

      // 2. Se tiver budget_id, busca itens do orçamento e contas a receber
      if (budgetId) {
        const { data: budgetData } = await supabase
          .from('budgets')
          .select('active_version_id, active_version:budget_versions!active_version_id(id, margin_pct, nf_pct, discount_value), receivable:receivables(total_amount)')
          .eq('id', budgetId)
          .single();

        if (budgetData) {
          activeVersionData = (budgetData as any).active_version;
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

      // 3. Busca custos, usuários, clientes, fornecedores, categorias e tipos de serviço em paralelo
      const [costsRes, usersRes, clientsRes, fornecedoresRes, finCatsRes, finServicesRes] = await Promise.all([
        supabase
          .from('project_costs')
          .select('*, responsible:app_users!responsible_id(full_name), paid_by_user:app_users!paid_by(full_name), fornecedor:fornecedores(nome)')
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
        supabase
          .from('fornecedores')
          .select('id, nome')
          .order('nome'),
        supabase
          .from('categorias')
          .select('*')
          .eq('ativo', true)
          .order('ordem'),
        supabase
          .from('tipos_servico')
          .select('*')
          .eq('ativo', true)
          .order('nome')
      ]);

      setCosts(costsRes.data || []);
      setAppUsers(usersRes.data || []);
      setClients(clientsRes.data || []);
      setFornecedores(fornecedoresRes.data || []);
      setFinanceCategorias(finCatsRes.data || []);
      setFinanceTiposServico(finServicesRes.data || []);

      // 4. Busca ou cria projetos_financeiro
      let finData = null;
      const { data: existingFin } = await supabase
        .from('projetos_financeiro')
        .select('*')
        .eq('project_id', id)
        .maybeSingle();

      if (existingFin) {
        finData = existingFin;
      } else {
        // Busca config default
        const { data: config } = await supabase
          .from('config_financeiro')
          .select('nf_percent')
          .eq('id', 1)
          .single();

        let client_id = projectData.client_id;
        if (!client_id && clientsRes.data && clientsRes.data.length > 0) {
          client_id = clientsRes.data[0].id;
        }

        if (client_id) {
          const { data: newFin, error: createFinErr } = await supabase
            .from('projetos_financeiro')
            .insert({
              project_id: id,
              proposta_id: projectData.budget_id || null,
              cliente_id: client_id,
              valor_vendido: projectData.production_value || receivableAmount || 0,
              nf_percent: config?.nf_percent ?? 0.18,
              custos_total: costsRes.data?.reduce((sum, c) => sum + Number(c.amount || 0), 0) || 0,
              status_titulo: 'emitir_nf',
              origem: 'manual',
              pendente_preenchimento: true
            })
            .select()
            .single();
          
          if (createFinErr) {
            console.error('Erro ao criar projetos_financeiro:', createFinErr);
          } else {
            finData = newFin;
          }
        }
      }

      // 5. Busca dados calculados da view rentabilidade
      if (finData) {
        const { data: rentData } = await supabase
          .from('vw_rentabilidade')
          .select(`
            *,
            categoria:categorias(nome),
            tipo_servico:tipos_servico(nome)
          `)
          .eq('project_id', id)
          .maybeSingle();
        
        if (rentData) {
          setProjectFinanceiro(rentData);
          setFinanceForm({
            cliente_id: rentData.cliente_id || '',
            categoria_id: rentData.categoria_id || '',
            tipo_servico_id: rentData.tipo_servico_id || '',
            icp: rentData.icp || '',
            data_recebimento_negociada: rentData.data_recebimento_negociada || '',
            status_titulo: rentData.status_titulo || 'emitir_nf',
            data_recebido: rentData.data_recebido || '',
            nf_percent: rentData.nf_percent || 0.18,
            valor_vendido: rentData.valor_vendido || 0
          });
        }
      }

      setFinRegistro(finData);
      setProject({ 
        ...projectData, 
        budget_items: budgetItems, 
        active_version: activeVersionData,
        receivable_amount: receivableAmount, 
        budget_id: budgetId 
      });

    } catch (error) {
      // NÃO redirecionar aqui: se um fetch em andamento termina/falha logo depois
      // de o usuário clicar para sair, este navigate sequestrava a navegação e o
      // jogava de volta para a lista. Em erro real, project fica null e a tela
      // "Projeto não encontrado" abaixo é exibida.
      console.error('Erro ao carregar projeto:', error);
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
        fornecedor_id: selectedFornecedorId || null,
        fornecedor_servico_id: selectedServicoId || null,
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

  const isEquipeCategory = (category: string) => {
    if (!category) return false;
    const normalized = category.toLowerCase().trim();
    if (normalized === 'equipe' || normalized === 'servicos_terceiros' || normalized === 'serviços_terceiros') return true;
    
    const equipeKeywords = [
      'cinegrafista', 'editor', 'audio', 'áudio', 'locutor', 'maquiador', 
      'fotografo', 'fotógrafo', 'diretor', 'direção', 'direcao', 
      'assistente', 'roteirista', 'animador', 'designer', 'ator', 
      'modelo', 'host', 'apresentador', 'operador'
    ];
    return equipeKeywords.some(keyword => normalized.includes(keyword));
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === costs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(costs.map(c => c.id)));
    }
  };

  const toggleSelectAllEquipe = () => {
    const equipeIds = costs.filter(c => isEquipeCategory(c.category)).map(c => c.id);
    const allEquipeSelected = equipeIds.length > 0 && equipeIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allEquipeSelected) {
      equipeIds.forEach(id => next.delete(id));
    } else {
      equipeIds.forEach(id => next.add(id));
    }
    setSelectedIds(next);
  };

  const toggleSelectAllProducao = () => {
    const producaoIds = costs.filter(c => !isEquipeCategory(c.category)).map(c => c.id);
    const allProducaoSelected = producaoIds.length > 0 && producaoIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allProducaoSelected) {
      producaoIds.forEach(id => next.delete(id));
    } else {
      producaoIds.forEach(id => next.add(id));
    }
    setSelectedIds(next);
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
    setSelectedFornecedorId('');
    setSelectedServicoId('');
  };

  const handleTogglePaid = async (costId: string, isPaid: boolean) => {
    if (!profile) return;
    
    const previousCosts = [...costs];
    
    // Atualização otimista na tela para resposta instantânea
    setCosts(prev => prev.map(item => {
      if (item.id === costId) {
        return {
          ...item,
          status: isPaid ? 'pago' : 'pendente',
          paid_at: isPaid ? new Date().toISOString() : null,
          paid_by: isPaid ? profile.id : null,
          paid_by_user: isPaid ? { full_name: profile.full_name } : null
        };
      }
      return item;
    }));

    try {
      const { error } = await supabase
        .from('project_costs')
        .update({
          status: isPaid ? 'pago' : 'pendente',
          paid_at: isPaid ? new Date().toISOString() : null,
          paid_by: isPaid ? profile.id : null
        })
        .eq('id', costId);

      if (error) throw error;
    } catch (err: any) {
      console.error('Error toggling cost payment status:', err);
      toast.error('Erro ao atualizar status de pagamento do custo.');
      setCosts(previousCosts);
    }
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
    setSelectedFornecedorId(c.fornecedor_id || '');
    setSelectedServicoId(c.fornecedor_servico_id || '');
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

  const handleSaveFinance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isComplete = Boolean(
        financeForm.cliente_id &&
        financeForm.categoria_id &&
        financeForm.tipo_servico_id &&
        financeForm.icp
      );

      const payload = {
        cliente_id: financeForm.cliente_id,
        categoria_id: financeForm.categoria_id || null,
        tipo_servico_id: financeForm.tipo_servico_id || null,
        icp: financeForm.icp || null,
        data_recebimento_negociada: financeForm.data_recebimento_negociada || null,
        status_titulo: financeForm.status_titulo,
        data_recebido: financeForm.status_titulo === 'pagamento_recebido' 
          ? (financeForm.data_recebido || new Date().toISOString().split('T')[0]) 
          : null,
        valor_vendido: financeForm.valor_vendido,
        nf_percent: financeForm.nf_percent,
        pendente_preenchimento: !isComplete
      };

      const { error } = await supabase
        .from('projetos_financeiro')
        .update(payload)
        .eq('project_id', id);

      if (error) throw error;

      // Sincroniza também no projeto principal (se alterou cliente ou valor_vendido)
      await supabase
        .from('projects')
        .update({
          client_id: financeForm.cliente_id || null,
          production_value: financeForm.valor_vendido || null
        })
        .eq('id', id);

      toast.success('Dados financeiros atualizados!');
      setIsEditingFinance(false);
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

  // 1. Cálculos de Custos Reais
  const totalCosts = costs.reduce((acc, c) => acc + Number(c.amount || 0), 0);

  // Agrupamento de Equipe vs. Produção (Melhoria C)
  const equipeCosts = costs.filter(c => isEquipeCategory(c.category));
  const producaoCosts = costs.filter(c => !isEquipeCategory(c.category));

  const totalEquipe = equipeCosts.reduce((acc, c) => acc + Number(c.amount || 0), 0);
  const totalProducao = producaoCosts.reduce((acc, c) => acc + Number(c.amount || 0), 0);

  // 2. Cálculos Orçamentários (Teto Operacional e Faturamento)
  const estimatedCost = (project.budget_items || []).reduce(
    (acc: number, item: any) => acc + Number(item.unit_cost || 0) * Number(item.quantity || 0),
    0
  );

  const defaultNfPercent = projectFinanceiro?.nf_percent ?? 0.18;
  const defaultMarginPercent = 0.40; // 40%

  // TETO DE CUSTOS (Custo Direto do Orçamento)
  const tetoCustos = project.budget_id
    ? estimatedCost
    : (projectFinanceiro?.valor_vendido || Number(project.production_value || 0)) * (1 - defaultNfPercent) / (1 + defaultMarginPercent);

  // Sobra operacional do teto (Saldo de Produção)
  const remainingCosts = tetoCustos - totalCosts;

  // Porcentagem de consumo do teto (usado para saúde do orçamento e progresso do produtor)
  const consumptionPercentProd = tetoCustos > 0 ? (totalCosts / tetoCustos) * 100 : 0;

  // 3. Cálculos de Faturamento, Impostos e Lucro (Cascata Financeira)
  const marginPct = Number(project.active_version?.margin_pct ?? defaultMarginPercent);
  const discountValue = Number(project.active_version?.discount_value ?? 0);

  // Alíquota EFETIVA de NF: prioriza o valor editado nos Dados Financeiros
  // (projectFinanceiro.nf_percent); cai para a do orçamento e por fim 0.18.
  const nfPct = Number(projectFinanceiro?.nf_percent ?? project.active_version?.nf_pct ?? 0.18);
  // Alíquota do ORÇAMENTO: usada apenas para reconstruir o valor de venda, que é
  // o valor contratado e não muda quando a alíquota efetiva é editada.
  const budgetNfPct = Number(project.active_version?.nf_pct ?? nfPct);

  // Subtotal (Custo + Margem)
  const subtotalOrçado = estimatedCost * (1 + marginPct);

  // Faturamento Bruto (venda) — valor contratado, FIXO. Reconstruído com a
  // alíquota do orçamento (ou o valor de venda registrado). Não muda com a
  // alíquota efetiva.
  const faturamentoBruto = project.budget_id
    ? (subtotalOrçado * (1 + budgetNfPct) - discountValue)
    : (projectFinanceiro?.valor_vendido ?? Number(project.production_value || 0));

  // Imposto NF — deduzido do faturamento bruto pela alíquota efetiva (embutido).
  // Menos imposto => sobra mais (Lucro Líquido sobe).
  const impostoNF = faturamentoBruto - (faturamentoBruto / (1 + nfPct));

  // Faturamento Líquido (Receita sem imposto) = Bruto − Imposto.
  const faturamentoLiquido = faturamentoBruto - impostoNF;

  // Lucro Líquido Real (com impostos deduzidos)
  const lucroLiquidoReal = faturamentoLiquido - totalCosts;

  // Lucro Operacional (sem descontar impostos)
  const lucroOperacionalReal = faturamentoBruto - totalCosts;

  // Markup Real (sobre custo) = Lucro Líquido Real ÷ Custo Real
  const markupReal = totalCosts > 0 ? (lucroLiquidoReal / totalCosts) * 100 : 0;

  // Margem s/ Faturamento = Lucro Líquido Real ÷ Faturamento Bruto
  const margemFaturamento = faturamentoBruto > 0 ? (lucroLiquidoReal / faturamentoBruto) * 100 : 0;

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={goBack}
            title="Voltar"
            className="p-2 bg-lumos-text-primary/5 rounded-full hover:bg-lumos-text-primary/10 transition-all"
          >
            <ArrowLeft className="w-5 h-5 text-lumos-text-primary" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              {project.code && (
                <span className="text-[10px] font-black text-lumos-yellow bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase tracking-tighter">
                  {formatBudgetCode(project.code)}
                </span>
              )}
              <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">
                {project.name}
              </h1>
              {finRegistro?.encerrado_em && (
                <span className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary bg-lumos-text-secondary/10 border border-lumos-border rounded-full px-2 py-0.5">
                  Encerrado
                </span>
              )}
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
          {finRegistro && (
            <button
              onClick={() => setEncerrandoProj(true)}
              className="btn-secondary flex items-center gap-2 h-10 px-4 text-xs"
              title={finRegistro.encerrado_em ? 'Reabrir projeto' : 'Encerrar projeto no financeiro'}
            >
              {finRegistro.encerrado_em
                ? <><RotateCcw className="w-4 h-4" /> Reabrir</>
                : <><Archive className="w-4 h-4" /> Encerrar</>}
            </button>
          )}
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

      {profile?.role === 'admin' && tetoCustos > 0 && consumptionPercentProd > 90 && (
        <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-lumos flex items-center gap-3 animate-pulse">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <p className="text-sm font-bold text-red-500 uppercase">
            Atenção Crítica: Consumo de Teto de {consumptionPercentProd.toFixed(1)}%!
          </p>
        </div>
      )}
      {profile?.role === 'admin' && tetoCustos > 0 && consumptionPercentProd > 70 && consumptionPercentProd <= 90 && (
        <div className="bg-yellow-500/10 border border-yellow-500/50 p-4 rounded-lumos flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-500" />
          <p className="text-sm font-bold text-yellow-500 uppercase">
            Aviso: Consumo de Teto de {consumptionPercentProd.toFixed(1)}%.
          </p>
        </div>
      )}

      {/* Grid de Cards Superiores condicional por Permissão/Papel */}
      {/* Grid de Cards Superiores condicional por Permissão/Papel */}
      {profile?.role === 'admin' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-6">
            <div className="flex justify-between items-start mb-1">
              <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">
                Faturamento Bruto (Venda)
              </p>
              {!project.budget_id && (
                <span className="text-[9px] font-bold bg-lumos-yellow/10 text-lumos-yellow px-1.5 py-0.5 rounded uppercase tracking-wider scale-90">
                  Estimado
                </span>
              )}
            </div>
            <p className="text-2xl font-black text-lumos-text-primary tracking-tight">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(faturamentoBruto)}
            </p>
          </div>
          <div className="card p-6">
            <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">
              Total de Custos
            </p>
            <p className="text-2xl font-black text-lumos-text-primary tracking-tight">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalCosts)}
            </p>
          </div>
          <div className="card p-6">
            <div className="flex justify-between items-start mb-1 gap-2">
              <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">
                {saldoMode === 'saldo' ? 'Saldo de Produção (Margem)' : 'Lucro Líquido Real'}
              </p>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {!project.budget_id && (
                  <span className="text-[9px] font-bold bg-lumos-yellow/10 text-lumos-yellow px-1.5 py-0.5 rounded uppercase tracking-wider scale-90">
                    Estimado
                  </span>
                )}
                <button
                  onClick={toggleSaldoMode}
                  className="text-[8px] font-bold uppercase tracking-wider text-lumos-text-secondary/70 hover:text-lumos-yellow border border-lumos-border hover:border-lumos-yellow/40 rounded-full px-2 py-0.5 transition-colors flex items-center gap-1"
                  title="Alternar entre Saldo de Produção e Lucro Líquido Real"
                >
                  <ArrowLeftRight className="w-2.5 h-2.5" />
                  {saldoMode === 'saldo' ? 'Lucro' : 'Saldo'}
                </button>
              </div>
            </div>
            {(() => {
              const val = saldoMode === 'saldo' ? remainingCosts : lucroLiquidoReal;
              return (
                <p className={`text-2xl font-black tracking-tight ${val >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)}
                </p>
              );
            })()}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-6">
            <div className="flex justify-between items-start mb-1">
              <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">
                Budget Disponível (Teto)
              </p>
              {!project.budget_id && (
                <span className="text-[9px] font-bold bg-lumos-yellow/10 text-lumos-yellow px-1.5 py-0.5 rounded uppercase tracking-wider scale-90">
                  Estimado
                </span>
              )}
            </div>
            <p className="text-2xl font-black text-lumos-text-primary tracking-tight">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(tetoCustos)}
            </p>
          </div>
          <div className="card p-6">
            <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">
              Custos Registrados (Gasto)
            </p>
            <p className="text-2xl font-black text-lumos-text-primary tracking-tight">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalCosts)}
            </p>
          </div>
          <div className="card p-6">
            <div className="flex justify-between items-start mb-1">
              <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">
                Saldo Restante
              </p>
              {!project.budget_id && (
                <span className="text-[9px] font-bold bg-lumos-yellow/10 text-lumos-yellow px-1.5 py-0.5 rounded uppercase tracking-wider scale-90">
                  Estimado
                </span>
              )}
            </div>
            <p className={`text-2xl font-black tracking-tight ${remainingCosts >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(remainingCosts)}
            </p>
          </div>
        </div>
      )}

      {/* Barra de Progresso/Saúde condicional por Permissão/Papel */}
      {profile?.role === 'admin' ? (
        tetoCustos > 0 && (
          <div className="card p-6 space-y-4">
            <div className="flex justify-between items-end">
              <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Saúde do Orçamento (Consumo de Teto)</p>
              <p className="text-xs font-black text-lumos-text-primary">{consumptionPercentProd.toFixed(1)}%</p>
            </div>
            <div className="w-full h-4 bg-lumos-text-primary/5 rounded-full overflow-hidden border border-lumos-border p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  consumptionPercentProd > 90
                    ? 'bg-red-500'
                    : consumptionPercentProd > 70
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(consumptionPercentProd, 100)}%` }}
              />
            </div>
          </div>
        )
      ) : (
        tetoCustos > 0 && (
          <div className="card p-6 space-y-4">
            <div className="flex justify-between items-end">
              <p className="text-[10px] font-bold text-lumos-text-secondary uppercase">Uso do Budget da Produção</p>
              <p className="text-xs font-black text-lumos-text-primary">{consumptionPercentProd.toFixed(1)}%</p>
            </div>
            <div className="w-full h-4 bg-lumos-text-primary/5 rounded-full overflow-hidden border border-lumos-border p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  consumptionPercentProd > 90
                    ? 'bg-red-500'
                    : consumptionPercentProd > 70
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(consumptionPercentProd, 100)}%` }}
              />
            </div>
          </div>
        )
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={clsx("space-y-6", profile?.role === 'admin' ? "lg:col-span-2" : "lg:col-span-3")}>
          {/* Tabela de Equipe (Serviços e Profissionais) (Melhoria C) */}
          <div className="card overflow-hidden">
            <div className="p-4 bg-lumos-text-primary/5 border-b border-lumos-border flex justify-between items-center flex-wrap gap-2">
              <h3 className="text-sm font-bold text-lumos-text-primary uppercase tracking-wider">
                Equipe (Serviços e Profissionais)
              </h3>
              <span className="text-sm font-black text-lumos-yellow">
                Subtotal: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalEquipe)}
              </span>
            </div>
            <div className="overflow-x-auto hidden lg:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                    <th className="px-6 py-4 w-10">
                      <div
                        onClick={toggleSelectAllEquipe}
                        className={clsx(
                          'w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all',
                          equipeCosts.length > 0 && equipeCosts.every(c => selectedIds.has(c.id))
                            ? 'bg-lumos-yellow border-lumos-yellow text-lumos-bg'
                            : 'border-lumos-border hover:border-lumos-yellow/50'
                        )}
                      >
                        {equipeCosts.length > 0 && equipeCosts.every(c => selectedIds.has(c.id)) && (
                          <Check className="w-3.5 h-3.5" />
                        )}
                      </div>
                    </th>
                    <th className="px-6 py-4">Data</th>
                    <th className="px-6 py-4">Descrição</th>
                    <th className="px-6 py-4">Categoria</th>
                    <th className="px-6 py-4">Vencimento</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-right">Valor</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-lumos-border">
                  {equipeCosts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-6 py-8 text-center text-lumos-text-secondary text-sm italic"
                      >
                        Nenhum custo de equipe registrado.
                      </td>
                    </tr>
                  ) : (
                    equipeCosts.map(c => (
                      <tr
                        key={c.id}
                        className={clsx(
                          'hover:bg-lumos-text-primary/5 transition-colors cursor-pointer group',
                          selectedIds.has(c.id) && 'bg-lumos-yellow/[0.03]',
                          (c.status === 'pago' || c.paid_at) && 'opacity-65 hover:opacity-100'
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
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-lumos-text-primary">{c.description}</span>
                            {c.fornecedor?.nome && (
                              <span className="text-[10px] text-lumos-yellow font-bold uppercase tracking-widest mt-0.5">
                                Fornecedor: {c.fornecedor.nome}
                              </span>
                            )}
                          </div>
                        </td>
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
                        <td className="px-6 py-4 text-center" onClick={e => e.stopPropagation()}>
                          {c.status === 'pago' || c.paid_at ? (
                            <div className="flex flex-col items-center justify-center gap-0.5 group/paid select-none">
                              <span className="inline-flex items-center text-[9px] font-black text-green-500 uppercase bg-green-500/10 border border-green-500/20 px-2.5 py-0.5 rounded-full">
                                Pago
                              </span>
                              {c.paid_at && (
                                <span className="text-[8px] text-lumos-text-secondary font-bold tracking-wide mt-0.5">
                                  {new Date(c.paid_at).toLocaleDateString('pt-BR')}
                                  {c.paid_by_user?.full_name && ` por ${c.paid_by_user.full_name.split(' ')[0]}`}
                                </span>
                              )}
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  handleTogglePaid(c.id, false);
                                }}
                                className="hidden group-hover/paid:inline-flex items-center text-[8px] font-black text-red-500 hover:underline uppercase tracking-wider mt-0.5 cursor-pointer"
                              >
                                Desfazer
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                handleTogglePaid(c.id, true);
                              }}
                              className="inline-flex items-center text-[9px] font-black text-yellow-500 uppercase bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 hover:border-yellow-500/35 px-2.5 py-1 rounded-full transition-all cursor-pointer"
                            >
                              Marcar Pago
                            </button>
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
            {/* Mobile: cartões (a tabela acima fica só no desktop) */}
            <MobileCardList>
              {equipeCosts.length === 0 ? (
                <MobileCardEmpty>Nenhum custo de equipe registrado.</MobileCardEmpty>
              ) : equipeCosts.map(renderCostCard)}
            </MobileCardList>
          </div>

          {/* Tabela de Produção (Logística, Alimentação, Locação e Outros) (Melhoria C) */}
          <div className="card overflow-hidden">
            <div className="p-4 bg-lumos-text-primary/5 border-b border-lumos-border flex justify-between items-center flex-wrap gap-2">
              <h3 className="text-sm font-bold text-lumos-text-primary uppercase tracking-wider">
                Produção (Logística, Alimentação e Locação)
              </h3>
              <span className="text-sm font-black text-lumos-yellow">
                Subtotal: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalProducao)}
              </span>
            </div>
            <div className="overflow-x-auto hidden lg:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                    <th className="px-6 py-4 w-10">
                      <div
                        onClick={toggleSelectAllProducao}
                        className={clsx(
                          'w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all',
                          producaoCosts.length > 0 && producaoCosts.every(c => selectedIds.has(c.id))
                            ? 'bg-lumos-yellow border-lumos-yellow text-lumos-bg'
                            : 'border-lumos-border hover:border-lumos-yellow/50'
                        )}
                      >
                        {producaoCosts.length > 0 && producaoCosts.every(c => selectedIds.has(c.id)) && (
                          <Check className="w-3.5 h-3.5" />
                        )}
                      </div>
                    </th>
                    <th className="px-6 py-4">Data</th>
                    <th className="px-6 py-4">Descrição</th>
                    <th className="px-6 py-4">Categoria</th>
                    <th className="px-6 py-4">Vencimento</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-right">Valor</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-lumos-border">
                  {producaoCosts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-6 py-8 text-center text-lumos-text-secondary text-sm italic"
                      >
                        Nenhum custo de produção registrado.
                      </td>
                    </tr>
                  ) : (
                    producaoCosts.map(c => (
                      <tr
                        key={c.id}
                        className={clsx(
                          'hover:bg-lumos-text-primary/5 transition-colors cursor-pointer group',
                          selectedIds.has(c.id) && 'bg-lumos-yellow/[0.03]',
                          (c.status === 'pago' || c.paid_at) && 'opacity-65 hover:opacity-100'
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
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-lumos-text-primary">{c.description}</span>
                            {c.fornecedor?.nome && (
                              <span className="text-[10px] text-lumos-yellow font-bold uppercase tracking-widest mt-0.5">
                                Fornecedor: {c.fornecedor.nome}
                              </span>
                            )}
                          </div>
                        </td>
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
                        <td className="px-6 py-4 text-center" onClick={e => e.stopPropagation()}>
                          {c.status === 'pago' || c.paid_at ? (
                            <div className="flex flex-col items-center justify-center gap-0.5 group/paid select-none">
                              <span className="inline-flex items-center text-[9px] font-black text-green-500 uppercase bg-green-500/10 border border-green-500/20 px-2.5 py-0.5 rounded-full">
                                Pago
                              </span>
                              {c.paid_at && (
                                <span className="text-[8px] text-lumos-text-secondary font-bold tracking-wide mt-0.5">
                                  {new Date(c.paid_at).toLocaleDateString('pt-BR')}
                                  {c.paid_by_user?.full_name && ` por ${c.paid_by_user.full_name.split(' ')[0]}`}
                                </span>
                              )}
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  handleTogglePaid(c.id, false);
                                }}
                                className="hidden group-hover/paid:inline-flex items-center text-[8px] font-black text-red-500 hover:underline uppercase tracking-wider mt-0.5 cursor-pointer"
                              >
                                Desfazer
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                handleTogglePaid(c.id, true);
                              }}
                              className="inline-flex items-center text-[9px] font-black text-yellow-500 uppercase bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 hover:border-yellow-500/35 px-2.5 py-1 rounded-full transition-all cursor-pointer"
                            >
                              Marcar Pago
                            </button>
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
            {/* Mobile: cartões (a tabela acima fica só no desktop) */}
            <MobileCardList>
              {producaoCosts.length === 0 ? (
                <MobileCardEmpty>Nenhum custo de produção registrado.</MobileCardEmpty>
              ) : producaoCosts.map(renderCostCard)}
            </MobileCardList>
          </div>
        </div>

        {/* Sidebar Panel for Admin only */}
        {profile?.role === 'admin' && projectFinanceiro && (
          <div className="space-y-6">
            <div className="card p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-lumos-text-primary uppercase tracking-wider flex items-center gap-2">
                  <Target className="w-4 h-4 text-lumos-yellow" /> Dados Financeiros
                </h3>
                {!isEditingFinance ? (
                  <div className="flex items-center gap-3">
                    {/* Combinado de pagamento costuma vir depois do fechamento:
                        é aqui, no financeiro, que ele vira parcela de verdade. */}
                    {project?.budget_id && (
                      <button
                        onClick={() => setParcelando(true)}
                        title="Definir como o cliente vai pagar (vira parcela com vencimento)"
                        className="text-xs text-lumos-text-secondary hover:text-lumos-yellow font-bold flex items-center gap-1 uppercase tracking-wider"
                      >
                        <CalendarClock className="w-3.5 h-3.5" /> Parcelamento
                      </button>
                    )}
                    <button
                      onClick={() => setIsEditingFinance(true)}
                      className="text-xs text-lumos-yellow hover:underline font-bold flex items-center gap-1 uppercase tracking-wider text-right"
                    >
                      <Pencil className="w-3.5 h-3.5 inline mr-1" /> Editar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setIsEditingFinance(false);
                      setFinanceForm({
                        cliente_id: projectFinanceiro.cliente_id || '',
                        categoria_id: projectFinanceiro.categoria_id || '',
                        tipo_servico_id: projectFinanceiro.tipo_servico_id || '',
                        icp: projectFinanceiro.icp || '',
                        data_recebimento_negociada: projectFinanceiro.data_recebimento_negociada || '',
                        status_titulo: projectFinanceiro.status_titulo || 'emitir_nf',
                        data_recebido: projectFinanceiro.data_recebido || '',
                        nf_percent: projectFinanceiro.nf_percent || 0.18,
                        valor_vendido: projectFinanceiro.valor_vendido || 0
                      });
                    }}
                    className="text-xs text-lumos-text-secondary hover:underline font-bold uppercase tracking-wider"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              {projectFinanceiro.pendente_preenchimento && (
                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lumos flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-black text-red-400 uppercase tracking-wider">Atenção Comercial</p>
                    <p className="text-[11px] text-lumos-text-secondary">
                      Preencha Cliente, Categoria, Tipo de Serviço e ICP para liberar os relatórios.
                    </p>
                  </div>
                </div>
              )}

              {isEditingFinance ? (
                <form onSubmit={handleSaveFinance} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Cliente *</label>
                    <Select className="input-lumos w-full" value={financeForm.cliente_id} onChange={v => setFinanceForm({ ...financeForm, cliente_id: v })} placeholder="Selecione um cliente"
                      options={[{ value: '', label: 'Selecione um cliente' }, ...clients.map(c => ({ value: c.id, label: c.name }))]} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Valor Vendido *</label>
                    <CurrencyInput
                      className="input-lumos w-full font-bold"
                      value={financeForm.valor_vendido}
                      onChange={(val: number) => setFinanceForm({ ...financeForm, valor_vendido: val })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Alíquota NF (%) *</label>
                    <input
                      type="number"
                      step="0.1"
                      className="input-lumos w-full"
                      value={(financeForm.nf_percent * 100)}
                      onChange={e => setFinanceForm({ ...financeForm, nf_percent: parseFloat(e.target.value) / 100 || 0 })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">ICP</label>
                    <Select className="input-lumos w-full" value={financeForm.icp} onChange={v => setFinanceForm({ ...financeForm, icp: v })} placeholder="Selecione"
                      options={[{ value: '', label: 'Selecione' }, { value: 'icp_1', label: 'ICP 1' }, { value: 'icp_2', label: 'ICP 2' }]} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Categoria</label>
                    <Select className="input-lumos w-full" value={financeForm.categoria_id} onChange={v => setFinanceForm({ ...financeForm, categoria_id: v, tipo_servico_id: '' })} placeholder="Selecione"
                      options={[{ value: '', label: 'Selecione' }, ...financeCategorias.map(c => ({ value: c.id, label: c.nome }))]} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Tipo de Serviço</label>
                    <Select className="input-lumos w-full" value={financeForm.tipo_servico_id} onChange={v => setFinanceForm({ ...financeForm, tipo_servico_id: v })} disabled={!financeForm.categoria_id} placeholder="Selecione"
                      options={[{ value: '', label: 'Selecione' }, ...financeTiposServico.filter(s => s.categoria_id === financeForm.categoria_id).map(s => ({ value: s.id, label: s.nome }))]} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Vencimento Negociado</label>
                    <input
                      type="date"
                      className="input-lumos w-full"
                      value={financeForm.data_recebimento_negociada}
                      onChange={e => setFinanceForm({ ...financeForm, data_recebimento_negociada: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Status do Título *</label>
                    <Select className="input-lumos w-full" value={financeForm.status_titulo} onChange={v => setFinanceForm({ ...financeForm, status_titulo: v })}
                      options={[{ value: 'emitir_nf', label: 'Emitir NF' }, { value: 'pedido_nf_feito', label: 'Pedido de NF Feito' }, { value: 'esperando_pagamento', label: 'Esperando Pagamento' }, { value: 'pagamento_atraso', label: 'Pagamento em Atraso' }, { value: 'pagamento_recebido', label: 'Pagamento Recebido' }]} />
                  </div>

                  {financeForm.status_titulo === 'pagamento_recebido' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Data do Recebimento *</label>
                      <input
                        type="date"
                        className="input-lumos w-full"
                        value={financeForm.data_recebido}
                        onChange={e => setFinanceForm({ ...financeForm, data_recebido: e.target.value })}
                        required
                      />
                    </div>
                  )}

                  <button type="submit" className="btn-primary w-full h-10 mt-2 font-bold text-xs uppercase">
                    Salvar Alterações
                  </button>
                </form>
              ) : (
                <div className="space-y-4 text-sm">
                  <div className="border-b border-lumos-border pb-3">
                    <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider mb-0.5">Cliente</p>
                    <p className="font-bold text-lumos-text-primary">
                      {clients.find(c => c.id === projectFinanceiro.cliente_id)?.name || 'Não informado'}
                    </p>
                  </div>

                  <div className="border-b border-lumos-border pb-3 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider mb-0.5">ICP</p>
                      <p className="font-bold text-lumos-text-primary">
                        {projectFinanceiro.icp ? projectFinanceiro.icp.toUpperCase().replace('_', ' ') : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider mb-0.5">Status de NF/Pgto</p>
                      <span className={clsx(
                        'inline-flex items-center text-[10px] font-black uppercase px-2 py-0.5 rounded-full mt-0.5',
                        projectFinanceiro.status_titulo === 'pagamento_recebido' ? 'bg-green-500/10 text-green-500' :
                        projectFinanceiro.status_titulo === 'pagamento_atraso' || projectFinanceiro.vencido ? 'bg-red-500/10 text-red-500' :
                        'bg-yellow-500/10 text-yellow-500'
                      )}>
                        {projectFinanceiro.vencido ? 'Atrasado' :
                         projectFinanceiro.status_titulo === 'emitir_nf' ? 'Emitir NF' :
                         projectFinanceiro.status_titulo === 'pedido_nf_feito' ? 'Pedido NF Feito' :
                         projectFinanceiro.status_titulo === 'esperando_pagamento' ? 'Aguardando Pgto' :
                         projectFinanceiro.status_titulo === 'pagamento_atraso' ? 'Atrasado' :
                         projectFinanceiro.status_titulo === 'pagamento_recebido' ? 'Recebido' : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="border-b border-lumos-border pb-3 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider mb-0.5">Categoria</p>
                      <p className="font-bold text-lumos-text-primary">{projectFinanceiro.categoria?.nome || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider mb-0.5">Tipo de Serviço</p>
                      <p className="font-bold text-lumos-text-primary">{projectFinanceiro.tipo_servico?.nome || '—'}</p>
                    </div>
                  </div>

                  {/* Cascata de Rentabilidade (Melhoria B - Corrigido) */}
                  <div className="space-y-4 bg-lumos-bg/30 p-4 rounded-lumos border border-lumos-border">
                    <h4 className="text-xs font-black text-lumos-yellow uppercase tracking-widest mb-2 flex items-center justify-between gap-1.5">
                      <span className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4" /> Cascata de Rentabilidade</span>
                      {!project.budget_id && (
                        <span className="text-[9px] font-bold bg-lumos-yellow/10 text-lumos-yellow px-1.5 py-0.2 rounded uppercase">Estimado</span>
                      )}
                    </h4>
                    
                    {/* Passo 1: Orçamento Bruto */}
                    <div className="flex justify-between items-center text-sm border-b border-lumos-border/50 pb-2">
                      <span className="text-lumos-text-secondary">1. Faturamento Bruto (Orçamento)</span>
                      <span className="font-bold text-lumos-text-primary">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(faturamentoBruto)}
                      </span>
                    </div>

                    {/* Passo 2: Imposto (NF) */}
                    <div className="flex justify-between items-center text-sm border-b border-lumos-border/50 pb-2">
                      <span className="text-lumos-text-secondary flex flex-col">
                        <span>2. Imposto NF</span>
                        <span className="text-[10px] text-lumos-text-secondary/60">Alíquota: {(nfPct * 100).toFixed(1)}%</span>
                      </span>
                      <span className="font-bold text-red-400">
                        - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(impostoNF)}
                      </span>
                    </div>

                    {/* Passo 3: Faturamento Líquido */}
                    <div className="flex justify-between items-center text-sm border-b border-lumos-border/50 pb-2 bg-lumos-yellow/[0.02] px-2 py-1 rounded">
                      <span className="text-lumos-text-primary font-bold">3. Faturamento Líquido</span>
                      <span className="font-extrabold text-lumos-text-primary">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(faturamentoLiquido)}
                      </span>
                    </div>

                    {/* Passo 4: Margem Comercial Estimada */}
                    <div className="flex justify-between items-center text-sm border-b border-lumos-border/50 pb-2">
                      <span className="text-lumos-text-secondary flex flex-col">
                        <span>4. Margem Orçada (Comercial)</span>
                        <span className="text-[10px] text-lumos-text-secondary/60">Teto de Custo Estimado: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(tetoCustos)}</span>
                      </span>
                      <span className="font-bold text-lumos-text-secondary">
                        {(marginPct * 100).toFixed(1)}%
                      </span>
                    </div>

                    {/* Passo 5: Custos Totais Reais */}
                    <div className="flex justify-between items-center text-sm border-b border-lumos-border/50 pb-2">
                      <span className="text-lumos-text-secondary flex flex-col">
                        <span>5. Custos Totais Reais</span>
                        <span className="text-[10px] text-lumos-text-secondary/60">
                          Diferença vs. Teto:{' '}
                          <span className={remainingCosts >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>
                            {remainingCosts >= 0 ? 'sobrou ' : 'estourou '}
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(remainingCosts))}
                          </span>
                        </span>
                      </span>
                      <span className="font-bold text-red-400">
                        - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalCosts)}
                      </span>
                    </div>

                    {/* Passo 6: Lucros (Líquido com NF e Operacional sem NF) */}
                    <div className={clsx(
                      "flex justify-between items-center text-sm border-b border-lumos-border/50 pb-2 px-2 py-1 rounded",
                      lucroLiquidoReal >= 0 ? "bg-green-500/5" : "bg-red-500/5"
                    )}>
                      <span className="text-lumos-text-primary flex flex-col">
                        <span className="font-bold">6. Lucro Líquido Real (com NF)</span>
                        <span className="text-[9px] text-lumos-text-secondary/60">Dedução: Faturamento Líquido − Custo Real</span>
                      </span>
                      <span className={clsx("font-black text-sm", lucroLiquidoReal >= 0 ? "text-green-500" : "text-red-500")}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lucroLiquidoReal)}
                      </span>
                    </div>

                    <div className={clsx(
                      "flex justify-between items-center text-sm border-b border-lumos-border/50 pb-2 px-2 py-1 rounded",
                      lucroOperacionalReal >= 0 ? "bg-green-500/5" : "bg-red-500/5"
                    )}>
                      <span className="text-lumos-text-primary flex flex-col">
                        <span className="font-bold">7. Lucro Operacional (sem NF)</span>
                        <span className="text-[9px] text-lumos-text-secondary/60">Dedução: Faturamento Bruto − Custo Real</span>
                      </span>
                      <span className={clsx("font-black text-sm", lucroOperacionalReal >= 0 ? "text-green-500" : "text-red-500")}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lucroOperacionalReal)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-b border-lumos-border/50 pb-3 pt-1">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-lumos-text-secondary uppercase">Markup Real</span>
                        <span className="font-extrabold text-sm text-lumos-text-primary mt-0.5">
                          {markupReal.toFixed(1)}%
                        </span>
                        <span className="text-[9px] text-lumos-text-secondary/60 leading-snug mt-1">
                          Lucro sobre o custo real. Compare com a Margem Orçada (mesma base).
                        </span>
                      </div>
                      
                      <div className="flex flex-col border-l border-lumos-border/50 pl-3">
                        <span className="text-[11px] font-bold text-lumos-text-secondary uppercase">Margem s/ Fat.</span>
                        <span className="font-extrabold text-sm text-lumos-text-primary mt-0.5">
                          {margemFaturamento.toFixed(1)}%
                        </span>
                        <span className="text-[9px] text-lumos-text-secondary/60 leading-snug mt-1">
                          Lucro sobre o faturamento total. Visão contábil.
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2 text-xs">
                      <div>
                        <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider mb-0.5">Vencimento Negociado</p>
                        <p className="font-bold text-lumos-text-primary">
                          {projectFinanceiro.data_recebimento_negociada 
                            ? new Date(projectFinanceiro.data_recebimento_negociada + 'T00:00:00').toLocaleDateString('pt-BR')
                            : '—'}
                        </p>
                      </div>
                      {projectFinanceiro.status_titulo === 'pagamento_recebido' && projectFinanceiro.data_recebido && (
                        <div>
                          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider mb-0.5">Data do Pagamento</p>
                          <p className="font-bold text-green-500">
                            {new Date(projectFinanceiro.data_recebido + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
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
      {parcelando && project?.budget_id && (
        <ParcelamentoModal
          budgetId={project.budget_id}
          nomeProjeto={project.name}
          onClose={() => setParcelando(false)}
          onDone={() => fetchProjectData()}
        />
      )}

      {encerrandoProj && finRegistro && (
        <EncerrarProjetoModal
          proj={{
            id: finRegistro.id,
            name: project.name,
            project_id: id!,
            budget_id: project.budget_id || finRegistro.proposta_id,
            encerrado_em: finRegistro.encerrado_em,
          }}
          onClose={() => setEncerrandoProj(false)}
          onDone={() => {
            setEncerrandoProj(false);
            fetchProjectData();
          }}
        />
      )}

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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest font-semibold">Fornecedor (Opcional)</label>
              <Select className="input-lumos w-full" value={selectedFornecedorId} onChange={handleFornecedorChange} placeholder="Nenhum fornecedor"
                options={[{ value: '', label: 'Nenhum fornecedor' }, ...fornecedores.map(f => ({ value: f.id, label: f.nome }))]} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest font-semibold">Serviço do Fornecedor</label>
              <Select className="input-lumos w-full" value={selectedServicoId} disabled={!selectedFornecedorId} onChange={handleServicoChange} placeholder="Selecione um serviço"
                options={[{ value: '', label: 'Selecione um serviço' }, ...services.map(s => ({ value: s.id, label: `${s.tipo_servico} — ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(s.valor || 0)}` }))]} />
            </div>
          </div>

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
              <Select className="input-lumos w-full" value={duePreset} onChange={applyDuePreset}
                options={[{ value: '7', label: '7 dias' }, { value: '15', label: '15 dias' }, { value: '30', label: '30 dias' }, { value: '45', label: '45 dias' }, { value: '60', label: '60 dias' }, { value: 'custom', label: 'Personalizado' }]} />
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
                <Select className="input-lumos w-full" value={formData.category}
                  onChange={v => { if (v === '__new__') setCreatingCategory(true); else setFormData({ ...formData, category: v }); }}
                  options={[...categories.map(c => ({ value: c, label: formatCategoryLabel(c) })), { value: '__new__', label: '+ Criar nova categoria' }]} />
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Responsável</label>
              <Select className="input-lumos w-full" value={formData.responsible_id} onChange={v => setFormData({ ...formData, responsible_id: v })} placeholder="Selecione"
                options={[{ value: '', label: 'Selecione' }, ...appUsers.map(u => ({ value: u.id, label: u.full_name }))]} />
            </div>
          </div>
          <div className="flex gap-3 pt-4 max-lg:sticky max-lg:-mx-6 max-lg:-mb-6 max-lg:bottom-0 max-lg:bg-lumos-surface max-lg:border-t max-lg:p-4 max-lg:pb-[calc(1rem+env(safe-area-inset-bottom))] max-lg:z-30 lg:static lg:pt-4 lg:border-0 lg:p-0">
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
            <Select className="input-lumos w-full" value={editProjectData.client_id} onChange={v => setEditProjectData({ ...editProjectData, client_id: v })} placeholder="Sem cliente"
              options={[{ value: '', label: 'Sem cliente' }, ...clients.map(c => ({ value: c.id, label: c.name }))]} />
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
