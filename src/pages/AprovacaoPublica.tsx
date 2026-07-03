import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { calcFinancials, formatCurrency } from '@/utils/financials';
import { syncBudgetApprovalFlow } from '@/utils/financeiro';
import type { BudgetVersion, BudgetItem } from '@/utils/financials';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { notify, getAdminUserIds, getProfileIdByAuthUserId } from '@/lib/notifications/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';


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

const RESPONSIVE_CSS = `
  .ap-wrap { max-width: 900px; margin: 0 auto; padding: 40px 48px; }
  .ap-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
  .ap-company-info { text-align: right; font-size: 11px; line-height: 1.75; color: #555; }
  .ap-fin-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 0; }
  .ap-total-bar { display: flex; justify-content: space-between; align-items: center; border-top: 3px solid #222; border-bottom: 3px solid #222; padding: 14px 12px; margin: 0 0 40px; }
  .ap-payment-row { display: flex; gap: 16px; margin-bottom: 40px; }
  .ap-btn-row { display: flex; gap: 12px; margin-top: 24px; }
  .ap-terms-box { border: 1px solid #e0e0e0; border-radius: 8px; padding: 32px; background: #fafafa; margin-bottom: 40px; }

  @media (max-width: 600px) {
    .ap-wrap { padding: 20px 16px; }

    .ap-header { flex-direction: column; gap: 14px; }
    .ap-logo { height: 36px !important; }
    .ap-company-info { text-align: left; font-size: 10px; }

    .ap-info-table { font-size: 12px; }
    .ap-info-emissao { display: none; }
    .ap-info-categoria-cell { display: block; font-size: 11px; color: #888; margin-top: 2px; }
    .ap-info-value { border-right: 1px solid #e0e0e0; }

    .ap-fin-wrap { margin: 0 -16px; width: calc(100% + 32px); }
    .ap-fin-desc { display: none; }
    .ap-fin-th-desc { display: none; }

    .ap-total-bar { flex-direction: column; align-items: flex-start; gap: 4px; }
    .ap-total-value { font-size: 22px !important; }

    .ap-payment-row { flex-direction: column; }

    .ap-terms-box { padding: 20px 16px; }
    .ap-btn-row { flex-direction: column; }
    .ap-btn-approve, .ap-btn-reject { padding: 16px !important; font-size: 14px !important; }
  }
`;

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'already_responded' | 'not_found';

