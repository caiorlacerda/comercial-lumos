import { useEffect, useMemo, useState } from 'react';
import { gravarCache, lerCache } from '@/lib/cacheDeTela';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import type { DadosHome, TarefaHome } from './tipos';

/** Tarefas abertas da pessoa (responsável ou colaboradora) e os números do resumo. */
export function useMinhasTarefas(): DadosHome {
  const { profile } = useAuth();
  const toast = useToast();
  const userId = profile?.id;
  const chaveCache = `home-tarefas:${userId ?? ''}`;
  const [tarefas, setTarefas] = useState<TarefaHome[]>(() => lerCache<TarefaHome[]>(chaveCache) ?? []);
  const [carregando, setCarregando] = useState(() => !lerCache(chaveCache));

  useEffect(() => {
    async function buscar() {
      if (!userId) return;
      try {
        if (!lerCache(chaveCache)) setCarregando(true);
        // Minhas tarefas = onde sou responsável OU colaborador.
        const { data: collabRows } = await supabase
          .from('task_collaborators').select('task_id').eq('user_id', userId);
        const collabIds = (collabRows || []).map((r: any) => r.task_id);

        const FIELDS = `
            id,
            project_id,
            titulo,
            status,
            prioridade,
            data_fim,
            responsavel_id,
            projects (
              id,
              name,
              client_id,
              clients (
                id,
                name
              )
            )
          `;
        const orFilter = collabIds.length
          ? `responsavel_id.eq.${userId},id.in.(${collabIds.join(',')})`
          : `responsavel_id.eq.${userId}`;

        const { data, error } = await supabase
          .from('project_tasks')
          .select(FIELDS)
          .or(orFilter)
          .is('deleted_at', null)          // não mostra tarefa que foi pra lixeira
          .neq('status', 'concluido');

        if (error) throw error;
        setTarefas((data as any) || []);
        gravarCache(chaveCache, (data as any) || []);
      } catch (err: any) {
        console.error('Error fetching home tasks:', err);
        toast.error('Erro ao carregar suas tarefas pendentes.');
      } finally {
        setCarregando(false);
      }
    }
    buscar();
  }, [userId, toast]);

  const hojeStr = useMemo(() => new Date().toLocaleDateString('en-CA'), []);

  const resumo = useMemo(() => {
    const pending = tarefas.length;
    const dueToday = tarefas.filter(t => t.data_fim === hojeStr).length;
    // Vencem nos próximos 7 dias
    const next7DaysStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
    const dueThisWeek = tarefas.filter(t => t.data_fim && t.data_fim >= hojeStr && t.data_fim <= next7DaysStr).length;
    const overdue = tarefas.filter(t => t.data_fim && t.data_fim < hojeStr).length;
    return { pending, dueToday, dueThisWeek, overdue };
  }, [tarefas, hojeStr]);

  // Por prazo crescente; sem prazo no fim
  const ordenadas = useMemo(() => [...tarefas].sort((a, b) => {
    if (!a.data_fim) return 1;
    if (!b.data_fim) return -1;
    return a.data_fim.localeCompare(b.data_fim);
  }), [tarefas]);

  return { tarefas, ordenadas, carregando, hojeStr, resumo };
}
