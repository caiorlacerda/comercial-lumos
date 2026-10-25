import { useCallback, useEffect, useMemo, useState } from 'react';
import { EsqueletoItens } from '@/components/ui/Esqueleto';
import { ExternalLink, Pencil, Plus, ScrollText, Search, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';
import QuickForm, { type QFField } from '@/components/common/QuickForm';
import { OPCOES_ROTEIRO, ROTEIRO_STATUS, etapaRoteiro } from '@/lib/roteiroStatus';
import { dataEnvio, haQuanto } from '@/lib/dataEnvio';

/**
 * Roteiros do projeto, do jeito Lumos: cada roteiro é um link do Google Docs
 * com nome e status (em criação, em revisão, aprovado). O que entra aqui
 * alimenta a aba Roteiros das Ordens do Dia e a etapa de roteiro do Status.
 */

interface Roteiro {
  id: string; nome: string; url: string; status: string; created_at: string; task_id: string | null;
  updated_at?: string | null;
  /** Quem adicionou (app_users). Vazio quando o roteiro é antigo ou a pessoa saiu. */
  author?: { full_name: string | null } | null;
}

type Ordem = 'recentes' | 'antigas' | 'mexidas' | 'nome' | 'tarefa' | 'etapa';

interface Props {
  projectId: string;
  canManage: boolean;
  /** Tarefas do projeto, pra ligar o roteiro à tarefa que ele atende. */
  tasks?: { id: string; titulo: string }[];
}

export default function ProjectRoteiros({ projectId, canManage, tasks = [] }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [roteiros, setRoteiros] = useState<Roteiro[]>([]);
  const [faltaMigracao, setFaltaMigracao] = useState(false);
  /** Banco ainda sem a coluna task_id: a lista funciona, só não vincula. */
  const [semVinculo, setSemVinculo] = useState(false);
  const [qf, setQf] = useState<null | { title: string; fields: QFField[]; submitLabel?: string; onSubmit: (v: Record<string, string>) => void }>(null);

  /**
   * MESMA VISÃO DE ENTREGAS: quem adicionou, quando, e filtro por etapa/tarefa.
   * A ordem fica guardada no navegador (jeito de trabalhar de cada um); busca e
   * filtros não, porque são do projeto aberto agora.
   */
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [taskFilter, setTaskFilter] = useState('all'); // 'all' | 'none' | id da tarefa
  const [ordem, setOrdem] = useState<Ordem>(() => {
    try { return (localStorage.getItem('lumos_roteiros_ordem') as Ordem) || 'recentes'; } catch { return 'recentes'; }
  });
  useEffect(() => { try { localStorage.setItem('lumos_roteiros_ordem', ordem); } catch { /* ignore */ } }, [ordem]);
  useEffect(() => { setSearch(''); setStatusFilter('all'); setTaskFilter('all'); }, [projectId]);

  const load = useCallback(async () => {
    // Cada tentativa tira um campo que pode ainda não existir no banco (migration
    // não rodada), pra lista nunca sumir por causa de UM campo novo — roteiro que
    // some assusta muito mais do que vínculo ou autor que faltam.
    const base = 'id, nome, url, status, created_at';
    const tentativas: { cols: string; vinculo: boolean }[] = [
      { cols: `${base}, updated_at, task_id, author:app_users(full_name)`, vinculo: true },
      { cols: `${base}, task_id`, vinculo: true },
      { cols: base, vinculo: false },
    ];
    for (let i = 0; i < tentativas.length; i++) {
      const { data, error } = await supabase.from('project_roteiros')
        .select(tentativas[i].cols)
        .eq('project_id', projectId).order('ordem').order('created_at');
      if (!error) {
        setSemVinculo(!tentativas[i].vinculo);
        setRoteiros(((data as any[]) || []).map(r => ({ task_id: null, ...r })));
        setLoading(false);
        return;
      }
    }
    setFaltaMigracao(true);
    setRoteiros([]);
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const validarUrl = (u: string) => /^https?:\/\/\S+$/.test(u.trim());

  const criar = () => setQf({
    title: 'Novo roteiro', submitLabel: 'Adicionar',
    fields: [
      { key: 'nome', label: 'Nome do roteiro', placeholder: 'Ex.: Filme principal 60s', required: true },
      { key: 'url', label: 'Link do Google Docs', placeholder: 'https://docs.google.com/…', required: true },
    ],
    onSubmit: async v => {
      if (!validarUrl(v.url)) { toast.error('Cole o link completo, começando com https://'); return; }
      const { error } = await supabase.from('project_roteiros').insert([{
        project_id: projectId, nome: v.nome.trim(), url: v.url.trim(), created_by: profile?.id || null,
      }]);
      if (error) { toast.error('Não foi possível adicionar. A migração dos roteiros já rodou?'); return; }
      toast.success('Roteiro adicionado ✓');
      load();
    },
  });

  const editar = (r: Roteiro) => setQf({
    title: 'Editar roteiro',
    fields: [
      { key: 'nome', label: 'Nome do roteiro', value: r.nome, required: true },
      { key: 'url', label: 'Link do Google Docs', value: r.url, required: true },
    ],
    onSubmit: async v => {
      if (!validarUrl(v.url)) { toast.error('Cole o link completo, começando com https://'); return; }
      const { error } = await supabase.from('project_roteiros')
        .update({ nome: v.nome.trim(), url: v.url.trim(), updated_at: new Date().toISOString() }).eq('id', r.id);
      if (error) { toast.error('Não foi possível salvar.'); return; }
      load();
    },
  });

  const mudarStatus = async (r: Roteiro, status: string) => {
    setRoteiros(prev => prev.map(x => x.id === r.id ? { ...x, status } : x));
    const { error } = await supabase.from('project_roteiros')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) { toast.error('Não foi possível mudar o status.'); load(); }
  };

  const vincular = async (r: Roteiro, taskId: string) => {
    const alvo = taskId || null;
    setRoteiros(prev => prev.map(x => x.id === r.id ? { ...x, task_id: alvo } : x));
    const { error } = await supabase.from('project_roteiros')
      .update({ task_id: alvo, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) {
      toast.error(/task_id|column/i.test(error.message)
        ? 'Falta rodar a migration 2026093320.' : 'Não foi possível vincular.');
      load();
    }
  };

  const excluir = async (r: Roteiro) => {
    const { error } = await supabase.from('project_roteiros').delete().eq('id', r.id);
    if (error) { toast.error('Não foi possível excluir.'); return; }
    load();
  };

  const tituloDe = useCallback((id: string | null) => tasks.find(t => t.id === id)?.titulo || '', [tasks]);
  const ordemDaEtapa = (st: string) => ROTEIRO_STATUS.findIndex(e => e.value === etapaRoteiro(st).value);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    roteiros.forEach(r => { const k = etapaRoteiro(r.status).value; c[k] = (c[k] || 0) + 1; });
    return c;
  }, [roteiros]);

  const taskCounts = useMemo(() => {
    const c: Record<string, number> = {};
    roteiros.forEach(r => { const k = r.task_id && tasks.some(t => t.id === r.task_id) ? r.task_id : '__sem__'; c[k] = (c[k] || 0) + 1; });
    return c;
  }, [roteiros, tasks]);

  const mostrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lista = roteiros.filter(r => {
      if (statusFilter !== 'all' && etapaRoteiro(r.status).value !== statusFilter) return false;
      if (taskFilter === 'none' && r.task_id && tasks.some(t => t.id === r.task_id)) return false;
      if (taskFilter !== 'all' && taskFilter !== 'none' && r.task_id !== taskFilter) return false;
      if (q && !`${r.nome} ${tituloDe(r.task_id)} ${r.author?.full_name || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const t = (x: string | null | undefined) => (x ? new Date(x).getTime() : 0);
    return [...lista].sort((a, b) => {
      switch (ordem) {
        case 'antigas': return t(a.created_at) - t(b.created_at);
        case 'mexidas': return t(a.updated_at || a.created_at) - t(b.updated_at || b.created_at);
        case 'nome': return a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true });
        case 'tarefa': return (tituloDe(a.task_id) || '\uffff').localeCompare(tituloDe(b.task_id) || '\uffff', 'pt-BR') || t(b.created_at) - t(a.created_at);
        case 'etapa': return ordemDaEtapa(a.status) - ordemDaEtapa(b.status) || t(b.created_at) - t(a.created_at);
        default: return t(b.created_at) - t(a.created_at);
      }
    });
  }, [roteiros, search, statusFilter, taskFilter, ordem, tasks, tituloDe]);

  if (loading) return <EsqueletoItens n={4} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="text-xs font-black uppercase tracking-widest text-lumos-text-primary flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-lumos-yellow" /> Roteiros
          {roteiros.length > 0 && <span className="text-lumos-text-secondary font-bold normal-case tracking-normal">· {roteiros.length}</span>}
        </p>
        {canManage && (
          <button type="button" onClick={criar}
            className="ml-auto btn-primary h-9 px-4 text-xs font-black flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Novo roteiro
          </button>
        )}
      </div>

      {/* Busca + filtros: os mesmos de Entregas */}
      {roteiros.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[170px] max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-lumos-text-secondary pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar roteiro, tarefa ou autor…" className="input-lumos w-full h-9 pl-9 text-xs" />
          </div>
          <div className="w-44 flex-shrink-0">
            <Select value={statusFilter} onChange={setStatusFilter} ariaLabel="Filtrar por etapa" menuClassName="min-w-[190px]"
              className={clsx('w-full h-9 px-3 rounded-lumos border bg-lumos-surface text-[11px] font-bold transition-colors',
                statusFilter !== 'all' ? 'border-lumos-yellow/60 text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/40')}
              options={[{ value: 'all', label: 'Todas as etapas' },
                ...ROTEIRO_STATUS.filter(e => (statusCounts[e.value] || 0) > 0)
                  .map(e => ({ value: e.value, label: `${e.label} · ${statusCounts[e.value]}` }))]} />
          </div>
          {!semVinculo && tasks.length > 0 && (
            <div className="w-52 flex-shrink-0">
              <Select value={taskFilter} onChange={setTaskFilter} ariaLabel="Filtrar por tarefa" menuClassName="min-w-[240px]"
                searchable={tasks.length > 6} searchPlaceholder="Buscar tarefa…"
                className={clsx('w-full h-9 px-3 rounded-lumos border bg-lumos-surface text-[11px] font-bold transition-colors',
                  taskFilter !== 'all' ? 'border-lumos-yellow/60 text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/40')}
                options={[
                  { value: 'all', label: 'Todas as tarefas' },
                  ...tasks.filter(t => (taskCounts[t.id] || 0) > 0).map(t => ({ value: t.id, label: `${t.titulo} · ${taskCounts[t.id]}` })),
                  ...(taskCounts['__sem__'] ? [{ value: 'none', label: `Sem tarefa · ${taskCounts['__sem__']}` }] : []),
                ]} />
            </div>
          )}
          <div className="w-52 flex-shrink-0" title="Ordem da lista">
            <Select value={ordem} onChange={v => setOrdem(v as Ordem)} ariaLabel="Ordenar os roteiros" menuClassName="min-w-[210px]"
              className={clsx('w-full h-9 px-3 rounded-lumos border bg-lumos-surface text-[11px] font-bold transition-colors',
                ordem !== 'recentes' ? 'border-lumos-yellow/60 text-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary hover:border-lumos-yellow/40')}
              options={[
                { value: 'recentes', label: 'Mais recentes primeiro' },
                { value: 'antigas', label: 'Mais antigos primeiro' },
                { value: 'mexidas', label: 'Mexidos por último' },
                { value: 'nome', label: 'Nome (A a Z)' },
                { value: 'tarefa', label: 'Agrupados por tarefa' },
                { value: 'etapa', label: 'Etapa do fluxo' },
              ]} />
          </div>
        </div>
      )}

      {faltaMigracao && (
        <div className="rounded-lumos border border-amber-500/50 bg-amber-500/10 px-4 py-3">
          <p className="text-[12.5px] text-amber-800 dark:text-amber-200"><b>Falta rodar a migração dos roteiros no banco.</b> Depois dela, é só recarregar.</p>
        </div>
      )}

      {roteiros.length === 0 && !faltaMigracao ? (
        <div className="card p-8 text-center">
          <ScrollText className="w-8 h-8 text-lumos-text-secondary/30 mx-auto mb-3" />
          <p className="text-sm font-bold text-lumos-text-primary">Nenhum roteiro neste projeto.</p>
          <p className="text-xs text-lumos-text-secondary mt-1 max-w-md mx-auto">
            Escreva no Google Docs como sempre, cole o link aqui, e o roteiro passa a viver no projeto e entra nas Ordens do Dia.
          </p>
        </div>
      ) : roteiros.length > 0 && mostrados.length === 0 ? (
        <p className="text-center py-8 text-xs text-lumos-text-secondary italic">Nenhum roteiro com essa busca/filtro.</p>
      ) : roteiros.length > 0 && (
        <div className="card divide-y divide-lumos-border/60 overflow-hidden">
          {mostrados.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-lumos-text-primary/5 transition-colors group">
              <span className="w-9 h-9 rounded bg-lumos-yellow/10 text-lumos-yellow grid place-items-center flex-shrink-0">
                <ScrollText className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <a href={r.url} target="_blank" rel="noopener noreferrer"
                  className="text-[13px] font-black text-lumos-text-primary hover:text-lumos-yellow truncate flex items-center gap-1.5">
                  {r.nome} <ExternalLink className="w-3 h-3 text-lumos-text-secondary flex-shrink-0" />
                </a>
                <p className="text-[10.5px] text-lumos-text-secondary">
                  Google Docs · <span title={`Adicionado ${haQuanto(r.created_at)}`}>Enviado{r.author?.full_name?.trim() ? ` por ${r.author.full_name.trim()}` : ''} · {dataEnvio(r.created_at)}</span>
                  {r.updated_at && new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60000 && (
                    <span title="Última vez que o nome, o link, a etapa ou a tarefa mudou"> · mexido {haQuanto(r.updated_at)}</span>
                  )}
                </p>
              </div>

              {/* A qual tarefa este roteiro atende. Sem isso, quem abria a tarefa
                  tinha que caçar o link no Docs ou perguntar pra alguém. */}
              {tasks.length > 0 && !semVinculo && (
                <div className="flex-shrink-0 w-[190px] hidden md:block">
                  {canManage ? (
                    <Select value={r.task_id || ''} onChange={v => void vincular(r, v)} align="right"
                      searchable={tasks.length > 6} searchPlaceholder="Buscar tarefa…"
                      menuClassName="min-w-[240px]"
                      className={clsx('w-full h-7 rounded-lumos border px-2.5 text-[10.5px] font-bold truncate',
                        r.task_id ? 'border-lumos-border text-lumos-text-primary' : 'border-dashed border-lumos-border text-lumos-text-secondary')}
                      options={[{ value: '', label: 'Sem tarefa' }, ...tasks.map(t => ({ value: t.id, label: t.titulo }))]} />
                  ) : (
                    <span className="block text-[10.5px] font-bold text-lumos-text-secondary truncate">
                      {tasks.find(t => t.id === r.task_id)?.titulo || 'Sem tarefa'}
                    </span>
                  )}
                </div>
              )}

              {/* Sempre visíveis: escondidas no hover, ninguém achava como
                  renomear — e no celular não havia hover pra achar. */}
              {canManage && (
                <span className="flex items-center gap-0.5 flex-shrink-0">
                  <button type="button" onClick={() => editar(r)} className="p-1.5 text-lumos-text-secondary hover:text-lumos-yellow" title="Renomear ou trocar o link"><Pencil className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => excluir(r)} className="p-1.5 text-lumos-text-secondary hover:text-red-400" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
                </span>
              )}
              <div className="flex-shrink-0 w-[150px]">
                {canManage ? (
                  <Select value={etapaRoteiro(r.status).value} onChange={v => void mudarStatus(r, v)} align="right"
                    className={clsx('w-full h-7 rounded-full border text-[10px] font-black px-3', etapaRoteiro(r.status).chip)}
                    options={OPCOES_ROTEIRO} />
                ) : (
                  <span className={clsx('inline-flex items-center justify-center w-full h-7 rounded-full border text-[10px] font-black', etapaRoteiro(r.status).chip)}>
                    {etapaRoteiro(r.status).label}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {roteiros.length > 0 && (
        <p className="text-[10.5px] text-lumos-text-secondary">
          Os roteiros daqui aparecem na aba Roteiros das Ordens do Dia.
        </p>
      )}

      {qf && <QuickForm title={qf.title} fields={qf.fields} submitLabel={qf.submitLabel} onSubmit={qf.onSubmit} onClose={() => setQf(null)} />}
    </div>
  );
}
