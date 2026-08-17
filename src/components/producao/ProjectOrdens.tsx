import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Check, ChevronRight, Link2, Loader2, Plus, ScrollText } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';
import Modal from '@/components/common/Modal';

/**
 * Ordens do Dia do projeto. Criar abre o modal do benchmark (data e hora,
 * nome pré-preenchido, primeira locação, roteiros da diária) e, ao criar,
 * cai direto na página nova da OD. Também dá pra adotar ordens antigas
 * soltas.
 */

interface Ordem { id: string; codigo: string; titulo: string; data_producao: string | null }

interface Props {
  projectId: string;
  projectName?: string;
  projectCode?: string | null;
  canManage: boolean;
}

const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ProjectOrdens({ projectId, projectName, projectCode, canManage }: Props) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [ordens, setOrdens] = useState<Ordem[]>([]);
  const [soltas, setSoltas] = useState<Ordem[]>([]);
  const [vinculando, setVinculando] = useState('');

  // modal de criação
  const [criando, setCriando] = useState(false);
  const [data, setData] = useState(hojeLocal());
  const [hora, setHora] = useState('08:00');
  const [nome, setNome] = useState('');
  const [locais, setLocais] = useState<string[]>([]);
  const [locacaoSel, setLocacaoSel] = useState('');
  const [roteiros, setRoteiros] = useState<{ id: string; name: string; url: string }[]>([]);
  const [roteirosSel, setRoteirosSel] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);

  const load = useCallback(async () => {
    const [minhas, semDono] = await Promise.all([
      supabase.from('ordens_do_dia').select('id, codigo, titulo, data_producao')
        .eq('project_id', projectId).order('data_producao', { ascending: false }),
      supabase.from('ordens_do_dia').select('id, codigo, titulo, data_producao')
        .is('project_id', null).order('created_at', { ascending: false }).limit(50),
    ]);
    setOrdens((minhas.data as Ordem[]) || []);
    setSoltas((semDono.data as Ordem[]) || []);
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const abrirCriacao = async () => {
    setNome(`Ordem do Dia - ${projectName || 'Projeto'} - Diária ${ordens.length + 1}`);
    setData(hojeLocal()); setHora('08:00'); setLocacaoSel(''); setRoteirosSel(new Set());
    setCriando(true);
    // Locais das diárias do projeto + roteiros dos arquivos, pra escolher no modal.
    const [dias, docs] = await Promise.all([
      supabase.from('project_diarias').select('local').eq('project_id', projectId),
      supabase.from('project_roteiros').select('id, nome, url').eq('project_id', projectId).order('ordem').order('created_at'),
    ]);
    setLocais([...new Set((dias.data || []).map(d => (d as any).local).filter(Boolean))] as string[]);
    setRoteiros(((docs.data as any[]) || []).map(d => ({ id: d.id, name: d.nome, url: d.url })));
  };

  const criar = async () => {
    if (!nome.trim()) { toast.error('Dê um nome pra ordem do dia.'); return; }
    setSalvando(true);
    const base: Record<string, unknown> = {
      codigo: `${projectCode || 'OD'}-D${ordens.length + 1}`,
      titulo: nome.trim(),
      data_producao: data || null,
      project_id: projectId,
      created_by: profile?.id || null,
      ...(locacaoSel ? { locacao: { nome: locacaoSel, endereco: '', observacoes: '' } } : {}),
      hora_inicio: hora || null,
      roteiros: roteiros.filter(r => roteirosSel.has(r.id)).map(r => ({ id: r.id, name: r.name, url: r.url })),
    };
    // Se a migration da OD 2.0 ainda não rodou, cria sem os campos novos.
    let { data: novo, error } = await supabase.from('ordens_do_dia').insert([base]).select('id').single();
    if (error && /hora_inicio|roteiros/.test(String(error.message))) {
      const { hora_inicio: _a, roteiros: _b, ...semNovos } = base;
      ({ data: novo, error } = await supabase.from('ordens_do_dia').insert([semNovos]).select('id').single());
    }
    setSalvando(false);
    if (error || !novo) { toast.error('Não foi possível criar a ordem do dia.'); return; }
    toast.success('Ordem do dia criada ✓');
    navigate(`/ordem-do-dia/${novo.id}`);
  };

  const vincular = async (id: string) => {
    if (!id) return;
    setVinculando('');
    const { error } = await supabase.from('ordens_do_dia').update({ project_id: projectId }).eq('id', id);
    if (error) { toast.error('Não foi possível vincular.'); return; }
    toast.success('Ordem do dia vinculada ao projeto ✓');
    load();
  };

  const fmt = (d: string | null) =>
    d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) : 'sem data';

  if (loading) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-lumos-yellow" /> Ordens do dia
          {ordens.length > 0 && <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· {ordens.length}</span>}
        </p>
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            {soltas.length > 0 && (
              <div className="w-56">
                <Select value={vinculando} onChange={v => vincular(v)} className="input-lumos h-9 w-full text-xs"
                  options={[{ value: '', label: '🔗 Vincular ordem existente…' },
                    ...soltas.map(o => ({ value: o.id, label: `${o.codigo} · ${o.titulo}` }))]} />
              </div>
            )}
            <button type="button" onClick={abrirCriacao}
              className="btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Nova ordem
            </button>
          </div>
        )}
      </div>

      {ordens.length === 0 ? (
        <div className="card p-8 text-center">
          <CalendarDays className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" />
          <p className="text-sm font-bold text-lumos-text-primary">Nenhuma ordem do dia neste projeto.</p>
          <p className="text-xs text-lumos-text-secondary mt-1 max-w-md mx-auto">
            Crie uma nova, já vinculada, ou adote uma ordem antiga pelo seletor acima.
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-lumos-border/60 overflow-hidden">
          {ordens.map(o => (
            <button key={o.id} type="button" onClick={() => navigate(`/ordem-do-dia/${o.id}`)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-lumos-text-primary/5 transition-colors group">
              <span className="text-[10px] font-black text-lumos-yellow bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase flex-shrink-0">{o.codigo}</span>
              <span className="text-[13px] font-bold truncate flex-1 text-lumos-text-primary">{o.titulo}</span>
              <span className="text-[11px] text-lumos-text-secondary flex-shrink-0">{fmt(o.data_producao)}</span>
              <ChevronRight className="w-4 h-4 text-lumos-text-secondary group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {soltas.length > 0 && canManage && (
        <p className="text-[10.5px] text-lumos-text-secondary flex items-center gap-1.5">
          <Link2 className="w-3 h-3" /> {soltas.length} orde{soltas.length > 1 ? 'ns' : 'm'} do dia antiga{soltas.length > 1 ? 's' : ''} sem projeto, dá pra adotar pelo seletor.
        </p>
      )}

      {/* Modal de criação, no formato do benchmark */}
      {criando && (
        <Modal isOpen onClose={() => setCriando(false)} title="Nova Ordem do Dia" maxWidth="max-w-md">
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Data e hora do início</label>
              <div className="grid grid-cols-[1fr_110px] gap-2 mt-1">
                <input type="date" value={data} onChange={e => setData(e.target.value)} className="input-lumos h-10 text-sm" />
                <input type="time" value={hora} onChange={e => setHora(e.target.value)} className="input-lumos h-10 text-sm" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Nome</label>
              <input value={nome} onChange={e => setNome(e.target.value)} className="input-lumos w-full h-10 mt-1 text-sm" />
            </div>

            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Primeira locação</label>
              {locais.length > 0 ? (
                <Select value={locacaoSel} onChange={v => setLocacaoSel(v)} className="input-lumos w-full h-10 mt-1 text-sm"
                  options={[{ value: '', label: 'Selecione uma locação' }, ...locais.map(l => ({ value: l, label: l }))]} />
              ) : (
                <input value={locacaoSel} onChange={e => setLocacaoSel(e.target.value)}
                  placeholder="Ex.: Praia da Reserva, Rio de Janeiro" className="input-lumos w-full h-10 mt-1 text-sm" />
              )}
              {locais.length > 0 && <p className="text-[10px] text-lumos-text-secondary mt-1">Vindas das diárias do projeto. Dá pra adicionar outras depois, na aba Locações.</p>}
            </div>

            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Roteiros para esta diária</label>
              {roteiros.length === 0 ? (
                <p className="text-[11px] text-lumos-text-secondary italic mt-1">
                  Nenhum roteiro no projeto. Cole o link do Google Docs na aba Roteiros e ele aparece aqui.
                </p>
              ) : (
                <div className="mt-1 border border-lumos-border rounded-lumos divide-y divide-lumos-border/60 max-h-40 overflow-y-auto custom-scrollbar">
                  {roteiros.map(r => {
                    const sel = roteirosSel.has(r.id);
                    return (
                      <button key={r.id} type="button"
                        onClick={() => setRoteirosSel(prev => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-lumos-text-primary/5">
                        <span className={clsx('w-4 h-4 rounded border-2 grid place-items-center flex-shrink-0',
                          sel ? 'bg-lumos-yellow border-lumos-yellow text-black' : 'border-lumos-text-secondary/40')}>
                          {sel && <Check className="w-3 h-3" />}
                        </span>
                        <ScrollText className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
                        <span className="text-xs font-bold truncate text-lumos-text-primary">{r.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={() => setCriando(false)} className="ml-auto text-[11px] font-bold text-lumos-text-secondary px-2">Cancelar</button>
              <button type="button" onClick={criar} disabled={salvando}
                className="btn-primary h-9 px-5 text-xs font-black disabled:opacity-60 flex items-center gap-1.5">
                {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Criar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
