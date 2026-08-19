import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Lightbulb, Loader2, Pencil, Target, TrendingUp, X } from 'lucide-react';
import { clsx } from 'clsx';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';

/**
 * METAS — no modelo do benchmark: cards de meta, e a Meta de Lucro por Mês
 * abre o gráfico Meta vs Previsto vs Realizado do ano.
 * · Meta: o valor que você define mês a mês.
 * · Previsto: o que está agendado (a receber menos a pagar por vencimento).
 * · Realizado: o resultado de caixa das Movimentações (extrato importado).
 */

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

export default function FinanceiroMetas() {
  const [aberta, setAberta] = useState(false);
  return (
    <div className="space-y-5 font-work-sans">
      <div>
        <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Metas</h1>
        <p className="text-lumos-text-secondary text-sm">Metas claras e mensuráveis pra acompanhar a saúde financeira da produtora.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <button onClick={() => setAberta(true)}
          className="card p-5 text-left hover:border-lumos-yellow/40 transition-colors group relative">
          <ChevronRight className="w-4 h-4 text-lumos-text-secondary absolute top-4 right-4 group-hover:translate-x-0.5 transition-transform" />
          <div className="w-10 h-10 rounded-lumos bg-green-500/15 text-green-500 flex items-center justify-center mb-3">
            <TrendingUp className="w-5 h-5" />
          </div>
          <p className="font-bold text-lumos-text-primary">Meta de Lucro por Mês</p>
          <p className="text-xs text-lumos-text-secondary mt-1 leading-relaxed">
            Defina metas mensais de lucro e acompanhe em tempo real se a produtora está dentro ou fora da meta.
          </p>
          <span className="inline-block mt-3 text-[9px] font-black uppercase tracking-wider text-green-500 bg-green-500/10 border border-green-500/30 rounded-full px-2 py-0.5">Ativa</span>
        </button>

        <div className="card p-5 border-dashed relative">
          <div className="w-10 h-10 rounded-lumos bg-sky-500/15 text-sky-500 flex items-center justify-center mb-3">
            <Lightbulb className="w-5 h-5" />
          </div>
          <p className="font-bold text-lumos-text-primary">Sugerir nova meta</p>
          <p className="text-xs text-lumos-text-secondary mt-1 leading-relaxed">
            Tem uma métrica importante pra acompanhar? Fala com o Caio que a gente coloca aqui.
          </p>
        </div>
      </div>

      {aberta && <MetaLucroModal onClose={() => setAberta(false)} />}
    </div>
  );
}

