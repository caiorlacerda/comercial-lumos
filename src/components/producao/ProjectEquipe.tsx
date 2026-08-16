import { useCallback, useEffect, useState } from 'react';
import { Loader2, Users2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';

/**
 * Ficha técnica do projeto, derivada das tarefas: quem é responsável ou
 * colaborador em alguma tarefa entra na equipe, com papel e carga. Nada é
 * cadastrado aqui, a fonte é o trabalho de verdade.
 */

interface Pessoa {
  id: string; nome: string; cargo: string | null; freela: boolean;
  tarefas: number; abertas: number;
}

interface Props { projectId: string }

export default function ProjectEquipe({ projectId }: Props) {
  const [loading, setLoading] = useState(true);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);

  const load = useCallback(async () => {
    const { data: tasks } = await supabase.from('project_tasks')
      .select('id, status, responsavel_id, responsavel_freela_id')
      .eq('project_id', projectId).is('deleted_at', null);
    const taskIds = (tasks || []).map(t => t.id);

    const { data: collabs } = taskIds.length
      ? await supabase.from('task_collaborators').select('task_id, user_id').in('task_id', taskIds)
      : { data: [] as { task_id: string; user_id: string }[] };

    // Junta responsáveis + colaboradores por pessoa.
    const porPessoa = new Map<string, { tarefas: Set<string>; abertas: number; freela: boolean }>();
    const add = (id: string | null, taskId: string, aberta: boolean, freela: boolean) => {
      if (!id) return;
      const p = porPessoa.get(id) || { tarefas: new Set<string>(), abertas: 0, freela };
      if (!p.tarefas.has(taskId)) { p.tarefas.add(taskId); if (aberta) p.abertas++; }
      porPessoa.set(id, p);
    };
    const ABERTAS = ['na_fila', 'roteiro', 'captacao', 'em_progresso', 'revisao_interna', 'revisao_cliente', 'alteracoes'];
    for (const t of tasks || []) {
      const aberta = ABERTAS.includes(t.status);
      add(t.responsavel_id, t.id, aberta, false);
      add(t.responsavel_freela_id, t.id, aberta, true);
    }
    for (const c of collabs || []) {
      const t = (tasks || []).find(x => x.id === c.task_id);
      add(c.user_id, c.task_id, t ? ABERTAS.includes(t.status) : false, false);
    }

    const userIds = [...porPessoa.keys()];
    if (!userIds.length) { setPessoas([]); setLoading(false); return; }

    // Nomes: app_users pro time, fornecedores pros freelas.
    const [users, freelas] = await Promise.all([
      supabase.from('app_users').select('id, full_name, job_title').in('id', userIds),
      supabase.from('fornecedores').select('id, nome').in('id', userIds),
    ]);
    const nomes = new Map<string, { nome: string; cargo: string | null; freela: boolean }>();
    for (const u of users.data || []) nomes.set(u.id, { nome: u.full_name, cargo: (u as any).job_title || null, freela: false });
    for (const f of freelas.data || []) if (!nomes.has(f.id)) nomes.set(f.id, { nome: (f as any).nome, cargo: 'Freelancer', freela: true });

    const lista: Pessoa[] = userIds
      .filter(id => nomes.has(id))
      .map(id => {
        const meta = nomes.get(id)!;
        const p = porPessoa.get(id)!;
        return { id, nome: meta.nome, cargo: meta.cargo, freela: meta.freela || p.freela, tarefas: p.tarefas.size, abertas: p.abertas };
      })
      .sort((a, b) => b.tarefas - a.tarefas || a.nome.localeCompare(b.nome, 'pt-BR'));
    setPessoas(lista);
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow" /></div>;

  const fixos = pessoas.filter(p => !p.freela);
  const freelas = pessoas.filter(p => p.freela);

  const CardPessoa = ({ p }: { p: Pessoa }) => (
    <div className="card p-4 flex items-center gap-3">
      <div className={clsx('w-11 h-11 rounded-full grid place-items-center text-sm font-black flex-shrink-0',
        p.freela ? 'bg-purple-500/15 text-purple-400' : 'bg-lumos-yellow/15 text-lumos-yellow')}>
        {p.nome.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-black truncate">{p.nome}</p>
        <p className="text-[11px] text-lumos-text-secondary truncate">{p.cargo || (p.freela ? 'Freelancer' : 'Equipe')}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[15px] font-black tabular-nums leading-none">{p.tarefas}</p>
        <p className="text-[9.5px] text-lumos-text-secondary uppercase font-bold">
          {p.abertas > 0 ? `${p.abertas} aberta${p.abertas > 1 ? 's' : ''}` : 'tudo entregue'}
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {pessoas.length === 0 ? (
        <div className="card p-8 text-center">
          <Users2 className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" />
          <p className="text-sm font-bold">Ninguém alocado ainda.</p>
          <p className="text-xs text-lumos-text-secondary mt-1 max-w-md mx-auto">
            A equipe aparece aqui sozinha conforme as tarefas ganham responsáveis e colaboradores, essa é a ficha técnica de quem realmente está no projeto.
          </p>
        </div>
      ) : (
        <>
          {fixos.length > 0 && (
            <div>
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary mb-2">Equipe Lumos · {fixos.length}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">{fixos.map(p => <CardPessoa key={p.id} p={p} />)}</div>
            </div>
          )}
          {freelas.length > 0 && (
            <div>
              <p className="text-[9.5px] font-black uppercase tracking-widest text-lumos-text-secondary mb-2">Freelancers · {freelas.length}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">{freelas.map(p => <CardPessoa key={p.id} p={p} />)}</div>
            </div>
          )}
          <p className="text-[10.5px] text-lumos-text-secondary">
            Montada a partir das tarefas do projeto: responsáveis e colaboradores entram sozinhos, com a carga de cada um.
          </p>
        </>
      )}
    </div>
  );
}
