import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';
import QuickForm, { type QFField } from '@/components/common/QuickForm';
import { OPCOES_ROTEIRO, etapaRoteiro } from '@/lib/roteiroStatus';

/**
 * Roteiros do projeto, do jeito Lumos: cada roteiro é um link do Google Docs
 * com nome e status (em criação, em revisão, aprovado). O que entra aqui
 * alimenta a aba Roteiros das Ordens do Dia e a etapa de roteiro do Status.
 */

interface Roteiro { id: string; nome: string; url: string; status: string; created_at: string; task_id: string | null }

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

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('project_roteiros')
      .select('id, nome, url, status, created_at, task_id')
      .eq('project_id', projectId).order('ordem').order('created_at');
    if (!error) {
      setRoteiros((data as Roteiro[]) || []);
      setLoading(false);
      return;
    }
    // A coluna task_id pode ainda não existir (migration não rodada). Sem esta
    // segunda tentativa, a lista inteira sumiria da tela por causa de UM campo
    // novo — e roteiro que some assusta muito mais do que vínculo que falta.
    const { data: antigo, error: erroAntigo } = await supabase.from('project_roteiros')
      .select('id, nome, url, status, created_at')
      .eq('project_id', projectId).order('ordem').order('created_at');
    if (erroAntigo) setFaltaMigracao(true);
    else setSemVinculo(true);
    setRoteiros(((antigo as any[]) || []).map(r => ({ ...r, task_id: null })));
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

  if (loading) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-lumos-yellow" /></div>;

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
            Escreva no Google Docs como sempre, cole o link aqui, e o roteiro passa a viver no projeto: entra nas Ordens do Dia e marca a etapa de roteiro no Status.
          </p>
        </div>
      ) : roteiros.length > 0 && (
        <div className="card divide-y divide-lumos-border/60 overflow-hidden">
          {roteiros.map(r => (
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
                  Criado em {new Date(r.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })} · Google Docs
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
          Os roteiros daqui aparecem na aba Roteiros das Ordens do Dia e, com o primeiro criado, a etapa "Criação do roteiro" do Status marca sozinha; com um aprovado, a "Roteiro aprovado" também.
        </p>
      )}

      {qf && <QuickForm title={qf.title} fields={qf.fields} submitLabel={qf.submitLabel} onSubmit={qf.onSubmit} onClose={() => setQf(null)} />}
    </div>
  );
}
