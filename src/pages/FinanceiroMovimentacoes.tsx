import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownCircle, ArrowUpCircle, FileUp, Loader2, Pencil, Plus, Search, Trash2, Upload, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';
import { MobileCardList, MobileCard } from '@/components/ui/MobileCards';
import { PERIODO_LABELS, intervaloDoPreset, type PeriodoPreset } from '@/lib/periodos';
import { parseCsvExtrato, parsePdfExtrato, type ResultadoExtrato } from '@/lib/extrato';

/**
 * MOVIMENTAÇÕES — o extrato vivo da produtora, no modelo do benchmark.
 * O extrato mensal do banco (CSV ou PDF do Cora) sobe por aqui e vira
 * lançamento com deduplicação automática: dá pra subir o mesmo mês duas
 * vezes, ou o CSV e o PDF juntos, sem duplicar nada. Filtro de período com
 * os presets do benchmark, KPIs do período e categorização inline.
 */

interface Movimentacao {
  id: string;
  data: string;
  descricao: string;
  tipo: 'credito' | 'debito';
  identificacao: string | null;
  valor: number;
  categoria: string | null;
  project_id: string | null;
  origem: string;
  projeto?: { name: string } | null;
}

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const brData = (isoStr: string) => {
  const [y, m, d] = isoStr.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};

const CATEGORIAS_SUGERIDAS = [
  'Equipe freelancer', 'Locação de equipamentos', 'Locação de espaços', 'Transporte',
  'Alimentação de set', 'Impostos', 'Aluguel e escritório', 'Energia e contas', 'Software',
  'Marketing', 'Recebimento de cliente', 'Pró-labore', 'Outros',
];

