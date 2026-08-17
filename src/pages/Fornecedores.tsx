import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Trash2, Edit2, AlertTriangle, Link2, CheckCircle2,
  MessageCircle, Send, Copy, FileText, Ban, RotateCcw, Receipt, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { formatName, formatDoc, formatPhone } from '@/lib/format';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';
import { useToast } from '@/context/ToastContext';
import { MobileCardList, MobileCard } from '@/components/ui/MobileCards';

/**
 * FORNECEDORES no formato do benchmark: título com contador, abas
 * Profissionais × Empresas, busca compacta ao lado do botão de novo, tabela
 * com avatar, funções, local, Pix e ações rápidas (WhatsApp, editar).
 * A aba Notas acompanha as cobranças de nota fiscal (automáticas: custo de
 * projeto com fornecedor agenda e-mail pro dia 28 depois do serviço).
 */

type Aba = 'profissionais' | 'empresas' | 'notas';

interface NotaRequest {
  id: string;
  descricao: string;
  valor: number | null;
  data_servico: string;
  enviar_em: string;
  pagar_em: string;
  token: string;
  status: string;
  nota_arquivo: { name: string; path: string } | null;
  fornecedor: { id: string; nome: string; email: string | null } | null;
  projeto: { name: string } | null;
}

const digits = (s?: string | null) => (s || '').replace(/\D/g, '');
// Antes da migration não existe f.tipo; a heurística marca empresa só quando o
// nome tem cara de empresa (MEI de freelancer continua profissional).
const NOME_EMPRESA = /ltda|eireli|\bs\.?a\.?\b|produç|producoes|studio|filmes?\b|locadora|rental|marketing|log[íi]stica|equipamentos|serviços|servicos/i;
const tipoDoFornecedor = (f: any): 'profissional' | 'empresa' => {
  if (f.tipo) return f.tipo === 'empresa' ? 'empresa' : 'profissional';
  return digits(f.cnpj).length === 14 && NOME_EMPRESA.test(f.nome || '') ? 'empresa' : 'profissional';
};

const waLink = (tel?: string | null) => {
  let d = digits(tel);
  if (!d) return null;
  if (!d.startsWith('55')) d = `55${d}`;
  return `https://wa.me/${d}`;
};

const iniciais = (nome: string) =>
  nome.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('');

