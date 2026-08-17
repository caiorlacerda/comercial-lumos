import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Clock, CloudRain, Copy, Loader2, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';
import { previsaoParaDiaria, type PrevisaoDia } from '@/lib/weather';

/**
 * Diárias de gravação do projeto: data, duração, local e descrição, com
 * previsão do tempo automática por local e data (Open-Meteo). Chuva com 30%+
 * de chance vira alerta no topo e no card.
 */

interface Diaria {
  id: string; nome: string; data: string | null; duracao_horas: number;
  local: string | null; descricao: string | null; ordem: number;
  google_event_id?: string | null;
}

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

  const load = useCallback(async () => {
    const { data } = await supabase.from('project_diarias')
      .select('*').eq('project_id', projectId)
      .order('data', { ascending: true, nullsFirst: false }).order('ordem');
    setDiarias((data as Diaria[]) || []);
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

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
    const payload = {
      project_id: projectId,
      nome: editando.nome.trim(),
      data: editando.data || null,
      duracao_horas: Number(editando.duracao_horas) || 10,
      local: editando.local?.trim() || null,
      descricao: editando.descricao?.trim() || null,
    };
    let diariaId = editando.id || null;
    if (editando.id) {
      const { error } = await supabase.from('project_diarias').update(payload).eq('id', editando.id);
      if (error) { setSalvando(false); toast.error('Não foi possível salvar a diária.'); return; }
    } else {
      const { data, error } = await supabase.from('project_diarias')
        .insert([{ ...payload, created_by: profile?.id || null }]).select('id').single();
      if (error || !data) { setSalvando(false); toast.error('Não foi possível salvar a diária.'); return; }
      diariaId = data.id;
    }
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
      <div className="flex items-center gap-3">
        <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-lumos-yellow" /> Diárias de gravação
          {diarias.length > 0 && <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· {diarias.length}</span>}
        </p>
        {canManage && (
          <button type="button" onClick={() => setEditando({ duracao_horas: 10 })}
            className="ml-auto btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5">
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
          <p className="text-sm font-bold">Nenhuma diária planejada.</p>
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
                    {Number(d.duracao_horas).toLocaleString('pt-BR')} horas
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
              <div>
                <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Duração (horas)</label>
                <input type="number" min={1} max={24} step={0.5} className="input-lumos w-full h-10 mt-1 text-sm"
                  value={editando.duracao_horas ?? 10} onChange={e => setEditando(s => ({ ...s, duracao_horas: Number(e.target.value) }))} />
              </div>
            </div>
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
    </div>
  );
}
