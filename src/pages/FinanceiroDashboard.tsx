import React, { useEffect, useState, useMemo } from 'react';
import {
  Wallet,
  TrendingUp,
  ArrowDownRight,
  ArrowUpRight,
  Activity,
  AlertCircle,
  CheckCircle2,
  Calendar,
  DollarSign,
  SlidersHorizontal,
  Settings,
  X,
  GripVertical,
  Award,
  Users,
  Eye,
  EyeOff,
  RefreshCw,
  Plus
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  rectSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';

type PeriodType = 'semana' | 'mes' | 'trimestre' | 'semestre' | 'ano';

interface BlockPreference {
  id: string;
  visible: boolean;
}

// Catálogo estático de blocos disponíveis
interface DashboardBlockDef {
  id: string;
  title: string;
  description: string;
  group: 'rentabilidade' | 'resultado' | 'caixa';
  defaultSize: 'small' | 'medium' | 'large' | 'full';
  defaultActive: boolean;
  isFuture?: boolean;
}

const DASHBOARD_BLOCKS_CATALOG: DashboardBlockDef[] = [
  {
    id: 'kpi-faturamento',
    title: 'Faturamento do Período',
    description: 'Soma do faturamento bruto dos projetos aprovados no período selecionado.',
    group: 'rentabilidade',
    defaultSize: 'small',
    defaultActive: true
  },
  {
    id: 'kpi-lucro-liquido',
    title: 'Lucro Líquido Real',
    description: 'Resultado real obtido deduzindo os impostos e custos operacionais dos projetos.',
    group: 'rentabilidade',
    defaultSize: 'small',
    defaultActive: true
  },
  {
    id: 'kpi-margem-media',
    title: 'Margem Real Média',
    description: 'Média de rentabilidade líquida acumulada dos projetos ativos.',
    group: 'rentabilidade',
    defaultSize: 'small',
    defaultActive: true
  },
  {
    id: 'kpi-projeto-top',
    title: 'Projeto Mais Rentável',
    description: 'Destaque para o projeto que obteve o maior lucro líquido real no período.',
    group: 'resultado',
    defaultSize: 'medium',
    defaultActive: true
  },
  {
    id: 'kpi-cliente-top',
    title: 'Principal Cliente',
    description: 'Destaque para o cliente com a maior receita faturada no período.',
    group: 'resultado',
    defaultSize: 'medium',
    defaultActive: true
  },
  {
    id: 'chart-fat-vs-lucro',
    title: 'Gráfico: Faturamento vs Lucro',
    description: 'Comparação mensal visual de receita versus rentabilidade líquida dos projetos.',
    group: 'resultado',
    defaultSize: 'full',
    defaultActive: true
  },
  {
    id: 'panel-titulos-atrasados',
    title: 'Alertas: Títulos em Atraso',
    description: 'Painel crítico com listagem e somatório de parcelas vencidas e em atraso.',
    group: 'rentabilidade',
    defaultSize: 'full',
    defaultActive: true
  },
  // Blocos futuros (Caixa V2)
  {
    id: 'kpi-saldo-conta',
    title: 'Saldo Geral em Conta',
    description: 'Saldo real disponível integrado com extratos bancários.',
    group: 'caixa',
    defaultSize: 'small',
    defaultActive: false,
    isFuture: true
  },
  {
    id: 'chart-fluxo-caixa',
    title: 'Gráfico: Fluxo de Caixa Real',
    description: 'Evolução mensal consolidada das entradas e saídas de caixa da conta corrente.',
    group: 'caixa',
    defaultSize: 'full',
    defaultActive: false,
    isFuture: true
  }
];

const DEFAULT_PREFERENCES: BlockPreference[] = [
  { id: 'kpi-faturamento', visible: true },
  { id: 'kpi-lucro-liquido', visible: true },
  { id: 'kpi-margem-media', visible: true },
  { id: 'kpi-projeto-top', visible: true },
  { id: 'kpi-cliente-top', visible: true },
  { id: 'chart-fat-vs-lucro', visible: true },
  { id: 'panel-titulos-atrasados', visible: true }
];

export default function FinanceiroDashboard() {
  const [period, setPeriod] = useState<PeriodType>('mes');
  const [rawProjects, setRawProjects] = useState<any[]>([]);
  const [payables, setPayables] = useState<any[]>([]);
  const [receivables, setReceivables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados de layout e personalização
  const [preferences, setPreferences] = useState<BlockPreference[]>(DEFAULT_PREFERENCES);
  const [tempPreferences, setTempPreferences] = useState<BlockPreference[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Sensores para Drag and Drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // evita arrastes acidentais em cliques normais
      },
    })
  );

  useEffect(() => {
    loadPreferencesAndData();
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [period]);

  const getStartDate = (periodType: PeriodType): string => {
    const now = new Date();
    let start = new Date();
    switch (periodType) {
      case 'semana':
        start.setDate(now.getDate() - 7);
        break;
      case 'mes':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'trimestre':
        start.setMonth(now.getMonth() - 3);
        break;
      case 'semestre':
        start.setMonth(now.getMonth() - 6);
        break;
      case 'ano':
        start = new Date(now.getFullYear(), 0, 1);
        break;
    }
    return start.toISOString().split('T')[0];
  };

  async function loadPreferencesAndData() {
    try {
      setLoading(true);
      await Promise.all([
        fetchPreferences(),
        fetchDashboardData()
      ]);
    } catch (error) {
      console.error('Erro na carga inicial:', error);
    } finally {
      setLoading(false);
    }
  }

  // Busca de preferências com merge inteligente e fallback para localStorage
  async function fetchPreferences() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        applyPreferencesMerge(loadLocalPreferences());
        return;
      }

      const { data, error } = await supabase
        .from('dashboard_preferences')
        .select('preferences')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.warn('Tabela dashboard_preferences inacessível, usando local:', error.message);
        applyPreferencesMerge(loadLocalPreferences());
        return;
      }

      if (data?.preferences && Array.isArray(data.preferences)) {
        applyPreferencesMerge(data.preferences);
      } else {
        applyPreferencesMerge(loadLocalPreferences());
      }
    } catch (error) {
      console.warn('Erro ao buscar preferências do banco, usando local:', error);
      applyPreferencesMerge(loadLocalPreferences());
    }
  }

  function loadLocalPreferences(): BlockPreference[] {
    const local = localStorage.getItem('lumos_dashboard_preferences');
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        console.warn('Erro ao ler localStorage:', e);
      }
    }
    return DEFAULT_PREFERENCES;
  }

  // Une as preferências do usuário com novos blocos que surgirem no catálogo futuramente
  function applyPreferencesMerge(saved: BlockPreference[]) {
    const merged = [...saved];

    // Adiciona blocos do catálogo que não existem nas preferências salvas
    DASHBOARD_BLOCKS_CATALOG.forEach(catalogBlock => {
      // Ignora blocos futuros de caixa
      if (catalogBlock.isFuture) return;

      const exists = merged.some(p => p.id === catalogBlock.id);
      if (!exists) {
        merged.push({
          id: catalogBlock.id,
          visible: catalogBlock.defaultActive
        });
      }
    });

    // Remove referências a blocos que foram excluídos do catálogo
    const cleaned = merged.filter(p => 
      DASHBOARD_BLOCKS_CATALOG.some(c => c.id === p.id)
    );

    setPreferences(cleaned);
  }

  async function savePreferencesToStorage(updatedPref: BlockPreference[]) {
    try {
      localStorage.setItem('lumos_dashboard_preferences', JSON.stringify(updatedPref));

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('dashboard_preferences').upsert({
          user_id: user.id,
          preferences: updatedPref,
          updated_at: new Date().toISOString()
        });
      }
    } catch (error) {
      console.warn('Erro ao salvar preferências no banco/local:', error);
    }
  }

  async function fetchDashboardData() {
    try {
      const now = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(now.getDate() + 7);
      const nextWeekStr = nextWeek.toISOString().split('T')[0];

      const startDate = getStartDate(period);

      const [rentRes, payablesRes, receivablesRes] = await Promise.all([
        supabase
          .from('vw_rentabilidade')
          .select('*, client:clients(name)')
          .or(`data_recebimento_negociada.gte.${startDate},created_at.gte.${startDate}`),
        supabase.from('payables').select('amount, due_date, paid_at'),
        supabase.from('receivables').select('total_amount, received_amount, due_date, status, received_at')
      ]);

      setRawProjects(rentRes.data || []);
      setPayables(payablesRes.data || []);
      setReceivables(receivablesRes.data || []);
    } catch (error) {
      console.error('Erro ao buscar dados:', error);
    }
  }

  // --- CONTROLES DE EDICAO ---
  const startEditing = () => {
    setTempPreferences(JSON.parse(JSON.stringify(preferences)));
    setIsEditing(true);
    setIsDrawerOpen(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setIsDrawerOpen(false);
    setTempPreferences([]);
  };

  const saveEditing = async () => {
    setPreferences(tempPreferences);
    setIsEditing(false);
    setIsDrawerOpen(false);
    await savePreferencesToStorage(tempPreferences);
    setTempPreferences([]);
  };

  const toggleBlockVisibility = (id: string) => {
    setTempPreferences(prev =>
      prev.map(p => (p.id === id ? { ...p, visible: !p.visible } : p))
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setTempPreferences(prev => {
      const oldIndex = prev.findIndex(p => p.id === active.id);
      const newIndex = prev.findIndex(p => p.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  // Mapeamento dinâmico de dados processados com base no rawProjects (centralizado)
  const dashboardData = useMemo(() => {
    const totals = {
      faturamento: 0,
      lucro: 0,
      custos: 0,
      margem: 0
    };

    let maxLucro = -Infinity;
    let topProjectName = '—';
    let topProjectValue = 0;

    const clientBilling: Record<string, { name: string; total: number }> = {};

    rawProjects.forEach(item => {
      const val = Number(item.valor_vendido || 0);
      const profit = Number(item.lucro_liquido || 0);
      const cost = Number(item.custos_total || 0);

      totals.faturamento += val;
      totals.lucro += profit;
      totals.custos += cost;

      // Projeto Top
      if (profit > maxLucro) {
        maxLucro = profit;
        topProjectName = item.client?.name ? `${item.client.name}` : 'Projeto Sem Nome';
        topProjectValue = profit;
      }

      // Cliente Top
      if (item.cliente_id) {
        const cId = item.cliente_id;
        const cName = item.client?.name || 'Cliente';
        if (!clientBilling[cId]) {
          clientBilling[cId] = { name: cName, total: 0 };
        }
        clientBilling[cId].total += val;
      }
    });

    totals.margem = totals.faturamento > 0 ? (totals.lucro / totals.faturamento) * 100 : 0;

    // Principal Cliente
    let topClientName = '—';
    let topClientValue = 0;
    Object.values(clientBilling).forEach(c => {
      if (c.total > topClientValue) {
        topClientValue = c.total;
        topClientName = c.name;
      }
    });

    // Alertas de caixa
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().split('T')[0];

    const pagarSemana = payables
      .filter(p => !p.paid_at && p.due_date && p.due_date <= nextWeekStr)
      .reduce((acc, p) => acc + Number(p.amount || 0), 0);

    const receberSemana = receivables
      .filter(r => r.status !== 'recebido' && r.due_date && r.due_date <= nextWeekStr)
      .reduce((acc, r) => acc + (Number(r.total_amount || 0) - Number(r.received_amount || 0)), 0);

    // Gráfico de Faturamento vs Lucro (Top 8 por lucro)
    const sortedProjects = [...rawProjects]
      .sort((a, b) => Number(b.lucro_liquido || 0) - Number(a.lucro_liquido || 0))
      .slice(0, 8)
      .map(p => ({
        name: p.client?.name || 'Projeto',
        Faturamento: Number(p.valor_vendido || 0),
        Lucro: Number(p.lucro_liquido || 0)
      }));

    // Títulos Atrasados
    const overdueList = rawProjects
      .filter(p => p.vencido || p.status_titulo === 'pagamento_atraso')
      .map(p => ({
        id: p.id,
        clientName: p.client?.name || 'Cliente',
        amount: Number(p.valor_vendido || 0),
        dueDate: p.data_recebimento_negociada
      }));

    const totalOverdue = overdueList.reduce((acc, o) => acc + o.amount, 0);

    return {
      totals,
      topProject: { name: topProjectName, val: topProjectValue },
      topClient: { name: topClientName, val: topClientValue },
      pagarSemana,
      receberSemana,
      overdueList,
      totalOverdue,
      chartData: sortedProjects
    };
  }, [rawProjects, payables, receivables]);

  const formatBRL = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  // Lista de blocos ordenada reativa (baseada em preferências ou tempPreferences)
  const currentPreferences = isEditing ? tempPreferences : preferences;
  const activeBlocks = currentPreferences.filter(p => p.visible);

  return (
    <div className="space-y-8 font-work-sans relative">
      
      {/* HEADER DE CONTEXTO DE EDIÇÃO */}
      {isEditing && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-lumos-surface border-b border-lumos-yellow/20 py-4 px-8 shadow-2xl flex items-center justify-between animate-in fade-in slide-in-from-top duration-300">
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="w-5 h-5 text-lumos-yellow animate-pulse" />
            <div>
              <p className="text-sm font-black text-lumos-text-primary uppercase tracking-wider">Modo de Edição do Dashboard</p>
              <p className="text-[10px] text-lumos-text-secondary mt-0.5 font-bold">Ligue/desligue blocos no painel lateral e arraste os cards para reorganizar.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={cancelEditing}
              className="px-4 py-2 rounded-full border border-lumos-border text-lumos-text-secondary text-xs font-black uppercase hover:text-lumos-text-primary hover:border-lumos-text-secondary transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={saveEditing}
              className="px-5 py-2 rounded-full bg-lumos-yellow text-lumos-bg text-xs font-black uppercase hover:shadow-[0_0_15px_rgba(239,199,0,0.4)] transition-all scale-105 active:scale-95"
            >
              Salvar Layout
            </button>
          </div>
        </div>
      )}

      {/* HEADER DE NAVEGAÇÃO E SELETOR */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 ${isEditing ? 'pt-16' : ''} transition-all`}>
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Dashboard Financeiro</h1>
          <p className="text-lumos-text-secondary font-medium mt-1">Visão geral da saúde econômica da Lumos.</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Botão de Modo de Edição (escondido se já estiver editando) */}
          {!isEditing && (
            <button
              onClick={startEditing}
              className="flex items-center gap-2 px-4 py-2 border border-lumos-border hover:border-lumos-yellow/40 rounded-full text-xs font-black uppercase tracking-wider text-lumos-text-secondary hover:text-lumos-yellow transition-all"
              title="Personalizar layout de blocos"
            >
              <Settings className="w-4 h-4" /> Personalizar Painel
            </button>
          )}

          {/* Seletor de Período Global */}
          <div className="flex bg-lumos-surface/40 p-1 border border-lumos-border/50 rounded-full w-fit">
            {(['semana', 'mes', 'trimestre', 'semestre', 'ano'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                  period === p
                    ? 'bg-lumos-yellow text-lumos-bg shadow-md scale-105'
                    : 'text-lumos-text-secondary hover:text-lumos-text-primary'
                }`}
              >
                {p === 'semana' && 'Semana'}
                {p === 'mes' && 'Mês'}
                {p === 'trimestre' && 'Trimestre'}
                {p === 'semestre' && 'Semestre'}
                {p === 'ano' && 'Ano'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* CORE DO DRAG AND DROP */}
      {activeBlocks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 border border-dashed border-lumos-border/50 rounded-lumos bg-lumos-surface/10 text-center">
          <EyeOff className="w-12 h-12 text-lumos-text-secondary/30 mb-4 animate-bounce" />
          <h3 className="text-base font-bold text-lumos-text-primary">Nenhum Bloco Visível</h3>
          <p className="text-xs text-lumos-text-secondary mt-1.5 max-w-sm leading-relaxed">
            Seu dashboard está totalmente vazio. Clique no botão abaixo para escolher quais blocos de dados você deseja exibir.
          </p>
          <button
            onClick={() => {
              if (!isEditing) startEditing();
              else setIsDrawerOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 mt-5 bg-lumos-yellow text-lumos-bg text-xs font-black uppercase rounded-full hover:shadow-[0_0_10px_rgba(239,199,0,0.3)] transition-all scale-105 active:scale-95"
          >
            <Plus className="w-4 h-4" /> Adicionar Blocos
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={activeBlocks.map(p => p.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {activeBlocks.map(blockPref => {
                const catalogBlock = DASHBOARD_BLOCKS_CATALOG.find(c => c.id === blockPref.id);
                if (!catalogBlock) return null;

                return (
                  <SortableBlockWrapper
                    key={catalogBlock.id}
                    block={catalogBlock}
                    isEditing={isEditing}
                    onHide={() => toggleBlockVisibility(catalogBlock.id)}
                  >
                    {/* KPI Faturamento */}
                    {catalogBlock.id === 'kpi-faturamento' && (
                      <div>
                        <div className="p-2 bg-green-500/10 rounded-lumos text-green-500 w-fit mb-4">
                          <TrendingUp className="w-5 h-5" />
                        </div>
                        <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">
                          Faturamento {period === 'semana' ? 'da Semana' : period === 'mes' ? 'do Mês' : period === 'trimestre' ? 'do Trimestre' : period === 'semestre' ? 'do Semestre' : 'do Ano'}
                        </p>
                        <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">
                          {formatBRL(dashboardData.totals.faturamento)}
                        </p>
                      </div>
                    )}

                    {/* KPI Lucro Líquido */}
                    {catalogBlock.id === 'kpi-lucro-liquido' && (
                      <div>
                        <div className="p-2 bg-lumos-yellow/10 rounded-lumos text-lumos-yellow w-fit mb-4">
                          <DollarSign className="w-5 h-5" />
                        </div>
                        <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Lucro Líquido Real</p>
                        <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">
                          {formatBRL(dashboardData.totals.lucro)}
                        </p>
                      </div>
                    )}

                    {/* KPI Margem Média */}
                    {catalogBlock.id === 'kpi-margem-media' && (
                      <div>
                        <div className="p-2 bg-amber-500/10 rounded-lumos text-amber-500 w-fit mb-4">
                          <Activity className="w-5 h-5" />
                        </div>
                        <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Margem Real Média</p>
                        <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">
                          {dashboardData.totals.margem.toFixed(1)}%
                        </p>
                      </div>
                    )}

                    {/* KPI Projeto Top */}
                    {catalogBlock.id === 'kpi-projeto-top' && (
                      <div>
                        <div className="p-2 bg-green-500/10 rounded-lumos text-green-500 w-fit mb-4">
                          <Award className="w-5 h-5" />
                        </div>
                        <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Projeto Mais Rentável (Lucro)</p>
                        <p className="text-base font-black text-lumos-text-primary mt-1.5 truncate tracking-tight">
                          {dashboardData.topProject.name}
                        </p>
                        <p className="text-xs text-green-500 font-extrabold mt-1">
                          + {formatBRL(dashboardData.topProject.val)}
                        </p>
                      </div>
                    )}

                    {/* KPI Cliente Top */}
                    {catalogBlock.id === 'kpi-cliente-top' && (
                      <div>
                        <div className="p-2 bg-blue-500/10 rounded-lumos text-blue-500 w-fit mb-4">
                          <Users className="w-5 h-5" />
                        </div>
                        <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Principal Cliente (Faturamento)</p>
                        <p className="text-base font-black text-lumos-text-primary mt-1.5 truncate tracking-tight">
                          {dashboardData.topClient.name}
                        </p>
                        <p className="text-xs text-blue-400 font-extrabold mt-1">
                          Faturou {formatBRL(dashboardData.topClient.val)}
                        </p>
                      </div>
                    )}

                    {/* Gráfico Faturamento vs Lucro */}
                    {catalogBlock.id === 'chart-fat-vs-lucro' && (
                      <div className="w-full">
                        <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-6 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-lumos-yellow" /> Faturamento vs Lucro Líquido por Projeto (Top 8)
                        </h3>
                        {dashboardData.chartData.length === 0 ? (
                          <div className="text-center py-16 text-xs text-lumos-text-secondary italic">Nenhum dado faturado no período.</div>
                        ) : (
                          <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={dashboardData.chartData} barGap={4}>
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
                              <Bar dataKey="Faturamento" name="Faturamento" fill="#22c55e" radius={[2, 2, 0, 0]} />
                              <Bar dataKey="Lucro" name="Lucro Líquido" fill="#EFC700" radius={[2, 2, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    )}

                    {/* Alertas de Títulos Atrasados */}
                    {catalogBlock.id === 'panel-titulos-atrasados' && (
                      <div className="w-full space-y-4">
                        <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2 border-b border-lumos-border pb-3">
                          <AlertCircle className="w-4 h-4 text-red-500" /> Títulos em Atraso (Inadimplência)
                        </h3>

                        {dashboardData.overdueList.length === 0 ? (
                          <p className="text-xs text-lumos-text-secondary italic text-center py-8">Nenhum título em atraso no período.</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lumos text-center flex flex-col justify-center">
                              <p className="text-[9px] font-bold text-lumos-text-secondary uppercase tracking-wider">Total em Atraso no Período</p>
                              <p className="text-2xl font-black text-red-500 mt-1">{formatBRL(dashboardData.totalOverdue)}</p>
                            </div>

                            <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                              {dashboardData.overdueList.map(proj => (
                                <div key={proj.id} className="p-2.5 rounded border border-lumos-border/50 bg-lumos-bg/30 text-xs">
                                  <div className="flex justify-between items-start gap-1">
                                    <span className="font-bold text-lumos-text-primary line-clamp-1">{proj.clientName}</span>
                                    <span className="font-bold text-red-500 whitespace-nowrap">{formatBRL(proj.amount)}</span>
                                  </div>
                                  <p className="text-[9px] text-lumos-text-secondary mt-1 font-bold">
                                    Venceu em: {proj.dueDate ? new Date(proj.dueDate + 'T12:00:00').toLocaleDateString('pt-BR') : 'Sem data'}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </SortableBlockWrapper>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* SEÇÃO DE ALERTAS DE CAIXA OPERACIONAL (FIXA NO RODAPÉ) */}
      <div className="grid grid-cols-1 gap-6">
        <div className="card p-8">
          <h3 className="text-sm font-bold text-lumos-text-primary uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-lumos-border pb-3">
            <AlertCircle className="w-4 h-4 text-lumos-yellow" /> Alertas de Caixa: Atenção Necessária
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {dashboardData.pagarSemana > 0 ? (
              <div className="flex items-start gap-4 p-5 bg-red-500/5 border border-red-500/20 rounded-lumos transition-all hover:bg-red-500/10">
                <div className="p-2 bg-red-500/10 rounded-full text-red-500 mt-1">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-lumos-text-primary tracking-tight">Contas vencendo esta semana (a pagar)</p>
                  <p className="text-xs text-lumos-text-secondary mt-1 leading-relaxed">Você possui {formatBRL(dashboardData.pagarSemana)} em compromissos com vencimento nos próximos 7 dias.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-4 p-5 bg-lumos-border/10 border border-lumos-border/30 rounded-lumos">
                <div className="p-2 bg-lumos-border/20 rounded-full text-lumos-text-secondary mt-1">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-lumos-text-secondary tracking-tight">Sem contas a pagar esta semana</p>
                  <p className="text-xs text-lumos-text-secondary/55 mt-1 leading-relaxed">Nenhum compromisso financeiro agendado para os próximos 7 dias.</p>
                </div>
              </div>
            )}

            {dashboardData.receberSemana > 0 ? (
              <div className="flex items-start gap-4 p-5 bg-blue-500/5 border border-blue-500/20 rounded-lumos transition-all hover:bg-blue-500/10">
                <div className="p-2 bg-blue-500/10 rounded-full text-blue-500 mt-1">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-lumos-text-primary tracking-tight">Recebíveis previstos para esta semana (a receber)</p>
                  <p className="text-xs text-lumos-text-secondary mt-1 leading-relaxed">Existem {formatBRL(dashboardData.receberSemana)} previstos para entrar no caixa nos próximos 7 dias.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-4 p-5 bg-lumos-border/10 border border-lumos-border/30 rounded-lumos">
                <div className="p-2 bg-lumos-border/20 rounded-full text-lumos-text-secondary mt-1">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-lumos-text-secondary tracking-tight">Sem previsões de recebimento esta semana</p>
                  <p className="text-xs text-lumos-text-secondary/55 mt-1 leading-relaxed">Nenhuma fatura ou pagamento previsto para faturamento nos próximos 7 dias.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PAINEL LATERAL (DRAWER) DE ATIVAÇÃO DE BLOCOS */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden font-work-sans">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setIsDrawerOpen(false)}
          />

          <div className="absolute inset-y-0 right-0 pl-10 max-w-full flex">
            <div className="w-screen max-w-md bg-lumos-surface border-l border-lumos-border shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
              {/* Header */}
              <div className="p-6 border-b border-lumos-border flex justify-between items-center bg-lumos-surface/80 backdrop-blur-md sticky top-0 z-10">
                <div>
                  <h2 className="text-lg font-black text-lumos-text-primary uppercase tracking-wider">Catálogo de Blocos</h2>
                  <p className="text-[10px] text-lumos-text-secondary mt-0.5 font-bold">Gerencie quais blocos de dados deseja visualizar.</p>
                </div>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-1 rounded-full text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-white/5 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Lista do Catálogo */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                
                {/* Categoria Rentabilidade */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-lumos-yellow uppercase tracking-widest border-b border-lumos-border pb-1">Rentabilidade e Alertas</h4>
                  {DASHBOARD_BLOCKS_CATALOG.filter(b => b.group === 'rentabilidade' && !b.isFuture).map(block => {
                    const pref = tempPreferences.find(p => p.id === block.id);
                    const isVisible = pref?.visible ?? false;

                    return (
                      <div key={block.id} className="flex items-start justify-between p-3 rounded-lg border border-lumos-border bg-lumos-bg/30 hover:bg-lumos-bg/50 transition-all">
                        <div className="pr-4">
                          <p className="text-xs font-bold text-lumos-text-primary">{block.title}</p>
                          <p className="text-[9px] text-lumos-text-secondary leading-snug mt-1">{block.description}</p>
                        </div>
                        <button
                          onClick={() => toggleBlockVisibility(block.id)}
                          className={`w-10 h-6 flex items-center rounded-full p-1 transition-all ${
                            isVisible ? 'bg-lumos-yellow justify-end' : 'bg-lumos-border justify-start'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-full shadow-md transition-all ${
                            isVisible ? 'bg-lumos-bg' : 'bg-lumos-text-secondary/50'
                          }`} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Categoria Resultados */}
                <div className="space-y-3 font-work-sans">
                  <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest border-b border-lumos-border pb-1">Análises e Resultados</h4>
                  {DASHBOARD_BLOCKS_CATALOG.filter(b => b.group === 'resultado' && !b.isFuture).map(block => {
                    const pref = tempPreferences.find(p => p.id === block.id);
                    const isVisible = pref?.visible ?? false;

                    return (
                      <div key={block.id} className="flex items-start justify-between p-3 rounded-lg border border-lumos-border bg-lumos-bg/30 hover:bg-lumos-bg/50 transition-all">
                        <div className="pr-4">
                          <p className="text-xs font-bold text-lumos-text-primary">{block.title}</p>
                          <p className="text-[9px] text-lumos-text-secondary leading-snug mt-1">{block.description}</p>
                        </div>
                        <button
                          onClick={() => toggleBlockVisibility(block.id)}
                          className={`w-10 h-6 flex items-center rounded-full p-1 transition-all ${
                            isVisible ? 'bg-lumos-yellow justify-end' : 'bg-lumos-border justify-start'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-full shadow-md transition-all ${
                            isVisible ? 'bg-lumos-bg' : 'bg-lumos-text-secondary/50'
                          }`} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Categoria Caixa V2 (Indisponíveis) */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest border-b border-lumos-border pb-1">Módulos de Caixa Real</h4>
                  {DASHBOARD_BLOCKS_CATALOG.filter(b => b.isFuture).map(block => {
                    return (
                      <div key={block.id} className="flex items-start justify-between p-3 rounded-lg border border-lumos-border/50 bg-lumos-bg/10 opacity-60">
                        <div className="pr-4">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-bold text-lumos-text-secondary">{block.title}</p>
                            <span className="text-[8px] bg-lumos-border text-lumos-text-secondary px-1.5 py-0.2 rounded uppercase font-black tracking-wider scale-90">V2</span>
                          </div>
                          <p className="text-[9px] text-lumos-text-secondary/60 leading-snug mt-1">{block.description}</p>
                        </div>
                        <button
                          disabled
                          className="w-10 h-6 flex items-center rounded-full p-1 bg-lumos-border/30 justify-start cursor-not-allowed"
                        >
                          <div className="w-4 h-4 rounded-full shadow-md bg-lumos-text-secondary/20" />
                        </button>
                      </div>
                    );
                  })}
                </div>

              </div>

              {/* Rodapé do Drawer com Ações */}
              <div className="p-6 border-t border-lumos-border bg-lumos-surface flex items-center gap-3 sticky bottom-0 z-10">
                <button
                  onClick={cancelEditing}
                  className="flex-1 py-2.5 rounded-full border border-lumos-border text-lumos-text-secondary text-xs font-black uppercase hover:text-lumos-text-primary hover:border-lumos-text-secondary transition-all text-center"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveEditing}
                  className="flex-1 py-2.5 rounded-full bg-lumos-yellow text-lumos-bg text-xs font-black uppercase hover:shadow-[0_0_15px_rgba(239,199,0,0.4)] transition-all text-center"
                >
                  Salvar Layout
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Wrapper Sortable com o useSortable do dnd-kit
interface SortableBlockWrapperProps {
  block: DashboardBlockDef;
  isEditing: boolean;
  onHide: () => void;
  children: React.ReactNode;
}

function SortableBlockWrapper({ block, isEditing, onHide, children }: SortableBlockWrapperProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : 'auto'
  };

  // Mapeamento dinâmico de largura com base no defaultSize
  const colSpanClass = useMemo(() => {
    switch (block.defaultSize) {
      case 'small':
        return 'col-span-1 md:col-span-2 lg:col-span-1';
      case 'medium':
        return 'col-span-1 md:col-span-2 lg:col-span-2';
      case 'large':
        return 'col-span-1 md:col-span-3 lg:col-span-3';
      case 'full':
        return 'col-span-1 md:col-span-4 lg:col-span-4';
      default:
        return 'col-span-1';
    }
  }, [block.defaultSize]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card p-6 shadow-lg transition-all relative group flex flex-col justify-between ${colSpanClass} ${
        isEditing
          ? 'border border-dashed border-lumos-yellow/40 bg-lumos-surface/50 hover:border-lumos-yellow transition-colors'
          : 'border border-lumos-border/40'
      }`}
    >
      {/* Botões do modo de edição */}
      {isEditing && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-90 z-20">
          {/* Botão de Drag Handle */}
          <div
            {...attributes}
            {...listeners}
            className="p-1 rounded bg-lumos-bg/90 border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow/40 cursor-grab active:cursor-grabbing transition-all"
            title="Arraste para reordenar"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>
          {/* Botão de Ocultar (X) */}
          <button
            onClick={onHide}
            className="p-1 rounded bg-lumos-bg/90 border border-lumos-border text-lumos-text-secondary hover:text-red-400 hover:border-red-400/40 transition-all"
            title="Ocultar bloco"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Conteúdo interno do bloco */}
      <div className="w-full flex-1 flex flex-col justify-center">
        {children}
      </div>
    </div>
  );
}
