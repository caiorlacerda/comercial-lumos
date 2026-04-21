import React, { useEffect, useState } from 'react';
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

export default function FinanceiroDashboard() {
  const [stats, setStats] = useState({
    saldoGeral: 0,
    faturamentoMes: 0,
    pagarSemana: 0,
    receberSemana: 0,
    despesasMes: 0,
    recebidoMes: 0
  });
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
      
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
      const nextWeekStr = nextWeek.toISOString().split('T')[0];

      const [payablesRes, receivablesRes, reimbursementsRes] = await Promise.all([
        supabase.from('payables').select('amount, due_date, paid_at'),
        supabase.from('receivables').select('total_amount, received_amount, due_date, status, received_at'),
        supabase.from('reimbursements').select('amount, status, paid_at')
      ]);

      const totalRecebido = (receivablesRes.data || []).reduce((acc, r) => acc + r.received_amount, 0);
      const totalPagoDespesas = (payablesRes.data || []).filter(p => p.paid_at).reduce((acc, p) => acc + p.amount, 0);
      const totalPagoReembolsos = (reimbursementsRes.data || []).filter(r => r.status === 'pago').reduce((acc, r) => acc + r.amount, 0);
      const saldoGeral = totalRecebido - (totalPagoDespesas + totalPagoReembolsos);

      const faturamentoMes = (receivablesRes.data || [])
        .filter(r => r.due_date >= firstDayOfMonth && r.due_date <= lastDayOfMonth)
        .reduce((acc, r) => acc + r.total_amount, 0);

      const pagarSemana = (payablesRes.data || [])
        .filter(p => !p.paid_at && p.due_date <= nextWeekStr)
        .reduce((acc, p) => acc + p.amount, 0);

      const receberSemana = (receivablesRes.data || [])
        .filter(r => r.status !== 'recebido' && r.due_date <= nextWeekStr)
        .reduce((acc, r) => acc + (r.total_amount - r.received_amount), 0);

      const recebidoMes = (receivablesRes.data || [])
        .filter(r => r.received_at && r.received_at >= firstDayOfMonth)
        .reduce((acc, r) => acc + r.received_amount, 0);
      
      const despesasMes = (payablesRes.data || [])
        .filter(p => p.paid_at && p.paid_at >= firstDayOfMonth)
        .reduce((acc, p) => acc + p.amount, 0);

      setStats({
        saldoGeral,
        faturamentoMes,
        pagarSemana,
        receberSemana,
        despesasMes,
        recebidoMes
      });
    } catch (error) {
      console.error('Erro no Dashboard:', error);
    } finally {
      setLoading(false);
    }
  }

  const formatBRL = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  if (loading) return <div className="flex items-center justify-center min-h-screen bg-lumos-bg"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-lumos-yellow"></div></div>;

  return (
    <div className="space-y-8 font-work-sans">
      <div>
        <h1 className="text-3xl font-black text-white tracking-tight">Dashboard Financeiro</h1>
        <p className="text-lumos-text-secondary font-medium mt-1">Visão geral da saúde econômica da Lumos.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-6 border-t-4 border-lumos-yellow shadow-lg bg-[#2a2a2a]">
          <div className="p-2 bg-lumos-yellow/10 rounded-lumos text-lumos-yellow w-fit mb-4">
            <Wallet className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Saldo Geral em Conta</p>
          <p className="text-2xl font-black text-white mt-1 tracking-tight">{formatBRL(stats.saldoGeral)}</p>
        </div>

        <div className="card p-6 border-t-4 border-green-500 shadow-lg bg-[#2a2a2a]">
          <div className="p-2 bg-green-500/10 rounded-lumos text-green-500 w-fit mb-4">
            <TrendingUp className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Faturamento do Mês</p>
          <p className="text-2xl font-black text-white mt-1 tracking-tight">{formatBRL(stats.faturamentoMes)}</p>
        </div>

        <div className="card p-6 border-t-4 border-red-500 shadow-lg bg-[#2a2a2a]">
          <div className="p-2 bg-red-500/10 rounded-lumos text-red-500 w-fit mb-4">
            <ArrowDownRight className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">A Pagar (7 dias)</p>
          <p className="text-2xl font-black text-white mt-1 tracking-tight">{formatBRL(stats.pagarSemana)}</p>
        </div>

        <div className="card p-6 border-t-4 border-blue-500 shadow-lg bg-[#2a2a2a]">
          <div className="p-2 bg-blue-500/10 rounded-lumos text-blue-500 w-fit mb-4">
            <ArrowUpRight className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">A Receber (7 dias)</p>
          <p className="text-2xl font-black text-white mt-1 tracking-tight">{formatBRL(stats.receberSemana)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-8 bg-[#2a2a2a]">
          <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-8 flex items-center gap-2">
            <Activity className="w-4 h-4 text-lumos-yellow" /> Balanço do Mês Atual
          </h3>
          <div className="space-y-8">
            <div>
              <div className="flex justify-between text-xs font-bold mb-3">
                <span className="text-lumos-text-secondary uppercase tracking-wider">Entradas (Recebido)</span>
                <span className="text-green-500">{formatBRL(stats.recebidoMes)}</span>
              </div>
              <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div className="h-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]" style={{ width: stats.recebidoMes > 0 ? '100%' : '0%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs font-bold mb-3">
                <span className="text-lumos-text-secondary uppercase tracking-wider">Saídas (Pago)</span>
                <span className="text-red-500">{formatBRL(stats.despesasMes)}</span>
              </div>
              <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div className="h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]" style={{ width: Math.min((stats.despesasMes / (stats.recebidoMes || 1)) * 100, 100) + '%' }} />
              </div>
            </div>
            <div className="pt-6 border-t border-lumos-border flex justify-between items-center">
              <span className="text-sm font-bold text-white uppercase tracking-widest opacity-80">Resultado Líquido</span>
              <span className={`text-xl font-black tracking-tight ${stats.recebidoMes - stats.despesasMes >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {formatBRL(stats.recebidoMes - stats.despesasMes)}
              </span>
            </div>
          </div>
        </div>

        <div className="card p-8 bg-[#2a2a2a]">
          <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-8 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-lumos-yellow" /> Atenção Necessária
          </h3>
          <div className="space-y-4">
            {stats.pagarSemana > 0 && (
              <div className="flex items-start gap-4 p-5 bg-red-500/5 border border-red-500/20 rounded-lumos transition-all hover:bg-red-500/10">
                <div className="p-2 bg-red-500/10 rounded-full text-red-500">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white tracking-tight">Contas vencendo esta semana</p>
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
                  <p className="text-sm font-bold text-white tracking-tight">Faturamento a confirmar</p>
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