const brData = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const brl = (v: number | null) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const NOTA_STATUS: Record<string, { label: string; cls: string }> = {
  agendada:      { label: 'Agendada',      cls: 'bg-sky-500/15 text-sky-500 border-sky-500/30' },
  email_enviado: { label: 'E-mail enviado', cls: 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/40' },
  nota_recebida: { label: 'Nota recebida', cls: 'bg-green-500/15 text-green-500 border-green-500/30' },
  paga:          { label: 'Paga',          cls: 'bg-emerald-600/15 text-emerald-500 border-emerald-600/30' },
  cancelada:     { label: 'Cancelada',     cls: 'bg-lumos-text-secondary/10 text-lumos-text-secondary border-lumos-border' },
};

export default function Fornecedores() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [fornecedores, setFornecedores] = useState<any[]>([]);
  const [notas, setNotas] = useState<NotaRequest[]>([]);
  const [notasIndisponiveis, setNotasIndisponiveis] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [enviandoNotaId, setEnviandoNotaId] = useState<string | null>(null);
  const [novaCobranca, setNovaCobranca] = useState(false);

  const podeVerNotas = isAdmin || can('custos_projeto');
  const abaParam = searchParams.get('tab') as Aba | null;
  const [aba, setAba] = useState<Aba>(abaParam === 'notas' && podeVerNotas ? 'notas' : abaParam === 'empresas' ? 'empresas' : 'profissionais');
  const mudarAba = (a: Aba) => {
    setAba(a);
    setSearchParams(a === 'profissionais' ? {} : { tab: a }, { replace: true });
  };

  useEffect(() => { fetchTudo(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useRealtimeRefetch(['fornecedores', 'fornecedor_servicos', 'nota_requests'], () => fetchTudo(true));

  async function fetchTudo(silent = false) {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('fornecedores')
        .select('*, servicos:fornecedor_servicos(id, tipo_servico)')
        .order('nome', { ascending: true });
      if (error) throw error;
      setFornecedores(data || []);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar fornecedores.');
    } finally {
      setLoading(false);
    }
    if (podeVerNotas) {
      const { data, error } = await supabase
        .from('nota_requests')
        .select('id, descricao, valor, data_servico, enviar_em, pagar_em, token, status, nota_arquivo, fornecedor:fornecedores(id, nome, email), projeto:projects(name)')
        .order('enviar_em', { ascending: false });
      // Tabela pode ainda não existir (migration pendente); a aba avisa.
      if (error) setNotasIndisponiveis(true);
      else { setNotasIndisponiveis(false); setNotas((data as any[]) || []); }
    }
  }

  const handleCopyPublicLink = async () => {
    const url = `${window.location.origin}/cadastro-fornecedor`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link de cadastro copiado ✓');
    } catch {
      toast.error(`Falha ao copiar. URL: ${url}`);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const { error } = await supabase.from('fornecedores').delete().eq('id', deletingId);
      if (error) throw error;
      toast.success('Fornecedor excluído.');
      setIsDeleteModalOpen(false);
      setDeletingId(null);
      fetchTudo(true);
    } catch (err: any) {
      toast.error(`Erro ao excluir: ${err.message}`);
    }
  };

  const aprovar = async (id: string) => {
    try {
      const { error } = await supabase.from('fornecedores').update({ status_cadastro: 'aprovado' }).eq('id', id);
      if (error) throw error;
      toast.success('Fornecedor aprovado ✓');
      fetchTudo(true);
    } catch (err: any) {
      toast.error(`Erro ao aprovar: ${err.message}`);
    }
  };

  // ── Notas ────────────────────────────────────────────────────────────────
  const atualizarNota = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from('nota_requests').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) toast.error(`Erro: ${error.message}`);
    else fetchTudo(true);
  };

  const enviarAgora = async (n: NotaRequest) => {
    if (!n.fornecedor?.email) { toast.error('Esse fornecedor não tem e-mail cadastrado.'); return; }
    setEnviandoNotaId(n.id);
    try {
      const { data, error } = await supabase.functions.invoke('nota-cron', { body: { id: n.id } });
      if (error) throw error;
      const r = data?.resultados?.[0];
      if (r?.ok) toast.success(`E-mail de cobrança enviado pra ${n.fornecedor.nome} ✓`);
      else toast.error(`Não enviou: ${r?.motivo || 'erro desconhecido'}`);
      fetchTudo(true);
    } catch (err: any) {
      toast.error(`Erro ao enviar: ${err.message}`);
    } finally {
      setEnviandoNotaId(null);
    }
  };

  const copiarLinkNota = async (n: NotaRequest) => {
    const url = `${window.location.origin}/nota/${n.token}`;
    try { await navigator.clipboard.writeText(url); toast.success('Link da nota copiado ✓'); }
    catch { toast.error(`Falha ao copiar. URL: ${url}`); }
  };

  const verNota = (n: NotaRequest) => {
    if (!n.nota_arquivo?.path) return;
    const { data } = supabase.storage.from('notas-fiscais').getPublicUrl(n.nota_arquivo.path);
    window.open(data.publicUrl, '_blank');
  };

  // ── Filtros e contagens ──────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return fornecedores.filter(f => {
      if (!term) return true;
      return f.nome.toLowerCase().includes(term)
        || (f.cnpj || '').toLowerCase().includes(term)
        || (f.cidade || '').toLowerCase().includes(term)
        || (f.servicos || []).some((s: any) => s.tipo_servico.toLowerCase().includes(term));
    });
  }, [fornecedores, searchTerm]);

  const profissionais = filtrados.filter(f => tipoDoFornecedor(f) === 'profissional');
  const empresas = filtrados.filter(f => tipoDoFornecedor(f) === 'empresa');
  const totalProfissionais = fornecedores.filter(f => tipoDoFornecedor(f) === 'profissional').length;
  const totalEmpresas = fornecedores.length - totalProfissionais;
  const notasFiltradas = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return notas.filter(n => !term
      || n.descricao.toLowerCase().includes(term)
      || (n.fornecedor?.nome || '').toLowerCase().includes(term)
      || (n.projeto?.name || '').toLowerCase().includes(term));
  }, [notas, searchTerm]);
  const notasPendentes = notas.filter(n => ['agendada', 'email_enviado', 'nota_recebida'].includes(n.status)).length;

  const listaAtiva = aba === 'empresas' ? empresas : profissionais;

  return (
    <div className="space-y-5 font-work-sans">
      {/* Título + contador */}
      <div className="flex items-center justify-center lg:justify-start gap-2 pt-1">
        <h1 className="text-3xl font-bold text-lumos-text-primary tracking-tight">Fornecedores</h1>
        <span className="text-[11px] font-black text-lumos-text-secondary bg-lumos-text-secondary/10 border border-lumos-border rounded-full min-w-[22px] h-[22px] px-1.5 flex items-center justify-center mt-1">
          {fornecedores.length}
        </span>
      </div>

      {/* Abas */}
      <div className="flex items-center justify-center gap-6 border-b border-lumos-border">
        {([
          { id: 'profissionais' as Aba, label: 'Profissionais', n: totalProfissionais },
          { id: 'empresas' as Aba, label: 'Empresas', n: totalEmpresas },
          ...(podeVerNotas ? [{ id: 'notas' as Aba, label: 'Notas', n: notasPendentes }] : []),
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => mudarAba(t.id)}
            className={clsx(
              'flex items-center gap-1.5 pb-2.5 px-1 text-sm font-bold border-b-2 -mb-px transition-colors',
              aba === t.id
                ? 'text-lumos-yellow border-lumos-yellow'
                : 'text-lumos-text-secondary border-transparent hover:text-lumos-text-primary',
            )}
          >
            {t.label}
            <span className={clsx('text-[10px] font-black', aba === t.id ? 'text-lumos-yellow/80' : 'text-lumos-text-secondary/70')}>{t.n}</span>
          </button>
        ))}
      </div>

      {/* Linha da seção: título + busca compacta + ações */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-base font-bold text-lumos-text-primary flex items-center gap-1.5">
          {aba === 'notas' ? 'Cobranças de nota' : aba === 'empresas' ? 'Empresas' : 'Profissionais'}
          <span className="text-[11px] font-black text-lumos-text-secondary">
            {aba === 'notas' ? notasFiltradas.length : listaAtiva.length}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary pointer-events-none" />
            <input
              type="text"
              placeholder={aba === 'notas' ? 'Buscar cobrança…' : aba === 'empresas' ? 'Buscar empresa…' : 'Buscar profissional…'}
              className="input-lumos pl-9 h-9 w-full sm:w-56 text-xs"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          {aba === 'notas' ? (
            <button onClick={() => setNovaCobranca(true)} className="btn-primary h-9 px-4 flex items-center gap-2 text-xs">
              <Plus className="w-4 h-4" /> Nova cobrança
            </button>
          ) : (
            <>
              <button
                onClick={handleCopyPublicLink}
                className="btn-secondary h-9 px-3 flex items-center gap-2 text-xs"
                title="Copia a URL pública de cadastro pra mandar ao fornecedor"
              >
                <Link2 className="w-4 h-4" /> <span className="hidden md:inline">Link de cadastro</span>
              </button>
              <button onClick={() => navigate('/producao/fornecedores/nova')} className="btn-primary h-9 px-4 flex items-center gap-2 text-xs">
                <Plus className="w-4 h-4" /> Novo Fornecedor
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div>
        </div>
      ) : aba === 'notas' ? (
        <NotasTab
          notas={notasFiltradas}
          indisponivel={notasIndisponiveis}
          enviandoId={enviandoNotaId}
          onEnviar={enviarAgora}
          onCopiar={copiarLinkNota}
          onVer={verNota}
          onMarcarPaga={n => atualizarNota(n.id, { status: 'paga' })}
          onCancelar={n => atualizarNota(n.id, { status: 'cancelada' })}
          onReativar={n => atualizarNota(n.id, { status: 'agendada' })}
        />
      ) : listaAtiva.length === 0 ? (
        <div className="card p-12 text-center text-lumos-text-secondary text-sm italic">
          {searchTerm ? 'Nenhum resultado pra essa busca.' : aba === 'empresas' ? 'Nenhuma empresa cadastrada.' : 'Nenhum profissional cadastrado.'}
        </div>
      ) : (
        <>
          {/* Desktop: tabela estilo benchmark */}
          <div className="card overflow-hidden hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-lumos-bg/40 border-b border-lumos-border">
                  <tr className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">Funções</th>
                    <th className="px-4 py-3">Local</th>
                    <th className="px-4 py-3">Pix</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-lumos-border/50">
                  {listaAtiva.map(f => {
                    const wa = waLink(f.telefone);
                    return (
                      <tr key={f.id} onClick={() => navigate(`/producao/fornecedores/${f.id}`)}
                        className="hover:bg-lumos-text-secondary/[0.03] cursor-pointer transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-lumos-yellow/15 text-lumos-yellow text-[11px] font-black flex items-center justify-center flex-shrink-0">
                              {iniciais(f.nome)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-lumos-text-primary truncate">{formatName(f.nome)}</span>
                                {f.status_cadastro === 'pendente' && (
                                  <span className="bg-yellow-500/15 text-yellow-500 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-yellow-500/20 flex-shrink-0">Pendente</span>
                                )}
                              </div>
                              {f.cnpj && <div className="text-[10px] text-lumos-text-secondary">{formatDoc(f.cnpj)}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {f.servicos?.length ? (
                            <div className="flex flex-wrap gap-1 max-w-[300px]">
                              {f.servicos.slice(0, 3).map((s: any) => (
                                <span key={s.id} className="text-[10px] font-semibold px-2 py-0.5 rounded bg-lumos-text-secondary/10 text-lumos-text-primary border border-lumos-border whitespace-nowrap">
                                  {s.tipo_servico}
                                </span>
                              ))}
                              {f.servicos.length > 3 && (
                                <span className="text-[10px] font-bold text-lumos-text-secondary">+{f.servicos.length - 3}</span>
                              )}
                            </div>
                          ) : <span className="text-lumos-text-secondary/60 text-xs italic">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-lumos-text-secondary text-xs">{f.cidade || '—'}</td>
                        <td className="px-4 py-2.5">
                          {f.payment_info
                            ? <span className="text-xs text-lumos-text-secondary truncate block max-w-[180px]">{f.payment_info}</span>
                            : <span className="text-xs text-lumos-text-secondary/50 italic">Sem Pix</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            {f.status_cadastro === 'pendente' && (
                              <button onClick={e => { e.stopPropagation(); aprovar(f.id); }}
                                className="p-1.5 text-green-500 hover:bg-green-500/10 rounded-full transition-all" title="Aprovar cadastro">
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                            )}
                            {wa && (
                              <a href={wa} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                                className="p-1.5 text-green-500 hover:bg-green-500/10 rounded-full transition-all" title={`WhatsApp: ${formatPhone(f.telefone)}`}>
                                <MessageCircle className="w-4 h-4" />
                              </a>
                            )}
                            <button onClick={e => { e.stopPropagation(); navigate(`/producao/fornecedores/${f.id}`); }}
                              className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all" title="Editar">
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={e => { e.stopPropagation(); setDeletingId(f.id); setIsDeleteModalOpen(true); }}
                              className="p-1.5 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all" title="Excluir">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile: cartões */}
          <div className="lg:hidden">
            <MobileCardList>
              {listaAtiva.map(f => {
                const wa = waLink(f.telefone);
                return (
                  <MobileCard key={f.id} onClick={() => navigate(`/producao/fornecedores/${f.id}`)}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-lumos-yellow/15 text-lumos-yellow text-[11px] font-black flex items-center justify-center flex-shrink-0">
                          {iniciais(f.nome)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-lumos-text-primary truncate">{formatName(f.nome)}</span>
                            {f.status_cadastro === 'pendente' && (
                              <span className="bg-yellow-500/15 text-yellow-500 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-yellow-500/20 flex-shrink-0">Pendente</span>
                            )}
                          </div>
                          <div className="text-[11px] text-lumos-text-secondary truncate">
                            {[f.cidade, formatPhone(f.telefone), f.email].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {f.status_cadastro === 'pendente' && (
                          <button onClick={e => { e.stopPropagation(); aprovar(f.id); }}
                            className="p-1.5 text-green-500 hover:bg-green-500/10 rounded-full" title="Aprovar">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        {wa && (
                          <a href={wa} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                            className="p-1.5 text-green-500 hover:bg-green-500/10 rounded-full" title="WhatsApp">
                            <MessageCircle className="w-4 h-4" />
                          </a>
                        )}
                        <button onClick={e => { e.stopPropagation(); setDeletingId(f.id); setIsDeleteModalOpen(true); }}
                          className="p-1.5 text-lumos-text-secondary hover:text-red-500 rounded-full" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {f.servicos?.length ? (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {f.servicos.map((s: any) => (
                          <span key={s.id} className="text-[10px] font-semibold px-2 py-0.5 rounded bg-lumos-text-secondary/10 text-lumos-text-primary border border-lumos-border whitespace-nowrap">
                            {s.tipo_servico}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </MobileCard>
                );
              })}
            </MobileCardList>
          </div>
        </>
      )}

      {novaCobranca && (
        <NovaCobrancaModal
          fornecedores={fornecedores}
          onClose={() => setNovaCobranca(false)}
          onCreated={() => { setNovaCobranca(false); fetchTudo(true); }}
        />
      )}

      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Confirmar Exclusão">
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-red-500/10 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div className="space-y-1">
              <p className="text-lumos-text-primary font-bold">Deseja excluir este fornecedor?</p>
              <p className="text-xs text-lumos-text-secondary">
                Isso removerá permanentemente o fornecedor e todos os seus serviços cadastrados.
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setIsDeleteModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lumos flex-1 transition-all">
              Excluir
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Aba Notas ──────────────────────────────────────────────────────────────
function NotasTab({ notas, indisponivel, enviandoId, onEnviar, onCopiar, onVer, onMarcarPaga, onCancelar, onReativar }: {
  notas: NotaRequest[];
  indisponivel: boolean;
  enviandoId: string | null;
  onEnviar: (n: NotaRequest) => void;
  onCopiar: (n: NotaRequest) => void;
  onVer: (n: NotaRequest) => void;
  onMarcarPaga: (n: NotaRequest) => void;
  onCancelar: (n: NotaRequest) => void;
  onReativar: (n: NotaRequest) => void;
}) {
  if (indisponivel) {
    return (
      <div className="card p-10 text-center space-y-2">
        <Receipt className="w-8 h-8 text-lumos-text-secondary mx-auto" />
        <p className="text-sm font-bold text-lumos-text-primary">Cobrança de notas ainda não ativada</p>
        <p className="text-xs text-lumos-text-secondary">Falta rodar a migration no Supabase pra criar a tabela de cobranças.</p>
      </div>
    );
  }
  if (notas.length === 0) {
    return (
      <div className="card p-10 text-center space-y-2">
        <Receipt className="w-8 h-8 text-lumos-text-secondary mx-auto" />
        <p className="text-sm font-bold text-lumos-text-primary">Nenhuma cobrança por aqui ainda</p>
        <p className="text-xs text-lumos-text-secondary max-w-md mx-auto">
          Todo custo de projeto com fornecedor (e e-mail cadastrado) agenda uma cobrança sozinho: 28 dias
          depois do serviço o fornecedor recebe o pedido da nota, e o pagamento fica previsto pra 35 dias.
        </p>
      </div>
    );
  }

  const Acoes = ({ n }: { n: NotaRequest }) => (
    <div className="flex items-center justify-end gap-1">
      {['agendada', 'email_enviado'].includes(n.status) && (
        <>
          <button onClick={e => { e.stopPropagation(); onEnviar(n); }} disabled={enviandoId === n.id}
            className="p-1.5 text-lumos-yellow hover:bg-lumos-yellow/10 rounded-full transition-all disabled:opacity-50"
            title={n.status === 'agendada' ? 'Enviar e-mail de cobrança agora' : 'Reenviar e-mail de cobrança'}>
            {enviandoId === n.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
          <button onClick={e => { e.stopPropagation(); onCopiar(n); }}
            className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all"
            title="Copiar link público da nota">
            <Copy className="w-4 h-4" />
          </button>
          <button onClick={e => { e.stopPropagation(); onCancelar(n); }}
            className="p-1.5 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all" title="Cancelar cobrança">
            <Ban className="w-4 h-4" />
          </button>
        </>
      )}
      {n.status === 'nota_recebida' && (
        <>
          <button onClick={e => { e.stopPropagation(); onVer(n); }}
            className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all" title="Ver a nota enviada">
            <FileText className="w-4 h-4" />
          </button>
          <button onClick={e => { e.stopPropagation(); onMarcarPaga(n); }}
            className="p-1.5 text-green-500 hover:bg-green-500/10 rounded-full transition-all" title="Marcar como paga">
            <CheckCircle2 className="w-4 h-4" />
          </button>
        </>
      )}
      {n.status === 'paga' && n.nota_arquivo && (
        <button onClick={e => { e.stopPropagation(); onVer(n); }}
          className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all" title="Ver a nota">
          <FileText className="w-4 h-4" />
        </button>
      )}
      {n.status === 'cancelada' && (
        <button onClick={e => { e.stopPropagation(); onReativar(n); }}
          className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all" title="Reativar cobrança">
          <RotateCcw className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const Status = ({ n }: { n: NotaRequest }) => {
    const s = NOTA_STATUS[n.status] || NOTA_STATUS.agendada;
    return <span className={clsx('text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap', s.cls)}>{s.label}</span>;
  };

  return (
    <>
      {/* Desktop */}
      <div className="card overflow-hidden hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-lumos-bg/40 border-b border-lumos-border">
              <tr className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">
                <th className="px-4 py-3">Fornecedor</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3" title="Data do serviço prestado">Serviço</th>
                <th className="px-4 py-3" title="Quando o e-mail de cobrança sai (serviço + 28 dias)">Cobrança</th>
                <th className="px-4 py-3" title="Pagamento previsto (serviço + 35 dias)">Pagamento</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lumos-border/50">
              {notas.map(n => (
                <tr key={n.id} className="hover:bg-lumos-text-secondary/[0.03] transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="font-bold text-lumos-text-primary">{n.fornecedor ? formatName(n.fornecedor.nome) : '—'}</div>
                    {!n.fornecedor?.email && <div className="text-[10px] text-red-500 font-bold">sem e-mail cadastrado</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-xs text-lumos-text-primary max-w-[260px] truncate" title={n.descricao}>{n.descricao}</div>
                    {n.projeto?.name && <div className="text-[10px] text-lumos-text-secondary truncate">{n.projeto.name}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-bold text-lumos-text-primary whitespace-nowrap">{brl(n.valor)}</td>
                  <td className="px-4 py-2.5 text-xs text-lumos-text-secondary whitespace-nowrap">{brData(n.data_servico)}</td>
                  <td className="px-4 py-2.5 text-xs text-lumos-text-secondary whitespace-nowrap">{brData(n.enviar_em)}</td>
                  <td className="px-4 py-2.5 text-xs text-lumos-text-secondary whitespace-nowrap">{brData(n.pagar_em)}</td>
                  <td className="px-4 py-2.5"><Status n={n} /></td>
                  <td className="px-4 py-2.5"><Acoes n={n} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile */}
      <div className="lg:hidden">
        <MobileCardList>
          {notas.map(n => (
            <MobileCard key={n.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-lumos-text-primary truncate">{n.fornecedor ? formatName(n.fornecedor.nome) : '—'}</span>
                <Status n={n} />
              </div>
              <div className="text-[11px] text-lumos-text-secondary truncate mt-0.5">{n.descricao}</div>
              <div className="flex items-center justify-between gap-2 mt-1.5">
                <span className="text-[11px] text-lumos-text-secondary">
                  {brl(n.valor)} · cobrança {brData(n.enviar_em)} · paga {brData(n.pagar_em)}
                </span>
                <Acoes n={n} />
              </div>
            </MobileCard>
          ))}
        </MobileCardList>
      </div>
    </>
  );
}

// ── Nova cobrança manual ───────────────────────────────────────────────────
function NovaCobrancaModal({ fornecedores, onClose, onCreated }: {
  fornecedores: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const { profile } = useAuth();
  const [projetos, setProjetos] = useState<{ id: string; name: string }[]>([]);
  const [fornecedorId, setFornecedorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [dataServico, setDataServico] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('projects').select('id, name').order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setProjetos(data || []));
  }, []);

  const salvar = async () => {
    if (!fornecedorId || !descricao.trim() || !dataServico) {
      toast.error('Preencha fornecedor, job e data do serviço.');
      return;
    }
    setSaving(true);
    const base = new Date(`${dataServico}T12:00:00`);
    const soma = (dias: number) => {
      const d = new Date(base); d.setDate(d.getDate() + dias);
      return d.toISOString().slice(0, 10);
    };
    const { error } = await supabase.from('nota_requests').insert({
      fornecedor_id: fornecedorId,
      project_id: projectId || null,
      descricao: descricao.trim(),
      valor: valor ? Number(valor.replace(/\./g, '').replace(',', '.')) : null,
      data_servico: dataServico,
      enviar_em: soma(28),
      pagar_em: soma(35),
      created_by: profile?.id || null,
    });
    setSaving(false);
    if (error) toast.error(`Erro ao criar: ${error.message}`);
    else { toast.success('Cobrança agendada ✓'); onCreated(); }
  };

  return (
    <Modal isOpen onClose={onClose} title="Nova cobrança de nota">
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Fornecedor *</label>
          <Select className="input-lumos w-full" value={fornecedorId} onChange={setFornecedorId} placeholder="Escolha o fornecedor"
            options={fornecedores.map(f => ({ value: f.id, label: f.nome + (f.email ? '' : ' (sem e-mail)') }))} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Projeto</label>
          <Select className="input-lumos w-full" value={projectId} onChange={setProjectId} placeholder="Sem projeto"
            options={[{ value: '', label: 'Sem projeto' }, ...projetos.map(p => ({ value: p.id, label: p.name }))]} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Job / descrição *</label>
          <input className="input-lumos w-full" value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex: Diária de captação, edição do vídeo X…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Valor (R$)</label>
            <input className="input-lumos w-full" value={valor} onChange={e => setValor(e.target.value)} placeholder="Ex: 1500,00" inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Data do serviço *</label>
            <input type="date" className="input-lumos w-full" value={dataServico} onChange={e => setDataServico(e.target.value)} />
          </div>
        </div>
        {dataServico && (
          <p className="text-[11px] text-lumos-text-secondary">
            Cobrança por e-mail em <strong>{brData((() => { const d = new Date(`${dataServico}T12:00:00`); d.setDate(d.getDate() + 28); return d.toISOString().slice(0, 10); })())}</strong>,
            pagamento previsto pra <strong>{brData((() => { const d = new Date(`${dataServico}T12:00:00`); d.setDate(d.getDate() + 35); return d.toISOString().slice(0, 10); })())}</strong>.
          </p>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={salvar} disabled={saving} className="btn-primary flex-1 disabled:opacity-50">
            {saving ? 'Salvando…' : 'Agendar cobrança'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