// ── Meta de Lucro Mensal: gráfico Meta vs Previsto vs Realizado ────────────
function MetaLucroModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { profile } = useAuth();
  const [ano, setAno] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [indisponivel, setIndisponivel] = useState(false);
  const [metas, setMetas] = useState<number[]>(Array(12).fill(0));
  const [realizado, setRealizado] = useState<(number | null)[]>(Array(12).fill(null));
  const [previsto, setPrevisto] = useState<number[]>(Array(12).fill(0));
  const [editandoMetas, setEditandoMetas] = useState(false);
  const [mesSel, setMesSel] = useState<number | null>(new Date().getMonth());
  const [lancamentosMes, setLancamentosMes] = useState<{ data: string; identificacao: string | null; valor: number }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const ini = `${ano}-01-01`, fim = `${ano}-12-31`;
    const [metasQ, txQ, recQ, pagQ] = await Promise.all([
      supabase.from('metas_financeiras').select('mes, valor').eq('tipo', 'lucro').eq('ano', ano),
      supabase.from('bank_transactions').select('data, valor').gte('data', ini).lte('data', fim).limit(5000),
      supabase.from('receivables').select('due_date, total_amount, received_amount, status')
        .gte('due_date', ini).lte('due_date', fim).not('status', 'eq', 'cancelado'),
      supabase.from('payables').select('due_date, amount, paid_at').gte('due_date', ini).lte('due_date', fim),
    ]);
    if (metasQ.error && /metas_financeiras|schema/i.test(metasQ.error.message)) {
      setIndisponivel(true); setLoading(false); return;
    }
    setIndisponivel(false);

    const m = Array(12).fill(0);
    for (const r of (metasQ.data as any[]) || []) m[r.mes - 1] = Number(r.valor);
    setMetas(m);

    // Realizado: resultado de caixa por mês (só meses com movimentação)
    const rz: (number | null)[] = Array(12).fill(null);
    for (const t of (txQ.data as any[]) || []) {
      const mes = Number(t.data.slice(5, 7)) - 1;
      rz[mes] = (rz[mes] ?? 0) + Number(t.valor);
    }
    setRealizado(rz);

    // Previsto: a receber menos a pagar, por vencimento
    const pv = Array(12).fill(0);
    for (const r of (recQ.data as any[]) || []) {
      const mes = Number(String(r.due_date).slice(5, 7)) - 1;
      pv[mes] += Number(r.total_amount || 0);
    }
    for (const pgt of (pagQ.data as any[]) || []) {
      const mes = Number(String(pgt.due_date).slice(5, 7)) - 1;
      pv[mes] -= Number(pgt.amount || 0);
    }
    setPrevisto(pv);
    setLoading(false);
  }, [ano]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (mesSel == null) { setLancamentosMes([]); return; }
    const ini = `${ano}-${String(mesSel + 1).padStart(2, '0')}-01`;
    const fim = `${ano}-${String(mesSel + 1).padStart(2, '0')}-31`;
    supabase.from('bank_transactions').select('data, identificacao, valor')
      .gte('data', ini).lte('data', fim).order('data', { ascending: false }).limit(200)
      .then(({ data }) => setLancamentosMes((data as any[]) || []));
  }, [mesSel, ano]);

  const dados = useMemo(() => MESES.map((nome, i) => ({
    nome,
    Meta: metas[i] || null,
    Previsto: previsto[i] || null,
    Realizado: realizado[i],
  })), [metas, previsto, realizado]);

  const salvarMetas = async (valores: number[]) => {
    const linhas = valores.map((valor, i) => ({
      tipo: 'lucro', ano, mes: i + 1, valor,
      created_by: profile?.id || null, updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('metas_financeiras')
      .upsert(linhas, { onConflict: 'tipo,ano,mes' });
    if (error) { toast.error(`Erro ao salvar: ${error.message}`); return; }
    setEditandoMetas(false);
    toast.success('Metas salvas ✓');
    load();
  };

  return (
    <Modal isOpen onClose={onClose} title="Meta de Lucro Mensal" maxWidth="max-w-3xl">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <select value={ano} onChange={e => setAno(Number(e.target.value))} className="input-lumos h-9 text-xs w-24">
            {[ano - 2, ano - 1, ano, ano + 1].filter((v, i, a) => a.indexOf(v) === i).sort().map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button onClick={() => setEditandoMetas(true)} className="btn-secondary h-9 px-3 text-xs flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Editar metas
          </button>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow" /></div>
        ) : indisponivel ? (
          <div className="h-40 flex flex-col items-center justify-center gap-2 text-center">
            <Target className="w-7 h-7 text-lumos-text-secondary" />
            <p className="text-xs text-lumos-text-secondary">Falta rodar a migration da reforma do financeiro no Supabase.</p>
          </div>
        ) : (
          <>
            <div className="rounded-lumos border border-lumos-border p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mb-2">
                Meta vs Previsto vs Realizado, {ano}
              </p>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dados} onClick={(e: any) => {
                    if (e?.activeTooltipIndex != null) setMesSel(e.activeTooltipIndex);
                  }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,0.15)" />
                    <XAxis dataKey="nome" tick={{ fontSize: 10 }} stroke="currentColor" />
                    <YAxis tick={{ fontSize: 10 }} stroke="currentColor" tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v) => brl(Number(v))} labelStyle={{ fontWeight: 700 }} />
                    <Line type="monotone" dataKey="Meta" stroke="#38bdf8" strokeDasharray="6 4" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Previsto" stroke="#a855f7" strokeWidth={2} dot={{ r: 2.5 }} />
                    <Line type="monotone" dataKey="Realizado" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-2 mt-2">
                <div className="flex items-center gap-4 text-[10.5px] font-bold">
                  <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-sky-400" /> Meta</span>
                  <span className="flex items-center gap-1.5 text-purple-500"><span className="w-4 border-t-2 border-purple-500" /> Previsto (contas agendadas)</span>
                  <span className="flex items-center gap-1.5 text-green-500"><span className="w-4 border-t-2 border-green-500" /> Realizado (movimentações)</span>
                </div>
                <p className="text-[10px] text-lumos-text-secondary italic">Clique num mês pra ver a composição.</p>
              </div>
            </div>

            {mesSel != null && (
              <div className="rounded-lumos border border-lumos-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-lumos-text-primary">
                    Composição, {MESES[mesSel]}/{ano}
                    <span className="text-lumos-text-secondary font-semibold"> · {lancamentosMes.length} lançamento{lancamentosMes.length === 1 ? '' : 's'}</span>
                    {realizado[mesSel] != null && (
                      <span className={clsx('ml-2 font-black', (realizado[mesSel] || 0) >= (metas[mesSel] || 0) ? 'text-green-500' : 'text-red-500')}>
                        {brl(realizado[mesSel] || 0)} de {brl(metas[mesSel] || 0)}
                      </span>
                    )}
                  </p>
                  <button onClick={() => setMesSel(null)} className="p-1 text-lumos-text-secondary hover:text-lumos-text-primary rounded-full">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {lancamentosMes.length === 0 ? (
                  <p className="text-xs text-lumos-text-secondary italic text-center py-4">Nenhum lançamento neste mês.</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto custom-scrollbar divide-y divide-lumos-border/40">
                    {lancamentosMes.map((l, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-1.5 text-[11.5px]">
                        <span className="text-lumos-text-secondary flex-shrink-0">{l.data.slice(8, 10)}/{l.data.slice(5, 7)}</span>
                        <span className="truncate flex-1 text-lumos-text-primary">{l.identificacao || '—'}</span>
                        <span className={clsx('font-bold tabular-nums flex-shrink-0', Number(l.valor) >= 0 ? 'text-green-500' : 'text-red-500')}>
                          {brl(Number(l.valor))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {editandoMetas && (
        <EditarMetasModal ano={ano} metas={metas} onClose={() => setEditandoMetas(false)} onSave={salvarMetas} />
      )}
    </Modal>
  );
}

function EditarMetasModal({ ano, metas, onClose, onSave }: {
  ano: number; metas: number[]; onClose: () => void; onSave: (valores: number[]) => void;
}) {
  const [valores, setValores] = useState<string[]>(metas.map(m => (m ? String(m) : '')));
  const [replicar, setReplicar] = useState('');
  return (
    <Modal isOpen onClose={onClose} title={`Editar metas de ${ano}`} maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input value={replicar} onChange={e => setReplicar(e.target.value)} inputMode="decimal"
            placeholder="Ex: 30000" className="input-lumos h-9 flex-1 text-xs" />
          <button onClick={() => {
            const v = replicar.replace(/\./g, '').replace(',', '.');
            if (v) setValores(Array(12).fill(v));
          }} className="btn-secondary h-9 px-3 text-xs whitespace-nowrap">Aplicar em todos</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MESES.map((nome, i) => (
            <div key={nome} className="space-y-0.5">
              <label className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-wider block">{nome}</label>
              <input value={valores[i]} inputMode="decimal"
                onChange={e => setValores(vs => vs.map((v, j) => (j === i ? e.target.value : v)))}
                className="input-lumos w-full h-9 text-xs" placeholder="0" />
            </div>
          ))}
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={() => onSave(valores.map(v => Number(v.replace(/\./g, '').replace(',', '.')) || 0))}
            className="btn-primary flex-1">Salvar metas</button>
        </div>
      </div>
    </Modal>
  );
}
