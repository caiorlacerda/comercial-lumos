import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBarraDeCarregamento } from '@/lib/progressoDeCarregamento';
import { EsqueletoItens } from '@/components/ui/Esqueleto';
import {
  AlertTriangle, Ban, CheckCircle2, Copy, FileText, Loader2, MailCheck, Plus, Receipt, RotateCcw, Search, Send,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch';
import { formatName } from '@/lib/format';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';
import { MobileCardList, MobileCard } from '@/components/ui/MobileCards';

/**
 * NOTAS — as cobranças de nota fiscal dos fornecedores, agora morando no
 * Financeiro (vieram da página de Fornecedores). Cobrança nasce sozinha da
 * escala das diárias ou dos custos; o e-mail sai 28 dias após o serviço e o
 * pagamento fica previsto pros 35. Filtros por etapa, projeto e fornecedor.
 */

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
  dados_pagamento?: string | null;
  origem?: string | null;
  lembretes_enviados?: number | null;
  fornecedor: { id: string; nome: string; email: string | null } | null;
  projeto: { name: string } | null;
  project_id?: string | null;
}

const brData = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const brl = (v: number | null) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const diasAte = (iso: string) => {
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const alvo = new Date(`${iso}T12:00:00`);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
};

/**
 * O que impede a cobrança agendada de sair. O e-mail só vai com fornecedor que
 * tenha e-mail E valor definido; sem isso o cron pula todo dia em silêncio, e
 * foi assim que cobranças ficaram paradas sem ninguém ver.
 */
const problemaDaCobranca = (n: NotaRequest): 'Falta e-mail' | 'Falta valor' | null => {
  if (n.status !== 'agendada') return null;
  if (!n.fornecedor?.email) return 'Falta e-mail';
  if (n.valor == null) return 'Falta valor';
  return null;
};

const hojeIso = () => new Date().toLocaleDateString('en-CA');
/** E-mail enviado, sem nota e com o pagamento previsto já vencido: o caso que pede ação do time. */
const semNotaVencida = (n: NotaRequest) => n.status === 'email_enviado' && n.pagar_em < hojeIso();

const ORIGEM_LABEL: Record<string, string> = {
  diaria: 'criada pelas diárias do projeto',
  custo: 'criada pelo custo do projeto',
  manual: 'criada à mão',
};

const NOTA_STATUS: Record<string, { label: string; cls: string }> = {
  agendada:      { label: 'Agendada',       cls: 'bg-sky-500/15 text-sky-500 border-sky-500/30' },
  email_enviado: { label: 'E-mail enviado', cls: 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/40' },
  nota_recebida: { label: 'Nota recebida',  cls: 'bg-green-500/15 text-green-500 border-green-500/30' },
  paga:          { label: 'Paga',           cls: 'bg-emerald-600/15 text-emerald-500 border-emerald-600/30' },
  cancelada:     { label: 'Cancelada',      cls: 'bg-lumos-text-secondary/10 text-lumos-text-secondary border-lumos-border' },
};

const CHIPS_STATUS: { id: string; label: string }[] = [
  { id: '', label: 'Todas' },
  { id: 'agendada', label: 'Agendadas' },
  { id: 'email_enviado', label: 'E-mail enviado' },
  { id: 'vencidas', label: 'Sem nota (vencidas)' },
  { id: 'nota_recebida', label: 'Nota recebida' },
  { id: 'paga', label: 'Pagas' },
  { id: 'cancelada', label: 'Canceladas' },
];

function ValorEditavel({ n, onSave }: { n: NotaRequest; onSave: (valor: number | null) => void }) {
  const [editando, setEditando] = useState(false);
  if (!editando) {
    return (
      <button onClick={() => setEditando(true)}
        className={clsx('text-xs font-bold whitespace-nowrap hover:underline underline-offset-4 decoration-dotted',
          n.valor == null ? 'text-lumos-text-secondary/60 italic' : 'text-lumos-text-primary')}
        title="Clique pra editar o valor">
        {n.valor == null ? 'definir valor' : brl(n.valor)}
      </button>
    );
  }
  return (
    <input autoFocus defaultValue={n.valor ?? ''} placeholder="1500,00" inputMode="decimal"
      className="input-lumos w-[92px] h-7 text-xs px-2"
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditando(false); }}
      onBlur={e => {
        const raw = e.target.value.trim();
        setEditando(false);
        if (raw === '') { if (n.valor != null) onSave(null); return; }
        const num = Number(raw.replace(/\./g, '').replace(',', '.'));
        if (!Number.isNaN(num) && num !== n.valor) onSave(num);
      }} />
  );
}

