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
  Plus,
  FileText,
  TrendingDown,
  FolderOpen
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
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
  size?: 'small' | 'medium' | 'full';
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
    id: 'kpi-impostos',
    title: 'Provisão de Impostos',
    description: 'Estimativa de impostos incidentes sobre o faturamento do período (18%).',
    group: 'rentabilidade',
    defaultSize: 'small',
    defaultActive: false
  },
  {
    id: 'kpi-receita-liquida',
    title: 'Receita Líquida',
    description: 'Receita bruta deduzindo a estimativa de impostos incidentes.',
    group: 'rentabilidade',
    defaultSize: 'small',
    defaultActive: false
  },
  {
    id: 'kpi-custos-projetos',
    title: 'Custos de Projetos',
    description: 'Total acumulado de custos de produção lançados nos projetos do período.',
    group: 'rentabilidade',
    defaultSize: 'small',
    defaultActive: false
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
    defaultSize: 'medium',
    defaultActive: true
  },
  {
    id: 'chart-desempenho-cliente',
    title: 'Gráfico: Desempenho por Cliente',
    description: 'Visão de faturamento e lucro acumulados por cliente no período.',
    group: 'resultado',
    defaultSize: 'medium',
    defaultActive: false
  },
  {
    id: 'chart-matriz-categoria',
    title: 'Gráfico: Matriz por Categoria',
    description: 'Faturamento bruto e lucro gerado agrupados por categoria de projeto (Digital / Filme / Live).',
    group: 'resultado',
    defaultSize: 'medium',
    defaultActive: false
  },
  {
    id: 'panel-icp',
    title: 'Painel ICP (Foco por Perfil)',
    description: 'Divisão de lucro e margem média por perfil de cliente (ICP 1, ICP 2, etc.).',
    group: 'resultado',
    defaultSize: 'medium',
    defaultActive: false
  },
  {
    id: 'table-detalhamento',
    title: 'Tabela: Detalhamento de Projetos',
    description: 'Planilha completa detalhando faturamento, custos e lucratividade projeto a projeto.',
    group: 'resultado',
    defaultSize: 'full',
    defaultActive: false
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
  { id: 'kpi-faturamento', visible: true, size: 'small' },
  { id: 'kpi-lucro-liquido', visible: true, size: 'small' },
  { id: 'kpi-margem-media', visible: true, size: 'small' },
  { id: 'kpi-projeto-top', visible: true, size: 'medium' },
  { id: 'kpi-cliente-top', visible: true, size: 'medium' },
  { id: 'chart-fat-vs-lucro', visible: true, size: 'medium' },
  { id: 'panel-titulos-atrasados', visible: true, size: 'full' }
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

  // Tempo real: lançamentos alterados por outros usuários atualizam o dashboard
  useRealtimeRefetch(['payables', 'receivables', 'project_costs', 'reimbursements'], () => fetchDashboardData());

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

  // Limite SUPERIOR (exclusivo) do período. Para períodos de calendário (mês/ano)
  // vai até o fim do mês/ano corrente; para os deslizantes vai até hoje (amanhã
  // exclusivo). Fecha o intervalo para não contar datas fora do período.
  const getEndExclusive = (periodType: PeriodType): string => {
    const now = new Date();
    let end: Date;
    switch (periodType) {
      case 'mes':
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case 'ano':
        end = new Date(now.getFullYear() + 1, 0, 1);
        break;
      case 'semana':
      case 'trimestre':
      case 'semestre':
      default:
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        break;
    }
    return end.toISOString().split('T')[0];
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
    const merged = saved.map(p => {
      const catBlock = DASHBOARD_BLOCKS_CATALOG.find(c => c.id === p.id);
      return {
        ...p,
        size: p.size || (catBlock?.defaultSize as any) || 'medium'
      };
    });

    // Adiciona blocos do catálogo que não existem nas preferências salvas
    DASHBOARD_BLOCKS_CATALOG.forEach(catalogBlock => {
      // Ignora blocos futuros de caixa
      if (catalogBlock.isFuture) return;

      const exists = merged.some(p => p.id === catalogBlock.id);
      if (!exists) {
        merged.push({
          id: catalogBlock.id,
          visible: catalogBlock.defaultActive,
          size: catalogBlock.defaultSize as any
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
        const { error } = await supabase.from('dashboard_preferences').upsert({
          user_id: user.id,
          preferences: updatedPref,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

        if (error) throw error;
      }
    } catch (error) {
      console.error('Erro ao salvar preferências no banco/local:', error);
    }
  }

  async function fetchDashboardData() {
    try {
      const startDate = getStartDate(period);
      const endExclusive = getEndExclusive(period);

      const [rentRes, payablesRes, receivablesRes] = await Promise.all([
        supabase
          .from('vw_rentabilidade')
          .select('*, client:clients(name), project:projects(name), categoria:categorias(nome), tipo_servico:tipos_servico(nome)')
          .or(`and(data_recebimento_negociada.gte.${startDate},data_recebimento_negociada.lt.${endExclusive}),and(created_at.gte.${startDate},created_at.lt.${endExclusive})`),
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

  const changeBlockSize = (id: string, size: 'small' | 'medium' | 'full') => {
    setTempPreferences(prev =>
      prev.map(p => (p.id === id ? { ...p, size } : p))
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
      margem: 0,
      nfTotal: 0,
      receitaLiquida: 0
    };

    let maxLucro = -Infinity;
    let topProjectName = '—';
    let topProjectValue = 0;

    const clientBilling: Record<string, { name: string; total: number }> = {};
    const categoryGroups: Record<string, { name: string; Faturamento: number; Lucro: number }> = {};
    const clientGroups: Record<string, { name: string; Faturamento: number; Lucro: number }> = {};

    rawProjects.forEach(item => {
      const val = Number(item.valor_vendido || 0);
      const profit = Number(item.lucro_liquido || 0);
      const cost = Number(item.custos_total || 0);
      const nf = Number(item.valor_nf || 0);
      const netReceita = Number(item.receita_liquida || 0);

      totals.faturamento += val;
      totals.lucro += profit;
      totals.custos += cost;
      totals.nfTotal += nf;
      totals.receitaLiquida += netReceita;

      // Projeto Top
      if (profit > maxLucro) {
        maxLucro = profit;
        topProjectName = item.client?.name ? `${item.client.name}` : 'Projeto Sem Nome';
        topProjectValue = profit;
      }

      // Cliente Top (KPI)
      if (item.cliente_id) {
        const cId = item.cliente_id;
        const cName = item.client?.name || 'Cliente';
        if (!clientBilling[cId]) {
          clientBilling[cId] = { name: cName, total: 0 };
        }
        clientBilling[cId].total += val;
      }

      // Agrupamento categoria
      const catName = item.categoria?.nome || 'Sem Categoria';
      const catId = item.categoria_id || 'unmapped';
      if (!categoryGroups[catId]) {
        categoryGroups[catId] = { name: catName, Faturamento: 0, Lucro: 0 };
      }
      categoryGroups[catId].Faturamento += val;
      categoryGroups[catId].Lucro += profit;

      // Agrupamento cliente (Desempenho por Cliente)
      const cliName = item.client?.name || 'Cliente Desconhecido';
      const cliId = item.cliente_id || 'unmapped';
      if (!clientGroups[cliId]) {
        clientGroups[cliId] = { name: cliName, Faturamento: 0, Lucro: 0 };
      }
      clientGroups[cliId].Faturamento += val;
      clientGroups[cliId].Lucro += profit;
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

    // Gráficos extras
    const categoryChartData = Object.values(categoryGroups).sort((a, b) => b.Lucro - a.Lucro);
    const clientChartData = Object.values(clientGroups).sort((a, b) => b.Lucro - a.Lucro).slice(0, 8);

    // ICP Metrics
    const icp1Data = rawProjects.filter(d => d.icp === 'icp_1');
    const icp2Data = rawProjects.filter(d => d.icp === 'icp_2');
    const icpUnmappedData = rawProjects.filter(d => !d.icp);

    const computeMetrics = (list: any[]) => {
      const totalVal = list.reduce((acc, i) => acc + Number(i.valor_vendido || 0), 0);
      const totalLucro = list.reduce((acc, i) => acc + Number(i.lucro_liquido || 0), 0);
      const avgMargin = totalVal > 0 ? (totalLucro / totalVal) * 100 : 0;
      return { totalVal, totalLucro, avgMargin };
    };

    const icpMetrics = {
      icp1: computeMetrics(icp1Data),
      icp2: computeMetrics(icp2Data),
      unmapped: computeMetrics(icpUnmappedData)
    };

    // Detail list
    const detailList = rawProjects.map(proj => ({
      id: proj.id,
      clientName: proj.client?.name || 'Sem Cliente',
      projectName: proj.project?.name || '—',
      categoriaName: proj.categoria?.nome || 'Sem Categ.',
      servicoName: proj.tipo_servico?.nome || 'Sem Serv.',
      icp: proj.icp,
      valorVendido: Number(proj.valor_vendido || 0),
      valorNf: Number(proj.valor_nf || 0),
      custosTotal: Number(proj.custos_total || 0),
      lucroLiquido: Number(proj.lucro_liquido || 0),
      margem: Number(proj.margem || 0) * 100,
      statusTitulo: proj.status_titulo,
      vencido: proj.vencido,
      dataRecebimento: proj.data_recebimento_negociada
    }));

    return {
      totals,
      topProject: { name: topProjectName, val: topProjectValue },
      topClient: { name: topClientName, val: topClientValue },
      pagarSemana,
      receberSemana,
      overdueList,
      totalOverdue,
      chartData: sortedProjects,
      categoryChartData,
      clientChartData,
      icpMetrics,
      detailList
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

                const prefSize = blockPref.size || catalogBlock.defaultSize;

                return (
                  <SortableBlockWrapper
                    key={catalogBlock.id}
                    block={catalogBlock}
                    size={prefSize as any}
                    isEditing={isEditing}
                    onHide={() => toggleBlockVisibility(catalogBlock.id)}
                    onChangeSize={(newSize) => changeBlockSize(catalogBlock.id, newSize)}
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

                    {/* KPI Impostos */}
                    {catalogBlock.id === 'kpi-impostos' && (
                      <div>
                        <div className="p-2 bg-purple-500/10 rounded-lumos text-purple-500 w-fit mb-4">
                          <FileText className="w-5 h-5" />
                        </div>
                        <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Provisão de Impostos (18%)</p>
                        <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">
                          {formatBRL(dashboardData.totals.nfTotal)}
                        </p>
                      </div>
                    )}

                    {/* KPI Receita Líquida */}
                    {catalogBlock.id === 'kpi-receita-liquida' && (
                      <div>
                        <div className="p-2 bg-cyan-500/10 rounded-lumos text-cyan-500 w-fit mb-4">
                          <TrendingUp className="w-5 h-5" />
                        </div>
                        <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Receita Líquida</p>
                        <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">
                          {formatBRL(dashboardData.totals.receitaLiquida)}
                        </p>
                      </div>
                    )}

                    {/* KPI Custos de Projetos */}
                    {catalogBlock.id === 'kpi-custos-projetos' && (
                      <div>
                        <div className="p-2 bg-red-500/10 rounded-lumos text-red-500 w-fit mb-4">
                          <TrendingDown className="w-5 h-5" />
                        </div>
                        <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Custos de Projetos</p>
                        <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">
                          {formatBRL(dashboardData.totals.custos)}
                        </p>
                      </div>
                    )}

                    {/* Gráfico Desempenho por Cliente */}
                    {catalogBlock.id === 'chart-desempenho-cliente' && (
                      <div className="w-full">
                        <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-6 flex items-center gap-2">
                          <Users className="w-4 h-4 text-lumos-yellow" /> Desempenho por Cliente (Top 8)
                        </h3>
                        {dashboardData.clientChartData.length === 0 ? (
                          <div className="text-center py-16 text-xs text-lumos-text-secondary italic">Nenhum faturamento por cliente no período.</div>
                        ) : (
                          <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={dashboardData.clientChartData} barGap={4}>
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

                    {/* Gráfico Matriz por Categoria */}
                    {catalogBlock.id === 'chart-matriz-categoria' && (
                      <div className="w-full">
                        <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest mb-6 flex items-center gap-2">
                          <FolderOpen className="w-4 h-4 text-lumos-yellow" /> Matriz por Categoria
                        </h3>
                        {dashboardData.categoryChartData.length === 0 ? (
                          <div className="text-center py-16 text-xs text-lumos-text-secondary italic">Sem dados de categorias no período.</div>
                        ) : (
                          <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={dashboardData.categoryChartData} barGap={4}>
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

                    {/* Painel ICP (Foco por Perfil) */}
                    {catalogBlock.id === 'panel-icp' && (
                      <div className="w-full space-y-4">
                        <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2 border-b border-lumos-border pb-3">
                          <Award className="w-4 h-4 text-lumos-yellow" /> Resposta CEO: ICP
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          {/* ICP 1 */}
                          <div className="p-4 bg-lumos-yellow/5 border border-lumos-yellow/20 rounded-lumos">
                            <p className="text-[10px] font-black text-lumos-yellow uppercase tracking-widest">ICP 1 (Principal)</p>
                            <div className="grid grid-cols-2 gap-4 mt-3">
                              <div>
                                <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Lucro Líquido</p>
                                <p className="text-sm font-black text-lumos-text-primary tracking-tight mt-0.5">{formatBRL(dashboardData.icpMetrics.icp1.totalLucro)}</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Margem Líquida</p>
                                <p className="text-sm font-black text-lumos-text-primary tracking-tight mt-0.5">{dashboardData.icpMetrics.icp1.avgMargin.toFixed(1)}%</p>
                              </div>
                            </div>
                          </div>

                          {/* ICP 2 */}
                          <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lumos">
                            <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">ICP 2 (Secundário)</p>
                            <div className="grid grid-cols-2 gap-4 mt-3">
                              <div>
                                <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Lucro Líquido</p>
                                <p className="text-sm font-black text-lumos-text-primary tracking-tight mt-0.5">{formatBRL(dashboardData.icpMetrics.icp2.totalLucro)}</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Margem Líquida</p>
                                <p className="text-sm font-black text-lumos-text-primary tracking-tight mt-0.5">{dashboardData.icpMetrics.icp2.avgMargin.toFixed(1)}%</p>
                              </div>
                            </div>
                          </div>

                          {/* Unmapped */}
                          <div className="p-4 bg-lumos-border/30 border border-lumos-border/50 rounded-lumos">
                            <p className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Sem Classificação</p>
                            <div className="grid grid-cols-2 gap-4 mt-3">
                              <div>
                                <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Lucro Líquido</p>
                                <p className="text-sm font-black text-lumos-text-primary tracking-tight mt-0.5">{formatBRL(dashboardData.icpMetrics.unmapped.totalLucro)}</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-lumos-text-secondary uppercase font-bold">Margem Líquida</p>
                                <p className="text-sm font-black text-lumos-text-primary tracking-tight mt-0.5">{dashboardData.icpMetrics.unmapped.avgMargin.toFixed(1)}%</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tabela de Detalhamento dos Dados */}
                    {catalogBlock.id === 'table-detalhamento' && (
                      <div className="w-full space-y-4">
                        <div className="flex justify-between items-center border-b border-lumos-border pb-3">
                          <h3 className="text-xs font-black text-lumos-text-primary uppercase tracking-widest flex items-center gap-2">
                            <FileText className="w-4 h-4 text-lumos-yellow" /> Detalhamento de Projetos (Período)
                          </h3>
                          <span className="text-[10px] bg-lumos-yellow/10 text-lumos-yellow px-2 py-0.5 rounded-full font-bold">
                            {dashboardData.detailList.length} projetos
                          </span>
                        </div>

                        <div className="overflow-x-auto custom-scrollbar">
                          <table className="w-full text-left text-xs font-medium border-collapse lumos-sticky-1">
                            <thead>
                              <tr className="bg-lumos-surface/40 text-[9px] font-black text-lumos-text-secondary uppercase tracking-wider border-b border-lumos-border">
                                <th className="py-2.5 px-3">Cliente</th>
                                <th className="py-2.5 px-3">Projeto</th>
                                <th className="py-2.5 px-3">Categoria</th>
                                <th className="py-2.5 px-3 text-right">Fat. Bruto</th>
                                <th className="py-2.5 px-3 text-right">Valor de NF aprox.</th>
                                <th className="py-2.5 px-3 text-right">Custos</th>
                                <th className="py-2.5 px-3 text-right">Lucro Líquido</th>
                                <th className="py-2.5 px-3 text-right">Margem %</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-lumos-border/40">
                              {dashboardData.detailList.length === 0 ? (
                                <tr>
                                  <td colSpan={8} className="py-8 text-center text-xs text-lumos-text-secondary italic">Nenhum projeto encontrado para este período.</td>
                                </tr>
                              ) : (
                                dashboardData.detailList.map(proj => (
                                  <tr key={proj.id} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="py-2.5 px-3">
                                      <p className="font-bold text-lumos-text-primary">{proj.clientName}</p>
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <p className="font-bold text-lumos-text-primary line-clamp-2">{proj.projectName}</p>
                                      <p className="text-[9px] text-lumos-text-secondary mt-0.5 flex items-center gap-1">
                                        {proj.statusTitulo === 'pagamento_recebido' && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                                        {(proj.statusTitulo === 'pagamento_atraso' || proj.vencido) && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                                        {proj.statusTitulo === 'emitir_nf' && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
                                        {proj.statusTitulo === 'pedido_nf_feito' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                                        {proj.statusTitulo === 'esperando_pagamento' && !proj.vencido && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                                        {proj.statusTitulo === 'pagamento_recebido' ? 'Recebido' :
                                         proj.statusTitulo === 'pagamento_atraso' || proj.vencido ? 'Atrasado' :
                                         proj.statusTitulo === 'emitir_nf' ? 'Emitir NF' :
                                         proj.statusTitulo === 'pedido_nf_feito' ? 'NF Solicitada' : 'Esperando Pgto'}
                                        {proj.dataRecebimento && ` · Vence ${new Date(proj.dataRecebimento + 'T12:00:00').toLocaleDateString('pt-BR')}`}
                                      </p>
                                    </td>
                                    <td className="py-2.5 px-3 space-y-0.5">
                                      <span className="inline-block text-[8px] bg-lumos-border/60 text-lumos-text-primary px-1.5 py-0.2 rounded mr-1 uppercase font-bold">
                                        {proj.categoriaName}
                                      </span>
                                      {proj.icp && (
                                        <span className="inline-block text-[8px] bg-lumos-yellow/10 text-lumos-yellow px-1.5 py-0.2 rounded uppercase font-bold">
                                          {proj.icp === 'icp_1' ? 'ICP 1' : 'ICP 2'}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-bold text-lumos-text-primary">{formatBRL(proj.valorVendido)}</td>
                                    <td className="py-2.5 px-3 text-right text-purple-400 font-bold">{formatBRL(proj.valorNf)}</td>
                                    <td className="py-2.5 px-3 text-right text-red-400 font-bold">{formatBRL(proj.custosTotal)}</td>
                                    <td className={`py-2.5 px-3 text-right font-black ${proj.lucroLiquido >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {formatBRL(proj.lucroLiquido)}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-black">
                                      <span className={`px-1.5 py-0.2 rounded text-[9px] ${proj.margem >= 40 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                        {proj.margem.toFixed(1)}%
                                      </span>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
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
  size: 'small' | 'medium' | 'full';
  isEditing: boolean;
  onHide: () => void;
  onChangeSize: (size: 'small' | 'medium' | 'full') => void;
  children: React.ReactNode;
}

function SortableBlockWrapper({ block, size, isEditing, onHide, onChangeSize, children }: SortableBlockWrapperProps) {
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

  // Mapeamento dinâmico de largura com base no size (com fallback responsivo)
  const colSpanClass = useMemo(() => {
    switch (size) {
      case 'small':
        return 'col-span-1 md:col-span-1 lg:col-span-1';
      case 'medium':
        return 'col-span-1 md:col-span-2 lg:col-span-2';
      case 'full':
        return 'col-span-1 md:col-span-2 lg:col-span-4';
      default:
        return 'col-span-1';
    }
  }, [size]);

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
          {/* Seletor de Tamanho P / M / G */}
          <div className="flex bg-lumos-bg/95 border border-lumos-border/60 rounded p-0.5 items-center gap-0.5 shadow-md">
            {(['small', 'medium', 'full'] as const).map(s => (
              <button
                key={s}
                onClick={() => onChangeSize(s)}
                className={`w-5 h-5 flex items-center justify-center rounded text-[9px] font-black uppercase transition-all ${
                  size === s
                    ? 'bg-lumos-yellow text-lumos-bg'
                    : 'text-lumos-text-secondary hover:text-lumos-text-primary'
                }`}
                title={
                  s === 'small'
                    ? 'Tamanho Pequeno (1/4 da linha)'
                    : s === 'medium'
                    ? 'Tamanho Médio (2/4 da linha)'
                    : 'Tamanho Grande (Largura total)'
                }
              >
                {s === 'small' && 'P'}
                {s === 'medium' && 'M'}
                {s === 'full' && 'G'}
              </button>
            ))}
          </div>

          {/* Botão de Drag Handle */}
          <div
            {...attributes}
            {...listeners}
            className="p-1 rounded bg-lumos-bg/90 border border-lumos-border text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow/40 cursor-grab active:cursor-grabbing transition-all h-6 flex items-center justify-center"
            title="Arraste para reordenar"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* Botão de Ocultar (X) */}
          <button
            onClick={onHide}
            className="p-1 rounded bg-lumos-bg/90 border border-lumos-border text-lumos-text-secondary hover:text-red-400 hover:border-red-400/40 transition-all h-6 flex items-center justify-center"
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
