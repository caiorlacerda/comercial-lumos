import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dataDeIso, iso, segundaDe } from '@/lib/cronograma';

/**
 * Dentro da tarefa: em que dia do cronograma da equipe ela está marcada, e com quem. Só aparece se algum item
 * do cronograma foi ligado a esta tarefa; o clique abre a semana certa.
 */
interface Marca { id: string; dia: string; quem: string }

export default function TarefaNoCronograma({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const [marcas, setMarcas] = useState<Marca[]>([]);

  useEffect(() => {
    let vivo = true;
    supabase.from('cronograma_itens')
      .select('id, dia, linha:cronograma_linhas(nome, user:app_users(full_name))').eq('task_id', taskId).order('dia')
      .then(({ data }) => {
        if (!vivo) return;
        setMarcas(((data as any[]) || []).map(r => {
          const linha = Array.isArray(r.linha) ? r.linha[0] : r.linha;
          const user = Array.isArray(linha?.user) ? linha.user[0] : linha?.user;
          return { id: r.id, dia: String(r.dia).slice(0, 10), quem: user?.full_name || linha?.nome || 'Equipe' };
        }));
      });
    return () => { vivo = false; };
  }, [taskId]);

  if (!marcas.length) return null;
  const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return (
    <div className="space-y-1.5">
      <span className="text-[9px] font-black uppercase text-lumos-text-secondary tracking-wider block">No cronograma da equipe</span>
      <div className="flex flex-wrap gap-1.5">
        {marcas.map(m => (
          <button key={m.id} type="button" title="Abrir esta semana no cronograma"
            onClick={() => navigate(`/producao/cronograma-edicao?semana=${iso(segundaDe(dataDeIso(m.dia)))}`)}
            className="flex items-center gap-1.5 rounded-lumos border border-lumos-border bg-lumos-surface px-2 py-1 text-[11px] font-bold text-lumos-text-primary hover:border-lumos-yellow/60 transition-colors">
            <CalendarRange className="w-3 h-3 text-lumos-text-secondary" /> {br(m.dia)} · {m.quem}
          </button>
        ))}
      </div>
    </div>
  );
}
