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
  DollarSign
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
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

export default function FinanceiroDashboard() {
  const [stats, setStats] = useState({
    saldoGeral: 0,
    faturamentoMes: 0,
    pagarSemana: 0,
    receberSemana: 0,
    despesasMes: 0,
    recebidoMes: 0
  });
  const [allResumo, setAllResumo] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  async function fetchDashboardData() {
    try {
      setLoading(true);
      const now = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(now.getDate() + 7);
      const nextWeekStr = nextWeek.toISOString().split('T')[0];

      const currentMonthKey = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

      const [resumoRes, payablesRes, receivablesRes] = await Promise.all([
        supabase.from('vw_resumo_mensal').select('*').order('mes', { ascending: true }),
        supabase.from('payables').select('amount, due_date, paid_at'),
        supabase.from('receivables').select('total_amount, received_amount, due_date, status, received_at')
      ]);

      const resumo = resumoRes.data || [];
      setAllResumo(resumo);

      // Saldo Geral: soma do lucro histórico
      const saldoGeral = resumo.reduce((acc, m) => acc + Number(m.lucro || 0), 0);

      // Dados do mês atual
      const currentResumo = resumo.find(r => r.mes === currentMonthKey) || { entradas: 0, saidas: 0, lucro: 0 };
      const faturamentoMes = Number(currentResumo.entradas || 0);
      const despesasMes = Number(currentResumo.saidas || 0);
      const recebidoMes = Number(currentResumo.entradas || 0);

      const pagarSemana = (payablesRes.data || [])
        .filter(p => !p.paid_at && p.due_date && p.due_date <= nextWeekStr)
        .reduce((acc, p) => acc + Number(p.amount || 0), 0);

      const receberSemana = (receivablesRes.data || [])
        .filter(r => r.status !== 'recebido' && r.due_date && r.due_date <= nextWeekStr)
        .reduce((acc, r) => acc + (Number(r.total_amount || 0) - Number(r.received_amount || 0)), 0);

      setStats({ saldoGeral, faturamentoMes, pagarSemana, receberSemana, despesasMes, recebidoMes });
    } catch (error) {
      console.error('Erro no Dashboard:', error);
    } finally {
      setLoading(false);
    }
  }

  const formatBRL = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const monthlyChartData = useMemo(() => {
    const now = new Date();
    const months: { mes: string; entradas: number; saidas: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 10); // 'YYYY-MM-01'
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

      const match = allResumo.find(r => r.mes === key) || { entradas: 0, saidas: 0 };
      months.push({
        mes: label,
        entradas: Number(match.entradas || 0),
        saidas: Number(match.saidas || 0),
      });
    }
    return months;
  }, [allResumo]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-lumos-surface border border-lumos-border rounded-lumos p-3 shadow-xl text-xs">
        <p className="font-black uppercase text-lumos-text-secondary mb-2">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} style={{ color: p.fill }} className="font-bold">
            {p.name}: {formatBRL(p.value)}
          </p>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-lumos-bg">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-lumos-yellow" />
    </div>
  );

  return (
    <div className="space-y-8 font-work-sans">
      <div>
        <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight">Dashboard Financeiro</h1>
        <p className="text-lumos-text-secondary font-medium mt-1">Visão geral da saúde econômica da Lumos.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-6 border-t-4 border-lumos-yellow shadow-lg">
          <div className="p-2 bg-lumos-yellow/10 rounded-lumos text-lumos-yellow w-fit mb-4">
            <Wallet className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Saldo Geral em Conta</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">{formatBRL(stats.saldoGeral)}</p>
        </div>

        <div className="card p-6 border-t-4 border-green-500 shadow-lg">
          <div className="p-2 bg-green-500/10 rounded-lumos text-green-500 w-fit mb-4">
            <TrendingUp className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Faturamento do Mês</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">{formatBRL(stats.faturamentoMes)}</p>
        </div>

        <div className="card p-6 border-t-4 border-red-500 shadow-lg">
          <div className="p-2 bg-red-500/10 rounded-lumos text-red-500 w-fit mb-4">
            <ArrowDownRight className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">A Pagar (7 dias)</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">{formatBRL(stats.pagarSemana)}</p>
        </div>

        <div className="card p-6 border-t-4 border-blue-500 shadow-lg">
          <div className="p-2 bg-blue-500/10 rounded-lumos text-blue-500 w-fit mb-4">
            <ArrowUpRight className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">A Receber (7 dias)</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">{formatBRL(stats.receberSemana)}</p>
        </div>
      </div>

      {/* Gráfico de fluxo mensal */}
      <div className="card p-6">
        <h3 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest mb-6 flex items-center gap-2">
          <Activity className="w-4 h-4 text-lumos-yellow" /> Fluxo de Caixa — Últimos 6 Meses
        </h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthlyChartData} barGap={6} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => `R$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} width={55} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
            <Legend formatter={(v) => <span style={{ fontSize: 11, color: '#aaa', fontWeight: 700, textTransform: 'uppercase' }}>{v}</span>} />
            <Bar dataKey="entradas" name="Entradas" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="saidas" name="Saídas" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-8">
          <h3 className="text-sm font-bold text-lumos-text-primary uppercase tracking-widest mb-8 flex items-center gap-2">
            <Activity className="w-4 h-4 text-lumos-yellow" /> Balanço do Mês Atual
          </h3>
          <div className="space-y-8">
            <div>
              <div className="flex justify-between text-xs font-bold mb-3">
                <span className="text-lumos-text-secondary uppercase tracking-wider">Entradas (Recebido)</span>
                <span className="text-green-500">{formatBRL(stats.recebidoMes)}</span>
              </div>
              <div className="w-full h-2 bg-lumos-text-primary/5 rounded-full overflow-hidden border border-lumos-border">
                <div className="h-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]" style={{ width: stats.recebidoMes > 0 ? '100%' : '0%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs font-bold mb-3">
                <span className="text-lumos-text-secondary uppercase tracking-wider">Saídas (Pago)</span>
                <span className="text-red-500">{formatBRL(stats.despesasMes)}</span>
              </div>
              <div className="w-full h-2 bg-lumos-text-primary/5 rounded-full overflow-hidden border border-lumos-border">
                <div className="h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]" style={{ width: Math.min((stats.despesasMes / (stats.recebidoMes || 1)) * 100, 100) + '%' }} />
              </div>
            </div>
            <div className="pt-6 border-t border-lumos-border flex justify-between items-center">
              <span className="text-sm font-bold text-lumos-text-primary uppercase tracking-widest opacity-80">Resultado Líquido</span>
              <span className={`text-xl font-black tracking-tight ${stats.recebidoMes - stats.despesasMes >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {formatBRL(stats.recebidoMes - stats.despesasMes)}
              </span>
            </div>
          </div>
        </div>

        <div className="card p-8">
          <h3 className="text-sm font-bold text-lumos-text-primary uppercase tracking-widest mb-8 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-lumos-yellow" /> Atenção Necessária
          </h3>
          <div className="space-y-4">
            {stats.pagarSemana > 0 && (
              <div className="flex items-start gap-4 p-5 bg-red-500/5 border border-red-500/20 rounded-lumos transition-all hover:bg-red-500/10">
                <div className="p-2 bg-red-500/10 rounded-full text-red-500">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-lumos-text-primary tracking-tight">Contas vencendo esta semana</p>
                  <p className="text-xs text-lumos-text-secondary mt-1 leading-relaxed">Você possui {formatBRL(stats.pagarSemana)} em compromissos com vencimento nos próximos 7 dias.</p>
                </div>
              </div>
            )}
            {stats.receberSemana > 0 && (
              <div className="flex items-start gap-4 p-5 bg-blue-500/5 border border-blue-500/20 rounded-lumos transition-all hover:bg-blue-500/10">
                <div className="p-2 bg-blue-500/10 rounded-full text-blue-500">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-lumos-text-primary tracking-tight">Faturamento a confirmar</p>
                  <p className="text-xs text-lumos-text-secondary mt-1 leading-relaxed">Existem {formatBRL(stats.receberSemana)} aguardando recebimento previsto para esta semana.</p>
                </div>
              </div>
            )}
            {stats.pagarSemana === 0 && stats.receberSemana === 0 && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/20">
                  <CheckCircle2 className="w-8 h-8 text-green-500/40" />
                </div>
                <p className="text-sm text-lumos-text-secondary italic">Nenhum alerta crítico para os próximos dias.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