export default function FinanceiroNotas() {
  const toast = useToast();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  useBarraDeCarregamento(loading);
  const [notas, setNotas] = useState<NotaRequest[]>([]);
  const [indisponivel, setIndisponivel] = useState(false);
  const [enviandoId, setEnviandoId] = useState<string | null>(null);
  const [novaCobranca, setNovaCobranca] = useState(false);
  const [recebendo, setRecebendo] = useState<NotaRequest | null>(null);
  const [fornecedores, setFornecedores] = useState<{ id: string; nome: string; email: string | null }[]>([]);

  const [statusFiltro, setStatusFiltro] = useState('');
  const [projetoFiltro, setProjetoFiltro] = useState('');
  const [fornecedorFiltro, setFornecedorFiltro] = useState('');
  const [busca, setBusca] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const colsBase = 'id, descricao, valor, data_servico, enviar_em, pagar_em, token, status, nota_arquivo, project_id, fornecedor:fornecedores(id, nome, email), projeto:projects(name)';
    // Cada tentativa tira colunas que podem não existir ainda (migration não rodada).
    let q: { data: unknown; error: { message: string } | null } = await supabase
      .from('nota_requests')
      .select(`${colsBase}, dados_pagamento, origem, lembretes_enviados`)
      .order('enviar_em', { ascending: false });
    if (q.error) {
      q = await supabase.from('nota_requests').select(`${colsBase}, dados_pagamento, origem`).order('enviar_em', { ascending: false });
    }
    if (q.error) {
      q = await supabase.from('nota_requests').select(colsBase).order('enviar_em', { ascending: false });
    }
    if (q.error) setIndisponivel(true);
    else { setIndisponivel(false); setNotas((q.data as NotaRequest[]) || []); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefetch(['nota_requests'], () => load(true));

  useEffect(() => {
    supabase.from('fornecedores').select('id, nome, email').order('nome')
      .then(({ data }) => setFornecedores((data as any[]) || []));
  }, []);

  const projetos = useMemo(() => {
    const m = new Map<string, string>();
    notas.forEach(n => { if (n.project_id && n.projeto?.name) m.set(n.project_id, n.projeto.name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [notas]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return notas.filter(n => {
      if (statusFiltro === 'vencidas') { if (!semNotaVencida(n)) return false; }
      else if (statusFiltro && n.status !== statusFiltro) return false;
      if (projetoFiltro && n.project_id !== projetoFiltro) return false;
      if (fornecedorFiltro && n.fornecedor?.id !== fornecedorFiltro) return false;
      if (q && !`${n.descricao} ${n.fornecedor?.nome || ''} ${n.projeto?.name || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [notas, statusFiltro, projetoFiltro, fornecedorFiltro, busca]);

  const pendentes = notas.filter(n => ['agendada', 'email_enviado', 'nota_recebida'].includes(n.status)).length;
  const travadas = useMemo(() => ({
    semEmail: notas.filter(n => problemaDaCobranca(n) === 'Falta e-mail').length,
    semValor: notas.filter(n => problemaDaCobranca(n) === 'Falta valor').length,
    vencidas: notas.filter(semNotaVencida).length,
  }), [notas]);

  // ── Ações ────────────────────────────────────────────────────────────────
  const atualizar = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from('nota_requests').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) toast.error(`Erro: ${error.message}`);
    else load(true);
  };

  const enviarAgora = async (n: NotaRequest) => {
    if (!n.fornecedor?.email) { toast.error('Esse fornecedor não tem e-mail cadastrado.'); return; }
    if (n.valor == null) { toast.error('Defina o valor antes de enviar a cobrança (clique em "definir valor").'); return; }
    setEnviandoId(n.id);
    try {
      const { data, error } = await supabase.functions.invoke('nota-cron', { body: { id: n.id } });
      if (error) throw error;
      const r = data?.resultados?.[0];
      if (r?.ok) toast.success(`E-mail de cobrança enviado pra ${n.fornecedor.nome} ✓`);
      else toast.error(`Não enviou: ${r?.motivo || 'erro desconhecido'}`);
      load(true);
    } catch (err: any) {
      toast.error(`Erro ao enviar: ${err.message}`);
    } finally {
      setEnviandoId(null);
    }
  };

  const copiarLink = async (n: NotaRequest) => {
    const url = `${window.location.origin}/nota/${n.token}`;
    try { await navigator.clipboard.writeText(url); toast.success('Link da nota copiado ✓'); }
    catch { toast.error(`Falha ao copiar. URL: ${url}`); }
  };

  const verNota = (n: NotaRequest) => {
    if (!n.nota_arquivo?.path) return;
    const { data } = supabase.storage.from('notas-fiscais').getPublicUrl(n.nota_arquivo.path);
    window.open(data.publicUrl, '_blank');
  };

  const Acoes = ({ n }: { n: NotaRequest }) => (
    <div className="flex items-center justify-end gap-1">
      {['agendada', 'email_enviado'].includes(n.status) && (
        <>
          <button onClick={() => enviarAgora(n)} disabled={enviandoId === n.id}
            className="p-1.5 text-lumos-yellow hover:bg-lumos-yellow/10 rounded-full transition-all disabled:opacity-50"
            title={n.status === 'agendada' ? 'Enviar e-mail de cobrança agora' : 'Reenviar e-mail de cobrança'}>
            {enviandoId === n.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
          <button onClick={() => setRecebendo(n)}
            className="p-1.5 text-green-500 hover:bg-green-500/10 rounded-full transition-all"
            title="A nota chegou por e-mail: registrar como recebida">
            <MailCheck className="w-4 h-4" />
          </button>
          <button onClick={() => copiarLink(n)}
            className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all"
            title="Copiar link público da nota">
            <Copy className="w-4 h-4" />
          </button>
          <button onClick={() => atualizar(n.id, { status: 'cancelada' })}
            className="p-1.5 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all" title="Cancelar cobrança">
            <Ban className="w-4 h-4" />
          </button>
        </>
      )}
      {n.status === 'nota_recebida' && (
        <>
          <button onClick={() => verNota(n)}
            className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all" title="Ver a nota enviada">
            <FileText className="w-4 h-4" />
          </button>
          <button onClick={() => atualizar(n.id, { status: 'paga' })}
            className="p-1.5 text-green-500 hover:bg-green-500/10 rounded-full transition-all" title="Marcar como paga">
            <CheckCircle2 className="w-4 h-4" />
          </button>
        </>
      )}
      {n.status === 'paga' && n.nota_arquivo && (
        <button onClick={() => verNota(n)}
          className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all" title="Ver a nota">
          <FileText className="w-4 h-4" />
        </button>
      )}
      {n.status === 'cancelada' && (
        <button onClick={() => atualizar(n.id, { status: 'agendada' })}
          className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all" title="Reativar cobrança">
          <RotateCcw className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const Status = ({ n }: { n: NotaRequest }) => {
    const s = NOTA_STATUS[n.status] || NOTA_STATUS.agendada;
    let label = s.label;
    let title: string | undefined = n.origem ? ORIGEM_LABEL[n.origem] : undefined;
    let cls = s.cls;
    if (n.status === 'agendada') {
      const dias = diasAte(n.enviar_em);
      label = dias <= 0 ? 'Envia hoje' : dias === 1 ? 'Envia amanhã' : `Envia em ${dias} dias`;
      title = `E-mail automático em ${brData(n.enviar_em)}${title ? `, ${title}` : ''}`;
      const problema = problemaDaCobranca(n);
      if (problema) {
        label = problema;
        cls = 'bg-red-500/15 text-red-500 border-red-500/30';
        title = `${problema === 'Falta e-mail' ? 'O fornecedor não tem e-mail cadastrado' : 'O valor da cobrança não foi definido'}: o e-mail não sai até corrigir (previsto para ${brData(n.enviar_em)}).`;
      }
    }
    if (n.status === 'email_enviado') {
      const lembretes = n.lembretes_enviados ?? 0;
      title = `${lembretes > 0 ? `${lembretes} lembrete(s) já enviado(s)` : 'Nenhum lembrete enviado'}${title ? ` · ${title}` : ''}`;
      if (semNotaVencida(n)) {
        const atraso = -diasAte(n.pagar_em);
        label = `Sem nota · ${atraso} d`;
        cls = 'bg-red-500/15 text-red-500 border-red-500/30';
        title = `Pagamento previsto em ${brData(n.pagar_em)} (há ${atraso} dia(s)) e a nota não chegou. ${title}`;
      }
    }
    return <span title={title} className={clsx('text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap', cls)}>{label}</span>;
  };

  return (
    <div className="space-y-5 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight flex items-center gap-2">
            Notas
            {pendentes > 0 && (
              <span className="text-[11px] font-black text-lumos-text-secondary bg-lumos-text-secondary/10 border border-lumos-border rounded-full min-w-[22px] h-[22px] px-1.5 flex items-center justify-center">{pendentes}</span>
            )}
          </h1>
          <p className="text-lumos-text-secondary text-sm">Cobrança de nota fiscal dos fornecedores, automática pelas diárias e custos.</p>
        </div>
        <button onClick={() => setNovaCobranca(true)} className="btn-primary h-10 px-4 flex items-center gap-2 text-xs self-start md:self-auto">
          <Plus className="w-4 h-4" /> Nova cobrança
        </button>
      </div>

      {(travadas.semEmail > 0 || travadas.semValor > 0 || travadas.vencidas > 0) && (
        <div className="rounded-lumos border border-amber-500/50 bg-amber-500/10 px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-300 flex-shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-amber-800 dark:text-amber-200">
            <b>Atenção:</b>{' '}
            {[
              travadas.vencidas > 0 && `${travadas.vencidas} com pagamento previsto vencido e sem nota (se já chegou por e-mail, registre no envelope; filtro "Sem nota")`,
              travadas.semValor > 0 && `${travadas.semValor} cobrança(s) sem valor, não saem sozinhas (clique em "definir valor")`,
              travadas.semEmail > 0 && `${travadas.semEmail} com fornecedor sem e-mail, não saem sozinhas (cadastre em Fornecedores)`,
            ].filter(Boolean).join(' · ')}.
          </p>
        </div>
      )}

      {/* Filtros: etapa, projeto, fornecedor, busca */}
      <div className="card p-3 space-y-2.5">
        <div className="flex items-center gap-1 flex-wrap">
          {CHIPS_STATUS.map(c => (
            <button key={c.id} onClick={() => setStatusFiltro(c.id)} aria-pressed={statusFiltro === c.id}
              className={clsx('chip-lumos px-3 h-8 rounded-full text-[11px] font-black uppercase tracking-wider border transition-colors',
                statusFiltro === c.id
                  ? 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/40'
                  : 'text-lumos-text-secondary border-lumos-border hover:text-lumos-text-primary')}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-52">
            <Select value={projetoFiltro} onChange={setProjetoFiltro} className="input-lumos h-9 w-full text-xs" placeholder="Todos os projetos"
              options={[{ value: '', label: 'Todos os projetos' }, ...projetos.map(([id, nome]) => ({ value: id, label: nome }))]} />
          </div>
          <div className="w-52">
            <Select value={fornecedorFiltro} onChange={setFornecedorFiltro} className="input-lumos h-9 w-full text-xs" placeholder="Todos os fornecedores"
              options={[{ value: '', label: 'Todos os fornecedores' }, ...fornecedores.map(f => ({ value: f.id, label: f.nome }))]} />
          </div>
          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary pointer-events-none" />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cobrança…"
              className="input-lumos pl-9 h-9 w-full sm:w-56 text-xs" />
          </div>
        </div>
      </div>

      {loading ? (
        <EsqueletoItens n={4} />
      ) : indisponivel ? (
        <div className="card p-10 text-center space-y-2">
          <Receipt className="w-8 h-8 text-lumos-text-secondary mx-auto" />
          <p className="text-sm font-bold text-lumos-text-primary">Cobrança de notas ainda não ativada</p>
          <p className="text-xs text-lumos-text-secondary">Falta rodar a migration no Supabase pra criar a tabela de cobranças.</p>
        </div>
      ) : filtradas.length === 0 ? (
        <div className="card p-10 text-center space-y-2">
          <Receipt className="w-8 h-8 text-lumos-text-secondary mx-auto" />
          <p className="text-sm font-bold text-lumos-text-primary">Nenhuma cobrança por aqui.</p>
          <p className="text-xs text-lumos-text-secondary max-w-md mx-auto">
            Fornecedor escalado em diária com data, ou custo de projeto com fornecedor, agenda a cobrança sozinho:
            28 dias depois do serviço o e-mail sai, e o pagamento fica previsto pros 35 dias.
          </p>
        </div>
      ) : (
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
                  {filtradas.map(n => (
                    <tr key={n.id} className="hover:bg-lumos-text-secondary/[0.03] transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="font-bold text-lumos-text-primary">{n.fornecedor ? formatName(n.fornecedor.nome) : '—'}</div>
                        {!n.fornecedor?.email && <div className="text-[10px] text-red-500 font-bold">sem e-mail cadastrado</div>}
                        {n.dados_pagamento && (
                          <div className="text-[10px] text-lumos-text-secondary truncate max-w-[220px]" title={n.dados_pagamento}>
                            PIX: {n.dados_pagamento}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs text-lumos-text-primary max-w-[260px] truncate" title={n.descricao}>{n.descricao}</div>
                        {n.projeto?.name && <div className="text-[10px] text-lumos-text-secondary truncate">{n.projeto.name}</div>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {['agendada', 'email_enviado', 'nota_recebida'].includes(n.status)
                          ? <ValorEditavel n={n} onSave={v => atualizar(n.id, { valor: v })} />
                          : <span className="text-xs font-bold text-lumos-text-primary">{brl(n.valor)}</span>}
                      </td>
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
              {filtradas.map(n => (
                <MobileCard key={n.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-lumos-text-primary truncate">{n.fornecedor ? formatName(n.fornecedor.nome) : '—'}</span>
                    <Status n={n} />
                  </div>
                  <div className="text-[11px] text-lumos-text-secondary truncate mt-0.5">{n.descricao}</div>
                  {n.dados_pagamento && (
                    <div className="text-[10px] text-lumos-text-secondary truncate">PIX: {n.dados_pagamento}</div>
                  )}
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
      )}

      {recebendo && (
        <RecebidaPorEmailModal
          n={recebendo}
          onClose={() => setRecebendo(null)}
          onDone={() => { setRecebendo(null); load(true); }}
        />
      )}

      {novaCobranca && (
        <NovaCobrancaModal
          fornecedores={fornecedores}
          onClose={() => setNovaCobranca(false)}
          onCreated={() => { setNovaCobranca(false); load(true); }}
          profileId={profile?.id || null}
        />
      )}
    </div>
  );
}

// ── Nova cobrança manual ───────────────────────────────────────────────────
function NovaCobrancaModal({ fornecedores, onClose, onCreated, profileId }: {
  fornecedores: { id: string; nome: string; email: string | null }[];
  onClose: () => void;
  onCreated: () => void;
  profileId: string | null;
}) {
  const toast = useToast();
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

  const soma = (dias: number) => {
    const d = new Date(`${dataServico}T12:00:00`); d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  };

  const salvar = async () => {
    if (!fornecedorId || !descricao.trim() || !dataServico) {
      toast.error('Preencha fornecedor, job e data do serviço.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('nota_requests').insert({
      fornecedor_id: fornecedorId,
      project_id: projectId || null,
      descricao: descricao.trim(),
      valor: valor ? Number(valor.replace(/\./g, '').replace(',', '.')) : null,
      data_servico: dataServico,
      enviar_em: soma(28),
      pagar_em: soma(35),
      created_by: profileId,
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
            Cobrança por e-mail em <strong>{brData(soma(28))}</strong>, pagamento previsto pra <strong>{brData(soma(35))}</strong>.
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


// ── Nota que chegou por e-mail (financeiro@) ──────────────────────────────
// A maioria dos fornecedores responde mandando a nota por e-mail em vez de usar
// o link. Aqui o time registra isso: a cobrança deixa de ficar "esperando" e o
// arquivo, se quiser, fica guardado junto.
function RecebidaPorEmailModal({ n, onClose, onDone }: { n: NotaRequest; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const salvar = async () => {
    if (arquivo && arquivo.size > 15 * 1024 * 1024) { toast.error('O arquivo pode ter no máximo 15MB.'); return; }
    setSaving(true);
    try {
      let nota_arquivo: { name: string; path: string } | undefined;
      if (arquivo) {
        // Sobe antes de mudar o status: a regra do bucket só aceita arquivo
        // enquanto a cobrança está aberta.
        const nomeLimpo = arquivo.name.replace(/[^\w.\-()\s]/g, '_');
        const path = `${n.token}/${Date.now()}_${nomeLimpo}`;
        const { error: upErr } = await supabase.storage.from('notas-fiscais').upload(path, arquivo, { upsert: false });
        if (upErr) throw upErr;
        nota_arquivo = { name: arquivo.name, path };
      }
      const { error } = await supabase.from('nota_requests').update({
        status: 'nota_recebida',
        nota_enviada_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(nota_arquivo ? { nota_arquivo } : {}),
      }).eq('id', n.id);
      if (error) throw error;
      toast.success('Nota registrada como recebida ✓');
      onDone();
    } catch (err: any) {
      toast.error(`Não foi possível registrar: ${err.message || 'erro desconhecido'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Nota recebida por e-mail">
      <div className="space-y-3">
        <p className="text-sm text-lumos-text-secondary">
          <b className="text-lumos-text-primary">{n.fornecedor ? formatName(n.fornecedor.nome) : 'O fornecedor'}</b> mandou a nota de
          {' '}<b className="text-lumos-text-primary">{n.descricao}</b>? Registre aqui para encerrar a espera por ela.
        </p>
        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Arquivo da nota (opcional)</label>
          <input type="file" accept=".pdf,.xml,.jpg,.jpeg,.png"
            onChange={e => setArquivo(e.target.files?.[0] || null)}
            className="input-lumos w-full text-xs" />
          <p className="text-[11px] text-lumos-text-secondary">Anexe se quiser guardar a nota junto da cobrança (PDF, XML ou foto, até 15MB).</p>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={salvar} disabled={saving} className="btn-primary flex-1 disabled:opacity-50">
            {saving ? 'Salvando…' : 'Marcar como recebida'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
