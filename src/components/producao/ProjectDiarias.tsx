import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CalendarOff, Clock, CloudRain, Copy, Loader2, MapPin, Pencil, Plus, Search, Trash2, UserPlus, Users2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import QuickForm from '@/components/common/QuickForm';
import PedidosDeDiaria from '@/components/producao/PedidosDeDiaria';
import BloqueiosDeAgenda from '@/components/producao/BloqueiosDeAgenda';
import { previsaoParaDiaria, type PrevisaoDia } from '@/lib/weather';

/**
 * Diárias de gravação do projeto: data, duração, local e descrição, com
 * previsão do tempo automática por local e data (Open-Meteo). Chuva com 30%+
 * de chance vira alerta no topo e no card. Cada diária tem a própria ESCALA
 * (equipe interna ou fornecedor): fornecedor escalado em diária com data é o
 * que dispara a cobrança automática de nota fiscal.
 */

export interface MembroDiaria {
  id: string;
  diaria_id: string;
  funcao: string | null;
  user: { id: string; full_name: string } | null;
  freela: { id: string; nome: string } | null;
}

interface PessoaCatalogo { tipo: 'user' | 'freela'; id: string; nome: string; funcao?: string | null; doProjeto?: boolean }

interface Diaria {
  id: string; nome: string; data: string | null; duracao_horas: number;
  hora_inicio: string | null; hora_fim: string | null;
  local: string | null; descricao: string | null; ordem: number;
  google_event_id?: string | null;
}

