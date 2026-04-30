import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { calcFinancials, formatCurrency } from '@/utils/financials';
import type { BudgetVersion, BudgetItem } from '@/utils/financials';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

const COMPANY = {
  name: 'Produtora Lumos Audiovisual Ltda.',
  cnpj: '51.253.010/0001-70',
  address: 'R. Jaceru, 384 - Cj. 1604 - Vila Gertrudes',
  city: 'São Paulo - SP, 04705-000',
  email: 'comercial@produtoralumos.com.br',
  phone: '+55 (11) 98667-6747',
  website: 'www.produtoralumos.com.br',
};

const CATEGORY_LABELS: Record<string, string> = { digital: 'Digital', filme: 'Filme', live: 'Live' };

const GROUPS = [
  { key: 'equipe', label: 'Equipe' },
  { key: 'equipamentos', label: 'Equipamentos' },
  { key: 'edicao', label: 'Edição' },
  { key: 'producao', label: 'Produção' },
];

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'already_responded' | 'not_found';

const s: Record<string, React.CSSProperties> = {
  page: { fontFamily: 'Inter, Helvetica, Arial, sans-serif', backgroundColor: '#fff', color: '#222', minHeight: '100vh' },
  wrap: { maxWidth: 900, margin: '0 auto', padding: '40px 48px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  companyInfo: { textAlign: 'right', fontSize: 11, lineHeight: '1.75', color: '#555' },
  companyName: { fontWeight: 700, color: '#111', display: 'block' },
  yellowLine: { borderBottom: '2px solid #EFC700', marginBottom: 20 },
  codeText: { fontSize: 11, color: '#888', marginBottom: 18 },
  infoTable: { width: '100%', borderCollapse: 'collapse' as const, marginBottom: 36, fontSize: 12, border: '1px solid #e0e0e0' },
  infoLabel: { padding: '9px 12px', color: '#888', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1, width: 90, borderRight: '1px solid #e0e0e0', backgroundColor: '#fafafa', verticalAlign: 'top' as const },
  infoValue: { padding: '9px 14px', color: '#222' },
  sectionTitle: { fontWeight: 900, fontSize: 13, textTransform: 'uppercase' as const, letterSpacing: '0.08em', borderBottom: '2px solid #222', paddingBottom: 8, marginBottom: 16, marginTop: 0 },
  finTable: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12, marginBottom: 0 },
  finTh: { padding: '8px 12px', textAlign: 'left' as const, fontWeight: 700, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1, borderBottom: '2px solid #222', color: '#555' },
  groupRow: { backgroundColor: '#FEF3AA' },
  groupCell: { padding: '8px 12px', fontWeight: 800, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: '#222' },
  itemName: { padding: '8px 12px', fontWeight: 600, color: '#222', verticalAlign: 'top' as const },
  itemDesc: { padding: '8px 12px', color: '#777', fontSize: 11, verticalAlign: 'top' as const },
  itemQty: { padding: '8px 12px', textAlign: 'center' as const, color: '#444', verticalAlign: 'top' as const },
  itemUnit: { padding: '8px 12px', textAlign: 'center' as const, color: '#666', verticalAlign: 'top' as const },
  subtotalRow: { borderTop: '1px solid #ddd', borderBottom: '2px solid #ddd' },
  subtotalLabel: { padding: '7px 12px', textAlign: 'right' as const, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, color: '#888' },
  subtotalValue: { padding: '7px 12px', textAlign: 'right' as const, fontWeight: 800, color: '#222', whiteSpace: 'nowrap' as const, fontSize: 13 },
  totalBar: { borderTop: '3px solid #222', borderBottom: '3px solid #222', padding: '14px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 40px' },
  totalLabel: { fontWeight: 900, fontSize: 13, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  totalValue: { fontWeight: 900, fontSize: 30, color: '#111' },
  termsBox: { border: '1px solid #e0e0e0', borderRadius: 8, padding: 32, backgroundColor: '#fafafa', marginBottom: 40 },
  termsTitle: { fontWeight: 900, fontSize: 13, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 24, marginTop: 0 },
  inputLabel: { display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, color: '#888', marginBottom: 6 },
  input: { width: '100%', padding: '10px 14px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, backgroundColor: '#fff', fontFamily: 'inherit' },
  btnRow: { display: 'flex', gap: 12, marginTop: 24 },
  btnApprove: { flex: 1, padding: '14px', backgroundColor: '#EFC700', border: 'none', borderRadius: 6, fontWeight: 800, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#000', letterSpacing: '0.04em' },
  btnReject: { flex: 1, padding: '14px', backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#555', letterSpacing: '0.04em' },
  footer: { borderTop: '1px solid #e0e0e0', paddingTop: 16, textAlign: 'center' as const, fontSize: 10, color: '#bbb', letterSpacing: '0.15em', textTransform: 'uppercase' as const, marginTop: 40 },
};

function CenterScreen({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, width: '100%', textAlign: 'center', fontFamily: 'Inter, Helvetica, Arial, sans-serif' }}>
        {children}
      </div>
    </div>
  );
}

export default function AprovacaoPublica() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<ApprovalStatus>('pending');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [budget, setBudget] = useState<any>(null);
  const [version, setVersion] = useState<BudgetVersion | null>(null);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [contact, setContact] = useState<{ name: string; email: string } | null>(null);
  const [createdAt, setCreatedAt] = useState('');
  const [approverName, setApproverName] = useState('');
  const [approverNotes, setApproverNotes] = useState('');
  const [decision, setDecision] = useState<'aprovado' | 'reprovado' | null>(null);
  const [debugError, setDebugError] = useState('');

  useEffect(() => { if (token) fetchData(); }, [token]);

  async function fetchData() {
    try {
      const { data, error } = await supabase.rpc('get_public_budget_by_token', { p_token: token });
      if (error || !data) {
        setDebugError(error ? `${error.code}: ${error.message}` : 'data is null');
        setStatus('not_found');
        return;
      }
      const d = data as any;
      const { data: existing } = await supabase
        .from('budget_approvals').select('id').eq('version_id', d.id).maybeSingle();
      if (existing) { setStatus('already_responded'); return; }
      setBudget(d.budgets);
      setVersion(d as unknown as BudgetVersion);
      setItems((d.items || []) as BudgetItem[]);
      setContact(d.contact || null);
      setCreatedAt(d.created_at || '');
    } catch (e: any) {
      setDebugError(e?.message || 'unknown error');
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

  if (loading) return (
    <CenterScreen><Loader2 style={{ width: 36, height: 36, color: '#EFC700', margin: '0 auto', animation: 'spin 1s linear infinite' }} /></CenterScreen>
  );

  if (status === 'not_found') return (
    <CenterScreen>
      <div style={{ width: 64, height: 64, borderRadius: '50%', border: '4px solid #ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
        <span style={{ color: '#ef4444', fontSize: 28, fontWeight: 900 }}>!</span>
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: '#111', marginBottom: 8 }}>Link inválido</h1>
      <p style={{ color: '#888', fontSize: 14 }}>Este link de aprovação não existe ou expirou.</p>
      {debugError && <p style={{ marginTop: 16, fontSize: 11, color: '#ef4444', fontFamily: 'monospace', background: '#fef2f2', padding: 12, borderRadius: 6, textAlign: 'left', wordBreak: 'break-all' }}>{debugError}</p>}
    </CenterScreen>
  );

  if (status === 'already_responded') return (
    <CenterScreen>
      <CheckCircle2 style={{ width: 64, height: 64, color: '#EFC700', margin: '0 auto 20px' }} />
      <h1 style={{ fontSize: 22, fontWeight: 900, color: '#111', marginBottom: 8 }}>Resposta já registrada</h1>
      <p style={{ color: '#888', fontSize: 14 }}>Este orçamento já recebeu uma resposta anteriormente.</p>
    </CenterScreen>
  );

  if (status === 'approved') return (
    <CenterScreen>
      <CheckCircle2 style={{ width: 64, height: 64, color: '#22c55e', margin: '0 auto 20px' }} />
      <h1 style={{ fontSize: 22, fontWeight: 900, color: '#111', marginBottom: 8 }}>Orçamento aprovado!</h1>
      <p style={{ color: '#888', fontSize: 14 }}>Obrigado. Nossa equipe entrará em contato em breve.</p>
    </CenterScreen>
  );

  if (status === 'rejected') return (
    <CenterScreen>
      <XCircle style={{ width: 64, height: 64, color: '#ef4444', margin: '0 auto 20px' }} />
      <h1 style={{ fontSize: 22, fontWeight: 900, color: '#111', marginBottom: 8 }}>Orçamento recusado</h1>
      <p style={{ color: '#888', fontSize: 14 }}>Sua resposta foi registrada. Obrigado pelo retorno.</p>
    </CenterScreen>
  );

  if (!budget || !version) return null;

  const financials = calcFinancials(items, version);
  const emissao = createdAt ? new Date(createdAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const codeTitle = `#${budget.code} | Lumos + ${budget.clients?.name || ''} | ${budget.project_name}`;

  return (
    <div style={s.page}>
      <div style={s.wrap}>

        {/* Header */}
        <div style={s.header}>
          <img src="/logo/Logotipo-Preto-Alpha.svg" alt="Lumos" style={{ height: 52 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div style={s.companyInfo}>
            <span style={s.companyName}>{COMPANY.name}</span>
            <span>CNPJ: {COMPANY.cnpj}</span><br />
            <span>{COMPANY.address}</span><br />
            <span>{COMPANY.city}</span><br />
            <span>{COMPANY.email}</span><br />
            <span>{COMPANY.phone}</span><br />
            <span>{COMPANY.website}</span>
          </div>
        </div>

        {/* Yellow divider */}
        <div style={s.yellowLine} />

        {/* Code */}
        <div style={s.codeText}>{codeTitle}</div>

        {/* Project info table */}
        <table style={s.infoTable}>
          <tbody>
            <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
              <td style={s.infoLabel}>Projeto</td>
              <td style={{ ...s.infoValue, fontWeight: 700, fontSize: 14 }}>{budget.project_name}</td>
              <td style={{ ...s.infoValue, textAlign: 'right', color: '#888', fontSize: 11, whiteSpace: 'nowrap' }}>
                {emissao ? `Emissão: ${emissao}` : ''}
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
              <td style={s.infoLabel}>Cliente</td>
              <td style={s.infoValue}>{budget.clients?.name || '—'}</td>
              <td style={{ ...s.infoValue, textAlign: 'right' }}>
                <span style={{ color: '#888', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginRight: 8 }}>Categoria</span>
                {CATEGORY_LABELS[budget.category] || budget.category}
              </td>
            </tr>
            {contact && (
              <tr>
                <td style={s.infoLabel}>Contato</td>
                <td colSpan={2} style={s.infoValue}>
                  {contact.name}{contact.email ? ` · ${contact.email}` : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Briefing */}
        {version.notes_client && (
          <div style={{ marginBottom: 40 }}>
            <h2 style={s.sectionTitle}>Escopo e Briefing</h2>
            <div
              style={{ fontSize: 12, lineHeight: 1.85, color: '#333' }}
              dangerouslySetInnerHTML={{ __html: version.notes_client }}
            />
          </div>
        )}

        {/* Financial table */}
        <div style={{ marginBottom: 0 }}>
          <h2 style={s.sectionTitle}>Proposta Financeira Detalhada</h2>
          <table style={s.finTable}>
            <thead>
              <tr>
                <th style={{ ...s.finTh, width: '28%' }}>Item / Serviço</th>
                <th style={s.finTh}>Descrição</th>
                <th style={{ ...s.finTh, width: 60, textAlign: 'center' }}>Qtd</th>
                <th style={{ ...s.finTh, width: 80, textAlign: 'center' }}>Unid.</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map(({ key, label }) => {
                const groupItems = items.filter(i => i.item_group === key);
                if (!groupItems.length) return null;
                const groupTotal = groupItems.reduce((sum, i) => sum + i.unit_cost * i.quantity, 0);
                return (
                  <React.Fragment key={key}>
                    <tr style={s.groupRow}>
                      <td colSpan={4} style={s.groupCell}>{label}</td>
                    </tr>
                    {groupItems.map((item, idx) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid #f0f0f0', backgroundColor: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={s.itemName}>{item.name}</td>
                        <td style={s.itemDesc}>{(item as any).description || ''}</td>
                        <td style={s.itemQty}>{item.quantity}</td>
                        <td style={s.itemUnit}>{item.unit_label}</td>
                      </tr>
                    ))}
                    <tr style={s.subtotalRow}>
                      <td colSpan={3} style={{ padding: '7px 12px', textAlign: 'right', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#888' }}>
                        Subtotal {label}
                      </td>
                      <td style={{ ...s.subtotalValue, textAlign: 'right', padding: '7px 12px' }}>
                        {formatCurrency(groupTotal)}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Total */}
        <div style={s.totalBar}>
          <span style={s.totalLabel}>Investimento Total do Projeto</span>
          <span style={s.totalValue}>{formatCurrency(financials.valorFinal)}</span>
        </div>

        {/* Payment info */}
        {(version.payment_terms || version.validity_days) && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 40 }}>
            {version.payment_terms && (
              <div style={{ flex: 1, padding: 16, border: '1px solid #e0e0e0', borderRadius: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 4 }}>Condições de Pagamento</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{version.payment_terms}</div>
              </div>
            )}
            {version.validity_days && (
              <div style={{ flex: 1, padding: 16, border: '1px solid #e0e0e0', borderRadius: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 4 }}>Validade da Proposta</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{version.validity_days} dias</div>
              </div>
            )}
          </div>
        )}

        {/* Approval form */}
        <div style={s.termsBox}>
          <h2 style={s.termsTitle}>Termo de Aceite e Aprovação</h2>
          <div style={{ marginBottom: 16 }}>
            <label style={s.inputLabel}>
              Seu nome <span style={{ color: '#bbb', fontWeight: 400, textTransform: 'none' }}>(opcional)</span>
            </label>
            <input
              type="text"
              value={approverName}
              onChange={(e) => setApproverName(e.target.value)}
              placeholder="Nome completo"
              style={s.input}
            />
          </div>
          <div>
            <label style={s.inputLabel}>
              Observações <span style={{ color: '#bbb', fontWeight: 400, textTransform: 'none' }}>(opcional)</span>
            </label>
            <textarea
              value={approverNotes}
              onChange={(e) => setApproverNotes(e.target.value)}
              rows={3}
              placeholder="Comentários, dúvidas ou condições..."
              style={{ ...s.input, resize: 'none' }}
            />
          </div>
          <div style={s.btnRow}>
            <button
              onClick={() => handleSubmit(true)}
              disabled={submitting}
              style={{ ...s.btnApprove, opacity: submitting ? 0.6 : 1 }}
            >
              {submitting && decision === 'aprovado'
                ? <Loader2 style={{ width: 16, height: 16 }} />
                : <CheckCircle2 style={{ width: 16, height: 16 }} />}
              APROVAR PROPOSTA
            </button>
            <button
              onClick={() => handleSubmit(false)}
              disabled={submitting}
              style={{ ...s.btnReject, opacity: submitting ? 0.6 : 1 }}
            >
              {submitting && decision === 'reprovado'
                ? <Loader2 style={{ width: 16, height: 16 }} />
                : <XCircle style={{ width: 16, height: 16 }} />}
              RECUSAR
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={s.footer}>{codeTitle} · {COMPANY.website}</div>
      </div>
    </div>
  );
}
