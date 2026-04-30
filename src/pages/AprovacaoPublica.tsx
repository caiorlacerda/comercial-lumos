import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { calcFinancials, formatCurrency } from '@/utils/financials';
import type { BudgetVersion, BudgetItem } from '@/utils/financials';
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';

interface PublicBudget {
  project_name: string;
  code: string;
  category: string;
  status: string;
  clients?: { name: string; agency_name?: string | null } | null;
}

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'already_responded' | 'expired' | 'not_found';

const CATEGORY_LABELS: Record<string, string> = {
  digital: 'Digital',
  filme: 'Filme',
  live: 'Live',
};

const GROUP_LABELS: Record<string, string> = {
  equipe: 'Equipe',
  equipamentos: 'Equipamentos',
  edicao: 'Edição',
  producao: 'Produção',
};

export default function AprovacaoPublica() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<ApprovalStatus>('pending');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [budget, setBudget] = useState<PublicBudget | null>(null);
  const [version, setVersion] = useState<BudgetVersion | null>(null);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [approverName, setApproverName] = useState('');
  const [approverNotes, setApproverNotes] = useState('');
  const [decision, setDecision] = useState<'aprovado' | 'reprovado' | null>(null);

  useEffect(() => {
    if (token) fetchData();
  }, [token]);

  async function fetchData() {
    try {
      const { data, error } = await supabase.rpc('get_public_budget_by_token', {
        p_token: token,
      });

      if (error || !data) {
        setStatus('not_found');
        return;
      }

      const versionData = data as any;

      // Check if already responded
      const { data: existing } = await supabase
        .from('budget_approvals')
        .select('id')
        .eq('version_id', versionData.id)
        .maybeSingle();

      if (existing) {
        setStatus('already_responded');
        return;
      }

      const b = versionData.budgets;
      setBudget({
        project_name: b.project_name,
        code: b.code,
        category: b.category,
        status: b.status,
        clients: b.clients,
      });
      setVersion(versionData as unknown as BudgetVersion);
      setItems((versionData.items || []) as BudgetItem[]);
    } catch {
      setStatus('not_found');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(approved: boolean) {
    if (!version) return;
    setDecision(approved ? 'aprovado' : 'reprovado');
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('insert_budget_approval', {
        p_version_id: version.id,
        p_approved: approved,
        p_approver_name: approverName.trim() || null,
        p_approver_notes: approverNotes.trim() || null,
      });

      if (error) throw error;
      setStatus(approved ? 'approved' : 'rejected');
    } catch {
      setDecision(null);
      alert('Erro ao registrar resposta. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0e0e0e] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#EFC700] animate-spin" />
      </div>
    );
  }

  if (status === 'not_found') {
    return (
      <div className="min-h-screen bg-[#0e0e0e] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-black text-white mb-2">Link inválido</h1>
          <p className="text-gray-400">Este link de aprovação não existe ou expirou.</p>
        </div>
      </div>
    );
  }

  if (status === 'already_responded') {
    return (
      <div className="min-h-screen bg-[#0e0e0e] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <CheckCircle2 className="w-16 h-16 text-[#EFC700] mx-auto mb-4" />
          <h1 className="text-2xl font-black text-white mb-2">Resposta já registrada</h1>
          <p className="text-gray-400">Este orçamento já recebeu uma resposta anteriormente.</p>
        </div>
      </div>
    );
  }

  if (status === 'approved') {
    return (
      <div className="min-h-screen bg-[#0e0e0e] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-black text-white mb-2">Orçamento aprovado!</h1>
          <p className="text-gray-400">Obrigado. Nossa equipe entrará em contato em breve.</p>
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="min-h-screen bg-[#0e0e0e] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-black text-white mb-2">Orçamento recusado</h1>
          <p className="text-gray-400">Sua resposta foi registrada. Obrigado pelo retorno.</p>
        </div>
      </div>
    );
  }

  if (!budget || !version) return null;

  const financials = calcFinancials(items, version);
  const groups = ['equipe', 'equipamentos', 'edicao', 'producao'] as const;

  return (
    <div className="min-h-screen bg-[#0e0e0e] font-sans" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center gap-3">
        <img src="/logo/Logotipo-Branco-Alpha.svg" alt="Lumos" className="h-7" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <span className="text-white/30 text-sm font-medium">Proposta Comercial</span>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        {/* Project header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-[#EFC700] uppercase tracking-widest bg-[#EFC700]/10 px-2 py-0.5 rounded border border-[#EFC700]/20">
              #{budget.code}
            </span>
            <span className="text-xs text-gray-500 uppercase tracking-widest">
              {CATEGORY_LABELS[budget.category] ?? budget.category}
            </span>
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">{budget.project_name}</h1>
          {budget.clients?.name && (
            <p className="text-gray-400 mt-1">
              {budget.clients.agency_name ? `${budget.clients.agency_name} — ` : ''}{budget.clients.name}
            </p>
          )}
        </div>

        {/* Client notes / briefing */}
        {version.notes_client && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Detalhes do Projeto</h2>
            <div
              className="text-gray-300 text-sm leading-relaxed prose prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: version.notes_client }}
            />
          </div>
        )}

        {/* Payment / validity */}
        {(version.payment_terms || version.validity_days) && (
          <div className="grid grid-cols-2 gap-4">
            {version.payment_terms && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Condições de Pagamento</p>
                <p className="text-sm text-white font-medium">{version.payment_terms}</p>
              </div>
            )}
            {version.validity_days && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Validade da Proposta</p>
                <p className="text-sm text-white font-medium">{version.validity_days} dias</p>
              </div>
            )}
          </div>
        )}

        {/* Items by group */}
        {groups.map((group) => {
          const groupItems = items.filter((i) => i.item_group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/10">
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">{GROUP_LABELS[group]}</h3>
              </div>
              <div className="divide-y divide-white/5">
                {groupItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-5 py-3 gap-4">
                    <span className="text-sm text-white flex-1">{item.name}</span>
                    <span className="text-xs text-gray-500 w-20 text-center shrink-0">
                      {item.quantity} {item.unit_label}
                    </span>
                    <span className="text-sm font-semibold text-white w-28 text-right shrink-0">
                      {formatCurrency(item.unit_cost * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Total */}
        <div className="bg-[#EFC700]/5 border border-[#EFC700]/20 rounded-xl px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-[#EFC700]/70 uppercase tracking-widest">Valor Total da Proposta</p>
            {version.discount_value > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">Inclui desconto de {formatCurrency(version.discount_value)}</p>
            )}
          </div>
          <p className="text-3xl font-black text-[#EFC700] tracking-tight">{formatCurrency(financials.valorFinal)}</p>
        </div>

        {/* Approval form */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
          <h2 className="text-sm font-black text-white uppercase tracking-widest">Sua Resposta</h2>

          <div>
            <label className="text-xs text-gray-400 font-semibold uppercase tracking-widest block mb-1.5">
              Seu nome <span className="text-gray-600 normal-case">(opcional)</span>
            </label>
            <input
              type="text"
              value={approverName}
              onChange={(e) => setApproverName(e.target.value)}
              placeholder="Ex: João Silva"
              className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#EFC700]/50"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 font-semibold uppercase tracking-widest block mb-1.5">
              Observações <span className="text-gray-600 normal-case">(opcional)</span>
            </label>
            <textarea
              value={approverNotes}
              onChange={(e) => setApproverNotes(e.target.value)}
              rows={3}
              placeholder="Comentários, dúvidas ou condições..."
              className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-[#EFC700]/50 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={() => handleSubmit(true)}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-bold text-sm py-3 rounded-lg transition-colors"
            >
              {submitting && decision === 'aprovado' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Aprovar Proposta
            </button>
            <button
              onClick={() => handleSubmit(false)}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white font-bold text-sm py-3 rounded-lg border border-white/10 transition-colors"
            >
              {submitting && decision === 'reprovado' ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Recusar
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-600 pb-4">
          Proposta enviada pela Lumos Produtora. Esta página é exclusiva para este orçamento.
        </p>
      </div>
    </div>
  );
}
