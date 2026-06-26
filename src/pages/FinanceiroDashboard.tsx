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

export default function FinanceiroDashboard() {
  const [stats, setStats] = useState({
    saldoGeral: 0, // Caixa V2
    faturamentoMes: 0, // Rentabilidade
    pagarSemana: 0, // Payables
    receberSemana: 0, // Receivables
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
      const nextWeekStr = nextWeek.toISOString().split('T')[0];

      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();

      // Busca dados de rentabilidade, contas a pagar e contas a receber
      const [rentRes, payablesRes, receivablesRes] = await Promise.all([
        supabase
          .from('vw_rentabilidade')
          .select('valor_vendido, created_at, data_recebimento_negociada'),
        supabase.from('payables').select('amount, due_date, paid_at'),
        supabase.from('receivables').select('total_amount, received_amount, due_date, status, received_at')
      ]);

      const rentData = rentRes.data || [];

      // Filtra projetos que têm faturamento no mês corrente
      const currentMonthProjects = rentData.filter(item => {
        const dateStr = item.data_recebimento_negociada || item.created_at;
        if (!dateStr) return false;
        const date = new Date(dateStr);
        return date.getFullYear() === currentYear && date.getMonth() === currentMonth;
      });

      // KPIs do Mês Atual baseados em Rentabilidade
      const faturamentoMes = currentMonthProjects.reduce((acc, item) => acc + Number(item.valor_vendido || 0), 0);

      // KPIs de Compromissos de Caixa da semana (puxados das tabelas de parcelas)
      const pagarSemana = (payablesRes.data || [])
        .filter(p => !p.paid_at && p.due_date && p.due_date <= nextWeekStr)
        .reduce((acc, p) => acc + Number(p.amount || 0), 0);

      const receberSemana = (receivablesRes.data || [])
        .filter(r => r.status !== 'recebido' && r.due_date && r.due_date <= nextWeekStr)
        .reduce((acc, r) => acc + (Number(r.total_amount || 0) - Number(r.received_amount || 0)), 0);

      setStats({
        saldoGeral: 0, // Caixa V2 (Integração Pendente)
        faturamentoMes,
        pagarSemana,
        receberSemana,
      });
    } catch (error) {
      console.error('Erro no Dashboard:', error);
    } finally {
      setLoading(false);
    }
  }

  const formatBRL = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

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
        {/* Card 1: Saldo Geral em Conta (Caixa V2 - Sinalizado) */}
        <div className="card p-6 border-t-4 border-lumos-text-secondary/35 shadow-lg relative overflow-hidden opacity-90">
          <div className="p-2 bg-lumos-border rounded-lumos text-lumos-text-secondary w-fit mb-4">
            <Wallet className="w-5 h-5" />
          </div>
          <div className="absolute top-4 right-4 bg-lumos-border text-lumos-text-secondary text-[8px] font-black uppercase px-2 py-0.5 rounded tracking-wider">
            V2 (Em breve)
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Saldo Geral em Conta</p>
          <p className="text-2xl font-black text-lumos-text-secondary/40 mt-1 tracking-tight">—</p>
          <p className="text-[9px] text-lumos-text-secondary/50 mt-2">Módulo de conciliação de caixa planejado para V2.</p>
        </div>

        {/* Card 2: Faturamento do Mês (Rentabilidade) */}
        <div className="card p-6 border-t-4 border-green-500 shadow-lg">
          <div className="p-2 bg-green-500/10 rounded-lumos text-green-500 w-fit mb-4">
            <TrendingUp className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">Faturamento do Mês</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">{formatBRL(stats.faturamentoMes)}</p>
        </div>

        {/* Card 3: A Pagar (7 dias) */}
        <div className="card p-6 border-t-4 border-red-500 shadow-lg">
          <div className="p-2 bg-red-500/10 rounded-lumos text-red-500 w-fit mb-4">
            <ArrowDownRight className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">A Pagar (7 dias)</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">{formatBRL(stats.pagarSemana)}</p>
        </div>

        {/* Card 4: A Receber (7 dias) */}
        <div className="card p-6 border-t-4 border-blue-500 shadow-lg">
          <div className="p-2 bg-blue-500/10 rounded-lumos text-blue-500 w-fit mb-4">
            <ArrowUpRight className="w-5 h-5" />
          </div>
          <p className="text-[10px] font-bold text-lumos-text-secondary uppercase tracking-widest">A Receber (7 dias)</p>
          <p className="text-2xl font-black text-lumos-text-primary mt-1 tracking-tight">{formatBRL(stats.receberSemana)}</p>
        </div>
      </div>

      {/* Gráfico de fluxo mensal (Sinalizado como Caixa V2 / Integração pendente) */}
      <div className="card p-6 relative overflow-hidden">
        <div className="absolute top-6 right-6 bg-lumos-border text-lumos-text-secondary text-[8px] font-black uppercase px-2 py-0.5 rounded tracking-wider">
          V2 (Em breve)
        </div>
        <h3 className="text-sm font-black text-lumos-text-primary uppercase tracking-widest mb-6 flex items-center gap-2">
          <Activity className="w-4 h-4 text-lumos-yellow" /> Fluxo de Caixa Real — Últimos 6 Meses
        </h3>
        
        <div className="flex flex-col items-center justify-center py-16 border border-dashed border-lumos-border/50 rounded-lumos bg-lumos-bg/30">
          <Activity className="w-8 h-8 text-lumos-text-secondary/40 animate-pulse mb-3" />
          <p className="text-sm font-bold text-lumos-text-primary tracking-tight">Gráfico de Caixa Real Indisponível</p>
          <p className="text-xs text-lumos-text-secondary/70 mt-1 max-w-sm text-center leading-relaxed">
            As movimentações financeiras de fluxo de caixa real requerem conciliação com extrato de contas bancárias (previsto para a V2).
          </p>
        </div>
      </div>

      {/* Seção de Alertas e Pendências */}
      <div className="grid grid-cols-1 gap-6">
        <div className="card p-8">
          <h3 className="text-sm font-bold text-lumos-text-primary uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-lumos-border pb-3">
            <AlertCircle className="w-4 h-4 text-lumos-yellow" /> Alertas de Caixa: Atenção Necessária
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stats.pagarSemana > 0 ? (
              <div className="flex items-start gap-4 p-5 bg-red-500/5 border border-red-500/20 rounded-lumos transition-all hover:bg-red-500/10">
                <div className="p-2 bg-red-500/10 rounded-full text-red-500 mt-1">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-lumos-text-primary tracking-tight">Contas vencendo esta semana (a pagar)</p>
                  <p className="text-xs text-lumos-text-secondary mt-1 leading-relaxed">Você possui {formatBRL(stats.pagarSemana)} em compromissos com vencimento nos próximos 7 dias.</p>
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

            {stats.receberSemana > 0 ? (
              <div className="flex items-start gap-4 p-5 bg-blue-500/5 border border-blue-500/20 rounded-lumos transition-all hover:bg-blue-500/10">
                <div className="p-2 bg-blue-500/10 rounded-full text-blue-500 mt-1">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-lumos-text-primary tracking-tight">Recebíveis previstos para esta semana (a receber)</p>
                  <p className="text-xs text-lumos-text-secondary mt-1 leading-relaxed">Existem {formatBRL(stats.receberSemana)} previstos para entrar no caixa nos próximos 7 dias.</p>
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
    </div>
  );
}
