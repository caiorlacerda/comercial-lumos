import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Trash2, Edit2, AlertTriangle, Link2, CheckCircle2, MessageCircle,
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
 * As cobranças de nota fiscal moram agora em Financeiro › Notas.
 */

type Aba = 'profissionais' | 'empresas';

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

export default function Fornecedores() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [fornecedores, setFornecedores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const abaParam = searchParams.get('tab');
  const [aba, setAba] = useState<Aba>(abaParam === 'empresas' ? 'empresas' : 'profissionais');

  // As notas mudaram de casa: link antigo cai no endereço novo.
  useEffect(() => {
    if (abaParam === 'notas') navigate('/financeiro/notas', { replace: true });
  }, [abaParam, navigate]);
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
          {aba === 'empresas' ? 'Empresas' : 'Profissionais'}
          <span className="text-[11px] font-black text-lumos-text-secondary">
            {listaAtiva.length}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary pointer-events-none" />
            <input
              type="text"
              placeholder={aba === 'empresas' ? 'Buscar empresa…' : 'Buscar profissional…'}
              className="input-lumos pl-9 h-9 w-full sm:w-56 text-xs"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
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
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-lumos-yellow mx-auto"></div>
        </div>

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
