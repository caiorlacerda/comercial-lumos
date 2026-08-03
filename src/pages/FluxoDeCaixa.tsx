import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Plus,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import Select from '@/components/ui/Select';
import Modal from '@/components/common/Modal';
import { useToast } from '@/context/ToastContext';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CashFlowEntry {
  id: string;
  data: string;
  tipo: 'entrada' | 'saida';
  valor: number;
  descricao: string;
  cliente_id: string;
  categoria_id: string;
  tipo_servico_id: string;
  projeto_financeiro_id: string | null;
  notes?: string | null;
}

interface Transaction {
  id: string;
  date: string;
  type: 'entrada' | 'saida';
  amount: number;
  description: string;
  source: 'Recebível' | 'Despesa' | 'Custo de Projeto' | 'Reembolso' | 'Manual';
}

interface MonthData {
  monthIndex: number; // 0-11
  label: string; // Jan, Fev, ...
  entradas: number;
  saidas: number;
  resultado: number;
  saldoAcumulado: number;
  transactions: Transaction[];
  isProjected: boolean;
}

interface EntryFormData {
  entry_date: string;
  type: 'entrada' | 'saida';
  amount: number;
  description: string;
  cliente_id: string;
  categoria_id: string;
  tipo_servico_id: string;
  projeto_financeiro_id: string;
  notes: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MONTH_NAMES_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const formatBRL = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

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

const SOURCE_COLORS: Record<string, string> = {
  'Recebível': 'bg-green-500/10 text-green-500 border-green-500/20',
  'Despesa': 'bg-red-500/10 text-red-500 border-red-500/20',
  'Custo de Projeto': 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  'Reembolso': 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  'Manual': 'bg-blue-500/10 text-blue-500 border-blue-500/20',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function FluxoDeCaixa() {
  const toast = useToast();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-indexed
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Raw data
  const [receivables, setReceivables] = useState<any[]>([]);
  const [payables, setPayables] = useState<any[]>([]);
  const [projectCosts, setProjectCosts] = useState<any[]>([]);
  const [reimbursements, setReimbursements] = useState<any[]>([]);
  const [cashEntries, setCashEntries] = useState<CashFlowEntry[]>([]);
  const [fixedCostsTotal, setFixedCostsTotal] = useState(0);

  // Dimensões
  const [clients, setClients] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [tiposServico, setTiposServico] = useState<any[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);

  const defaultForm: EntryFormData = {
    entry_date: new Date().toISOString().split('T')[0],
    type: 'entrada',
    amount: 0,
    description: '',
    cliente_id: '',
    categoria_id: '',
    tipo_servico_id: '',
    projeto_financeiro_id: '',
    notes: '',
  };
  const [formData, setFormData] = useState<EntryFormData>(defaultForm);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [recRes, payRes, pcRes, reimbRes, lfRes, fcRes, clientsRes, catsRes, tsRes, projRes] = await Promise.all([
        supabase.from('receivables').select('id, received_amount, received_at, status').not('received_at', 'is', null),
        supabase.from('payables').select('id, amount, paid_at, description, category').not('paid_at', 'is', null),
        supabase.from('project_costs').select('id, amount, paid_at, description, budget_id').not('paid_at', 'is', null),
        supabase.from('reimbursements').select('id, amount, paid_at, status').not('paid_at', 'is', null).eq('status', 'pago'),
        supabase.from('lancamentos_financeiros').select('*').order('data', { ascending: true }),
        supabase.from('fixed_costs').select('amount').eq('is_active', true),
        supabase.from('clients').select('id, name').order('name'),
        supabase.from('categorias').select('id, nome').eq('ativo', true).order('ordem'),
        supabase.from('tipos_servico').select('id, categoria_id, nome').eq('ativo', true).order('nome'),
        supabase.from('vw_rentabilidade').select('id, project_id, proposta_id, origem, budgets(project_name)')
      ]);

      if (lfRes.error) console.error('[FluxoDeCaixa] lancamentos_financeiros:', lfRes.error.message);
      if (fcRes.error) console.error('[FluxoDeCaixa] fixed_costs:', fcRes.error.message);

      setReceivables(recRes.data || []);
      setPayables(payRes.data || []);
      setProjectCosts(pcRes.data || []);
      setReimbursements(reimbRes.data || []);
      setCashEntries(lfRes.data || []);
      
      const fcTotal = (fcRes.data || []).reduce((acc: number, r: any) => acc + (r.amount || 0), 0);
      setFixedCostsTotal(fcTotal);

      setClients(clientsRes.data || []);
      setCategorias(catsRes.data || []);
      setTiposServico(tsRes.data || []);
      setProjectsList(projRes.data || []);

      if (lfRes.error || fcRes.error) {
        toast.error('Erro ao carregar dados. Verifique se as tabelas foram criadas no Supabase.');
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Build monthly data ───────────────────────────────────────────────────

  const monthlyData: MonthData[] = useMemo(() => {
    const months: MonthData[] = MONTH_NAMES.map((label, i) => ({
      monthIndex: i,
      label,
      entradas: 0,
      saidas: 0,
      resultado: 0,
      saldoAcumulado: 0,
      transactions: [],
      isProjected: false,
    }));

    const yearStr = String(selectedYear);

    // Receivables → entradas
    receivables.forEach(r => {
      const d = r.received_at?.slice(0, 10);
      if (!d || !d.startsWith(yearStr)) return;
      const m = parseInt(d.slice(5, 7)) - 1;
      months[m].entradas += r.received_amount || 0;
      months[m].transactions.push({
        id: r.id,
        date: d,
        type: 'entrada',
        amount: r.received_amount || 0,
        description: 'Recebimento de cliente',
        source: 'Recebível',
      });
    });

    // Payables → saídas
    payables.forEach(p => {
      const d = p.paid_at?.slice(0, 10);
      if (!d || !d.startsWith(yearStr)) return;
      const m = parseInt(d.slice(5, 7)) - 1;
      months[m].saidas += p.amount || 0;
      months[m].transactions.push({
        id: p.id,
        date: d,
        type: 'saida',
        amount: p.amount || 0,
        description: p.description || 'Despesa',
        source: 'Despesa',
      });
    });

    // Project costs → saídas
    projectCosts.forEach(pc => {
      const d = pc.paid_at?.slice(0, 10);
      if (!d || !d.startsWith(yearStr)) return;
      const m = parseInt(d.slice(5, 7)) - 1;
      months[m].saidas += pc.amount || 0;
      months[m].transactions.push({
        id: pc.id,
        date: d,
        type: 'saida',
        amount: pc.amount || 0,
        description: pc.description || 'Custo de projeto',
        source: 'Custo de Projeto',
      });
    });

    // Reimbursements → saídas
    reimbursements.forEach(r => {
      const d = r.paid_at?.slice(0, 10);
      if (!d || !d.startsWith(yearStr)) return;
      const m = parseInt(d.slice(5, 7)) - 1;
      months[m].saidas += r.amount || 0;
      months[m].transactions.push({
        id: r.id,
        date: d,
        type: 'saida',
        amount: r.amount || 0,
        description: 'Reembolso pago',
        source: 'Reembolso',
      });
    });

    // Cash flow entries
    cashEntries.forEach(ce => {
      const d = ce.data?.slice(0, 10);
      if (!d || !d.startsWith(yearStr)) return;
      const m = parseInt(d.slice(5, 7)) - 1;
      if (ce.tipo === 'entrada') {
        months[m].entradas += Number(ce.valor || 0);
      } else {
        months[m].saidas += Number(ce.valor || 0);
      }
      months[m].transactions.push({
        id: ce.id,
        date: d,
        type: ce.tipo,
        amount: Number(ce.valor || 0),
        description: ce.descricao,
        source: 'Manual',
      });
    });

    // Mark future months as projected (with fixed costs as projected saídas)
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();

    months.forEach(month => {
      const isPast = selectedYear < todayYear || (selectedYear === todayYear && month.monthIndex <= todayMonth);
      const hasData = month.entradas > 0 || month.saidas > 0 || month.transactions.length > 0;

      if (!isPast && !hasData && fixedCostsTotal > 0) {
        month.isProjected = true;
        month.saidas = fixedCostsTotal; // projected from fixed costs
      }

      month.resultado = month.entradas - month.saidas;
    });

    // Compute running saldo
    let running = 0;
    months.forEach(month => {
      running += month.resultado;
      month.saldoAcumulado = running;
    });

    // Sort transactions by date desc within each month
    months.forEach(m => {
      m.transactions.sort((a, b) => b.date.localeCompare(a.date));
    });

    return months;
  }, [receivables, payables, projectCosts, reimbursements, cashEntries, fixedCostsTotal, selectedYear]);

  // ─── Year KPIs ───────────────────────────────────────────────────────────

  const today = new Date();
  const kpis = useMemo(() => {
    const cutoffMonth = selectedYear < today.getFullYear()
      ? 11
      : selectedYear > today.getFullYear()
        ? -1
        : today.getMonth();

    const realMonths = monthlyData.filter(m => m.monthIndex <= cutoffMonth && !m.isProjected);
    const totalEntradas = realMonths.reduce((a, m) => a + m.entradas, 0);
    const totalSaidas = realMonths.reduce((a, m) => a + m.saidas, 0);
    const resultado = totalEntradas - totalSaidas;
    const saldoAcumulado = monthlyData[cutoffMonth < 0 ? 0 : cutoffMonth]?.saldoAcumulado ?? 0;
    return { totalEntradas, totalSaidas, resultado, saldoAcumulado };
  }, [monthlyData, selectedYear]);

  // ─── Chart data ──────────────────────────────────────────────────────────

  const chartData = monthlyData.map(m => ({
    mes: m.label,
    entradas: m.entradas,
    saidas: m.saidas,
    projetado: m.isProjected,
  }));

  // ─── Toggle row ──────────────────────────────────────────────────────────

  const toggleRow = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // ─── Submit new entry ─────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.description.trim()) return toast.error('Descrição é obrigatória.');
    if (formData.amount <= 0) return toast.error('Valor deve ser maior que zero.');
    if (!formData.cliente_id) return toast.error('Cliente é obrigatório.');
    if (!formData.categoria_id) return toast.error('Categoria é obrigatória.');
    if (!formData.tipo_servico_id) return toast.error('Tipo de serviço é obrigatório.');

    try {
      const { error } = await supabase.from('lancamentos_financeiros').insert([{
        data: formData.entry_date,
        tipo: formData.type,
        valor: formData.amount,
        descricao: formData.description,
        cliente_id: formData.cliente_id,
        categoria_id: formData.categoria_id,
        tipo_servico_id: formData.tipo_servico_id,
        projeto_financeiro_id: formData.projeto_financeiro_id || null,
        origem: 'manual'
      }]);
      if (error) throw error;
      toast.success('Lançamento adicionado com sucesso.');
      setIsModalOpen(false);
      setFormData(defaultForm);
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  // ─── Custom Tooltip ───────────────────────────────────────────────────────

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-3 shadow-xl text-xs">
        <p className="font-black uppercase text-lumos-text-secondary mb-2">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} className="font-bold" style={{ color: p.stroke }}>
            {p.name === 'entradas' ? 'Entradas' : 'Saídas'}: {formatBRL(p.value)}
          </p>
        ))}
      </div>
    );
  };

  // ─── Year options ─────────────────────────────────────────────────────────

  const yearOptions = [];
  for (let y = 2023; y <= currentYear + 1; y++) {
    yearOptions.push(y);
  }

  // ─── Loading skeleton ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 font-work-sans animate-pulse">
        <div className="flex justify-between">
          <div className="h-8 w-64 bg-lumos-surface rounded" />
          <div className="h-10 w-32 bg-lumos-surface rounded" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="card p-5 h-24" />)}
        </div>
        <div className="card h-56" />
        <div className="card h-80" />
      </div>
    );
  }

  return (
    <div className="space-y-6 font-work-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Fluxo de Caixa</h1>
          <p className="text-lumos-text-secondary text-sm">Entradas, saídas e saldo acumulado por mês.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select className="input-lumos h-10 px-4 text-sm" value={String(selectedYear)} onChange={v => setSelectedYear(Number(v))}
            options={yearOptions.map(y => ({ value: String(y), label: String(y) }))} />
          <button
            onClick={() => { setFormData(defaultForm); setIsModalOpen(true); }}
            className="btn-primary h-10 px-6 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Nova Entrada
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5 border-t-4 border-lumos-yellow shadow-lg">
          <div className="p-2 bg-lumos-yellow/10 rounded-lumos text-lumos-yellow w-fit mb-3">
            <Wallet className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Saldo Acumulado</p>
          <p className={clsx('text-2xl font-black mt-1 tracking-tight', kpis.saldoAcumulado >= 0 ? 'text-lumos-text-primary' : 'text-red-500')}>
            {formatBRL(kpis.saldoAcumulado)}
          </p>
        </div>
        <div className="card p-5 border-t-4 border-green-500 shadow-lg">
          <div className="p-2 bg-green-500/10 rounded-lumos text-green-500 w-fit mb-3">
            <TrendingUp className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Entradas no Ano</p>
          <p className="text-2xl font-black text-green-500 mt-1 tracking-tight">{formatBRL(kpis.totalEntradas)}</p>
        </div>
        <div className="card p-5 border-t-4 border-red-500 shadow-lg">
          <div className="p-2 bg-red-500/10 rounded-lumos text-red-500 w-fit mb-3">
            <TrendingDown className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Saídas no Ano</p>
          <p className="text-2xl font-black text-red-500 mt-1 tracking-tight">{formatBRL(kpis.totalSaidas)}</p>
        </div>
        <div className={clsx('card p-5 border-t-4 shadow-lg', kpis.resultado >= 0 ? 'border-green-500' : 'border-red-500')}>
          <div className={clsx('p-2 rounded-lumos w-fit mb-3', kpis.resultado >= 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500')}>
            <Activity className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Resultado do Ano</p>
          <p className={clsx('text-2xl font-black mt-1 tracking-tight', kpis.resultado >= 0 ? 'text-green-500' : 'text-red-500')}>
            {formatBRL(kpis.resultado)}
          </p>
        </div>
      </div>

      {/* Area Chart */}
      <div className="card p-6">
        <h3 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest mb-6 flex items-center gap-2">
          <Activity className="w-4 h-4 text-lumos-yellow" /> Evolução Mensal — {selectedYear}
        </h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="gradEntradas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradSaidas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={v => `R$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`}
              tick={{ fontSize: 10, fill: '#888' }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend formatter={v => <span style={{ fontSize: 11, color: '#aaa', fontWeight: 700, textTransform: 'uppercase' }}>{v === 'entradas' ? 'Entradas' : 'Saídas'}</span>} />
            <Area type="monotone" dataKey="entradas" stroke="#22c55e" strokeWidth={2} fill="url(#gradEntradas)" />
            <Area type="monotone" dataKey="saidas" stroke="#ef4444" strokeWidth={2} fill="url(#gradSaidas)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left lumos-sticky-2">
            <thead>
              <tr className="bg-lumos-text-primary/5 border-b border-lumos-border text-[10px] font-bold text-lumos-text-secondary uppercase">
                <th className="px-6 py-4 w-8" />
                <th className="px-6 py-4">Mês</th>
                <th className="px-6 py-4 text-right">Entradas</th>
                <th className="px-6 py-4 text-right">Saídas</th>
                <th className="px-6 py-4 text-right">Resultado</th>
                <th className="px-6 py-4 text-right">Saldo Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.map(month => {
                const isCurrentMonth = selectedYear === currentYear && month.monthIndex === currentMonth;
                const isExpanded = expandedRows.has(month.monthIndex);
                const hasData = month.transactions.length > 0 || month.isProjected;
                const isFuture = selectedYear > today.getFullYear() ||
                  (selectedYear === today.getFullYear() && month.monthIndex > currentMonth);

                return (
                  <React.Fragment key={month.monthIndex}>
                    <tr
                      className={clsx(
                        'border-b border-lumos-border/50 transition-colors',
                        hasData && 'cursor-pointer hover:bg-lumos-text-primary/5',
                        isCurrentMonth && 'bg-lumos-yellow/[0.04]',
                        isFuture && !month.isProjected && 'opacity-40'
                      )}
                      onClick={() => hasData && toggleRow(month.monthIndex)}
                    >
                      <td className="px-6 py-4 w-8">
                        {hasData && (
                          isExpanded
                            ? <ChevronDown className="w-4 h-4 text-lumos-text-secondary" />
                            : <ChevronRight className="w-4 h-4 text-lumos-text-secondary" />
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className={clsx(
                            'text-sm font-bold',
                            isCurrentMonth ? 'text-lumos-yellow' : 'text-lumos-text-primary'
                          )}>
                            {MONTH_NAMES_FULL[month.monthIndex]}
                          </span>
                          {isCurrentMonth && (
                            <span className="text-[9px] font-black bg-lumos-yellow/20 text-lumos-yellow px-1.5 py-0.5 rounded uppercase tracking-tight">
                              Atual
                            </span>
                          )}
                          {month.isProjected && (
                            <span className="text-[9px] font-black bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded uppercase tracking-tight border border-blue-500/20">
                              Projetado
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-bold text-green-500">
                        {month.entradas > 0 ? formatBRL(month.entradas) : <span className="text-lumos-text-secondary/40">—</span>}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-bold text-red-400">
                        {month.saidas > 0 ? formatBRL(month.saidas) : <span className="text-lumos-text-secondary/40">—</span>}
                      </td>
                      <td className={clsx(
                        'px-6 py-4 text-right text-sm font-black',
                        month.resultado > 0 ? 'text-green-500' : month.resultado < 0 ? 'text-red-500' : 'text-lumos-text-secondary/40'
                      )}>
                        {month.entradas === 0 && month.saidas === 0
                          ? '—'
                          : formatBRL(month.resultado)}
                      </td>
                      <td className={clsx(
                        'px-6 py-4 text-right text-sm font-black',
                        month.saldoAcumulado > 0 ? 'text-lumos-text-primary' : month.saldoAcumulado < 0 ? 'text-red-500' : 'text-lumos-text-secondary/40'
                      )}>
                        {formatBRL(month.saldoAcumulado)}
                      </td>
                    </tr>

                    {/* Expanded transactions */}
                    {isExpanded && (
                      <tr className="border-b border-lumos-border/50">
                        <td colSpan={6} className="px-6 py-0">
                          <div className="py-4 animate-in fade-in slide-in-from-top-2 duration-200">
                            {month.isProjected ? (
                              <div className="flex items-center gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-lumos">
                                <AlertTriangle className="w-4 h-4 text-blue-400 flex-shrink-0" />
                                <p className="text-xs text-blue-400">
                                  Dados projetados com base nos custos fixos ativos ({formatBRL(fixedCostsTotal)}/mês). Nenhuma transação real registrada ainda.
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {month.transactions.map(tx => (
                                  <div
                                    key={tx.id}
                                    className="flex items-center justify-between py-2 px-3 rounded-lumos hover:bg-lumos-text-primary/5 transition-colors"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <span className={clsx(
                                        'text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-tight border flex-shrink-0',
                                        SOURCE_COLORS[tx.source]
                                      )}>
                                        {tx.source}
                                      </span>
                                      <span className="text-[10px] text-lumos-text-secondary flex-shrink-0">
                                        {new Date(tx.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                                      </span>
                                      <span className="text-xs text-lumos-text-primary font-medium truncate">
                                        {tx.description}
                                      </span>
                                    </div>
                                    <span className={clsx(
                                      'text-sm font-black flex-shrink-0 ml-4',
                                      tx.type === 'entrada' ? 'text-green-500' : 'text-red-400'
                                    )}>
                                      {tx.type === 'entrada' ? '+' : '-'}{formatBRL(tx.amount)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Entry Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Nova Entrada Manual"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type radio */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Tipo *</label>
            <div className="grid grid-cols-2 gap-3">
              {(['entrada', 'saida'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFormData({ ...formData, type: t })}
                  className={clsx(
                    'py-3 rounded-lumos border font-bold text-sm transition-all',
                    formData.type === t
                      ? t === 'entrada'
                        ? 'bg-green-500/10 border-green-500 text-green-500'
                        : 'bg-red-500/10 border-red-500 text-red-500'
                      : 'border-lumos-border text-lumos-text-secondary hover:border-lumos-yellow/50'
                  )}
                >
                  {t === 'entrada' ? '↑ Entrada' : '↓ Saída'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Data *</label>
              <input
                required
                type="date"
                className="input-lumos w-full"
                value={formData.entry_date}
                onChange={e => setFormData({ ...formData, entry_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Valor (R$) *</label>
              <CurrencyInput
                className="input-lumos w-full font-bold"
                value={formData.amount}
                onChange={val => setFormData({ ...formData, amount: val })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Descrição *</label>
            <input
              required
              type="text"
              className="input-lumos w-full"
              placeholder="Ex: Pagamento de cliente XYZ"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Cliente *</label>
            <Select className="input-lumos w-full" value={formData.cliente_id} onChange={v => setFormData({ ...formData, cliente_id: v })} placeholder="Selecione um cliente"
              options={[{ value: '', label: 'Selecione um cliente' }, ...clients.map(c => ({ value: c.id, label: c.name }))]} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Categoria *</label>
              <Select className="input-lumos w-full" value={formData.categoria_id} onChange={v => setFormData({ ...formData, categoria_id: v, tipo_servico_id: '' })} placeholder="Selecione"
                options={[{ value: '', label: 'Selecione' }, ...categorias.map(c => ({ value: c.id, label: c.nome }))]} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Tipo de Serviço *</label>
              <Select className="input-lumos w-full" value={formData.tipo_servico_id} onChange={v => setFormData({ ...formData, tipo_servico_id: v })} disabled={!formData.categoria_id} placeholder="Selecione"
                options={[{ value: '', label: 'Selecione' }, ...tiposServico.filter(s => s.categoria_id === formData.categoria_id).map(s => ({ value: s.id, label: s.nome }))]} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Projeto (Opcional)</label>
            <Select className="input-lumos w-full" value={formData.projeto_financeiro_id} onChange={v => setFormData({ ...formData, projeto_financeiro_id: v })} placeholder="Nenhum projeto"
              options={[{ value: '', label: 'Nenhum projeto' }, ...projectsList.map(p => ({ value: p.id, label: p.budget?.project_name || p.origem || 'Projeto Sem Nome' }))]} />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-lumos-text-secondary uppercase tracking-widest">Observações</label>
            <textarea
              className="input-lumos w-full resize-none"
              rows={2}
              placeholder="Informações adicionais (opcional)..."
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>

          <div className="pt-4 flex gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button type="submit" className="btn-primary flex-1 h-10">
              Registrar Entrada
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