// "08:00" → minutos, pra derivar a duração quando há início e fim.
const min = (h?: string | null) => { if (!h) return null; const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const fmtHora = (h?: string | null) => h ? h.slice(0, 5) : null;

interface Props { projectId: string; canManage: boolean }

// toLocaleDateString devolve tudo minúsculo; só a primeira letra sobe (nada de "De Agosto").
const fmtData = (d?: string | null) => {
  if (!d) return 'data a definir';
  const s = new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function ProjectDiarias({ projectId, canManage }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [diarias, setDiarias] = useState<Diaria[]>([]);
  const [clima, setClima] = useState<Record<string, PrevisaoDia | null>>({});
  const [editando, setEditando] = useState<Partial<Diaria> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [equipes, setEquipes] = useState<Record<string, MembroDiaria[]>>({});
  const [escalaIndisponivel, setEscalaIndisponivel] = useState(false);
  const [escalando, setEscalando] = useState<Diaria | null>(null);
  const [catalogo, setCatalogo] = useState<PessoaCatalogo[]>([]);
  const [editandoFuncao, setEditandoFuncao] = useState<MembroDiaria | null>(null);
  const [bloqueiosAbertos, setBloqueiosAbertos] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('project_diarias')
      .select('*').eq('project_id', projectId)
      .order('data', { ascending: true, nullsFirst: false }).order('ordem');
    const lista = (data as Diaria[]) || [];
    setDiarias(lista);
    setLoading(false);
    // Escala de cada diária (tabela pode não existir antes da migration).
    if (lista.length > 0) {
      const eq = await supabase.from('diaria_members')
        .select('id, diaria_id, funcao, user:app_users!user_id(id, full_name), freela:fornecedores(id, nome)')
        .in('diaria_id', lista.map(d => d.id));
      if (eq.error) setEscalaIndisponivel(true);
      else {
        setEscalaIndisponivel(false);
        const porDiaria: Record<string, MembroDiaria[]> = {};
        for (const m of (eq.data as unknown as MembroDiaria[]) || []) {
          (porDiaria[m.diaria_id] ||= []).push(m);
        }
        setEquipes(porDiaria);
      }
    } else {
      setEquipes({});
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  // Catálogo de quem pode ser escalado: equipe do projeto em destaque,
  // depois todos os fornecedores e o time Lumos.
  useEffect(() => {
    (async () => {
      const [pm, forn, users] = await Promise.all([
        supabase.from('project_members').select('user_id, freela_id, funcao').eq('project_id', projectId),
        supabase.from('fornecedores').select('id, nome').order('nome'),
        supabase.from('app_users').select('id, full_name').eq('status', 'ativo').order('full_name'),
      ]);
      const funcaoDe = new Map<string, string | null>();
      const doProjeto = new Set<string>();
      for (const m of (pm.data as any[]) || []) {
        const k = m.user_id ? `user:${m.user_id}` : `freela:${m.freela_id}`;
        doProjeto.add(k);
        funcaoDe.set(k, m.funcao || null);
      }
      const pessoas: PessoaCatalogo[] = [
        ...(((forn.data as any[]) || []).map(f => ({
          tipo: 'freela' as const, id: f.id, nome: f.nome,
          funcao: funcaoDe.get(`freela:${f.id}`) || null, doProjeto: doProjeto.has(`freela:${f.id}`),
        }))),
        ...(((users.data as any[]) || []).map(u => ({
          tipo: 'user' as const, id: u.id, nome: u.full_name,
          funcao: funcaoDe.get(`user:${u.id}`) || null, doProjeto: doProjeto.has(`user:${u.id}`),
        }))),
      ];
      setCatalogo(pessoas);
    })();
  }, [projectId]);

  const escalar = async (d: Diaria, p: PessoaCatalogo) => {
    const { error } = await supabase.from('diaria_members').insert({
      diaria_id: d.id,
      user_id: p.tipo === 'user' ? p.id : null,
      freela_id: p.tipo === 'freela' ? p.id : null,
      funcao: p.funcao || null,
      added_by: profile?.id || null,
    });
    if (error) toast.error(`Não deu pra escalar: ${error.message}`);
    else load();
  };

  const desescalar = async (m: MembroDiaria) => {
    const { error } = await supabase.from('diaria_members').delete().eq('id', m.id);
    if (error) toast.error('Não foi possível remover da escala.');
    else load();
  };

  const salvarFuncao = async (m: MembroDiaria, funcao: string) => {
    setEditandoFuncao(null);
    const { error } = await supabase.from('diaria_members').update({ funcao: funcao.trim() || null }).eq('id', m.id);
    if (error) toast.error('Não foi possível salvar a função.');
    else load();
  };

  // Clima: busca uma vez por diária com local + data dentro da janela.
  useEffect(() => {
    diarias.forEach(d => {
      if (!d.local || !d.data || clima[d.id] !== undefined) return;
      previsaoParaDiaria(d.local, d.data).then(p => setClima(c => ({ ...c, [d.id]: p })));
    });
  }, [diarias]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = async () => {
    if (!editando?.nome?.trim()) { toast.error('Dê um nome pra diária.'); return; }
    setSalvando(true);
    const mi = min(editando.hora_inicio), mf = min(editando.hora_fim);
    if (mi != null && mf != null && mf <= mi) { toast.error('O horário final precisa ser depois do início.'); return; }
    const payload = {
      project_id: projectId,
      nome: editando.nome.trim(),
      data: editando.data || null,
      hora_inicio: editando.hora_inicio || null,
      hora_fim: editando.hora_fim || null,
      // com início e fim, a duração sai da conta; senão vale o que digitaram
      duracao_horas: (mi != null && mf != null) ? Math.round(((mf - mi) / 60) * 10) / 10 : (Number(editando.duracao_horas) || 10),
      local: editando.local?.trim() || null,
      descricao: editando.descricao?.trim() || null,
    };
    let diariaId = editando.id || null;
    // Se a migration dos horários ainda não rodou, salva sem eles em vez de quebrar.
    const gravar = async (pl: Record<string, unknown>) => editando.id
      ? { r: await supabase.from('project_diarias').update(pl).eq('id', editando.id), id: editando.id }
      : (() => null)() ?? { r: await supabase.from('project_diarias').insert([{ ...pl, created_by: profile?.id || null }]).select('id').single(), id: null };
    let res = await gravar(payload);
    let err = (res.r as any).error;
    if (err && /hora_inicio|hora_fim/.test(String(err.message))) {
      const { hora_inicio: _a, hora_fim: _b, ...semHoras } = payload as any;
      res = await gravar(semHoras);
      err = (res.r as any).error;
      if (!err) toast.error('Diária salva sem horário: falta rodar a migração dos horários no banco.');
    }
    if (err) { setSalvando(false); toast.error('Não foi possível salvar a diária.'); return; }
    diariaId = editando.id || (res.r as any).data?.id || null;
    setSalvando(false);
    setEditando(null);
    setClima({});
    load();
    // Diária no calendário da produção: melhor esforço, sem travar o fluxo.
    if (diariaId && payload.data) {
      supabase.functions.invoke('calendar-diaria', { body: { action: 'upsert', diaria_id: diariaId } })
        .then(({ data: r, error }) => {
          if (error || (r as any)?.error) toast.error('Diária salva, mas o Google Calendar não aceitou. Confere a conexão do calendário.');
          else if ((r as any)?.event_id) { toast.success('Diária no Google Calendar ✓'); load(); }
        });
    }
  };

  const excluir = async () => {
    if (!editando?.id) return;
    if (!confirm(`Excluir a diária "${editando.nome}"?`)) return;
    const eventId = (editando as Diaria).google_event_id;
    const { error } = await supabase.from('project_diarias').delete().eq('id', editando.id);
    if (error) { toast.error('Não foi possível excluir.'); return; }
    if (eventId) void supabase.functions.invoke('calendar-diaria', { body: { action: 'delete', event_id: eventId } });
    setEditando(null);
    load();
  };

  const duplicar = () => {
    if (!editando) return;
    setEditando({ ...editando, id: undefined, nome: `${editando.nome} (cópia)` });
  };

  if (loading) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow" /></div>;

  const comChuva = diarias.filter(d => (clima[d.id]?.chanceChuva ?? 0) >= 30);

  return (
    <div className="space-y-3">
      <PedidosDeDiaria projectId={projectId} canManage={canManage} onMudou={load} />

      <div className="flex items-center gap-3">
        <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-lumos-yellow" /> Diárias de gravação
          {diarias.length > 0 && <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· {diarias.length}</span>}
        </p>
        {canManage && (
          <button type="button" onClick={() => setBloqueiosAbertos(true)}
            className="ml-auto text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary flex items-center gap-1.5">
            <CalendarOff className="w-3.5 h-3.5" /> Datas bloqueadas
          </button>
        )}
        {canManage && (
          <button type="button" onClick={() => setEditando({ duracao_horas: 10 })}
            className="btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Nova diária
          </button>
        )}
      </div>

      {/* Alerta de chuva agregado, igual referência */}
      {comChuva.length > 0 && (
        <div className="rounded-lumos border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3 flex items-start gap-2.5">
          <CloudRain className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] leading-snug">
            {comChuva.map((d, i) => (
              <span key={d.id}>
                {i > 0 && <br />}
                Previsão de chuva em <b>{fmtData(d.data)}</b> na diária "{d.nome}", {clima[d.id]!.chanceChuva}% de chance
                {clima[d.id]!.chuvaMm > 0 ? `, ${clima[d.id]!.chuvaMm.toLocaleString('pt-BR')} mm previstos` : ''}
                {d.local ? `, em ${d.local}` : ''}.
              </span>
            ))}
          </p>
        </div>
      )}

      {diarias.length === 0 ? (
        <div className="card p-8 text-center">
          <CalendarDays className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" />
          <p className="text-sm font-bold text-lumos-text-primary">Nenhuma diária planejada.</p>
          <p className="text-xs text-lumos-text-secondary mt-1 max-w-md mx-auto">
            Cadastre as diárias com data e local: a previsão do tempo aparece sozinha, e a etapa "Diárias planejadas" do Status marca automaticamente.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {diarias.map(d => {
            const p = clima[d.id];
            const chuva = (p?.chanceChuva ?? 0) >= 30;
            const passada = !!d.data && d.data < new Date().toISOString().slice(0, 10);
            return (
              <div key={d.id} className={clsx('card p-4 relative group border-l-4',
                chuva ? 'border-l-amber-500' : passada ? 'border-l-green-600' : 'border-l-lumos-yellow/70')}>
                {canManage && (
                  <button type="button" onClick={() => setEditando(d)}
                    className="absolute top-3 right-3 p-1.5 rounded text-lumos-text-secondary hover:text-lumos-yellow opacity-0 group-hover:opacity-100 transition-opacity" title="Editar">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                <p className="text-[13.5px] font-black pr-8 text-lumos-text-primary">{d.nome}</p>
                {d.descricao && <p className="text-[11.5px] text-lumos-text-secondary mt-0.5 leading-snug">{d.descricao}</p>}

                {chuva && p && (
                  <p className="mt-2 text-[11px] font-bold text-amber-500 flex items-center gap-1.5">
                    <CloudRain className="w-3.5 h-3.5" /> Chuva na previsão · {p.chanceChuva}%
                  </p>
                )}

                <div className="mt-3 space-y-1.5 text-[11.5px] text-lumos-text-primary">
                  <p className="flex items-center gap-2">
                    <CalendarDays className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
                    <span className={clsx(passada && 'text-lumos-text-secondary')}>{fmtData(d.data)}</span>
                    {passada && <span className="text-[9px] font-black uppercase text-green-500">feita</span>}
                  </p>
                  <p className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
                    {d.hora_inicio && d.hora_fim
                      ? <>{fmtHora(d.hora_inicio)} → {fmtHora(d.hora_fim)} · {Number(d.duracao_horas).toLocaleString('pt-BR')}h</>
                      : <>{Number(d.duracao_horas).toLocaleString('pt-BR')} horas</>}
                  </p>
                  {d.local && (
                    <p className="flex items-center gap-2 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
                      <a href={`https://www.google.com/maps/search/${encodeURIComponent(d.local)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="truncate hover:text-lumos-yellow underline decoration-lumos-border underline-offset-2">
                        {d.local}
                      </a>
                    </p>
                  )}
                  {p && !chuva && (
                    <p className="text-[10.5px] text-lumos-text-secondary">
                      Previsão: {p.tempMin}° a {p.tempMax}° · {p.chanceChuva}% de chuva
                    </p>
                  )}
                  {d.google_event_id && (
                    <p className="text-[10px] font-bold text-green-600 dark:text-green-500">No Google Calendar ✓</p>
                  )}
                </div>

                {/* Escala desta diária: quem trabalha nela. Fornecedor escalado
                    em diária com data dispara a cobrança de nota sozinho. */}
                <div className="mt-3 pt-3 border-t border-lumos-border/50">
                  <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary flex items-center gap-1.5 mb-1.5">
                    <Users2 className="w-3 h-3" /> Equipe da diária
                    {(equipes[d.id]?.length || 0) > 0 && <span className="normal-case tracking-normal">· {equipes[d.id]!.length}</span>}
                  </p>
                  {escalaIndisponivel ? (
                    <p className="text-[10px] text-lumos-text-secondary italic">Falta rodar a migration da escala no banco.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(equipes[d.id] || []).map(m => (
                        <span key={m.id} className={clsx('inline-flex items-center gap-1 rounded-full border pl-2 py-0.5 text-[10.5px] font-bold',
                          m.freela ? 'bg-lumos-yellow/10 border-lumos-yellow/40 text-lumos-text-primary' : 'bg-lumos-text-secondary/10 border-lumos-border text-lumos-text-primary',
                          canManage ? 'pr-1' : 'pr-2')}>
                          <button type="button" disabled={!canManage} title={canManage ? 'Editar função' : undefined}
                            onClick={() => canManage && setEditandoFuncao(m)} className="text-left">
                            {m.freela?.nome || m.user?.full_name}
                            {m.funcao && <span className="text-lumos-text-secondary font-semibold"> · {m.funcao}</span>}
                          </button>
                          {canManage && (
                            <button type="button" onClick={() => desescalar(m)}
                              className="p-0.5 rounded-full text-lumos-text-secondary hover:text-red-500 hover:bg-red-500/10" title="Tirar da escala">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      ))}
                      {canManage && (
                        <button type="button" onClick={() => setEscalando(d)}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-lumos-text-secondary/40 px-2 py-0.5 text-[10.5px] font-bold text-lumos-text-secondary hover:text-lumos-yellow hover:border-lumos-yellow transition-colors">
                          <UserPlus className="w-3 h-3" /> Escalar
                        </button>
                      )}
                      {!canManage && (equipes[d.id]?.length || 0) === 0 && (
                        <span className="text-[10px] text-lumos-text-secondary italic">Ninguém escalado ainda.</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Criar / editar */}
      {editando && (
        <Modal isOpen onClose={() => setEditando(null)} title={editando.id ? 'Editar diária' : 'Nova diária'} maxWidth="max-w-md">
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Nome</label>
              <input autoFocus className="input-lumos w-full h-10 mt-1 text-sm" placeholder='Ex.: "Diária 1, Praia"'
                value={editando.nome || ''} onChange={e => setEditando(s => ({ ...s, nome: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Data prevista</label>
                <input type="date" className="input-lumos w-full h-10 mt-1 text-sm"
                  value={editando.data || ''} onChange={e => setEditando(s => ({ ...s, data: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Início</label>
                  <input type="time" className="input-lumos w-full h-10 mt-1 text-sm"
                    value={editando.hora_inicio || ''} onChange={e => setEditando(s => ({ ...s, hora_inicio: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Fim</label>
                  <input type="time" className="input-lumos w-full h-10 mt-1 text-sm"
                    value={editando.hora_fim || ''} onChange={e => setEditando(s => ({ ...s, hora_fim: e.target.value }))} />
                </div>
              </div>
            </div>
            <p className="text-[10px] text-lumos-text-secondary -mt-1">Com horário, o evento entra no Google Calendar como compromisso com hora; sem, vira evento de dia inteiro.</p>
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Local</label>
              <input className="input-lumos w-full h-10 mt-1 text-sm" placeholder="Ex.: Praia da Reserva, Rio de Janeiro"
                value={editando.local || ''} onChange={e => setEditando(s => ({ ...s, local: e.target.value }))} />
              <p className="text-[10px] text-lumos-text-secondary mt-1">Com local e data, a previsão do tempo aparece sozinha no card.</p>
            </div>
            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Descrição</label>
              <textarea rows={2} className="input-lumos w-full mt-1 text-sm resize-y" placeholder="O que se grava nessa diária"
                value={editando.descricao || ''} onChange={e => setEditando(s => ({ ...s, descricao: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 pt-1">
              {editando.id && (
                <>
                  <button type="button" onClick={excluir} className="text-[11px] font-bold text-red-400 border border-red-500/40 rounded-lumos px-3 h-9 hover:bg-red-500/10 flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" /> Excluir
                  </button>
                  <button type="button" onClick={duplicar} className="text-[11px] font-bold text-lumos-text-secondary border border-lumos-border rounded-lumos px-3 h-9 hover:text-lumos-text-primary flex items-center gap-1.5">
                    <Copy className="w-3.5 h-3.5" /> Duplicar
                  </button>
                </>
              )}
              <button type="button" onClick={() => setEditando(null)} className="ml-auto text-[11px] font-bold text-lumos-text-secondary px-2">Cancelar</button>
              <button type="button" onClick={salvar} disabled={salvando}
                className="btn-primary h-9 px-5 text-xs font-black disabled:opacity-60 flex items-center gap-1.5">
                {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {escalando && (
        <EscalarModal
          diaria={escalando}
          catalogo={catalogo}
          jaEscalados={new Set((equipes[escalando.id] || []).map(m => m.freela ? `freela:${m.freela.id}` : `user:${m.user?.id}`))}
          onEscalar={p => escalar(escalando, p)}
          onClose={() => setEscalando(null)}
        />
      )}

      {editandoFuncao && (
        <QuickForm
          title={`Função de ${editandoFuncao.freela?.nome || editandoFuncao.user?.full_name}`}
          fields={[{ key: 'funcao', label: 'Função nesta diária', placeholder: 'Ex.: Direção de fotografia', value: editandoFuncao.funcao || '' }]}
          submitLabel="Salvar"
          onSubmit={v => salvarFuncao(editandoFuncao, v.funcao || '')}
          onClose={() => setEditandoFuncao(null)}
        />
      )}

      <BloqueiosDeAgenda isOpen={bloqueiosAbertos} onClose={() => setBloqueiosAbertos(false)} canManage={canManage} />
    </div>
  );
}

// ── Modal de escalar: busca em todo mundo, equipe do projeto em destaque ───
function EscalarModal({ diaria, catalogo, jaEscalados, onEscalar, onClose }: {
  diaria: Diaria;
  catalogo: PessoaCatalogo[];
  jaEscalados: Set<string>;
  onEscalar: (p: PessoaCatalogo) => void;
  onClose: () => void;
}) {
  const [busca, setBusca] = useState('');
  const q = busca.trim().toLowerCase();
  const disponiveis = catalogo.filter(p => !jaEscalados.has(`${p.tipo}:${p.id}`) && (!q || p.nome.toLowerCase().includes(q)));
  const grupos: { titulo: string; itens: PessoaCatalogo[] }[] = [
    { titulo: 'Equipe do projeto', itens: disponiveis.filter(p => p.doProjeto) },
    { titulo: 'Fornecedores', itens: disponiveis.filter(p => !p.doProjeto && p.tipo === 'freela') },
    { titulo: 'Time Lumos', itens: disponiveis.filter(p => !p.doProjeto && p.tipo === 'user') },
  ].filter(g => g.itens.length > 0);

  return (
    <Modal isOpen onClose={onClose} title={`Escalar em "${diaria.nome}"`} maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-lumos-text-secondary pointer-events-none" />
          <input autoFocus value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar pessoa ou fornecedor…" className="input-lumos pl-9 w-full h-10 text-sm" />
        </div>
        <p className="text-[10.5px] text-lumos-text-secondary">
          Fornecedor escalado em diária com data já agenda a cobrança de nota sozinho.
        </p>
        <div className="border border-lumos-border rounded-lumos max-h-72 overflow-y-auto custom-scrollbar divide-y divide-lumos-border/40">
          {grupos.length === 0 && (
            <p className="text-xs text-lumos-text-secondary italic p-4 text-center">Ninguém encontrado.</p>
          )}
          {grupos.map(g => (
            <div key={g.titulo}>
              <p className="text-[9px] font-black uppercase tracking-widest text-lumos-text-secondary bg-lumos-bg/60 px-3 py-1.5 sticky top-0">{g.titulo}</p>
              {g.itens.map(pessoa => (
                <button key={`${pessoa.tipo}:${pessoa.id}`} type="button"
                  onClick={() => { onEscalar(pessoa); onClose(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-lumos-text-primary/5 transition-colors">
                  <span className={clsx('w-7 h-7 rounded-full text-[10px] font-black flex items-center justify-center flex-shrink-0',
                    pessoa.tipo === 'freela' ? 'bg-lumos-yellow/15 text-lumos-yellow' : 'bg-lumos-text-secondary/15 text-lumos-text-secondary')}>
                    {pessoa.nome.trim().split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase() || '').join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-xs font-bold text-lumos-text-primary block truncate">{pessoa.nome}</span>
                    <span className="text-[10px] text-lumos-text-secondary block truncate">
                      {pessoa.tipo === 'freela' ? 'Fornecedor' : 'Time Lumos'}{pessoa.funcao ? ` · ${pessoa.funcao}` : ''}
                    </span>
                  </span>
                  <UserPlus className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
