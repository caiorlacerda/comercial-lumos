import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, Link2, Loader2, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';

/**
 * Ordens do Dia do projeto. As ordens continuam morando no editor delas
 * (/ordem-do-dia); aqui é a visão por projeto: listar, abrir, criar já
 * vinculada e adotar ordens antigas que ficaram soltas.
 */

interface Ordem { id: string; codigo: string; titulo: string; data_producao: string | null }

interface Props { projectId: string; canManage: boolean }

export default function ProjectOrdens({ projectId, canManage }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [ordens, setOrdens] = useState<Ordem[]>([]);
  const [soltas, setSoltas] = useState<Ordem[]>([]);
  const [vinculando, setVinculando] = useState('');

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
            <button type="button" onClick={() => navigate(`/ordem-do-dia/nova?projectId=${projectId}`)}
              className="btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Nova ordem
            </button>
          </div>
        )}
      </div>

      {ordens.length === 0 ? (
        <div className="card p-8 text-center">
          <CalendarDays className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" />
          <p className="text-sm font-bold">Nenhuma ordem do dia neste projeto.</p>
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
              <span className="text-[13px] font-bold truncate flex-1">{o.titulo}</span>
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
    </div>
  );
}
