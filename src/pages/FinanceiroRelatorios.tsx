import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import Select from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import {
  BarChart3,
  PieChart,
  Filter,
  Calendar,
  DollarSign,
  TrendingUp,
  FolderOpen,
  Briefcase,
  Users,
  Award,
  Activity,
  FileText,
  AlertCircle,
  HelpCircle,
  TrendingDown,
  RefreshCw
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  Cell,
  Pie
} from 'recharts';

interface ProjetoRentabilidade {
  id: string;
  proposta_id: string;
  project_id: string;
  cliente_id: string;
  categoria_id: string;
  tipo_servico_id: string;
  icp: 'icp_1' | 'icp_2' | null;
  valor_vendido: number;
  nf_percent: number;
  custos_total: number;
  data_recebimento_negociada: string | null;
  status_titulo: 'emitir_nf' | 'pedido_nf_feito' | 'esperando_pagamento' | 'pagamento_atraso' | 'pagamento_recebido';
  data_recebido: string | null;
  origem: string;
  pendente_preenchimento: boolean;
  created_at: string;
  valor_nf: number;
  receita_liquida: number;
  lucro_operacional: number;
  lucro_liquido: number;
  margem: number;
  vencido: boolean;
  client?: { name: string };
  categoria?: { nome: string };
  tipo_servico?: { nome: string };
}

interface DimensionItem {
  id: string;
  nome: string;
}

