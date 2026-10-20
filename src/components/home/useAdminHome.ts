import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import type { DadosAdmin, ItemFila } from './tipos';

const hoje = () => new Date().toLocaleDateString('en-CA');
const maisDias = (n: number) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA');
const diasDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const inicioDoMes = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); };

const VAZIO: DadosAdmin = {
  carregando: true,
  financeiro: {
    receberAtrasado: { valor: 0, qtd: 0 }, recebidoNoMes: 0,
    pagar7d: { valor: 0, qtd: 0, vencidas: 0 }, notasParaPagar: { valor: 0, qtd: 0 },
  },
  comercial: { emNegociacao: 0, semResposta7d: [], aprovadosNoMes: 0 },
  filas: { reembolsos: [], notas: [] },
};

/**
 * Números de financeiro, comercial e pendências que só o admin decide. Usa as mesmas regras das telas
 * (Contas a Receber: "em atraso" = não recebido com vencimento no passado). `ativo = false` não consulta nada.
 */
export function useAdminHome(ativo: boolean): DadosAdmin | undefined {
  const [dados, setDados] = useState<DadosAdmin>(VAZIO);

  const carregar = useCallback(async () => {
    const h = hoje();
    const limite = maisDias(7);
    const mes = inicioDoMes();
    const [rec, pag, nota, reemb, orc] = await Promise.allSettled([
      supabase.from('receivables').select('id, total_amount, received_amount, due_date, received_at, status'),
      supabase.from('payables').select('id, amount, due_date, paid_at').is('paid_at', null),
      supabase.from('nota_requests').select('id, descricao, valor, fornecedor:fornecedores(nome)').eq('status', 'nota_recebida'),
      supabase.from('reimbursements').select('id, description, amount, requester:app_users!requester_id(full_name)').eq('status', 'pendente').order('created_at', { ascending: true }),
      supabase.from('budgets').select('id, code, project_name, status, updated_at').eq('is_template', false).in('status', ['em_negociacao', 'aprovado']),
    ]);
    const lista = <T,>(r: PromiseSettledResult<any>): T[] => (r.status === 'fulfilled' && !r.value.error ? (r.value.data as T[]) || [] : []);

    // ── Financeiro ────────────────────────────────────────────────────────
    const recebiveis = lista<any>(rec);
    const atrasados = recebiveis.filter(r => r.status !== 'recebido' && r.status !== 'cancelado' && r.due_date && r.due_date < h);
    const receberAtrasado = {
      valor: atrasados.reduce((n, r) => n + Math.max(0, Number(r.total_amount || 0) - Number(r.received_amount || 0)), 0),
      qtd: atrasados.length,
    };
    const recebidoNoMes = recebiveis
      .filter(r => r.received_at && r.received_at >= mes)
      .reduce((n, r) => n + Number(r.received_amount || 0), 0);

    const aPagar = lista<any>(pag);
    const proximos = aPagar.filter(p => p.due_date && p.due_date >= h && p.due_date <= limite);
    const pagar7d = {
      valor: proximos.reduce((n, p) => n + Number(p.amount || 0), 0),
      qtd: proximos.length,
      vencidas: aPagar.filter(p => p.due_date && p.due_date < h).length,
    };

    const notas = lista<any>(nota);
    const notasParaPagar = { valor: notas.reduce((n, x) => n + Number(x.valor || 0), 0), qtd: notas.length };

    // ── Comercial ─────────────────────────────────────────────────────────
    const orcamentos = lista<any>(orc);
    const negociando = orcamentos.filter(o => o.status === 'em_negociacao');
    const semResposta7d = negociando
      .map(o => ({ id: o.id, titulo: o.project_name || o.code || 'Orçamento', dias: diasDesde(o.updated_at) }))
      .filter(o => o.dias >= 7)
      .sort((a, b) => b.dias - a.dias)
      .slice(0, 3);
    const aprovadosNoMes = orcamentos.filter(o => o.status === 'aprovado' && o.updated_at >= mes).length;

    // ── Filas extras ──────────────────────────────────────────────────────
    const reembolsos: ItemFila[] = lista<any>(reemb).map(r => ({
      id: r.id, titulo: r.description || 'Reembolso', sub: r.requester?.full_name || undefined, rota: '/financeiro/reembolso',
    }));
    const filaNotas: ItemFila[] = notas.map(n => ({
      id: n.id, titulo: n.fornecedor?.nome || 'Fornecedor', sub: n.descricao || undefined, rota: '/financeiro/notas',
    }));

    setDados({
      carregando: false,
      financeiro: { receberAtrasado, recebidoNoMes, pagar7d, notasParaPagar },
      comercial: { emNegociacao: negociando.length, semResposta7d, aprovadosNoMes },
      filas: { reembolsos, notas: filaNotas },
    });
  }, []);

  useEffect(() => { if (ativo) void carregar(); }, [ativo, carregar]);
  useRealtimeRefetch(['receivables', 'payables', 'nota_requests', 'reimbursements', 'budgets'], () => { void carregar(); }, { enabled: ativo });

  return useMemo(() => (ativo ? dados : undefined), [ativo, dados]);
}
