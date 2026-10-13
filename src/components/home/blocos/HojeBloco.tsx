import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import BlocoCartao from '../BlocoCartao';
import type { DadosHome } from '../tipos';

type TipoItem = 'diaria' | 'ordem' | 'prazo';
interface ItemHoje { id: string; tipo: TipoItem; titulo: string; hora: string | null; projeto: string | null; link: string }

const ROTULO: Record<TipoItem, string> = { diaria: 'Diária', ordem: 'Ordem do dia', prazo: 'Prazo' };
const COR: Record<TipoItem, string> = {
  diaria: 'bg-lumos-yellow/10 text-lumos-yellow border-lumos-yellow/25',
  ordem: 'bg-sky-500/10 text-sky-400 border-sky-500/25',
  prazo: 'bg-orange-500/10 text-orange-400 border-orange-500/25',
};

/** O que acontece hoje para mim: diárias em que estou escalado, ordens do dia desses projetos e prazos que vencem hoje. */
export default function HojeBloco({ dados }: { dados: DadosHome }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const userId = profile?.id;
  const { hojeStr } = dados;
  const [agenda, setAgenda] = useState<ItemHoje[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!userId) return;
      try {
        // Diárias de hoje em que estou na escala
        const { data: mem } = await supabase.from('diaria_members').select('diaria_id').eq('user_id', userId);
        const diariaIds = (mem || []).map((m: any) => m.diaria_id);
        let diarias: any[] = [];
        if (diariaIds.length) {
          const { data } = await supabase.from('project_diarias')
            .select('id, nome, data, hora_inicio, project_id, projects(name)')
            .in('id', diariaIds).eq('data', hojeStr);
          diarias = data || [];
        }
        // Ordens do dia de hoje nos projetos dessas diárias
        const projetoIds = [...new Set(diarias.map(d => d.project_id))];
        let ordens: any[] = [];
        if (projetoIds.length) {
          const { data } = await supabase.from('ordens_do_dia')
            .select('id, titulo, data_producao, project_id, projects(name)')
            .in('project_id', projetoIds).eq('data_producao', hojeStr);
          ordens = data || [];
        }
        if (!vivo) return;
        const itens: ItemHoje[] = [
          ...diarias.map(d => ({
            id: `diaria:${d.id}`, tipo: 'diaria' as const, titulo: d.nome,
            hora: d.hora_inicio ? String(d.hora_inicio).slice(0, 5) : null,
            projeto: d.projects?.name || null,
            link: `/producao/projetos?projectId=${d.project_id}&tab=diarias`,
          })),
          ...ordens.map(o => ({
            id: `ordem:${o.id}`, tipo: 'ordem' as const, titulo: o.titulo, hora: null,
            projeto: o.projects?.name || null, link: `/ordem-do-dia/${o.id}`,
          })),
        ];
        setAgenda(itens);
      } catch (e) {
        console.error('Home: agenda de hoje', e);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [userId, hojeStr]);

  const itens = useMemo(() => {
    const prazos: ItemHoje[] = dados.ordenadas.filter(t => t.data_fim === hojeStr).map(t => ({
      id: `prazo:${t.id}`, tipo: 'prazo' as const, titulo: t.titulo, hora: null,
      projeto: t.projects?.name || null,
      link: `/producao/projetos?projectId=${t.project_id}&taskId=${t.id}`,
    }));
    const ordemTipo: Record<TipoItem, number> = { diaria: 0, ordem: 1, prazo: 2 };
    return [...agenda, ...prazos].sort((a, b) => {
      if (a.hora && b.hora) return a.hora.localeCompare(b.hora);
      if (a.hora) return -1;
      if (b.hora) return 1;
      return ordemTipo[a.tipo] - ordemTipo[b.tipo];
    });
  }, [agenda, dados.ordenadas, hojeStr]);

  return (
    <BlocoCartao titulo="Hoje" direita={itens.length > 0 ? (
      <span className="text-[10px] font-black uppercase bg-lumos-yellow/10 text-lumos-yellow px-2 py-0.5 rounded">{itens.length}</span>
    ) : undefined}>
      {carregando && dados.carregando ? (
        <p className="text-xs text-lumos-text-secondary italic text-center py-4">Carregando…</p>
      ) : itens.length === 0 ? (
        <p className="text-xs text-lumos-text-secondary italic text-center py-6">Nada marcado para hoje.</p>
      ) : (
        <div className="space-y-2">
          {itens.map(item => (
            <button
              key={item.id}
              onClick={() => navigate(item.link)}
              className="w-full text-left p-3 rounded border border-lumos-border bg-lumos-bg/30 hover:bg-lumos-yellow/5 hover:border-lumos-yellow/20 transition-all flex items-center gap-3 group cursor-pointer"
            >
              <span className={clsx('px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border flex-shrink-0', COR[item.tipo])}>
                {ROTULO[item.tipo]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-lumos-text-primary truncate group-hover:text-lumos-yellow transition-colors">{item.titulo}</span>
                {item.projeto && <span className="block text-[10px] uppercase tracking-wider text-lumos-text-secondary truncate">{item.projeto}</span>}
              </span>
              {item.hora && <span className="text-[11px] uppercase tracking-wider text-lumos-text-primary flex-shrink-0">{item.hora}</span>}
              <ChevronRight className="w-4 h-4 text-lumos-text-secondary group-hover:text-lumos-yellow flex-shrink-0 transition-colors" />
            </button>
          ))}
        </div>
      )}
    </BlocoCartao>
  );
}
