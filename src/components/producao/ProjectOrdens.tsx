import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Check, ChevronRight, Link2, Loader2, Plus, ScrollText, Video } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';
import Modal from '@/components/common/Modal';

/**
 * Ordens do Dia do projeto. A OD nasce sempre de uma DIÁRIA: o modal pede
 * qual diária vai virar ordem do dia (data, hora e locação vêm dela) e, se o
 * projeto ainda não tem diária, o próprio modal cria uma na hora, com os
 * mesmos campos da aba Diárias. Também dá pra adotar ordens antigas soltas.
 */

interface Ordem { id: string; codigo: string; titulo: string; data_producao: string | null; diaria_id?: string | null }
interface Diaria {
  id: string; nome: string; data: string | null;
  hora_inicio: string | null; hora_fim: string | null; local: string | null;
}

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

const fmtDia = (d: string | null) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) : 'sem data';
const fmtHora = (h: string | null) => (h ? h.slice(0, 5) : null);

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
  const [diarias, setDiarias] = useState<Diaria[]>([]);
  const [diariaSel, setDiariaSel] = useState<string>(''); // id da diária ou 'nova'
  const [nome, setNome] = useState('');
  const [roteiros, setRoteiros] = useState<{ id: string; name: string; url: string }[]>([]);
  const [roteirosSel, setRoteirosSel] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  // form da diária nova (mesmos campos da aba Diárias)
  const [dNome, setDNome] = useState('');
  const [dData, setDData] = useState(hojeLocal());
  const [dInicio, setDInicio] = useState('08:00');
  const [dFim, setDFim] = useState('18:00');
  const [dLocal, setDLocal] = useState('');

  const load = useCallback(async () => {
    // diaria_id pode não existir ainda (migration pendente): tenta com e sem.
    let minhas = await supabase.from('ordens_do_dia').select('id, codigo, titulo, data_producao, diaria_id')
      .eq('project_id', projectId).order('data_producao', { ascending: false });
    if (minhas.error) {
      minhas = await supabase.from('ordens_do_dia').select('id, codigo, titulo, data_producao')
        .eq('project_id', projectId).order('data_producao', { ascending: false }) as any;
    }
    const semDono = await supabase.from('ordens_do_dia').select('id, codigo, titulo, data_producao')
      .is('project_id', null).order('created_at', { ascending: false }).limit(50);
    setOrdens((minhas.data as Ordem[]) || []);
    setSoltas((semDono.data as Ordem[]) || []);
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const nomePadrao = (d?: Diaria | null) =>
    `Ordem do Dia - ${projectName || 'Projeto'} - ${d?.nome || `Diária ${ordens.length + 1}`}`;

  const abrirCriacao = async () => {
    setRoteirosSel(new Set());
    setDNome(`Diária ${ordens.length + 1}`); setDData(hojeLocal()); setDInicio('08:00'); setDFim('18:00'); setDLocal('');
    setCriando(true);
    const [dias, docs] = await Promise.all([
      supabase.from('project_diarias').select('id, nome, data, hora_inicio, hora_fim, local')
        .eq('project_id', projectId).order('data', { ascending: true, nullsFirst: false }).order('ordem'),
      supabase.from('project_roteiros').select('id, nome, url').eq('project_id', projectId).order('ordem').order('created_at'),
    ]);
    const lista = ((dias.data as any[]) || []) as Diaria[];
    setDiarias(lista);
    // pré-seleciona a primeira diária ainda sem OD; sem diária nenhuma, cai no form de criar
    const usadas = new Set(ordens.map(o => o.diaria_id).filter(Boolean));
    const livre = lista.find(d => !usadas.has(d.id));
    setDiariaSel(lista.length === 0 ? 'nova' : (livre?.id || lista[0]?.id || 'nova'));
    setNome(nomePadrao(lista.length === 0 ? null : (livre || lista[0])));
    setRoteiros(((docs.data as any[]) || []).map(d => ({ id: d.id, name: d.nome, url: d.url })));
  };

  const escolherDiaria = (id: string) => {
    setDiariaSel(id);
    setNome(nomePadrao(id === 'nova' ? null : diarias.find(d => d.id === id)));
  };

  const diariaAtual = diariaSel !== 'nova' ? diarias.find(d => d.id === diariaSel) : null;
  const odDaDiaria = diariaAtual ? ordens.find(o => o.diaria_id === diariaAtual.id) : null;

  const criar = async () => {
    if (!nome.trim()) { toast.error('Dê um nome pra ordem do dia.'); return; }
    setSalvando(true);

    // 1) Garante a diária: escolhida na lista ou criada aqui mesmo.
    let diaria: Diaria | null = diariaAtual || null;
    if (diariaSel === 'nova') {
      if (!dNome.trim() || !dData) {
        setSalvando(false);
        toast.error('Dê um nome e uma data pra diária.');
        return;
      }
      const mi = dInicio ? Number(dInicio.slice(0, 2)) * 60 + Number(dInicio.slice(3, 5)) : null;
      const mf = dFim ? Number(dFim.slice(0, 2)) * 60 + Number(dFim.slice(3, 5)) : null;
      if (mi != null && mf != null && mf <= mi) { setSalvando(false); toast.error('O horário final precisa ser depois do início.'); return; }
      const payload: Record<string, unknown> = {
        project_id: projectId,
        nome: dNome.trim(),
        data: dData,
        hora_inicio: dInicio || null,
        hora_fim: dFim || null,
        duracao_horas: (mi != null && mf != null) ? Math.round(((mf - mi) / 60) * 10) / 10 : 10,
        local: dLocal.trim() || null,
        created_by: profile?.id || null,
      };
      let ins = await supabase.from('project_diarias').insert([payload]).select('id').single();
      if (ins.error && /hora_inicio|hora_fim/.test(String(ins.error.message))) {
        const { hora_inicio: _a, hora_fim: _b, ...semHoras } = payload;
        ins = await supabase.from('project_diarias').insert([semHoras]).select('id').single();
      }
      if (ins.error || !ins.data) { setSalvando(false); toast.error('Não foi possível criar a diária.'); return; }
      diaria = { id: ins.data.id, nome: dNome.trim(), data: dData, hora_inicio: dInicio || null, hora_fim: dFim || null, local: dLocal.trim() || null };
      // Google Calendar em melhor esforço, igual à aba Diárias.
      supabase.functions.invoke('calendar-diaria', { body: { action: 'upsert', diaria_id: diaria.id } }).catch(() => null);
    }
    if (!diaria) { setSalvando(false); toast.error('Escolha de qual diária vai nascer a ordem do dia.'); return; }

    // 2) A escala da diária vira a equipe da OD (melhor esforço).
    let equipeOd: { nome: string; funcao: string }[] = [];
    try {
      const eq = await supabase.from('diaria_members')
        .select('funcao, user:app_users!user_id(full_name), freela:fornecedores(nome)')
        .eq('diaria_id', diaria.id);
      equipeOd = (((eq.data as any[]) || [])
        .map(m => ({ nome: m.freela?.nome || m.user?.full_name || '', funcao: m.funcao || '' }))
        .filter(m => m.nome));
    } catch { /* tabela da escala pode não existir ainda */ }

    // 3) Cria a OD herdando data, hora, locação e equipe da diária.
    const base: Record<string, unknown> = {
      codigo: `${projectCode || 'OD'}-D${ordens.length + 1}`,
      titulo: nome.trim(),
      data_producao: diaria.data || null,
      project_id: projectId,
      diaria_id: diaria.id,
      created_by: profile?.id || null,
      ...(diaria.local ? { locacao: { nome: diaria.local, endereco: '', observacoes: '' } } : {}),
      hora_inicio: diaria.hora_inicio || null,
      roteiros: roteiros.filter(r => roteirosSel.has(r.id)).map(r => ({ id: r.id, name: r.name, url: r.url })),
      ...(equipeOd.length > 0 ? { equipe: equipeOd } : {}),
    };
    // Migrations pendentes: tenta sem os campos que o banco ainda não conhece.
    let { data: novo, error } = await supabase.from('ordens_do_dia').insert([base]).select('id').single();
    if (error && /diaria_id/.test(String(error.message))) {
      const { diaria_id: _d, ...semDiaria } = base;
      ({ data: novo, error } = await supabase.from('ordens_do_dia').insert([semDiaria]).select('id').single());
    }
    if (error && /hora_inicio|roteiros|equipe/.test(String(error.message))) {
      const { hora_inicio: _a, roteiros: _b, diaria_id: _d, equipe: _e, ...semNovos } = base;
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
            Crie uma nova a partir de uma diária, ou adote uma ordem antiga pelo seletor acima.
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-lumos-border/60 overflow-hidden">
          {ordens.map(o => (
            <button key={o.id} type="button" onClick={() => navigate(`/ordem-do-dia/${o.id}`)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-lumos-text-primary/5 transition-colors group">
              <span className="text-[10px] font-black text-lumos-yellow bg-lumos-yellow/10 px-2 py-0.5 rounded uppercase flex-shrink-0">{o.codigo}</span>
              <span className="text-[13px] font-bold truncate flex-1 text-lumos-text-primary">{o.titulo}</span>
              <span className="text-[11px] text-lumos-text-secondary flex-shrink-0">{fmtDia(o.data_producao)}</span>
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

      {/* Modal de criação: a OD nasce de uma diária */}
      {criando && (
        <Modal isOpen onClose={() => setCriando(false)} title="Nova Ordem do Dia" maxWidth="max-w-md">
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">De qual diária?</label>
              {diarias.length === 0 ? (
                <p className="text-[11px] text-lumos-text-secondary mt-1">
                  Este projeto ainda não tem diária, então ela nasce aqui junto com a ordem do dia.
                </p>
              ) : (
                <div className="mt-1 border border-lumos-border rounded-lumos divide-y divide-lumos-border/60 max-h-44 overflow-y-auto custom-scrollbar">
                  {diarias.map(d => {
                    const sel = diariaSel === d.id;
                    const jaTemOd = ordens.some(o => o.diaria_id === d.id);
                    return (
                      <button key={d.id} type="button" onClick={() => escolherDiaria(d.id)}
                        className={clsx('w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                          sel ? 'bg-lumos-yellow/10' : 'hover:bg-lumos-text-primary/5')}>
                        <span className={clsx('w-4 h-4 rounded-full border-2 grid place-items-center flex-shrink-0',
                          sel ? 'border-lumos-yellow' : 'border-lumos-text-secondary/40')}>
                          {sel && <span className="w-2 h-2 rounded-full bg-lumos-yellow" />}
                        </span>
                        <Video className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="text-xs font-bold text-lumos-text-primary block truncate">{d.nome}</span>
                          <span className="text-[10px] text-lumos-text-secondary block truncate">
                            {fmtDia(d.data)}{fmtHora(d.hora_inicio) ? ` · ${fmtHora(d.hora_inicio)}` : ''}{d.local ? ` · ${d.local}` : ''}
                          </span>
                        </span>
                        {jaTemOd && (
                          <span className="text-[9px] font-black uppercase text-lumos-text-secondary bg-lumos-text-secondary/10 border border-lumos-border rounded px-1.5 py-0.5 flex-shrink-0">
                            já tem OD
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => escolherDiaria('nova')}
                    className={clsx('w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                      diariaSel === 'nova' ? 'bg-lumos-yellow/10' : 'hover:bg-lumos-text-primary/5')}>
                    <span className={clsx('w-4 h-4 rounded-full border-2 grid place-items-center flex-shrink-0',
                      diariaSel === 'nova' ? 'border-lumos-yellow' : 'border-lumos-text-secondary/40')}>
                      {diariaSel === 'nova' && <span className="w-2 h-2 rounded-full bg-lumos-yellow" />}
                    </span>
                    <Plus className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
                    <span className="text-xs font-bold text-lumos-text-primary">Criar diária nova…</span>
                  </button>
                </div>
              )}
            </div>

            {diariaSel === 'nova' ? (
              <div className="border border-lumos-border rounded-lumos p-3 space-y-2.5 bg-lumos-bg/40">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Nome da diária</label>
                    <input value={dNome} onChange={e => setDNome(e.target.value)} className="input-lumos w-full h-9 mt-1 text-sm" placeholder="Ex.: Diária 1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Data</label>
                    <input type="date" value={dData} onChange={e => setDData(e.target.value)} className="input-lumos w-full h-9 mt-1 text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Início</label>
                      <input type="time" value={dInicio} onChange={e => setDInicio(e.target.value)} className="input-lumos w-full h-9 mt-1 text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Fim</label>
                      <input type="time" value={dFim} onChange={e => setDFim(e.target.value)} className="input-lumos w-full h-9 mt-1 text-sm" />
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Local</label>
                    <input value={dLocal} onChange={e => setDLocal(e.target.value)} className="input-lumos w-full h-9 mt-1 text-sm" placeholder="Ex.: Estúdio Lumos, São Paulo" />
                  </div>
                </div>
                <p className="text-[10px] text-lumos-text-secondary">
                  A diária entra na aba Diárias e no Google Calendar, e a ordem do dia herda data, hora e locação.
                </p>
              </div>
            ) : diariaAtual && (
              <div className="border border-lumos-border rounded-lumos px-3 py-2.5 bg-lumos-bg/40 text-[11px] text-lumos-text-secondary">
                A ordem do dia herda da diária: <strong className="text-lumos-text-primary">{fmtDia(diariaAtual.data)}</strong>
                {fmtHora(diariaAtual.hora_inicio) && <> · início <strong className="text-lumos-text-primary">{fmtHora(diariaAtual.hora_inicio)}</strong></>}
                {diariaAtual.local && <> · <strong className="text-lumos-text-primary">{diariaAtual.local}</strong></>}
                {odDaDiaria && <span className="block mt-1 text-lumos-yellow font-bold">Essa diária já tem a OD {odDaDiaria.codigo}, dá pra abrir direto.</span>}
              </div>
            )}

            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Nome da ordem do dia</label>
              <input value={nome} onChange={e => setNome(e.target.value)} className="input-lumos w-full h-10 mt-1 text-sm" />
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
              {odDaDiaria ? (
                <button type="button" onClick={() => navigate(`/ordem-do-dia/${odDaDiaria.id}`)}
                  className="btn-primary h-9 px-5 text-xs font-black flex items-center gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5" /> Abrir a OD dessa diária
                </button>
              ) : (
                <button type="button" onClick={criar} disabled={salvando}
                  className="btn-primary h-9 px-5 text-xs font-black disabled:opacity-60 flex items-center gap-1.5">
                  {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {diariaSel === 'nova' ? 'Criar diária e OD' : 'Criar'}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