export default function FinanceiroRelatorios() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProjetoRentabilidade[]>([]);
  const [clients, setClients] = useState<DimensionItem[]>([]);
  const [categories, setCategories] = useState<DimensionItem[]>([]);
  const [services, setServices] = useState<any[]>([]);

  // Filter States
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const [selectedICP, setSelectedICP] = useState('');
  const [selectedStatusPayment, setSelectedStatusPayment] = useState('');
  const [selectedStatusNF, setSelectedStatusNF] = useState('');
  const [selectedYear, setSelectedYear] = useState('');

  // Tab State
  const [activeTab, setActiveTab] = useState<'projetos' | 'clientes' | 'categorias' | 'servicos' | 'icp'>('projetos');

  useEffect(() => {
    if (isAdmin) {
      fetchReportData();
    }
  }, [isAdmin]);

  async function fetchReportData() {
    try {
      setLoading(true);
      const [rentRes, clientRes, catRes, svcRes] = await Promise.all([
        supabase
          .from('vw_rentabilidade')
          .select('*, client:clients(name), categoria:categorias(nome), tipo_servico:tipos_servico(nome)')
          .order('created_at', { ascending: false }),
        supabase.from('clients').select('id, name').order('name'),
        supabase.from('categorias').select('id, nome').order('nome'),
        supabase.from('tipos_servico').select('id, categoria_id, nome').order('nome')
      ]);

      if (rentRes.error) throw rentRes.error;
      if (clientRes.error) throw clientRes.error;
      if (catRes.error) throw catRes.error;
      if (svcRes.error) throw svcRes.error;

      setData(rentRes.data || []);
      setClients((clientRes.data || []).map(c => ({ id: c.id, nome: c.name })));
      setCategories(catRes.data || []);
      setServices(svcRes.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar relatórios:', err);
      toast.error('Erro ao carregar dados dos relatórios.');
    } finally {
      setLoading(false);
    }
  }

  // Filter service list dynamically by chosen category
  const filteredServiceOptions = useMemo(() => {
    if (!selectedCategory) return services;
    return services.filter(s => s.categoria_id === selectedCategory);
  }, [selectedCategory, services]);

  // Reset service if category changes and the selected service isn't in the new list
  useEffect(() => {
    if (selectedCategory && selectedService) {
      const match = services.find(s => s.id === selectedService && s.categoria_id === selectedCategory);
      if (!match) setSelectedService('');
    }
  }, [selectedCategory, selectedService, services]);

  // Dynamic Year Options extracted from dataset
  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    data.forEach(item => {
      const date = item.data_recebimento_negociada || item.created_at;
      if (date) {
        const year = new Date(date).getFullYear().toString();
        years.add(year);
      }
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [data]);

  // Filtered dataset
  const filteredData = useMemo(() => {
    return data.filter(item => {
      if (selectedClient && item.cliente_id !== selectedClient) return false;
      if (selectedCategory && item.categoria_id !== selectedCategory) return false;
      if (selectedService && item.tipo_servico_id !== selectedService) return false;
      if (selectedICP && item.icp !== selectedICP) return false;

      // Status NF
      if (selectedStatusNF && item.status_titulo !== selectedStatusNF) return false;

      // Status Payment
      if (selectedStatusPayment) {
        if (selectedStatusPayment === 'recebido' && item.status_titulo !== 'pagamento_recebido') return false;
        if (selectedStatusPayment === 'esperando' && item.status_titulo !== 'esperando_pagamento') return false;
        if (selectedStatusPayment === 'atraso' && !(item.status_titulo === 'pagamento_atraso' || item.vencido)) return false;
      }

      // Year Filter
      if (selectedYear) {
        const date = item.data_recebimento_negociada || item.created_at;
        if (date) {
          const year = new Date(date).getFullYear().toString();
          if (year !== selectedYear) return false;
        } else {
          return false;
        }
      }

      return true;
    });
  }, [data, selectedClient, selectedCategory, selectedService, selectedICP, selectedStatusNF, selectedStatusPayment, selectedYear]);

  // General Totals
  const totals = useMemo(() => {
    let faturamentoBruto = 0;
    let nfTotal = 0;
    let receitaLiquida = 0;
    let custosTotal = 0;
    let lucroLiquido = 0;

    filteredData.forEach(item => {
      faturamentoBruto += Number(item.valor_vendido || 0);
      nfTotal += Number(item.valor_nf || 0);
      receitaLiquida += Number(item.receita_liquida || 0);
      custosTotal += Number(item.custos_total || 0);
      lucroLiquido += Number(item.lucro_liquido || 0);
    });

    const margemLiquida = faturamentoBruto > 0 ? (lucroLiquido / faturamentoBruto) : 0;

    return {
      faturamentoBruto,
      nfTotal,
      receitaLiquida,
      custosTotal,
      lucroLiquido,
      margemLiquida
    };
  }, [filteredData]);

  // Aggregation Calculations based on Active Tab
  const aggregatedData = useMemo(() => {
    const groups: Record<string, {
      name: string;
      valor_vendido: number;
      valor_nf: number;
      receita_liquida: number;
      custos_total: number;
      lucro_liquido: number;
      count: number;
    }> = {};

    filteredData.forEach(item => {
      let key = '';
      let name = '';

      if (activeTab === 'clientes') {
        key = item.cliente_id;
        name = item.client?.name || 'Cliente Desconhecido';
      } else if (activeTab === 'categorias') {
        key = item.categoria_id || 'unmapped';
        name = item.categoria?.nome || 'Sem Categoria';
      } else if (activeTab === 'servicos') {
        key = item.tipo_servico_id || 'unmapped';
        name = item.tipo_servico?.nome || 'Sem Serviço';
      } else if (activeTab === 'icp') {
        key = item.icp || 'unmapped';
        name = item.icp === 'icp_1' ? 'ICP 1 (Principal)' : item.icp === 'icp_2' ? 'ICP 2 (Secundário)' : 'Sem Classificação';
      } else {
        return; // 'projetos' does not group
      }

      if (!groups[key]) {
        groups[key] = {
          name,
          valor_vendido: 0,
          valor_nf: 0,
          receita_liquida: 0,
          custos_total: 0,
          lucro_liquido: 0,
          count: 0
        };
      }

      groups[key].valor_vendido += Number(item.valor_vendido || 0);
      groups[key].valor_nf += Number(item.valor_nf || 0);
      groups[key].receita_liquida += Number(item.receita_liquida || 0);
      groups[key].custos_total += Number(item.custos_total || 0);
      groups[key].lucro_liquido += Number(item.lucro_liquido || 0);
      groups[key].count += 1;
    });

    return Object.values(groups).map(g => ({
      ...g,
      margem: g.valor_vendido > 0 ? (g.lucro_liquido / g.valor_vendido) : 0
    })).sort((a, b) => b.lucro_liquido - a.lucro_liquido); // Sorted by profit descending
  }, [filteredData, activeTab]);

  // Chart Data preparation
  const chartData = useMemo(() => {
    if (activeTab === 'projetos') {
      // Top 8 projects by profit
      return [...filteredData]
        .sort((a, b) => b.lucro_liquido - a.lucro_liquido)
        .slice(0, 8)
        .map(item => ({
          name: item.client?.name ? `${item.client.name.substring(0, 10)}...` : 'Sem Nome',
          Lucro: Number(item.lucro_liquido || 0),
          Faturamento: Number(item.valor_vendido || 0)
        }));
    } else {
      // Top 8 aggregated groups
      return aggregatedData.slice(0, 8).map(g => ({
        name: g.name.length > 15 ? `${g.name.substring(0, 15)}...` : g.name,
        Lucro: g.lucro_liquido,
        Faturamento: g.valor_vendido
      }));
    }
  }, [filteredData, aggregatedData, activeTab]);

  const formatBRL = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const formatPercent = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(val);

  const clearFilters = () => {
    setSelectedClient('');
    setSelectedCategory('');
    setSelectedService('');
    setSelectedICP('');
    setSelectedStatusPayment('');
    setSelectedStatusNF('');
    setSelectedYear('');
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] bg-lumos-bg">
        <div className="card p-6 border border-red-500/30 max-w-md text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h2 className="text-lg font-black text-lumos-text-primary uppercase tracking-wider">Acesso Negado</h2>
          <p className="text-xs text-lumos-text-secondary leading-relaxed">
            Esta tela de relatórios estratégicos é de uso exclusivo dos administradores e sócios da Lumos.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] bg-lumos-bg">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-lumos-yellow" />
      </div>
    );
  }

  return (
    <div className="space-y-8 font-work-sans max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Painel de Respostas do CEO</h1>
          <p className="text-lumos-text-secondary mt-1 font-medium">Camada de inteligência estratégica e rentabilidade consolidada.</p>
        </div>
        <button
          onClick={fetchReportData}
          className="btn-primary h-10 px-4 flex items-center justify-center gap-2 font-bold text-xs uppercase self-start sm:self-auto"
        >
          <RefreshCw className="w-4 h-4" />
          Atualizar Dados
        </button>
      </div>

      {/* Filters Box */}
      <div className="card p-5 space-y-4 border border-lumos-border/60">
        <div className="flex items-center gap-2 border-b border-lumos-border pb-2.5">
          <Filter className="w-4 h-4 text-lumos-yellow" />
          <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest">Filtros Globais</h3>
          { (selectedClient || selectedCategory || selectedService || selectedICP || selectedStatusPayment || selectedStatusNF || selectedYear) && (
            <button
              onClick={clearFilters}
              className="text-[10px] text-lumos-yellow hover:underline ml-auto font-black uppercase tracking-wider"
            >
              Limpar Filtros
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {/* Cliente */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider block">Cliente</label>
            <Select className="input-lumos w-full h-9 text-xs" value={selectedClient} onChange={setSelectedClient}
              options={[{ value: '', label: 'Todos' }, ...clients.map(c => ({ value: c.id, label: c.nome }))]} />
          </div>

          {/* Categoria */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider block">Categoria</label>
            <Select className="input-lumos w-full h-9 text-xs" value={selectedCategory} onChange={setSelectedCategory}
              options={[{ value: '', label: 'Todas' }, ...categories.map(c => ({ value: c.id, label: c.nome }))]} />
          </div>

          {/* Tipo de Serviço */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider block">Tipo Serviço</label>
            <Select className="input-lumos w-full h-9 text-xs" value={selectedService} onChange={setSelectedService}
              options={[{ value: '', label: 'Todos' }, ...filteredServiceOptions.map(s => ({ value: s.id, label: s.nome }))]} />
          </div>

          {/* ICP */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider block">ICP</label>
            <Select className="input-lumos w-full h-9 text-xs" value={selectedICP} onChange={setSelectedICP}
              options={[{ value: '', label: 'Todos' }, { value: 'icp_1', label: 'ICP 1 (Principal)' }, { value: 'icp_2', label: 'ICP 2 (Secundário)' }]} />
          </div>

          {/* Status NF */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider block">Status NF</label>
            <Select className="input-lumos w-full h-9 text-xs" value={selectedStatusNF} onChange={setSelectedStatusNF}
              options={[{ value: '', label: 'Todos' }, { value: 'emitir_nf', label: 'A Emitir NF' }, { value: 'pedido_nf_feito', label: 'Pedido NF Feito' }]} />
          </div>

          {/* Status Pagamento */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider block">Status Pagamento</label>
            <Select className="input-lumos w-full h-9 text-xs" value={selectedStatusPayment} onChange={setSelectedStatusPayment}
              options={[{ value: '', label: 'Todos' }, { value: 'esperando', label: 'Aguardando Pgto' }, { value: 'atraso', label: 'Pagamento em Atraso' }, { value: 'recebido', label: 'Pago/Recebido' }]} />
          </div>

          {/* Período / Ano */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-wider block">Ano Vencimento</label>
            <Select className="input-lumos w-full h-9 text-xs" value={selectedYear} onChange={setSelectedYear}
              options={[{ value: '', label: 'Todos' }, ...yearOptions.map(yr => ({ value: String(yr), label: String(yr) }))]} />
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* Card 1: Faturamento Bruto */}
        <div className="card p-5 border-t-4 border-green-500 shadow-md">
          <p className="text-[9px] font-black text-lumos-text-secondary uppercase tracking-widest">Receita Bruta Total</p>
          <p className="text-xl font-black text-lumos-text-primary mt-1.5 tracking-tight">{formatBRL(totals.faturamentoBruto)}</p>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-green-500 font-bold">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Faturado bruto</span>
          </div>
        </div>

        {/* Card 2: NF Impostos */}
        <div className="card p-5 border-t-4 border-purple-500 shadow-md">
          <p className="text-[9px] font-black text-lumos-text-secondary uppercase tracking-widest">NF / Impostos (18%)</p>
          <p className="text-xl font-black text-lumos-text-primary mt-1.5 tracking-tight">{formatBRL(totals.nfTotal)}</p>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-purple-400 font-bold">
            <FileText className="w-3.5 h-3.5" />
            <span>Provisão de imposto</span>
          </div>
        </div>

        {/* Card 3: Receita Líquida */}
        <div className="card p-5 border-t-4 border-cyan-500 shadow-md">
          <p className="text-[9px] font-black text-lumos-text-secondary uppercase tracking-widest">Receita Líquida</p>
          <p className="text-xl font-black text-lumos-text-primary mt-1.5 tracking-tight">{formatBRL(totals.receitaLiquida)}</p>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-cyan-400 font-bold">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Bruto - Imposto</span>
          </div>
        </div>

        {/* Card 4: Custos Operacionais */}
        <div className="card p-5 border-t-4 border-red-500 shadow-md">
          <p className="text-[9px] font-black text-lumos-text-secondary uppercase tracking-widest">Custos de Projeto</p>
          <p className="text-xl font-black text-lumos-text-primary mt-1.5 tracking-tight">{formatBRL(totals.custosTotal)}</p>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-red-500 font-bold">
            <TrendingDown className="w-3.5 h-3.5" />
            <span>Lançados pela produção</span>
          </div>
        </div>

        {/* Card 5: Lucro Líquido */}
        <div className="card p-5 border-t-4 border-lumos-yellow shadow-md">
          <p className="text-[9px] font-black text-lumos-text-secondary uppercase tracking-widest">Lucro Líquido Real</p>
          <p className="text-xl font-black text-lumos-text-primary mt-1.5 tracking-tight">{formatBRL(totals.lucroLiquido)}</p>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-lumos-yellow font-bold">
            <Activity className="w-3.5 h-3.5" />
            <span>Resultado real</span>
          </div>
        </div>

        {/* Card 6: Margem Líquida */}
        <div className="card p-5 border-t-4 border-amber-500 shadow-md">
          <p className="text-[9px] font-black text-lumos-text-secondary uppercase tracking-widest">Margem Real Média</p>
          <p className="text-xl font-black text-lumos-text-primary mt-1.5 tracking-tight">{formatPercent(totals.margemLiquida)}</p>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-amber-500 font-bold">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>pricing ref: 40%</span>
          </div>
        </div>
      </div>

      {/* Main Analysis Area: Chart + Aggregation Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 columns: Chart & Table */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs header */}
          <div className="flex border-b border-lumos-border pb-px gap-1 overflow-x-auto custom-scrollbar">
            {(['projetos', 'clientes', 'categorias', 'servicos', 'icp'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 px-5 text-xs font-black uppercase tracking-widest border-b-2 transition-all whitespace-nowrap ${
                  activeTab === tab
                    ? 'border-lumos-yellow text-lumos-yellow bg-lumos-yellow/5'
                    : 'border-transparent text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-white/5'
                }`}
              >
                {tab === 'projetos' && 'Rentabilidade por Projeto'}
                {tab === 'clientes' && 'Desempenho por Cliente'}
                {tab === 'categorias' && 'Matriz por Categoria'}
                {tab === 'servicos' && 'Foco por Tipo de Serviço'}
                {tab === 'icp' && 'Foco por ICP'}
              </button>
            ))}
          </div>

          {/* Aggregated Chart */}
          <div className="card p-6">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-6 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-lumos-yellow" /> Faturamento vs Lucro Real (Top 8)
            </h3>
            {chartData.length === 0 ? (
              <div className="text-center py-12 text-xs text-lumos-text-secondary italic">Sem dados suficientes para gerar gráfico.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#888' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => `R$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} tick={{ fontSize: 9, fill: '#888' }} axisLine={false} tickLine={false} width={45} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-3 shadow-xl text-xs font-work-sans">
                          <p className="font-black uppercase text-lumos-text-secondary mb-1.5">{label}</p>
                          {payload.map((p: any) => (
                            <p key={p.name} style={{ color: p.fill }} className="font-bold">
                              {p.name}: {formatBRL(p.value)}
                            </p>
                          ))}
                        </div>
                      );
                    }}
                    cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                  />
                  <Legend formatter={(v) => <span className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider">{v}</span>} />
                  <Bar dataKey="Faturamento" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Lucro" fill="#EFC700" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tab Content Table */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-lumos-border flex justify-between items-center">
              <h4 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest">
                Detalhamento dos Dados
              </h4>
              <span className="text-[10px] bg-lumos-yellow/10 text-lumos-yellow px-2 py-0.5 rounded-full font-bold">
                {activeTab === 'projetos' ? filteredData.length : aggregatedData.length} itens encontrados
              </span>
            </div>

            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs font-medium border-collapse lumos-sticky-1">
                <thead>
                  <tr className="bg-lumos-surface/40 text-[9px] font-black text-lumos-text-secondary uppercase tracking-wider border-b border-lumos-border">
                    <th className="py-3 px-4">{activeTab === 'projetos' ? 'Projeto / Cliente' : 'Grupo'}</th>
                    {activeTab === 'projetos' && <th className="py-3 px-4">Dimensões</th>}
                    <th className="py-3 px-4 text-right">Fat. Bruto</th>
                    <th className="py-3 px-4 text-right">NF (18%)</th>
                    <th className="py-3 px-4 text-right">Custos</th>
                    <th className="py-3 px-4 text-right">Lucro Líquido</th>
                    <th className="py-3 px-4 text-right">Margem %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-lumos-border/40">
                  {activeTab === 'projetos' ? (
                    filteredData.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-xs text-lumos-text-secondary italic">Nenhum projeto encontrado para os filtros selecionados.</td>
                      </tr>
                    ) : (
                      filteredData.map(proj => (
                        <tr key={proj.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-3.5 px-4">
                            <p className="font-bold text-lumos-text-primary">{proj.client?.name || 'Sem Cliente'}</p>
                            <p className="text-[10px] text-lumos-text-secondary mt-0.5 flex items-center gap-1.5">
                              {proj.status_titulo === 'pagamento_recebido' && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                              {(proj.status_titulo === 'pagamento_atraso' || proj.vencido) && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                              {proj.status_titulo === 'emitir_nf' && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
                              {proj.status_titulo === 'pedido_nf_feito' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                              {proj.status_titulo === 'esperando_pagamento' && !proj.vencido && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                              {proj.status_titulo === 'pagamento_recebido' ? 'Recebido' :
                               proj.status_titulo === 'pagamento_atraso' || proj.vencido ? 'Atrasado' :
                               proj.status_titulo === 'emitir_nf' ? 'Emitir NF' :
                               proj.status_titulo === 'pedido_nf_feito' ? 'NF Solicitada' : 'Esperando Pgto'}
                              {proj.data_recebimento_negociada && ` · Vence ${new Date(proj.data_recebimento_negociada + 'T12:00:00').toLocaleDateString('pt-BR')}`}
                            </p>
                          </td>
                          <td className="py-3.5 px-4 space-y-1">
                            <span className="inline-block text-[9px] bg-lumos-border/60 text-lumos-text-primary px-2 py-0.5 rounded mr-1 uppercase font-bold">
                              {proj.categoria?.nome || 'Sem Categ.'}
                            </span>
                            <span className="inline-block text-[9px] bg-lumos-border/60 text-lumos-text-primary px-2 py-0.5 rounded mr-1 uppercase font-bold">
                              {proj.tipo_servico?.nome || 'Sem Serv.'}
                            </span>
                            {proj.icp && (
                              <span className="inline-block text-[9px] bg-lumos-yellow/10 text-lumos-yellow px-2 py-0.5 rounded uppercase font-bold">
                                {proj.icp === 'icp_1' ? 'ICP 1' : 'ICP 2'}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right font-bold text-lumos-text-primary">{formatBRL(proj.valor_vendido)}</td>
                          <td className="py-3.5 px-4 text-right text-purple-400 font-bold">{formatBRL(proj.valor_nf)}</td>
                          <td className="py-3.5 px-4 text-right text-red-400 font-bold">{formatBRL(proj.custos_total)}</td>
                          <td className={`py-3.5 px-4 text-right font-black ${proj.lucro_liquido >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatBRL(proj.lucro_liquido)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-black">
                            <span className={`px-2 py-0.5 rounded text-[10px] ${proj.margem >= 0.40 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                              {formatPercent(proj.margem)}
                            </span>
                          </td>
                        </tr>
                      ))
                    )
                  ) : (
                    aggregatedData.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-xs text-lumos-text-secondary italic">Nenhum dado agregado disponível.</td>
                      </tr>
                    ) : (
                      aggregatedData.map(group => (
                        <tr key={group.name} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-3.5 px-4">
                            <p className="font-bold text-lumos-text-primary">{group.name}</p>
                            <p className="text-[9px] text-lumos-text-secondary mt-0.5 uppercase tracking-wider font-bold">
                              {group.count} {group.count === 1 ? 'projeto' : 'projetos'}
                            </p>
                          </td>
                          <td className="py-3.5 px-4 text-right font-bold text-lumos-text-primary">{formatBRL(group.valor_vendido)}</td>
                          <td className="py-3.5 px-4 text-right text-purple-400 font-bold">{formatBRL(group.valor_nf)}</td>
                          <td className="py-3.5 px-4 text-right text-red-400 font-bold">{formatBRL(group.custos_total)}</td>
                          <td className={`py-3.5 px-4 text-right font-black ${group.lucro_liquido >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatBRL(group.lucro_liquido)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-black">
                            <span className={`px-2 py-0.5 rounded text-[10px] ${group.margem >= 0.40 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                              {formatPercent(group.margem)}
                            </span>
                          </td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right column: Extra charts or strategic breakdown */}
        <div className="space-y-6">
          {/* ICP Breakdown details */}
          <div className="card p-6 space-y-6">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2 border-b border-lumos-border pb-3">
              <Award className="w-4 h-4 text-lumos-yellow" /> Resposta CEO: ICP
            </h3>
            
            {(() => {
              const icp1Data = data.filter(d => d.icp === 'icp_1');
              const icp2Data = data.filter(d => d.icp === 'icp_2');
              const icpUnmappedData = data.filter(d => !d.icp);

              const computeMetrics = (list: ProjetoRentabilidade[]) => {
                const totalVal = list.reduce((acc, i) => acc + Number(i.valor_vendido || 0), 0);
                const totalLucro = list.reduce((acc, i) => acc + Number(i.lucro_liquido || 0), 0);
                const avgMargin = totalVal > 0 ? (totalLucro / totalVal) : 0;
                return { totalVal, totalLucro, avgMargin };
              };

              const icp1 = computeMetrics(icp1Data);
              const icp2 = computeMetrics(icp2Data);
              const unmapped = computeMetrics(icpUnmappedData);

              return (
                <div className="space-y-4">
                  {/* ICP 1 */}
                  <div className="p-4 bg-lumos-yellow/5 border border-lumos-yellow/20 rounded-lumos">
                    <p className="text-[10px] font-black text-lumos-yellow uppercase tracking-widest">ICP 1 (Principal)</p>
                    <div className="grid grid-cols-2 gap-4 mt-3">
                      <div>
                        <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Lucro Líquido</p>
                        <p className="text-base font-black text-lumos-text-primary tracking-tight mt-0.5">{formatBRL(icp1.totalLucro)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Margem Líquida</p>
                        <p className="text-base font-black text-lumos-text-primary tracking-tight mt-0.5">{formatPercent(icp1.avgMargin)}</p>
                      </div>
                    </div>
                  </div>

                  {/* ICP 2 */}
                  <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lumos">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">ICP 2 (Secundário)</p>
                    <div className="grid grid-cols-2 gap-4 mt-3">
                      <div>
                        <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Lucro Líquido</p>
                        <p className="text-base font-black text-lumos-text-primary tracking-tight mt-0.5">{formatBRL(icp2.totalLucro)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Margem Líquida</p>
                        <p className="text-base font-black text-lumos-text-primary tracking-tight mt-0.5">{formatPercent(icp2.avgMargin)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Unmapped */}
                  <div className="p-4 bg-lumos-border/30 border border-lumos-border/50 rounded-lumos">
                    <p className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Sem Classificação</p>
                    <div className="grid grid-cols-2 gap-4 mt-3">
                      <div>
                        <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Lucro Líquido</p>
                        <p className="text-base font-black text-lumos-text-primary tracking-tight mt-0.5">{formatBRL(unmapped.totalLucro)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Margem Líquida</p>
                        <p className="text-base font-black text-lumos-text-primary tracking-tight mt-0.5">{formatPercent(unmapped.avgMargin)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Atrasados Alert Panel */}
          <div className="card p-6 space-y-4">
            <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2 border-b border-lumos-border pb-3">
              <AlertCircle className="w-4 h-4 text-red-500" /> Títulos Atrasados
            </h3>

            {(() => {
              const overdue = data.filter(d => d.vencido || d.status_titulo === 'pagamento_atraso');
              if (overdue.length === 0) {
                return (
                  <p className="text-xs text-lumos-text-secondary italic text-center py-6">Nenhum título em atraso encontrado.</p>
                );
              }

              const totalOverdueAmount = overdue.reduce((acc, o) => acc + Number(o.valor_vendido || 0), 0);

              return (
                <div className="space-y-3">
                  <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lumos text-center">
                    <p className="text-[9px] font-bold text-lumos-text-secondary uppercase tracking-wider">Total em Atraso</p>
                    <p className="text-xl font-black text-red-500 mt-1">{formatBRL(totalOverdueAmount)}</p>
                  </div>

                  <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                    {overdue.map(proj => (
                      <div key={proj.id} className="p-2.5 rounded border border-lumos-border/50 bg-lumos-bg/30 text-xs">
                        <div className="flex justify-between items-start gap-1">
                          <span className="font-bold text-lumos-text-primary line-clamp-1">{proj.client?.name || 'Cliente'}</span>
                          <span className="font-bold text-red-500 whitespace-nowrap">{formatBRL(proj.valor_vendido)}</span>
                        </div>
                        <p className="text-[9px] text-lumos-text-secondary mt-1 font-bold">
                          Venceu em: {proj.data_recebimento_negociada ? new Date(proj.data_recebimento_negociada + 'T12:00:00').toLocaleDateString('pt-BR') : 'Sem data'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
