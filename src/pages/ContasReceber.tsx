import React, { useEffect, useState } from 'react';
import {
  ArrowDownCircle,
  Search,
  CheckCircle2,
  Calendar,
  Building2,
  FileText,
  DollarSign,
  Plus,
  Trash2,
  Check,
  AlertTriangle,
  FileDown,
  ChevronUp,
  ChevronDown,
  Pencil,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { formatBudgetCode } from '@/utils/formatters';
import { Link } from 'react-router-dom';
import Modal from '@/components/common/Modal';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { notify, getAdminUserIds } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';
import { MobileCardList, MobileCard, MobileCardSkeleton, MobileCardEmpty } from '@/components/ui/MobileCards';


const CurrencyInput = ({ value, onChange, className }: any) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, "");
    const numberValue = rawValue ? parseInt(rawValue) / 100 : 0;
    onChange(numberValue);
  };
  const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  return <input type="text" className={className} value={formattedValue} onChange={handleChange} />;
};

export default function ContasReceber() {
  const { profile } = useAuth();
  const toast = useToast();
  const [receivables, setReceivables] = useState<any[]>([]);
  // Lucro líquido por orçamento (vw_rentabilidade), para a coluna Lucro.
  const [lucroByBudget, setLucroByBudget] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [selectedReceivable, setSelectedReceivable] = useState<any>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newReceivableData, setNewReceivableData] = useState({
    description: '',
    client_id: '',
    total_amount: 0,
    due_date: new Date().toISOString().split('T')[0],
    notes: ''
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'todos' | 'aguardando' | 'emitir_nf' | 'nf_emitida' | 'recebido' | 'atrasado'>('todos');
  const [groupByClient, setGroupByClient] = useState(false);
  // 'padrao' = ordem estável de vencimento (do banco); não reordena ao mudar status.
  const [sortConfig, setSortConfig] = useState<{ key: 'padrao' | 'projeto' | 'cliente' | 'total' | 'lucro' | 'data'; direction: 'asc' | 'desc' }>({ key: 'padrao', direction: 'asc' });
  const handleSort = (key: typeof sortConfig.key) =>
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  const SortIcon = ({ column }: { column: typeof sortConfig.key }) =>
    sortConfig.key !== column ? null
      : sortConfig.direction === 'asc'
        ? <ChevronUp className="w-3 h-3 text-lumos-yellow" />
        : <ChevronDown className="w-3 h-3 text-lumos-yellow" />;
  const [paymentData, setPaymentData] = useState({
    amount: 0,
    received_at: new Date().toISOString().split('T')[0],
    payment_method: 'pix'
  });
  // Menu de status por linha (mesmo padrão do dropdown de status dos Orçamentos).
  const [statusMenuOpen, setStatusMenuOpen] = useState<string | null>(null);
  // Status clicáveis (fluxo). "Em atraso" NÃO entra aqui: é derivado do
  // vencimento (statusOf) e aparece sozinho em vermelho quando vence.
  const statusOptions = [
    { value: 'aguardando', label: 'Aguardando', color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20' },
    { value: 'emitir_nf', label: 'Emitir NF', color: 'text-orange-500 bg-orange-500/10 border-orange-500/20' },
    { value: 'nf_emitida', label: 'NF Emitida', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
    { value: 'recebido', label: 'Recebido', color: 'text-green-500 bg-green-500/10 border-green-500/20' },
  ];
  const statusLabels: Record<string, string> = {
    aguardando: 'Aguardando', emitir_nf: 'Emitir NF', nf_emitida: 'NF Emitida',
    recebido: 'Recebido', atrasado: 'Em atraso', parcial: 'Parcial',
  };
  const statusLabel = (s: string) => statusLabels[s] || s;
  const statusPillClass = (s: string) =>
    s === 'recebido' ? 'text-green-500 bg-green-500/10 border-green-500/20'
      : s === 'atrasado' ? 'text-red-500 bg-red-500/10 border-red-500/20'
      : s === 'nf_emitida' ? 'text-blue-500 bg-blue-500/10 border-blue-500/20'
      : s === 'emitir_nf' ? 'text-orange-500 bg-orange-500/10 border-orange-500/20'
      : 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';

  // Aplica um status pelo menu. "Recebido" preenche o valor/data; os demais
  // (aguardando, emitir_nf, nf_emitida) são diretos e zeram o recebido.
  const applyStatus = async (r: any, newStatus: string) => {
    setStatusMenuOpen(null);
    try {
      const patch = newStatus === 'recebido'
        ? { status: 'recebido', received_amount: Number(r.total_amount || 0), received_at: (r.received_at || new Date().toISOString().split('T')[0]) }
        : { status: newStatus, received_amount: 0, received_at: null };
      // Atualização otimista: muda só a linha na hora, sem recarregar a tela toda.
      setReceivables((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
      const { error } = await supabase.from('receivables').update(patch).eq('id', r.id);
      if (error) throw error;
      if (newStatus === 'recebido') {
        const admins = await getAdminUserIds();
        await notify({
          userIds: admins,
          event: NOTIFICATION_EVENTS.PAGAMENTO_RECEBIDO,
          title: 'Pagamento recebido',
          body: `${brl(Number(r.total_amount || 0))} recebido de "${r.client?.name || 'Cliente'}" para: ${r.description}.`,
          link: '/financeiro/contas-receber',
        });
      }
      fetchReceivables(true);
    } catch (error: any) { toast.error(error.message); fetchReceivables(true); }
  };

  // Edição de um recebível (descrição, cliente, valor, vencimento, data de recebimento).
  const [editing, setEditing] = useState<any | null>(null);
  const [editData, setEditData] = useState({ description: '', client_id: '', total_amount: 0, received_at: '' });

  const openEdit = (r: any) => {
    setEditData({
      description: r.description || '',
      client_id: r.client_id || '',
      total_amount: Number(r.total_amount || 0),
      received_at: r.received_at ? r.received_at.slice(0, 10) : '',
    });
    setEditing(r);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      const { error } = await supabase.from('receivables').update({
        description: editData.description.trim(),
        client_id: editData.client_id || null,
        total_amount: editData.total_amount,
        received_at: editData.received_at || null,      // só a DATA; não mexe no status/valor recebido
      }).eq('id', editing.id);
      if (error) throw error;
      toast.success('Recebível atualizado.');
      setEditing(null);
      fetchReceivables();
    } catch (error: any) { toast.error(error.message); }
  };

  useEffect(() => {
    fetchReceivables();
    fetchClients();
  }, []);

  // Tempo real: recebíveis alterados por outros usuários aparecem sem spinner
  useRealtimeRefetch(['receivables'], () => fetchReceivables(true));

  async function fetchClients() {
    const { data } = await supabase.from('clients').select('id, name').order('name');
    setClients(data || []);
  }

  async function fetchReceivables(silent = false) {
    try {
      if (!silent) setLoading(true);
      const [rec, rent] = await Promise.all([
        supabase.from('receivables').select('*, client:clients(name), budget:budgets(id, project_name, code)').order('due_date', { ascending: true }),
        supabase.from('vw_rentabilidade').select('proposta_id, lucro_liquido'),
      ]);
      if (rec.error) throw rec.error;
      setReceivables(rec.data || []);
      const map: Record<string, number> = {};
      (rent.data || []).forEach((r: any) => { if (r.proposta_id) map[r.proposta_id] = Number(r.lucro_liquido || 0); });
      setLucroByBudget(map);
    } catch (error) {
      console.error('Erro ao buscar recebíveis:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReceivable) return;
    if (paymentData.amount <= 0) {
      toast.error('O valor recebido deve ser maior que zero.');
      return;
    }
    const newReceivedAmount = Number(selectedReceivable.received_amount) + Number(paymentData.amount);
    if (newReceivedAmount > selectedReceivable.total_amount) {
      toast.error(`O valor ultrapassa o total do recebível (${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(selectedReceivable.total_amount)}).`);
      return;
    }
    const newStatus = newReceivedAmount >= selectedReceivable.total_amount ? 'recebido' : 'parcial';
    try {
      const { error } = await supabase.from('receivables').update({
        received_amount: newReceivedAmount,
        received_at: paymentData.received_at,
        payment_method: paymentData.payment_method,
        status: newStatus,
        updated_at: new Date().toISOString()
      }).eq('id', selectedReceivable.id);
      if (error) throw error;

      if (newStatus === 'recebido') {
        const admins = await getAdminUserIds();
        await notify({
          userIds: admins,
          event: NOTIFICATION_EVENTS.PAGAMENTO_RECEBIDO,
          title: 'Pagamento recebido',
          body: `Valor de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(paymentData.amount)} recebido de "${selectedReceivable.client?.name || 'Cliente'}" para: ${selectedReceivable.description}.`,
          link: '/financeiro/contas-receber'
        });
      }

      setIsPayModalOpen(false);
      fetchReceivables();
    } catch (error: any) { toast.error(error.message); }
  };


  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) {
      toast.error("Você precisa estar logado para realizar esta ação.");
      return;
    }
    try {
      const { error } = await supabase.from('receivables').insert([{
        ...newReceivableData,
        status: 'aguardando',
        received_amount: 0,
        budget_id: null,
        created_by: profile.id
      }]);
      if (error) throw error;
      setIsNewModalOpen(false);
      setNewReceivableData({ description: '', client_id: '', total_amount: 0, due_date: new Date().toISOString().split('T')[0], notes: '' });
      fetchReceivables();
    } catch (error: any) { toast.error(error.message); }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const { error } = await supabase.from('receivables').delete().eq('id', deletingId);
      if (error) throw error;
      setIsDeleteModalOpen(false);
      setDeletingId(null);
      fetchReceivables();
    } catch (error: any) { toast.error(error.message); }
  };

  const handleBatchReceive = async () => {
    const toReceive = filtered.filter(r => selectedIds.has(r.id) && r.status !== 'recebido');
    if (toReceive.length === 0) return;

    try {
      const updates = toReceive.map(r => 
        supabase.from('receivables').update({
          status: 'recebido',
          received_amount: r.total_amount,
          received_at: new Date().toISOString().split('T')[0],
          updated_at: new Date().toISOString()
        }).eq('id', r.id)
      );

      await Promise.all(updates);

      // Trigger notifications for payments received
      const admins = await getAdminUserIds();
      for (const item of toReceive) {
        await notify({
          userIds: admins,
          event: NOTIFICATION_EVENTS.PAGAMENTO_RECEBIDO,
          title: 'Pagamento recebido (Lote)',
          body: `Valor de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.total_amount)} recebido de "${item.client?.name || 'Cliente'}" para: ${item.description}.`,
          link: '/financeiro/contas-receber'
        });
      }

      setSelectedIds(new Set());
      fetchReceivables();
    } catch (error: any) { toast.error(error.message); }
  };


  const handleBatchDelete = async () => {
    const toDelete = filtered.filter(r => selectedIds.has(r.id));
    if (toDelete.length === 0) return;

    try {
      const ids = toDelete.map(r => r.id);
      const { error } = await supabase.from('receivables').delete().in('id', ids);
      if (error) throw error;
      
      setIsBatchDeleteModalOpen(false);
      setSelectedIds(new Set());
      fetchReceivables();
    } catch (error: any) { toast.error(error.message); }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(r => r.id)));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const stats = {
    toReceive: receivables.filter(r => r.status !== 'recebido').reduce((acc, r) => acc + (r.total_amount - r.received_amount), 0),
    receivedMonth: receivables.filter(r => r.received_at && new Date(r.received_at).getMonth() === new Date().getMonth()).reduce((acc, r) => acc + r.received_amount, 0),
    overdue: receivables.filter(r => r.status !== 'recebido' && r.due_date && new Date(r.due_date) < new Date()).length
  };

  // "Atrasado" não é um status na tabela — é um recebível não recebido cujo
  // vencimento já passou. Tratamos como um filtro derivado.
  const isOverdue = (r: any) => r.status !== 'recebido' && r.due_date && new Date(r.due_date) < new Date();

  const statusOf = (r: any): string => (isOverdue(r) ? 'atrasado' : r.status);

  // Código do projeto (#2026-XXX) via orçamento vinculado.
  const codeOf = (r: any): string | null => (r.budget?.code ? formatBudgetCode(r.budget.code) : null);
  // Lucro líquido do recebível (via orçamento vinculado).
  const lucroOf = (r: any): number | null => (r.budget_id != null && lucroByBudget[r.budget_id] != null ? lucroByBudget[r.budget_id] : null);
  // Data sem fuso: received_at é timestamptz (meia-noite UTC); formatar pela parte
  // da data evita o "1 dia antes" no fuso do Brasil.
  const fmtDate = (d: any): string => {
    if (!d) return '—';
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return (y && m && day) ? `${day}/${m}/${y}` : '—';
  };

  const filtered = React.useMemo(() => {
    const q = searchTerm.toLowerCase();
    let list = receivables.filter(r =>
      (r.description?.toLowerCase().includes(q)
        || r.client?.name?.toLowerCase().includes(q)
        || (codeOf(r) || '').toLowerCase().includes(q))
    );
    if (statusFilter !== 'todos') {
      list = list.filter(r => (statusFilter === 'atrasado' ? isOverdue(r) : r.status === statusFilter && !isOverdue(r)));
    }
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortConfig.key) {
        case 'projeto': return (a.description || '').localeCompare(b.description || '', 'pt-BR', { sensitivity: 'base' }) * dir;
        case 'cliente': return (a.client?.name || '').localeCompare(b.client?.name || '', 'pt-BR', { sensitivity: 'base' }) * dir;
        case 'data': {
          // Sem data sempre por último, independente da direção.
          const av = a.received_at ? String(a.received_at).slice(0, 10) : '';
          const bv = b.received_at ? String(b.received_at).slice(0, 10) : '';
          if (!av && !bv) return 0;
          if (!av) return 1;
          if (!bv) return -1;
          return av.localeCompare(bv) * dir;
        }
        case 'total': return (Number(a.total_amount || 0) - Number(b.total_amount || 0)) * dir;
        case 'lucro': return ((lucroOf(a) ?? -Infinity) - (lucroOf(b) ?? -Infinity)) * dir;
        default: return 0;
      }
    });
  }, [receivables, searchTerm, statusFilter, sortConfig, lucroByBudget]);

  // Totais do que está na tela (rodapé) e do que está selecionado (barra).
  const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const sum = (rows: any[]) => rows.reduce(
    (acc, r) => {
      acc.total += Number(r.total_amount || 0);
      acc.lucro += lucroOf(r) ?? 0;
      return acc;
    },
    { total: 0, lucro: 0 }
  );
  const totaisFiltrados = sum(filtered);
  const totaisSelecionados = sum(filtered.filter(r => selectedIds.has(r.id)));

  // Agrupamento por cliente (subtotal por cliente). Preserva a ordenação dentro de
  // cada grupo; os grupos vêm do maior saldo a receber para o menor.
  const grupos = React.useMemo(() => {
    if (!groupByClient) return [];
    const map = new Map<string, any[]>();
    filtered.forEach(r => {
      const nome = r.client?.name || 'Sem cliente';
      map.set(nome, [...(map.get(nome) || []), r]);
    });
    return [...map.entries()]
      .map(([cliente, itens]) => ({ cliente, itens, tot: sum(itens) }))
      .sort((a, b) => b.tot.saldo - a.tot.saldo);
  }, [filtered, groupByClient]);

  const renderRow = (r: any) => (
    <tr
      key={r.id}
      className={clsx(
        'hover:bg-lumos-text-primary/5 transition-colors cursor-pointer group',
        selectedIds.has(r.id) && 'bg-lumos-yellow/[0.03]'
      )}
      onClick={() => openEdit(r)}
    >
      <td className="px-6 py-4">
        <div
          onClick={(e) => toggleSelect(r.id, e)}
          className={clsx(
            'w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all',
            selectedIds.has(r.id)
              ? 'bg-lumos-yellow border-lumos-yellow text-lumos-bg'
              : 'border-lumos-border group-hover:border-lumos-yellow/50 opacity-0 group-hover:opacity-100',
            selectedIds.size > 0 && 'opacity-100'
          )}
        >
          {selectedIds.has(r.id) && <Check className="w-3.5 h-3.5" />}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2 min-w-0">
          {codeOf(r) && (
            <button
              onClick={e => { e.stopPropagation(); setSearchTerm(codeOf(r) as string); }}
              title="Filtrar por este código"
              className="text-[10px] font-black text-amber-600 dark:text-lumos-yellow bg-amber-500/10 dark:bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase tracking-tight hover:bg-amber-500/20 dark:hover:bg-lumos-yellow/20 transition-colors flex-shrink-0"
            >
              {codeOf(r)}
            </button>
          )}
          <span className="text-sm font-bold text-lumos-text-primary truncate">{r.description}</span>
        </div>
      </td>
      <td className="px-6 py-4">
        <span className="text-xs text-lumos-text-secondary flex items-center gap-1"><Building2 className="w-3 h-3 flex-shrink-0" /> {r.client?.name || '—'}</span>
      </td>
      <td className="px-6 py-4 text-right text-sm font-bold text-lumos-text-primary whitespace-nowrap">{brl(Number(r.total_amount || 0))}</td>
      <td className="px-6 py-4 text-right whitespace-nowrap">
        {lucroOf(r) != null
          ? <span className={clsx('text-sm font-black', (lucroOf(r) as number) >= 0 ? 'text-green-500' : 'text-red-500')}>{brl(lucroOf(r) as number)}</span>
          : <span className="text-sm text-lumos-text-secondary/50">—</span>}
      </td>
      <td className="px-6 py-4 text-center">
        <div className="flex justify-center relative" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setStatusMenuOpen(statusMenuOpen === r.id ? null : r.id)}
            className={clsx('px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border transition-all hover:scale-105 active:scale-95', statusPillClass(statusOf(r)))}
          >
            {statusLabel(statusOf(r))}
          </button>
          {statusMenuOpen === r.id && (
            <>
              <div className="fixed inset-0 z-[40]" onClick={() => setStatusMenuOpen(null)} />
              <div className="absolute top-9 left-1/2 -translate-x-1/2 w-44 bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl z-[50] py-1 animate-in fade-in zoom-in-95 duration-150">
                {statusOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => applyStatus(r, opt.value)}
                    className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-lumos-bg transition-colors"
                  >
                    <span className={opt.color + ' px-2 py-0.5 rounded-full border'}>{opt.label}</span>
                    {r.status === opt.value && <Check className="w-3.5 h-3.5 text-lumos-yellow" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-sm text-lumos-text-secondary whitespace-nowrap">{fmtDate(r.received_at)}</td>
      <td className="px-6 py-4 text-right">
        <div className="flex justify-end items-center gap-1" onClick={e => e.stopPropagation()}>
          <button onClick={() => openEdit(r)} title="Editar" className="p-2 text-lumos-text-secondary hover:text-lumos-yellow rounded transition-colors"><Pencil className="w-4 h-4" /></button>
          {r.budget_id && <Link to={`/orcamentos/${r.budget_id}`} title="Ver orçamento" className="p-2 text-lumos-text-secondary hover:text-lumos-text-primary rounded"><FileText className="w-4 h-4" /></Link>}
          <button onClick={() => { setDeletingId(r.id); setIsDeleteModalOpen(true); }} title="Excluir" className="p-2 text-lumos-text-secondary hover:text-red-500 rounded transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );

  // Mesma linha, em formato de cartão para o celular.
  const renderMobileCard = (r: any) => (
    <MobileCard key={r.id} onClick={() => openEdit(r)}>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          {codeOf(r) && (
            <span className="text-[10px] font-black text-amber-600 dark:text-lumos-yellow bg-amber-500/10 dark:bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase tracking-tight">
              {codeOf(r)}
            </span>
          )}
        </div>
        <span className={clsx('px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border whitespace-nowrap', statusPillClass(statusOf(r)))}>
          {statusLabel(statusOf(r))}
        </span>
      </div>
      <div className="font-bold text-lumos-text-primary text-[15px] leading-snug truncate">{r.description}</div>
      <div className="text-[11px] text-lumos-text-secondary flex items-center gap-1 truncate mt-0.5 mb-2">
        <Building2 className="w-3 h-3 flex-shrink-0" /> {r.client?.name || '—'}
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-black font-mono text-sm text-lumos-text-primary whitespace-nowrap">{brl(Number(r.total_amount || 0))}</span>
          {lucroOf(r) != null && (
            <span className={clsx('text-[11px] font-bold whitespace-nowrap', (lucroOf(r) as number) >= 0 ? 'text-green-500' : 'text-red-500')}>
              {brl(lucroOf(r) as number)}
            </span>
          )}
        </div>
        <span className="text-[11px] text-lumos-text-secondary whitespace-nowrap">{fmtDate(r.received_at)}</span>
      </div>
    </MobileCard>
  );

  return (
    <div className="space-y-6 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Contas a Receber</h1>
          <p className="text-lumos-text-secondary text-sm">Controle de faturamento e entradas de projetos.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const rows = filtered.map(r => ({
                'Código': codeOf(r) || '',
                'Projeto': r.description || '',
                'Cliente': r.client?.name || '',
                'Valor (R$)': r.total_amount,
                'Lucro Líquido (R$)': lucroOf(r) ?? '',
                'Status': statusLabel(statusOf(r)).toUpperCase(),
                'Recebimento': fmtDate(r.received_at),
              }));
              const ws = XLSX.utils.json_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Contas a Receber');
              XLSX.writeFile(wb, `contas-receber-${new Date().toISOString().slice(0,10)}.xlsx`);
            }}
            className="btn-secondary h-10 px-4 flex items-center gap-2 text-sm"
          >
            <FileDown className="w-4 h-4" /> Excel
          </button>
          <button onClick={() => setIsNewModalOpen(true)} className="btn-primary h-10 px-6 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Novo Recebível
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-6 border-l-4 border-blue-500 shadow-lg">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">Total a Receber</p>
          <p className="text-2xl font-black text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.toReceive)}</p>
        </div>
        <div className="card p-6 border-l-4 border-green-500 shadow-lg">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">Recebido no Mês</p>
          <p className="text-2xl font-black text-lumos-text-primary">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.receivedMonth)}</p>
        </div>
        <div className="card p-6 border-l-4 border-red-500 shadow-lg">
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase mb-1">Títulos em Atraso</p>
          <p className="text-2xl font-black text-red-500">{stats.overdue}</p>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
          <input type="text" placeholder="Buscar por código, projeto ou cliente..." className="input-lumos pl-10 w-full h-10" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>

        {/* Filtro por status (Atrasado é derivado do vencimento) + agrupar por cliente */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setGroupByClient(v => !v)}
            aria-pressed={groupByClient}
            className={clsx(
              'order-last ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-full border text-[11px] font-bold whitespace-nowrap transition-colors',
              groupByClient
                ? 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/40'
                : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary'
            )}
          >
            <Building2 className="w-3.5 h-3.5" /> Agrupar por cliente
          </button>
          {([
            ['todos', 'Todos'],
            ['aguardando', 'Aguardando'],
            ['emitir_nf', 'Emitir NF'],
            ['nf_emitida', 'NF Emitida'],
            ['recebido', 'Recebido'],
            ['atrasado', 'Em atraso'],
          ] as const).map(([key, label]) => {
            const count = key === 'todos'
              ? receivables.length
              : key === 'atrasado'
                ? receivables.filter(isOverdue).length
                : receivables.filter(r => r.status === key && !isOverdue(r)).length;
            const active = statusFilter === key;
            const danger = key === 'atrasado';
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={clsx(
                  'px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors',
                  active
                    ? danger
                      ? 'bg-red-500/15 text-red-500 border-red-500/30'
                      : 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/40'
                    : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary'
                )}
              >
                {label} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto hidden lg:block">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                <th className="px-6 py-4 w-10">
                  <div 
                    onClick={toggleSelectAll}
                    className={clsx(
                      "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all",
                      selectedIds.size === filtered.length && filtered.length > 0
                        ? "bg-lumos-yellow border-lumos-yellow text-lumos-bg"
                        : "border-lumos-border hover:border-lumos-yellow/50"
                    )}
                  >
                    {selectedIds.size === filtered.length && filtered.length > 0 && <Check className="w-3.5 h-3.5" />}
                  </div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('projeto')}>
                  <div className="flex items-center gap-1">Projeto <SortIcon column="projeto" /></div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('cliente')}>
                  <div className="flex items-center gap-1">Cliente <SortIcon column="cliente" /></div>
                </th>
                <th className="px-6 py-4 text-right cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('total')}>
                  <div className="flex items-center justify-end gap-1">Valor <SortIcon column="total" /></div>
                </th>
                <th className="px-6 py-4 text-right cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('lucro')}>
                  <div className="flex items-center justify-end gap-1">Lucro Líq. <SortIcon column="lucro" /></div>
                </th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 cursor-pointer hover:text-lumos-text-primary transition-colors" onClick={() => handleSort('data')}>
                  <div className="flex items-center gap-1">Recebimento <SortIcon column="data" /></div>
                </th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border">
              {loading ? (
                <tr><td colSpan={8} className="py-12 text-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-lumos-text-secondary text-sm italic">Nenhum recebível encontrado com esse filtro.</td></tr>
              ) : groupByClient ? (
                grupos.map(g => (
                  <React.Fragment key={g.cliente}>
                    <tr className="bg-lumos-text-primary/[0.06] border-y border-lumos-border">
                      <td />
                      <td colSpan={2} className="px-6 py-2.5">
                        <span className="text-xs font-black uppercase tracking-wide text-lumos-text-primary flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-lumos-yellow" /> {g.cliente}
                          <span className="text-[10px] font-bold text-lumos-text-secondary/70">({g.itens.length})</span>
                        </span>
                      </td>
                      <td className="px-6 py-2.5 text-right text-xs font-black text-lumos-text-primary">{brl(g.tot.total)}</td>
                      <td className="px-6 py-2.5 text-right text-xs font-bold text-green-500">{brl(g.tot.lucro)}</td>
                      <td colSpan={3} />
                    </tr>
                    {g.itens.map(renderRow)}
                  </React.Fragment>
                ))
              ) : (
                filtered.map(renderRow)
              )}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-lumos-border bg-lumos-text-primary/5 font-black">
                  <td />
                  <td colSpan={2} className="px-6 py-4 text-[11px] uppercase tracking-widest text-lumos-text-secondary">
                    Total ({filtered.length} {filtered.length === 1 ? 'título' : 'títulos'})
                  </td>
                  <td className="px-6 py-4 text-right text-sm text-lumos-text-primary">{brl(totaisFiltrados.total)}</td>
                  <td className="px-6 py-4 text-right text-sm text-green-500">{brl(totaisFiltrados.lucro)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Mobile: cartões (a tabela acima fica só no desktop) */}
        <MobileCardList>
          {loading ? (
            <MobileCardSkeleton rows={6} />
          ) : filtered.length === 0 ? (
            <MobileCardEmpty>Nenhum recebível encontrado com esse filtro.</MobileCardEmpty>
          ) : groupByClient ? (
            grupos.map(g => (
              <React.Fragment key={g.cliente}>
                <div className="px-4 py-2 bg-lumos-text-primary/[0.06] flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wide text-lumos-text-primary flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-lumos-yellow" /> {g.cliente}
                    <span className="text-[10px] font-bold text-lumos-text-secondary/70">({g.itens.length})</span>
                  </span>
                  <span className="text-[11px] font-black text-lumos-text-primary whitespace-nowrap">{brl(g.tot.total)}</span>
                </div>
                {g.itens.map(renderMobileCard)}
              </React.Fragment>
            ))
          ) : (
            filtered.map(renderMobileCard)
          )}
          {!loading && filtered.length > 0 && (
            <div className="px-4 py-3 bg-lumos-text-primary/5 flex items-center justify-between gap-3 font-black">
              <span className="text-[10px] uppercase tracking-widest text-lumos-text-secondary">
                Total ({filtered.length} {filtered.length === 1 ? 'título' : 'títulos'})
              </span>
              <span className="text-sm text-lumos-text-primary whitespace-nowrap">{brl(totaisFiltrados.total)}</span>
            </div>
          )}
        </MobileCardList>
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-lumos-surface border border-lumos-yellow/20 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-full px-6 py-4 flex items-center gap-6 backdrop-blur-xl">
            <div className="flex items-center gap-3 pr-6 border-r border-lumos-border">
              <div className="w-8 h-8 rounded-full bg-lumos-yellow/20 flex items-center justify-center font-black text-lumos-yellow text-sm">
                {selectedIds.size}
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-tight">
                  {selectedIds.size === 1 ? 'selecionado' : 'selecionados'} · valor
                </span>
                <span className="text-base font-black text-lumos-yellow tabular-nums">{brl(totaisSelecionados.total)}</span>
              </div>
            </div>
            {totaisSelecionados.lucro !== 0 && (
              <div className="flex flex-col leading-tight pr-6 border-r border-lumos-border">
                <span className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-tight">lucro líq.</span>
                <span className="text-base font-black text-green-500 tabular-nums">{brl(totaisSelecionados.lucro)}</span>
              </div>
            )}
            
            <div className="flex items-center gap-3">
              <button 
                onClick={handleBatchReceive}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-lumos-yellow text-lumos-bg font-black text-xs uppercase hover:scale-105 active:scale-95 transition-all"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Marcar Recebido
              </button>
              
              <button 
                onClick={() => setIsBatchDeleteModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 text-red-500 font-black text-xs uppercase hover:bg-red-500 hover:text-white transition-all active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Excluir
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
      <Modal
        isOpen={isBatchDeleteModalOpen}
        onClose={() => setIsBatchDeleteModalOpen(false)}
        title="Excluir Recebíveis"
      >
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-1">
              <p className="text-lumos-text-primary font-bold">Confirma a exclusão em lote?</p>
              <p className="text-xs text-lumos-text-secondary">Você selecionou {selectedIds.size} recebíveis para exclusão permanente. Esta ação não pode ser desfeita.</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsBatchDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleBatchDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">Sim, Excluir</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isPayModalOpen} onClose={() => setIsPayModalOpen(false)} title="Registrar Recebimento">
        <form onSubmit={handleRegisterPayment} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase">Valor Recebido (R$)</label>
            <CurrencyInput className="input-lumos w-full font-bold" value={paymentData.amount} onChange={(val: number) => setPaymentData({...paymentData, amount: val})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Data</label>
              <input type="date" className="input-lumos w-full" value={paymentData.received_at} onChange={e => setPaymentData({...paymentData, received_at: e.target.value})} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Forma</label>
              <select className="input-lumos w-full" value={paymentData.payment_method} onChange={e => setPaymentData({...paymentData, payment_method: e.target.value})}>
                <option value="pix">PIX</option>
                <option value="boleto">Boleto</option>
                <option value="transferencia">Transferência</option>
              </select>
            </div>
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsPayModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 h-10">Confirmar</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} title="Novo Recebível Manual">
        <form onSubmit={handleCreateManual} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Descrição</label>
            <input required type="text" className="input-lumos w-full" placeholder="Ex: Adiantamento Projeto X" value={newReceivableData.description} onChange={e => setNewReceivableData({...newReceivableData, description: e.target.value})} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Cliente</label>
            <select required className="input-lumos w-full" value={newReceivableData.client_id} onChange={e => setNewReceivableData({...newReceivableData, client_id: e.target.value})}>
              <option value="">Selecione um cliente</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Valor Total (R$)</label>
              <CurrencyInput className="input-lumos w-full font-bold" value={newReceivableData.total_amount} onChange={(val: number) => setNewReceivableData({...newReceivableData, total_amount: val})} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Vencimento</label>
              <input required type="date" className="input-lumos w-full" value={newReceivableData.due_date} onChange={e => setNewReceivableData({...newReceivableData, due_date: e.target.value})} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Observações</label>
            <textarea className="input-lumos w-full h-20 py-2" value={newReceivableData.notes} onChange={e => setNewReceivableData({...newReceivableData, notes: e.target.value})} />
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsNewModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 h-10">Cadastrar Recebível</button>
          </div>
        </form>
      </Modal>

      {/* Editar recebível — estilo dos modais de Produção (overlay custom, lumos) */}
      {editing && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setEditing(null)}>
          <form
            onClick={e => e.stopPropagation()}
            onSubmit={handleSaveEdit}
            className="w-full max-w-md bg-lumos-surface border border-lumos-border rounded-lumos shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black uppercase tracking-tight text-lumos-text-primary flex items-center gap-2">
                <Pencil className="w-4 h-4 text-lumos-yellow" /> Editar recebível
              </h3>
              <button type="button" onClick={() => setEditing(null)} className="p-1.5 rounded-full text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Descrição</label>
              <input required type="text" className="input-lumos w-full h-10 text-sm" value={editData.description} onChange={e => setEditData({ ...editData, description: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Cliente</label>
              <select className="input-lumos w-full h-10 text-sm cursor-pointer" value={editData.client_id} onChange={e => setEditData({ ...editData, client_id: e.target.value })}>
                <option value="">Sem cliente</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Valor Total (R$)</label>
                <CurrencyInput className="input-lumos w-full h-10 text-sm font-bold" value={editData.total_amount} onChange={(val: number) => setEditData({ ...editData, total_amount: val })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Data de recebimento</label>
                <input type="date" className="input-lumos w-full h-10 text-sm" value={editData.received_at} onChange={e => setEditData({ ...editData, received_at: e.target.value })} />
              </div>
            </div>
            <p className="text-[10px] text-lumos-text-secondary/60 -mt-1">Quando o valor será/foi recebido. Para marcar como recebido, use o status.</p>

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setEditing(null)} className="btn-secondary flex-1 h-10 text-sm">Cancelar</button>
              <button type="submit" className="btn-primary flex-1 h-10 text-sm font-bold">Salvar</button>
            </div>
          </form>
        </div>
      )}

      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Excluir Recebível">
        <div className="space-y-4">
          <p className="text-sm text-lumos-text-secondary">Tem certeza que deseja excluir este recebível? Esta ação não pode ser desfeita.</p>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">Confirmar Exclusão</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