export default function FinanceiroMovimentacoes() {
  const { profile } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [movs, setMovs] = useState<Movimentacao[]>([]);
  const [projetos, setProjetos] = useState<{ id: string; name: string }[]>([]);
  const [indisponivel, setIndisponivel] = useState(false);

  // filtros
  const [preset, setPreset] = useState<PeriodoPreset>(() => {
    try { return (localStorage.getItem('lumos_mov_periodo') as PeriodoPreset) || 'este_mes'; } catch { return 'este_mes'; }
  });
  const [customIni, setCustomIni] = useState('');
  const [customFim, setCustomFim] = useState('');
  const [fluxo, setFluxo] = useState<'todas' | 'entradas' | 'saidas'>('todas');
  const [busca, setBusca] = useState('');

  // importação
  const [importando, setImportando] = useState<null | {
    filename: string; formato: 'csv' | 'pdf'; resultado: ResultadoExtrato;
    novas: number; duplicadas: number; gravando: boolean;
  }>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // lançamento manual / edição
  const [editando, setEditando] = useState<Partial<Movimentacao> | null>(null);

  const intervalo = useMemo(() => {
    if (preset === 'personalizado') return { inicio: customIni || null, fim: customFim || null };
    return intervaloDoPreset(preset);
  }, [preset, customIni, customFim]);

  const mudarPreset = (p: PeriodoPreset) => {
    setPreset(p);
    try { localStorage.setItem('lumos_mov_periodo', p); } catch { /* ok */ }
  };

  const load = useCallback(async () => {
    let q = supabase.from('bank_transactions')
      .select('id, data, descricao, tipo, identificacao, valor, categoria, project_id, origem, projeto:projects(name)')
      .order('data', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1500);
    if (intervalo.inicio) q = q.gte('data', intervalo.inicio);
    if (intervalo.fim) q = q.lte('data', intervalo.fim);
    const { data, error } = await q;
    if (error) { setIndisponivel(true); setLoading(false); return; }
    setIndisponivel(false);
    setMovs((data as unknown as Movimentacao[]) || []);
    setLoading(false);
  }, [intervalo.inicio, intervalo.fim]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.from('projects').select('id, name').order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setProjetos(data || []));
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return movs.filter(mv => {
      if (fluxo === 'entradas' && mv.tipo !== 'credito') return false;
      if (fluxo === 'saidas' && mv.tipo !== 'debito') return false;
      if (q && !`${mv.identificacao || ''} ${mv.descricao} ${mv.categoria || ''} ${mv.projeto?.name || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [movs, fluxo, busca]);

  const kpis = useMemo(() => {
    const entradas = movs.filter(mv => mv.tipo === 'credito').reduce((s, mv) => s + Number(mv.valor), 0);
    const saidas = movs.filter(mv => mv.tipo === 'debito').reduce((s, mv) => s + Number(mv.valor), 0);
    return { entradas, saidas: Math.abs(saidas), resultado: entradas + saidas };
  }, [movs]);

  // ── Importação do extrato ────────────────────────────────────────────────
  const receberArquivo = async (file: File) => {
    const formato: 'csv' | 'pdf' = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'csv';
    try {
      const resultado = formato === 'pdf'
        ? await parsePdfExtrato(await file.arrayBuffer())
        : parseCsvExtrato(await file.text());
      if (resultado.linhas.length === 0) {
        toast.error('Não achei movimentações nesse arquivo. É o extrato do banco (CSV ou PDF)?');
        return;
      }
      // Confere contra o que já existe pra mostrar o resumo antes de gravar.
      const hashes = resultado.linhas.map(l => l.hash);
      const { data: existentes } = await supabase.from('bank_transactions')
        .select('hash_dedup').in('hash_dedup', hashes);
      const jaTem = new Set((existentes || []).map(e => e.hash_dedup));
      const novas = resultado.linhas.filter(l => !jaTem.has(l.hash)).length;
      setImportando({
        filename: file.name, formato, resultado,
        novas, duplicadas: resultado.linhas.length - novas, gravando: false,
      });
    } catch (err) {
      console.error(err);
      toast.error('Não consegui ler o arquivo. Confere se é o extrato original do banco.');
    }
  };

  const confirmarImport = async () => {
    if (!importando || importando.gravando) return;
    setImportando({ ...importando, gravando: true });
    const { resultado, filename, formato, novas, duplicadas } = importando;

    const { data: imp, error: impErr } = await supabase.from('bank_imports').insert({
      filename, formato,
      periodo: resultado.periodo,
      saldo_inicial: resultado.saldoInicial,
      saldo_final: resultado.saldoFinal,
      novas, duplicadas,
      created_by: profile?.id || null,
    }).select('id').single();
    if (impErr || !imp) {
      setImportando(null);
      toast.error(`Erro ao registrar a importação: ${impErr?.message}`);
      return;
    }

    // upsert ignorando os hashes que já existem: reimportar nunca duplica
    const linhas = resultado.linhas.map(l => ({
      data: l.data, descricao: l.descricao, tipo: l.tipo,
      identificacao: l.identificacao, valor: l.valor,
      hash_dedup: l.hash, import_id: imp.id, origem: 'extrato',
      created_by: profile?.id || null,
    }));
    const { error } = await supabase.from('bank_transactions')
      .upsert(linhas, { onConflict: 'hash_dedup', ignoreDuplicates: true });
    setImportando(null);
    if (error) { toast.error(`Erro ao gravar: ${error.message}`); return; }
    toast.success(`Extrato importado ✓ ${novas} nova${novas === 1 ? '' : 's'}, ${duplicadas} já existia${duplicadas === 1 ? '' : 'm'}.`);
    load();
  };

  // ── Edição inline ────────────────────────────────────────────────────────
  const atualizar = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from('bank_transactions')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) toast.error(`Erro: ${error.message}`);
    else load();
  };

  const excluir = async (mv: Movimentacao) => {
    if (!confirm(`Excluir o lançamento de ${brl(Number(mv.valor))} (${mv.identificacao || mv.descricao})?`)) return;
    const { error } = await supabase.from('bank_transactions').delete().eq('id', mv.id);
    if (error) toast.error('Não foi possível excluir.');
    else load();
  };

  const salvarManual = async () => {
    if (!editando) return;
    if (!editando.data || !editando.valor || !editando.identificacao?.trim()) {
      toast.error('Preencha data, descrição e valor.');
      return;
    }
    const valorNum = Number(editando.valor);
    const payload = {
      data: editando.data,
      descricao: editando.descricao?.trim() || 'Lançamento manual',
      tipo: valorNum >= 0 ? 'credito' : 'debito',
      identificacao: editando.identificacao.trim(),
      valor: valorNum,
      categoria: editando.categoria || null,
      project_id: editando.project_id || null,
      origem: 'manual',
      created_by: profile?.id || null,
    };
    const { error } = editando.id
      ? await supabase.from('bank_transactions').update(payload).eq('id', editando.id)
      : await supabase.from('bank_transactions').insert(payload);
    if (error) { toast.error(`Erro ao salvar: ${error.message}`); return; }
    setEditando(null);
    toast.success('Lançamento salvo ✓');
    load();
  };

  const CHIPS: { id: typeof fluxo; label: string }[] = [
    { id: 'todas', label: 'Todas' },
    { id: 'entradas', label: 'Entradas' },
    { id: 'saidas', label: 'Saídas' },
  ];

  return (
    <div className="space-y-5 font-work-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-lumos-text-primary tracking-tight">Movimentações</h1>
          <p className="text-lumos-text-secondary text-sm">O extrato da Lumos dentro do app, importado direto do banco.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,.pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) receberArquivo(f); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} className="btn-primary h-10 px-4 flex items-center gap-2 text-xs">
            <Upload className="w-4 h-4" /> Importar extrato
          </button>
          <button onClick={() => setEditando({ data: new Date().toISOString().slice(0, 10) })}
            className="btn-secondary h-10 px-4 flex items-center gap-2 text-xs">
            <Plus className="w-4 h-4" /> Novo lançamento
          </button>
        </div>
      </div>

      {/* KPIs do período */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary flex items-center gap-1.5">
            <ArrowDownCircle className="w-3.5 h-3.5 text-green-500" /> Entradas
          </p>
          <p className="text-2xl font-black text-green-500 tabular-nums mt-1">{brl(kpis.entradas)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary flex items-center gap-1.5">
            <ArrowUpCircle className="w-3.5 h-3.5 text-red-500" /> Saídas
          </p>
          <p className="text-2xl font-black text-red-500 tabular-nums mt-1">{brl(kpis.saidas)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Resultado</p>
          <p className={clsx('text-2xl font-black tabular-nums mt-1', kpis.resultado >= 0 ? 'text-lumos-text-primary' : 'text-red-500')}>
            {brl(kpis.resultado)}
          </p>
        </div>
      </div>

      {/* Filtros: período no modelo do benchmark + fluxo + busca */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <div className="w-44">
          <Select value={preset} onChange={v => mudarPreset(v as PeriodoPreset)} className="input-lumos h-9 w-full text-xs"
            options={(Object.keys(PERIODO_LABELS) as PeriodoPreset[]).map(p => ({ value: p, label: PERIODO_LABELS[p] }))} />
        </div>
        {preset === 'personalizado' && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={customIni} onChange={e => setCustomIni(e.target.value)} className="input-lumos h-9 text-xs" />
            <span className="text-xs text-lumos-text-secondary">até</span>
            <input type="date" value={customFim} onChange={e => setCustomFim(e.target.value)} className="input-lumos h-9 text-xs" />
          </div>
        )}
        <div className="flex items-center gap-1">
          {CHIPS.map(c => (
            <button key={c.id} onClick={() => setFluxo(c.id)}
              className={clsx('px-3 h-8 rounded-full text-[11px] font-black uppercase tracking-wider border transition-colors',
                fluxo === c.id
                  ? 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/40'
                  : 'text-lumos-text-secondary border-lumos-border hover:text-lumos-text-primary')}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary pointer-events-none" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…"
            className="input-lumos pl-9 h-9 w-full sm:w-56 text-xs" />
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-lumos-yellow mx-auto" /></div>
      ) : indisponivel ? (
        <div className="card p-10 text-center space-y-2">
          <p className="text-sm font-bold text-lumos-text-primary">Movimentações ainda não ativadas</p>
          <p className="text-xs text-lumos-text-secondary">Falta rodar a migration da reforma do financeiro no Supabase.</p>
        </div>
      ) : filtradas.length === 0 ? (
        <div className="card p-10 text-center space-y-2">
          <FileUp className="w-8 h-8 text-lumos-text-secondary mx-auto" />
          <p className="text-sm font-bold text-lumos-text-primary">Nenhuma movimentação neste período.</p>
          <p className="text-xs text-lumos-text-secondary max-w-md mx-auto">
            Suba o extrato mensal do banco (CSV ou PDF) no botão Importar extrato: os lançamentos entram sozinhos,
            sem duplicar nada mesmo se o mesmo arquivo subir duas vezes.
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
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Contraparte</th>
                    <th className="px-4 py-3">Transação</th>
                    <th className="px-4 py-3">Categoria</th>
                    <th className="px-4 py-3">Projeto</th>
                    <th className="px-4 py-3 text-right">Valor</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-lumos-border/50">
                  {filtradas.map(mv => (
                    <tr key={mv.id} className="hover:bg-lumos-text-secondary/[0.03] transition-colors">
                      <td className="px-4 py-2 text-xs text-lumos-text-secondary whitespace-nowrap">{brData(mv.data)}</td>
                      <td className="px-4 py-2">
                        <span className="text-xs font-bold text-lumos-text-primary block max-w-[240px] truncate" title={mv.identificacao || ''}>
                          {mv.identificacao || '—'}
                        </span>
                        {mv.origem === 'manual' && <span className="text-[9px] font-black uppercase text-lumos-text-secondary">manual</span>}
                      </td>
                      <td className="px-4 py-2 text-[11px] text-lumos-text-secondary whitespace-nowrap">{mv.descricao}</td>
                      <td className="px-4 py-2">
                        <Select value={mv.categoria || ''} onChange={v => atualizar(mv.id, { categoria: v || null })}
                          className="input-lumos h-8 w-40 text-[11px]" placeholder="Sem categoria"
                          options={[{ value: '', label: 'Sem categoria' },
                            ...CATEGORIAS_SUGERIDAS.map(c => ({ value: c, label: c })),
                            ...(mv.categoria && !CATEGORIAS_SUGERIDAS.includes(mv.categoria) ? [{ value: mv.categoria, label: mv.categoria }] : [])]} />
                      </td>
                      <td className="px-4 py-2">
                        <Select value={mv.project_id || ''} onChange={v => atualizar(mv.id, { project_id: v || null })}
                          className="input-lumos h-8 w-44 text-[11px]" placeholder="Sem projeto"
                          options={[{ value: '', label: 'Sem projeto' }, ...projetos.map(p => ({ value: p.id, label: p.name }))]} />
                      </td>
                      <td className={clsx('px-4 py-2 text-right text-sm font-black tabular-nums whitespace-nowrap',
                        mv.tipo === 'credito' ? 'text-green-500' : 'text-red-500')}>
                        {brl(Number(mv.valor))}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {mv.origem === 'manual' && (
                            <button onClick={() => setEditando(mv)}
                              className="p-1.5 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full" title="Editar">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => excluir(mv)}
                            className="p-1.5 text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full" title="Excluir">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile */}
          <div className="lg:hidden">
            <MobileCardList>
              {filtradas.map(mv => (
                <MobileCard key={mv.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-lumos-text-primary truncate text-[13px]">{mv.identificacao || mv.descricao}</span>
                    <span className={clsx('text-sm font-black tabular-nums flex-shrink-0',
                      mv.tipo === 'credito' ? 'text-green-500' : 'text-red-500')}>
                      {brl(Number(mv.valor))}
                    </span>
                  </div>
                  <div className="text-[11px] text-lumos-text-secondary truncate mt-0.5">
                    {brData(mv.data)} · {mv.descricao}{mv.categoria ? ` · ${mv.categoria}` : ''}{mv.projeto?.name ? ` · ${mv.projeto.name}` : ''}
                  </div>
                </MobileCard>
              ))}
            </MobileCardList>
          </div>
          <p className="text-[10.5px] text-lumos-text-secondary">
            {filtradas.length} lançamento{filtradas.length === 1 ? '' : 's'} no período.
          </p>
        </>
      )}

      {/* Modal de importação: preview antes de gravar */}
      {importando && (
        <Modal isOpen onClose={() => !importando.gravando && setImportando(null)} title="Importar extrato" maxWidth="max-w-md">
          <div className="space-y-4">
            <p className="text-sm font-bold text-lumos-text-primary flex items-center gap-2">
              <FileUp className="w-4 h-4 text-lumos-yellow flex-shrink-0" /> {importando.filename}
            </p>
            <div className="rounded-lumos border border-lumos-border p-4 space-y-2 text-sm">
              {importando.resultado.periodo && (
                <div className="flex justify-between"><span className="text-lumos-text-secondary">Período</span><span className="font-bold">{importando.resultado.periodo}</span></div>
              )}
              <div className="flex justify-between"><span className="text-lumos-text-secondary">Movimentações no arquivo</span><span className="font-bold">{importando.resultado.linhas.length}</span></div>
              <div className="flex justify-between"><span className="text-lumos-text-secondary">Novas (vão entrar)</span><span className="font-bold text-green-500">{importando.novas}</span></div>
              <div className="flex justify-between"><span className="text-lumos-text-secondary">Já existiam (ignoradas)</span><span className="font-bold">{importando.duplicadas}</span></div>
              {importando.resultado.saldoFinal != null && (
                <div className="flex justify-between border-t border-lumos-border pt-2">
                  <span className="text-lumos-text-secondary">Saldo final do extrato</span>
                  <span className="font-black text-lumos-text-primary">{brl(importando.resultado.saldoFinal)}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setImportando(null)} disabled={importando.gravando} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={confirmarImport} disabled={importando.gravando || importando.novas === 0}
                className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                {importando.gravando ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {importando.novas === 0 ? 'Nada novo pra importar' : `Importar ${importando.novas}`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Lançamento manual */}
      {editando && (
        <Modal isOpen onClose={() => setEditando(null)} title={editando.id ? 'Editar lançamento' : 'Novo lançamento'} maxWidth="max-w-md">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Data *</label>
                <input type="date" value={editando.data || ''} onChange={e => setEditando({ ...editando, data: e.target.value })}
                  className="input-lumos w-full h-10 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Valor (R$) *</label>
                <input value={editando.valor ?? ''} inputMode="decimal" placeholder="-500,00 saída · 500,00 entrada"
                  onChange={e => setEditando({ ...editando, valor: e.target.value.replace(/\./g, '').replace(',', '.') as unknown as number })}
                  className="input-lumos w-full h-10 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Descrição / contraparte *</label>
              <input value={editando.identificacao || ''} onChange={e => setEditando({ ...editando, identificacao: e.target.value })}
                placeholder="Ex: Freela de edição, recebimento do cliente X…" className="input-lumos w-full h-10 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Categoria</label>
                <Select value={editando.categoria || ''} onChange={v => setEditando({ ...editando, categoria: v || null })}
                  className="input-lumos w-full h-10 text-sm" placeholder="Sem categoria"
                  options={[{ value: '', label: 'Sem categoria' }, ...CATEGORIAS_SUGERIDAS.map(c => ({ value: c, label: c }))]} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Projeto</label>
                <Select value={editando.project_id || ''} onChange={v => setEditando({ ...editando, project_id: v || null })}
                  className="input-lumos w-full h-10 text-sm" placeholder="Sem projeto"
                  options={[{ value: '', label: 'Sem projeto' }, ...projetos.map(p => ({ value: p.id, label: p.name }))]} />
              </div>
            </div>
            <p className="text-[11px] text-lumos-text-secondary flex items-start gap-1.5">
              <X className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-0" />
              Valor negativo é saída, positivo é entrada.
            </p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditando(null)} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={salvarManual} className="btn-primary flex-1">Salvar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
