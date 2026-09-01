import { useCallback, useEffect, useMemo, useState } from 'react';
import { Headset, Loader2, Plus, Search, Trash2, Users2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Modal from '@/components/common/Modal';

/**
 * Ficha técnica do projeto: gente cadastrada à mão (project_members, do time
 * interno ou da lista de fornecedores) + gente derivada das tarefas. Quem
 * chegou pelas tarefas ganha o selo "via tarefas" e não se remove por aqui.
 */

interface Pessoa {
  id: string; nome: string; cargo: string | null; freela: boolean;
  tarefas: number; abertas: number;
  memberId?: string; // presente = cadastrada à mão, dá pra remover
  viaTarefas: boolean;
  atendimento: boolean; // marca lida pela automação atendimento_com_cliente
}
interface Candidato { id: string; nome: string; cargo: string | null; freela: boolean }

interface Props { projectId: string; canManage: boolean }

export default function ProjectEquipe({ projectId, canManage }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [addAberto, setAddAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [funcao, setFuncao] = useState('');
  const [selecionado, setSelecionado] = useState<Candidato | null>(null);
  const [salvando, setSalvando] = useState(false);
  // A coluna e_atendimento chegou na migração 2026093340. Enquanto ela não
  // rodar, a marca simplesmente não aparece e o resto da ficha funciona igual.
  const [atendimentoOk, setAtendimentoOk] = useState(false);
  const [marcando, setMarcando] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [tasksQ, membersQ] = await Promise.all([
      supabase.from('project_tasks')
        .select('id, status, responsavel_id, responsavel_freela_id')
        .eq('project_id', projectId).is('deleted_at', null),
      // select('*') de propósito: pedir e_atendimento pelo nome derrubaria a
      // consulta inteira num banco onde a migração 2026093340 ainda não rodou.
      supabase.from('project_members')
        .select('*').eq('project_id', projectId),
    ]);
    const tasks = tasksQ.data || [];
    const members = membersQ.data || [];
    setAtendimentoOk(!!members.length && 'e_atendimento' in members[0]);
    const taskIds = tasks.map(t => t.id);

    const { data: collabs } = taskIds.length
      ? await supabase.from('task_collaborators').select('task_id, user_id').in('task_id', taskIds)
      : { data: [] as { task_id: string; user_id: string }[] };

    // Carga por pessoa a partir das tarefas.
    const carga = new Map<string, { tarefas: Set<string>; abertas: number; freela: boolean }>();
    const add = (id: string | null, taskId: string, aberta: boolean, freela: boolean) => {
      if (!id) return;
      const p = carga.get(id) || { tarefas: new Set<string>(), abertas: 0, freela };
      if (!p.tarefas.has(taskId)) { p.tarefas.add(taskId); if (aberta) p.abertas++; }
      carga.set(id, p);
    };
    const ABERTAS = ['na_fila', 'roteiro', 'captacao', 'em_progresso', 'revisao_interna', 'revisao_cliente', 'alteracoes'];
    for (const t of tasks) {
      const aberta = ABERTAS.includes(t.status);
      add(t.responsavel_id, t.id, aberta, false);
      add(t.responsavel_freela_id, t.id, aberta, true);
    }
    for (const c of collabs || []) {
      const t = tasks.find(x => x.id === c.task_id);
      add(c.user_id, c.task_id, t ? ABERTAS.includes(t.status) : false, false);
    }

    // Universo de ids: das tarefas + dos cadastrados à mão.
    const idsTarefas = [...carga.keys()];
    const idsMembros = members.map(m => (m.user_id || m.freela_id) as string);
    const todos = [...new Set([...idsTarefas, ...idsMembros])];
    if (!todos.length) { setPessoas([]); setLoading(false); return; }

    const [users, freelas] = await Promise.all([
      supabase.from('app_users').select('id, full_name, job_title').in('id', todos),
      supabase.from('fornecedores').select('id, nome').in('id', todos),
    ]);
    const nomes = new Map<string, { nome: string; cargo: string | null; freela: boolean }>();
    for (const u of users.data || []) nomes.set(u.id, { nome: u.full_name, cargo: (u as any).job_title || null, freela: false });
    for (const f of freelas.data || []) if (!nomes.has(f.id)) nomes.set(f.id, { nome: (f as any).nome, cargo: 'Freelancer', freela: true });

    const lista: Pessoa[] = todos.filter(id => nomes.has(id)).map(id => {
      const meta = nomes.get(id)!;
      const c = carga.get(id);
      const m = members.find(x => (x.user_id || x.freela_id) === id);
      return {
        id, nome: meta.nome,
        cargo: m?.funcao || meta.cargo,
        freela: meta.freela,
        tarefas: c?.tarefas.size || 0,
        abertas: c?.abertas || 0,
        memberId: m?.id,
        viaTarefas: !!c,
        atendimento: !!(m as any)?.e_atendimento,
      };
    }).sort((a, b) => b.tarefas - a.tarefas || a.nome.localeCompare(b.nome, 'pt-BR'));
    setPessoas(lista);
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  // Candidatos do seletor: time ativo + fornecedores, filtrados pela busca.
  useEffect(() => {
    if (!addAberto) return;
    (async () => {
      const [users, freelas] = await Promise.all([
        supabase.from('app_users').select('id, full_name, job_title').eq('status', 'ativo').order('full_name'),
        supabase.from('fornecedores').select('id, nome').order('nome'),
      ]);
      const lista: Candidato[] = [
        ...(users.data || []).map(u => ({ id: u.id, nome: u.full_name, cargo: (u as any).job_title || null, freela: false })),
        ...(freelas.data || []).map(f => ({ id: f.id, nome: (f as any).nome, cargo: 'Freelancer', freela: true })),
      ];
      setCandidatos(lista);
    })();
  }, [addAberto]);

  const jaNoProjeto = useMemo(() => new Set(pessoas.map(p => p.id)), [pessoas]);
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return candidatos
      .filter(c => !jaNoProjeto.has(c.id))
      .filter(c => !t || c.nome.toLowerCase().includes(t) || (c.cargo || '').toLowerCase().includes(t))
      .slice(0, 30);
  }, [candidatos, busca, jaNoProjeto]);

  const adicionar = async () => {
    if (!selecionado) return;
    setSalvando(true);
    const { error } = await supabase.from('project_members').insert([{
      project_id: projectId,
      user_id: selecionado.freela ? null : selecionado.id,
      freela_id: selecionado.freela ? selecionado.id : null,
      funcao: funcao.trim() || null,
      added_by: profile?.id || null,
    }]);
    setSalvando(false);
    if (error) { toast.error('Não foi possível adicionar.'); return; }
    toast.success(`${selecionado.nome.split(' ')[0]} entrou na equipe do projeto ✓`);
    setSelecionado(null); setFuncao(''); setBusca(''); setAddAberto(false);
    load();
  };

  // A marca de atendimento do projeto. É separada da função (texto livre) de
  // propósito: é ela que a automação lê quando o vídeo vai pro cliente.
  const marcarAtendimento = async (p: Pessoa) => {
    if (!p.memberId) return;
    setMarcando(p.memberId);
    const { error } = await supabase.from('project_members')
      .update({ e_atendimento: !p.atendimento }).eq('id', p.memberId);
    setMarcando(null);
    if (error) { toast.error('Não foi possível salvar a marca de atendimento.'); return; }
    setPessoas(lista => lista.map(x => x.id === p.id ? { ...x, atendimento: !p.atendimento } : x));
    toast.success(p.atendimento
      ? `${p.nome.split(' ')[0]} não é mais o atendimento deste projeto`
      : `${p.nome.split(' ')[0]} é o atendimento deste projeto ✓`);
  };

  const remover = async (p: Pessoa) => {
    if (!p.memberId) return;
    const { error } = await supabase.from('project_members').delete().eq('id', p.memberId);
    if (error) { toast.error('Não foi possível remover.'); return; }
    load();
  };

  if (loading) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow" /></div>;

  const fixos = pessoas.filter(p => !p.freela);
  const freelas = pessoas.filter(p => p.freela);

  const CardPessoa = ({ p }: { p: Pessoa }) => (
    <div className="card p-4 flex items-center gap-3 group">
      <div className={clsx('w-11 h-11 rounded-full grid place-items-center text-sm font-black flex-shrink-0',
        p.freela ? 'bg-purple-500/15 text-purple-500' : 'bg-lumos-yellow/15 text-lumos-yellow')}>
        {p.nome.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-black truncate text-lumos-text-primary">{p.nome}</p>
        <p className="text-[11px] text-lumos-text-secondary truncate">
          {p.cargo || (p.freela ? 'Freelancer' : 'Equipe')}
          {p.viaTarefas && !p.memberId && <span className="ml-1.5 text-[9px] font-black uppercase text-lumos-text-secondary/70">· via tarefas</span>}
        </p>
        {/* Marca de atendimento: some inteira num banco sem a migração, e é só
            leitura pra quem não gere o projeto. Sempre visível, sem depender de
            passar o mouse, porque a ficha é muito usada no celular. */}
        {atendimentoOk && !p.freela && p.memberId && (canManage ? (
          <button type="button" onClick={() => marcarAtendimento(p)} disabled={marcando === p.memberId}
            title={p.atendimento
              ? 'Deixa de ser o atendimento: para de entrar sozinho na tarefa quando o vídeo vai pro cliente.'
              : 'Marca como atendimento: entra sozinho na tarefa e é avisado quando o vídeo vai pro cliente.'}
            className={clsx('mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border transition-colors disabled:opacity-50',
              p.atendimento
                ? 'bg-lumos-yellow/15 text-lumos-yellow border-lumos-yellow/30'
                : 'text-lumos-text-secondary border-lumos-border hover:border-lumos-yellow/40 hover:text-lumos-yellow')}>
            {marcando === p.memberId ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Headset className="w-2.5 h-2.5" />}
            Atendimento
          </button>
        ) : p.atendimento && (
          <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide bg-lumos-yellow/15 text-lumos-yellow border border-lumos-yellow/30">
            <Headset className="w-2.5 h-2.5" /> Atendimento
          </span>
        ))}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[15px] font-black tabular-nums leading-none text-lumos-text-primary">{p.tarefas}</p>
        <p className="text-[9.5px] text-lumos-text-secondary uppercase font-bold">
          {p.abertas > 0 ? `${p.abertas} aberta${p.abertas > 1 ? 's' : ''}` : p.tarefas > 0 ? 'tudo entregue' : 'sem tarefas'}
        </p>
      </div>
      {canManage && p.memberId && (
        <button type="button" onClick={() => remover(p)} title="Remover da equipe"
          className="p-1.5 rounded text-lumos-text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2">
          <Users2 className="w-4 h-4 text-lumos-yellow" /> Ficha técnica
          {pessoas.length > 0 && <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· {pessoas.length}</span>}
        </p>
        {canManage && (
          <button type="button" onClick={() => setAddAberto(true)}
            className="ml-auto btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Adicionar pessoa
          </button>
        )}
      </div>

      {pessoas.length === 0 ? (
        <div className="card p-8 text-center">
          <Users2 className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" />
          <p className="text-sm font-bold text-lumos-text-primary">Ninguém na equipe ainda.</p>
          <p className="text-xs text-lumos-text-secondary mt-1 max-w-md mx-auto">
            Adicione gente do time ou da lista de fornecedores, e quem ganhar tarefa no projeto entra sozinho.
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
            Quem tem o selo "via tarefas" entrou sozinho pelas tarefas do projeto; os demais foram adicionados aqui.
          </p>
          {atendimentoOk && (
            <p className="text-[10.5px] text-lumos-text-secondary flex items-start gap-1.5">
              <Headset className="w-3 h-3 text-lumos-yellow flex-shrink-0 mt-0.5" />
              <span>
                Marque "Atendimento" em quem cuida do cliente neste projeto: quando um vídeo daqui vai pra revisão do
                cliente, essa pessoa entra sozinha como colaboradora da tarefa e recebe o aviso, e sai quando todos os
                formatos da tarefa são aprovados. A função continua livre pra escrever o que quiser, a marca é coisa
                separada. Quem entrou só pelas tarefas precisa ser adicionado aqui antes de receber a marca.
              </span>
            </p>
          )}
        </>
      )}

      {/* Seletor de pessoa */}
      {addAberto && (
        <Modal isOpen onClose={() => { setAddAberto(false); setSelecionado(null); setBusca(''); setFuncao(''); }} title="Adicionar à equipe" maxWidth="max-w-md">
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary" />
              <input autoFocus className="input-lumos w-full h-10 pl-9 text-sm" placeholder="Buscar no time ou nos fornecedores…"
                value={busca} onChange={e => { setBusca(e.target.value); setSelecionado(null); }} />
            </div>

            <div className="border border-lumos-border rounded-lumos divide-y divide-lumos-border/60 max-h-64 overflow-y-auto custom-scrollbar">
              {filtrados.length === 0 ? (
                <p className="text-xs text-lumos-text-secondary italic text-center py-6">Ninguém encontrado fora do projeto.</p>
              ) : filtrados.map(c => (
                <button key={c.id} type="button" onClick={() => setSelecionado(c)}
                  className={clsx('w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    selecionado?.id === c.id ? 'bg-lumos-yellow/10' : 'hover:bg-lumos-text-primary/5')}>
                  <span className={clsx('w-7 h-7 rounded-full grid place-items-center text-[10px] font-black flex-shrink-0',
                    c.freela ? 'bg-purple-500/15 text-purple-500' : 'bg-lumos-yellow/15 text-lumos-yellow')}>
                    {c.nome.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold truncate text-lumos-text-primary">{c.nome}</span>
                    <span className="block text-[10px] text-lumos-text-secondary truncate">{c.cargo || (c.freela ? 'Freelancer' : 'Equipe')}</span>
                  </span>
                  <span className={clsx('text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full flex-shrink-0',
                    c.freela ? 'bg-purple-500/10 text-purple-500' : 'bg-lumos-yellow/10 text-lumos-yellow')}>
                    {c.freela ? 'Fornecedor' : 'Time'}
                  </span>
                </button>
              ))}
            </div>

            <div>
              <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">Função neste projeto (opcional)</label>
              <input className="input-lumos w-full h-10 mt-1 text-sm" placeholder="Ex.: Direção de fotografia"
                value={funcao} onChange={e => setFuncao(e.target.value)} />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setAddAberto(false); setSelecionado(null); }} className="ml-auto text-[11px] font-bold text-lumos-text-secondary px-2">Cancelar</button>
              <button type="button" onClick={adicionar} disabled={!selecionado || salvando}
                className="btn-primary h-9 px-5 text-xs font-black disabled:opacity-60 flex items-center gap-1.5">
                {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {selecionado ? `Adicionar ${selecionado.nome.split(' ')[0]}` : 'Adicionar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