const s: Record<string, React.CSSProperties> = {
  page: { fontFamily: 'Inter, Helvetica, Arial, sans-serif', backgroundColor: '#fff', color: '#222', minHeight: '100vh' },
  yellowLine: { borderBottom: '2px solid #EFC700', marginBottom: 20 },
  codeText: { fontSize: 11, color: '#888', marginBottom: 18 },
  infoTable: { width: '100%', borderCollapse: 'collapse' as const, marginBottom: 36, border: '1px solid #e0e0e0' },
  infoLabel: { padding: '9px 12px', color: '#888', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1, width: 90, borderRight: '1px solid #e0e0e0', backgroundColor: '#fafafa', verticalAlign: 'top' as const },
  infoValue: { padding: '9px 14px', color: '#222' },
  sectionTitle: { fontWeight: 900, fontSize: 13, textTransform: 'uppercase' as const, letterSpacing: '0.08em', borderBottom: '2px solid #222', paddingBottom: 8, marginBottom: 16, marginTop: 0 },
  finTable: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12, marginBottom: 0 },
  finTh: { padding: '8px 12px', textAlign: 'left' as const, fontWeight: 700, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1, borderBottom: '2px solid #222', color: '#555', whiteSpace: 'nowrap' as const },
  groupRow: { backgroundColor: '#FEF3AA' },
  groupCell: { padding: '8px 12px', fontWeight: 800, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: '#222' },
  itemName: { padding: '8px 12px', fontWeight: 600, color: '#222', verticalAlign: 'top' as const },
  itemDesc: { padding: '8px 12px', color: '#777', fontSize: 11, verticalAlign: 'top' as const },
  itemQty: { padding: '8px 12px', textAlign: 'center' as const, color: '#444', verticalAlign: 'top' as const, whiteSpace: 'nowrap' as const },
  itemUnit: { padding: '8px 12px', textAlign: 'center' as const, color: '#666', verticalAlign: 'top' as const, whiteSpace: 'nowrap' as const },
  subtotalRow: { borderTop: '1px solid #ddd', borderBottom: '2px solid #ddd' },
  totalLabel: { fontWeight: 900, fontSize: 13, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  termsTitle: { fontWeight: 900, fontSize: 13, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 24, marginTop: 0 },
  inputLabel: { display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, color: '#888', marginBottom: 6 },
  input: { width: '100%', padding: '10px 14px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, backgroundColor: '#fff', fontFamily: 'inherit' },
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
  const submittingRef = useRef(false);

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
    if (!version || submittingRef.current) return;
    submittingRef.current = true;
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
      
      if (approved) {
        const fin = calcFinancials(items, version);
        if (version.budget_id) {
          await syncBudgetApprovalFlow(version.budget_id, fin.valorFinal);

          // Trigger notification ORCAMENTO_APROVADO
          const creatorProfileId = await getProfileIdByAuthUserId(budget?.created_by);
          const admins = await getAdminUserIds();
          const recipientIds = new Set<string>(admins);
          if (creatorProfileId) recipientIds.add(creatorProfileId);

          await notify({
            userIds: Array.from(recipientIds),
            event: NOTIFICATION_EVENTS.ORCAMENTO_APROVADO,
            title: 'Orçamento aprovado pelo cliente',
            body: `O orçamento "${budget?.project_name || 'Projeto'}" (#${budget?.code || ''}) foi aprovado pelo cliente: ${approverName.trim() || 'Cliente'}.`,
            link: `/orcamentos/${version.budget_id}`
          });
        }
      }


      setStatus(approved ? 'approved' : 'rejected');
    } catch {
      setDecision(null);
      alert('Erro ao registrar resposta. Tente novamente.');
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
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
  const markupMultiplier = financials.totalCusto > 0 ? financials.valorFinal / financials.totalCusto : 1;
  const emissao = createdAt ? new Date(createdAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const codeTitle = `#${budget.code} | Lumos + ${budget.clients?.name || ''} | ${budget.project_name}`;

  return (
    <div style={s.page}>
      <style>{RESPONSIVE_CSS}</style>
      <div className="ap-wrap">

        {/* Header */}
        <div className="ap-header">
          <img
            src="/logo/Logotipo-Preto-Alpha.svg"
            alt="Lumos"
            className="ap-logo"
            style={{ height: 52 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div className="ap-company-info">
            <span style={{ fontWeight: 700, color: '#111', display: 'block' }}>{COMPANY.name}</span>
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
        <table style={s.infoTable} className="ap-info-table">
          <tbody>
            <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
              <td style={s.infoLabel}>Projeto</td>
              <td className="ap-info-value" style={{ ...s.infoValue, fontWeight: 700, fontSize: 14 }}>
                {budget.project_name}
                {emissao && <span className="ap-info-categoria-cell">Emissão: {emissao}</span>}
              </td>
              <td className="ap-info-emissao" style={{ ...s.infoValue, textAlign: 'right', color: '#888', fontSize: 11, whiteSpace: 'nowrap' }}>
                {emissao ? `Emissão: ${emissao}` : ''}
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
              <td style={s.infoLabel}>Cliente</td>
              <td className="ap-info-value" style={s.infoValue}>
                {budget.clients?.name || '—'}
                <span className="ap-info-categoria-cell">
                  {CATEGORY_LABELS[budget.category] || budget.category}
                </span>
              </td>
              <td className="ap-info-emissao" style={{ ...s.infoValue, textAlign: 'right' }}>
                <span style={{ color: '#888', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginRight: 8 }}>Categoria</span>
                {CATEGORY_LABELS[budget.category] || budget.category}
              </td>
            </tr>
            {contact && (
              <tr>
                <td style={s.infoLabel}>Contato</td>
                <td colSpan={2} className="ap-info-value" style={s.infoValue}>
                  {contact.name}{contact.email ? ` · ${contact.email}` : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Briefing */}
        {(version.notes_client || version.logistics_date || version.logistics_time || version.logistics_location) && (
          <div style={{ marginBottom: 40 }}>
            <h2 style={s.sectionTitle}>Escopo e Briefing</h2>

            {(version.logistics_date || version.logistics_time || version.logistics_location) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                {version.logistics_date && (
                  <div style={{ flex: '1 1 120px', padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: 6, backgroundColor: '#fafafa' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 3 }}>Data(s)</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{version.logistics_date}</div>
                  </div>
                )}
                {version.logistics_time && (
                  <div style={{ flex: '1 1 100px', padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: 6, backgroundColor: '#fafafa' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 3 }}>Horário</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{version.logistics_time}</div>
                  </div>
                )}
                {version.logistics_location && (
                  <div style={{ flex: '2 1 200px', padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: 6, backgroundColor: '#fafafa' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 3 }}>Local / Endereço</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{version.logistics_location}</div>
                  </div>
                )}
              </div>
            )}

            {version.notes_client && (
              <div style={{ fontSize: 12, lineHeight: 1.85, color: '#333', whiteSpace: 'pre-wrap', textAlign: 'justify' }}>
                {version.notes_client}
              </div>
            )}
          </div>
        )}

        {/* Financial table */}
        <div style={{ marginBottom: 0 }}>
          <h2 style={s.sectionTitle}>Proposta Financeira Detalhada</h2>
          <div className="ap-fin-wrap">
            <table style={s.finTable}>
              <thead>
                <tr>
                  <th style={{ ...s.finTh, minWidth: 140 }}>Item / Serviço</th>
                  <th className="ap-fin-th-desc" style={s.finTh}>Descrição</th>
                  <th style={{ ...s.finTh, width: 60, textAlign: 'center' }}>Qtd</th>
                  <th style={{ ...s.finTh, width: 80, textAlign: 'center' }}>Unid.</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.map(({ key, label }) => {
                  const groupItems = items.filter(i => i.item_group === key);
                  if (!groupItems.length) return null;
                  const groupTotal = groupItems.reduce((sum, i) => sum + i.unit_cost * i.quantity * markupMultiplier, 0);
                  return (
                    <React.Fragment key={key}>
                      <tr style={s.groupRow}>
                        <td colSpan={4} style={s.groupCell}>{label}</td>
                      </tr>
                      {groupItems.map((item, idx) => (
                        <tr key={item.id} style={{ borderBottom: '1px solid #f0f0f0', backgroundColor: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                          <td style={s.itemName}>{item.name}</td>
                          <td className="ap-fin-desc" style={s.itemDesc}>{(item as any).description || ''}</td>
                          <td style={s.itemQty}>{item.quantity}</td>
                          <td style={s.itemUnit}>{item.unit_label}</td>
                        </tr>
                      ))}
                      <tr style={s.subtotalRow}>
                        <td colSpan={4} style={{ padding: '7px 12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#888' }}>
                              Subtotal {label}
                            </span>
                            <span style={{ fontWeight: 800, color: '#222', whiteSpace: 'nowrap', fontSize: 13 }}>
                              {formatCurrency(groupTotal)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Total */}
        <div className="ap-total-bar">
          <span style={s.totalLabel}>Investimento Total do Projeto</span>
          <span className="ap-total-value" style={{ fontWeight: 900, fontSize: 30, color: '#111' }}>
            {formatCurrency(financials.valorFinal)}
          </span>
        </div>

        {/* Payment info */}
        {(version.payment_terms || version.validity_days) && (
          <div className="ap-payment-row">
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

        {/* Condições Gerais */}
        <div style={{ marginBottom: 40 }}>
          <h2 style={s.sectionTitle}>Condições Gerais</h2>
          {[
            {
              title: '1. Prazos e Alterações',
              items: [
                'Esta Proposta Comercial terá validade por 7 dias corridos, a partir da celebração do contrato entre as partes. Após este período, os investimentos estarão sujeitos a alterações.',
                'Eventuais alterações nas especificações dos trabalhos a serem realizados podem alterar o valor desta Proposta Comercial.',
              ],
            },
            {
              title: '2. Cancelamento e Rescisão',
              items: [
                'Aprovada esta Proposta Comercial, em qualquer hipótese de cancelamento da prestação dos serviços, por parte do CLIENTE, será devida multa, em favor da LUMOS, em valor correspondente a 70% (setenta por cento) do valor total devido pelo CLIENTE, sem prejuízo do pagamento de todas as despesas já realizadas pela LUMOS, na execução dos serviços objeto da presente Proposta Comercial.',
                'Para quaisquer finalidades que se façam necessárias, a presente Proposta Comercial, considerar-se-á aprovada pelo CLIENTE, em qualquer hipótese de manifestação deste, concordando com seus termos e condições, seja por concordância manifestada por e-mail ou outros meios, tais como mas não limitados a aplicativos de troca de mensagens, mensagens de texto, etc., seja por manifestação tácita da vontade do CLIENTE, no sentido deste ter ciência do início do cumprimento das obrigações constantes da Proposta Comercial, pela LUMOS, sem que se manifeste em contrário.',
              ],
            },
            {
              title: '3. Pagamento',
              items: [
                'O pagamento deverá ocorrer de acordo com prazo de pagamento combinado entre o CLIENTE e a LUMOS no ato do aceite da presente Proposta Comercial, dentro das opções disponíveis nesta.',
                'O atraso no pagamento sujeitará o CLIENTE à multa de 10% (dez por cento) e juros de 1% a.m. sobre o valor do débito.',
              ],
            },
            {
              title: '4. Taxa de Remarcação',
              items: [
                'Caso o CLIENTE altere a data prevista para a execução do serviço, sem respeitar o prazo máximo de 48 horas de antecedência, será cobrada uma taxa de remarcação no valor mínimo de R$2.000,00 ou 20% do valor total do projeto.',
              ],
            },
            {
              title: '5. Direitos Autorais e Uso',
              items: [
                'Todo o material produzido pela LUMOS permanece de propriedade desta até a quitação integral do valor contratado.',
                'A cessão de direitos de uso do material produzido está limitada ao território e período de veiculação descritos nesta Proposta.',
              ],
            },
            {
              title: '6. Créditos',
              items: [
                'A LUMOS reserva-se o direito de utilizar o material produzido em seu portfólio e materiais de divulgação, salvo expressa proibição do CLIENTE formalizada por escrito.',
              ],
            },
            {
              title: '7. Responsabilidades',
              items: [
                'A LUMOS não se responsabiliza por atrasos ou impedimentos causados por fatores externos ao seu controle, como condições climáticas, restrições de locação ou atrasos por parte do CLIENTE na entrega de materiais necessários à produção.',
              ],
            },
          ].map((section, si) => (
            <div key={si} style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#111' }}>{section.title}</div>
              {section.items.map((item, ii) => (
                <p key={ii} style={{ fontSize: 11.5, lineHeight: 1.8, color: '#444', margin: '0 0 6px', paddingLeft: 16 }}>
                  {`${si + 1}.${ii + 1}. ${item}`}
                </p>
              ))}
            </div>
          ))}
        </div>

        {/* Approval form */}
        <div className="ap-terms-box">
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
          <div className="ap-btn-row">
            <button
              onClick={() => handleSubmit(true)}
              disabled={submitting}
              className="ap-btn-approve"
              style={{ flex: 1, padding: '14px', backgroundColor: '#EFC700', border: 'none', borderRadius: 6, fontWeight: 800, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#000', letterSpacing: '0.04em', opacity: submitting ? 0.6 : 1 }}
            >
              {submitting && decision === 'aprovado'
                ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} />
                : <CheckCircle2 style={{ width: 16, height: 16 }} />}
              {submitting && decision === 'aprovado' ? 'APROVANDO...' : 'APROVAR PROPOSTA'}
            </button>
            <button
              onClick={() => handleSubmit(false)}
              disabled={submitting}
              className="ap-btn-reject"
              style={{ flex: 1, padding: '14px', backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#555', letterSpacing: '0.04em', opacity: submitting ? 0.6 : 1 }}
            >
              {submitting && decision === 'reprovado'
                ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} />
                : <XCircle style={{ width: 16, height: 16 }} />}
              {submitting && decision === 'reprovado' ? 'RECUSANDO...' : 'RECUSAR'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={s.footer}>{codeTitle} · {COMPANY.website}</div>
      </div>
    </div>
  );
}
