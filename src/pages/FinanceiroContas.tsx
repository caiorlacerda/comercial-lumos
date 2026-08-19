import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Banknote, Copy, Landmark, Loader2, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';

/**
 * CONTAS — no modelo do benchmark: os dados bancários da produtora num lugar
 * só, prontos pra copiar e mandar pro cliente, com o saldo real vindo do
 * último extrato importado. As contas a pagar e a receber viram sub-abas
 * daqui (as páginas continuam as mesmas por dentro).
 */

const ContasPagar = lazy(() => import('@/pages/ContasPagar'));
const ContasReceber = lazy(() => import('@/pages/ContasReceber'));

type Aba = 'bancos' | 'pagar' | 'receber';

interface Conta {
  id: string;
  nome: string;
  tipo: string;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  pix: string | null;
  titular: string | null;
  documento: string | null;
  principal: boolean;
}

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const ICONES: Record<string, typeof Landmark> = { banco: Landmark, dinheiro: Banknote, cartao: Wallet };

export default function FinanceiroContas() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const abaParam = searchParams.get('tab') as Aba | null;
  const [aba, setAba] = useState<Aba>(abaParam === 'pagar' || abaParam === 'receber' ? abaParam : 'bancos');
  const mudarAba = (a: Aba) => {
    setAba(a);
    setSearchParams(a === 'bancos' ? {} : { tab: a }, { replace: true });
  };

  const [contas, setContas] = useState<Conta[]>([]);
  const [saldoExtrato, setSaldoExtrato] = useState<{ valor: number; quando: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [indisponivel, setIndisponivel] = useState(false);
  const [editando, setEditando] = useState<Partial<Conta> | null>(null);
  const [salvando, setSalvando] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bank_accounts')
      .select('*').order('principal', { ascending: false }).order('ordem').order('created_at');
    if (error) { setIndisponivel(true); setLoading(false); return; }
    setIndisponivel(false);
    setContas((data as Conta[]) || []);
    // saldo real: o saldo final do último extrato importado
    const { data: imp } = await supabase.from('bank_imports')
      .select('saldo_final, periodo, created_at')
      .not('saldo_final', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (imp?.saldo_final != null) {
      setSaldoExtrato({ valor: Number(imp.saldo_final), quando: imp.periodo || 'último extrato importado' });
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const copiarDados = async (c: Conta) => {
    const partes = [
      c.titular && `Titular: ${c.titular}`,
      c.documento && `CNPJ: ${c.documento}`,
      c.banco && `Banco: ${c.banco}`,
      c.agencia && `Agência: ${c.agencia}`,
      c.conta && `Conta: ${c.conta}`,
      c.pix && `PIX: ${c.pix}`,
    ].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(partes); toast.success('Dados bancários copiados ✓'); }
    catch { toast.error('Não consegui copiar.'); }
  };

  const salvar = async () => {
    if (!editando?.nome?.trim()) { toast.error('Dê um nome pra conta.'); return; }
    setSalvando(true);
    const payload = {
      nome: editando.nome.trim(),
      tipo: editando.tipo || 'banco',
      banco: editando.banco?.trim() || null,
      agencia: editando.agencia?.trim() || null,
      conta: editando.conta?.trim() || null,
      pix: editando.pix?.trim() || null,
      titular: editando.titular?.trim() || null,
      documento: editando.documento?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = editando.id
      ? await supabase.from('bank_accounts').update(payload).eq('id', editando.id)
      : await supabase.from('bank_accounts').insert(payload);
    setSalvando(false);
    if (error) { toast.error(`Erro ao salvar: ${error.message}`); return; }
    setEditando(null);
    load();
  };

  const excluir = async (c: Conta) => {
    if (!confirm(`Excluir a conta "${c.nome}"?`)) return;
    const { error } = await supabase.from('bank_accounts').delete().eq('id', c.id);
    if (error) toast.error('Não foi possível excluir.');
    else load();
  };

  const TABS: { id: Aba; label: string }[] = [
    { id: 'bancos', label: 'Bancos' },
    { id: 'pagar', label: 'A Pagar' },
    { id: 'receber', label: 'A Receber' },
  ];

  return (
    <div className="space-y-5 font-work-sans">
      <div>
        <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Contas</h1>
        <p className="text-lumos-text-secondary text-sm">Dados bancários da produtora, contas a pagar e a receber.</p>
      </div>

      <div className="flex items-center gap-6 border-b border-lumos-border">
        {TABS.map(t => (
          <button key={t.id} onClick={() => mudarAba(t.id)}
            className={clsx('pb-2.5 px-1 text-sm font-bold border-b-2 -mb-px transition-colors',
              aba === t.id ? 'text-lumos-yellow border-lumos-yellow' : 'text-lumos-text-secondary border-transparent hover:text-lumos-text-primary')}>
            {t.label}
          </button>
        ))}
      </div>

      {aba !== 'bancos' ? (
        <Suspense fallback={<div className="card p-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow mx-auto" /></div>}>
          {aba === 'pagar' ? <ContasPagar /> : <ContasReceber />}
        </Suspense>
      ) : loading ? (
        <div className="card p-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow mx-auto" /></div>
      ) : indisponivel ? (
        <div className="card p-10 text-center space-y-2">
          <Landmark className="w-8 h-8 text-lumos-text-secondary mx-auto" />
          <p className="text-sm font-bold text-lumos-text-primary">Contas ainda não ativadas</p>
          <p className="text-xs text-lumos-text-secondary">Falta rodar a migration da reforma do financeiro no Supabase.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-lumos-text-secondary max-w-md">
              Um lugar pra copiar rapidinho os dados bancários e mandar pro cliente. O saldo da conta principal vem
              do último extrato importado em Movimentações.
            </p>
            <button onClick={() => setEditando({ tipo: 'banco' })} className="btn-primary h-9 px-4 flex items-center gap-2 text-xs">
              <Plus className="w-4 h-4" /> Nova conta
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {contas.map(c => {
              const Icone = ICONES[c.tipo] || Landmark;
              return (
                <div key={c.id} className="card p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lumos bg-lumos-yellow/15 text-lumos-yellow flex items-center justify-center flex-shrink-0">
                      <Icone className="w-4.5 h-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-lumos-text-primary truncate">{c.nome}</p>
                        {c.principal && (
                          <span className="text-[9px] font-black uppercase tracking-wider text-green-500 bg-green-500/10 border border-green-500/30 rounded-full px-2 py-0.5">Principal</span>
                        )}
                      </div>
                      {c.banco && <p className="text-[11px] text-lumos-text-secondary truncate">{c.banco}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setEditando(c)}
                        className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full" title="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {!c.principal && (
                        <button onClick={() => excluir(c)}
                          className="p-1.5 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full" title="Excluir">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {c.principal && saldoExtrato && (
                    <div className="flex items-center justify-between border-t border-lumos-border/60 pt-3">
                      <span className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Saldo</span>
                      <span className="text-lg font-black text-lumos-text-primary tabular-nums" title={`Saldo final do extrato: ${saldoExtrato.quando}`}>
                        {brl(saldoExtrato.valor)}
                      </span>
                    </div>
                  )}

                  <div className="space-y-1 text-[11.5px] border-t border-lumos-border/60 pt-3">
                    {c.titular && <p><span className="text-lumos-text-secondary">Titular:</span> <span className="font-semibold">{c.titular}</span></p>}
                    {c.documento && <p><span className="text-lumos-text-secondary">CNPJ:</span> <span className="font-semibold">{c.documento}</span></p>}
                    {(c.agencia || c.conta) && (
                      <p>
                        {c.agencia && <><span className="text-lumos-text-secondary">Agência:</span> <span className="font-semibold">{c.agencia}</span>  </>}
                        {c.conta && <><span className="text-lumos-text-secondary">Conta:</span> <span className="font-semibold">{c.conta}</span></>}
                      </p>
                    )}
                    {c.pix && <p><span className="text-lumos-text-secondary">PIX:</span> <span className="font-semibold">{c.pix}</span></p>}
                    {!c.titular && !c.documento && !c.agencia && !c.conta && !c.pix && (
                      <p className="text-lumos-text-secondary italic">Sem dados cadastrados, edite pra preencher.</p>
                    )}
                  </div>

                  {(c.titular || c.banco || c.pix) && (
                    <button onClick={() => copiarDados(c)}
                      className="btn-secondary w-full h-9 text-xs flex items-center justify-center gap-2">
                      <Copy className="w-3.5 h-3.5" /> Copiar dados
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {editando && (
        <Modal isOpen onClose={() => setEditando(null)} title={editando.id ? 'Editar conta' : 'Nova conta'} maxWidth="max-w-md">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Nome *</label>
                <input value={editando.nome || ''} onChange={e => setEditando({ ...editando, nome: e.target.value })}
                  placeholder="Ex: Conta principal" className="input-lumos w-full h-10 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Tipo</label>
                <Select value={editando.tipo || 'banco'} onChange={v => setEditando({ ...editando, tipo: v })}
                  className="input-lumos w-full h-10 text-sm"
                  options={[{ value: 'banco', label: 'Banco' }, { value: 'dinheiro', label: 'Dinheiro' }, { value: 'cartao', label: 'Cartão' }]} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Banco</label>
              <input value={editando.banco || ''} onChange={e => setEditando({ ...editando, banco: e.target.value })}
                placeholder="Ex: Cora SCFI" className="input-lumos w-full h-10 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Agência</label>
                <input value={editando.agencia || ''} onChange={e => setEditando({ ...editando, agencia: e.target.value })}
                  className="input-lumos w-full h-10 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Conta</label>
                <input value={editando.conta || ''} onChange={e => setEditando({ ...editando, conta: e.target.value })}
                  className="input-lumos w-full h-10 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Titular</label>
              <input value={editando.titular || ''} onChange={e => setEditando({ ...editando, titular: e.target.value })}
                className="input-lumos w-full h-10 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">CNPJ</label>
                <input value={editando.documento || ''} onChange={e => setEditando({ ...editando, documento: e.target.value })}
                  className="input-lumos w-full h-10 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Chave PIX</label>
                <input value={editando.pix || ''} onChange={e => setEditando({ ...editando, pix: e.target.value })}
                  className="input-lumos w-full h-10 text-sm" />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditando(null)} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="btn-primary flex-1 disabled:opacity-60">
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
