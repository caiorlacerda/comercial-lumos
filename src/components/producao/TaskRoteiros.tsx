import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Link2, Loader2, Plus, ScrollText, Unlink } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';
import QuickForm, { type QFField } from '@/components/common/QuickForm';
import { OPCOES_ROTEIRO, etapaRoteiro } from '@/lib/roteiroStatus';

/**
 * ROTEIRO DENTRO DA TAREFA.
 *
 * O roteiro vivia solto na aba Roteiros do projeto: dava pra ver que o projeto
 * tem seis, mas não qual é o DESTA tarefa. Quem ia editar abria a tarefa e
 * caçava o link no Docs, no WhatsApp ou perguntando pra alguém.
 *
 * Aqui ele aparece junto do resto da tarefa, com a etapa à mão — nas mesmas
 * palavras da tarefa, inclusive "Ajustes", que é o que avisa que alguém tem
 * que escrever uma nova versão antes de a edição começar.
 *
 * Uma tarefa pode ter mais de um roteiro (versão em 30s e em 60s, por exemplo),
 * então isto é uma lista, não um campo só.
 */

interface Roteiro { id: string; nome: string; url: string; status: string; task_id: string | null }

interface Props {
  projectId: string;
  taskId: string;
  canManage: boolean;
}

export default function TaskRoteiros({ projectId, taskId, canManage }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const [todos, setTodos] = useState<Roteiro[]>([]);
  const [loading, setLoading] = useState(true);
  const [semColuna, setSemColuna] = useState(false);
  const [qf, setQf] = useState<null | { title: string; fields: QFField[]; submitLabel?: string; onSubmit: (v: Record<string, string>) => void }>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('project_roteiros')
      .select('id, nome, url, status, task_id')
      .eq('project_id', projectId).order('ordem').order('created_at');
    // Sem a coluna task_id (migration não rodou) o bloco some em vez de mostrar
    // uma lista que nunca vai vincular nada.
    if (error) { setSemColuna(true); setLoading(false); return; }
    setTodos((data as Roteiro[]) || []);
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const meus = todos.filter(r => r.task_id === taskId);
  const livres = todos.filter(r => !r.task_id);

  const vincular = async (id: string) => {
    if (!id) return;
    setTodos(prev => prev.map(r => (r.id === id ? { ...r, task_id: taskId } : r)));
    const { error } = await supabase.from('project_roteiros')
      .update({ task_id: taskId, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Não foi possível vincular.'); load(); }
  };

  const desvincular = async (r: Roteiro) => {
    setTodos(prev => prev.map(x => (x.id === r.id ? { ...x, task_id: null } : x)));
    const { error } = await supabase.from('project_roteiros')
      .update({ task_id: null, updated_at: new Date().toISOString() }).eq('id', r.id);
    // Desvincular solta o vínculo; o roteiro continua na aba Roteiros do
    // projeto. Não é excluir, e o texto do menu diz isso.
    if (error) { toast.error('Não foi possível desvincular.'); load(); }
  };

  const mudarStatus = async (r: Roteiro, status: string) => {
    setTodos(prev => prev.map(x => (x.id === r.id ? { ...x, status } : x)));
    const { error } = await supabase.from('project_roteiros')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) { toast.error('Não foi possível mudar o status.'); load(); }
  };

  const criar = () => setQf({
    title: 'Novo roteiro desta tarefa', submitLabel: 'Adicionar',
    fields: [
      { key: 'nome', label: 'Nome do roteiro', placeholder: 'Ex.: Filme principal 60s', required: true },
      { key: 'url', label: 'Link do Google Docs', placeholder: 'https://docs.google.com/…', required: true },
    ],
    onSubmit: async v => {
      if (!/^https?:\/\/\S+$/.test(v.url.trim())) { toast.error('Cole o link completo, começando com https://'); return; }
      const { error } = await supabase.from('project_roteiros').insert([{
        project_id: projectId, task_id: taskId, nome: v.nome.trim(), url: v.url.trim(),
        created_by: profile?.id || null,
      }]);
      if (error) { toast.error('Não foi possível adicionar.'); return; }
      toast.success('Roteiro adicionado ✓');
      load();
    },
  });

  if (semColuna) return null;

  return (
    <div className="space-y-2">
      <span className="text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary">Roteiro</span>

      {loading ? (
        <div className="p-3 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-lumos-yellow" /></div>
      ) : (
        <div className="space-y-2">
          {meus.map(r => (
            <div key={r.id} className="flex items-center gap-2 p-2.5 rounded-lumos border border-lumos-border bg-lumos-bg/40">
              <span className="w-8 h-8 rounded bg-lumos-yellow/10 text-lumos-yellow grid place-items-center flex-shrink-0">
                <ScrollText className="w-4 h-4" />
              </span>
              <a href={r.url} target="_blank" rel="noopener noreferrer"
                className="min-w-0 flex-1 text-xs font-bold text-lumos-text-primary hover:text-lumos-yellow truncate flex items-center gap-1.5">
                {r.nome} <ExternalLink className="w-3 h-3 text-lumos-text-secondary flex-shrink-0" />
              </a>
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
              {canManage && (
                <button type="button" onClick={() => desvincular(r)} title="Desvincular da tarefa (o roteiro continua no projeto)"
                  className="p-1.5 rounded-lumos border border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary flex-shrink-0">
                  <Unlink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}

          {canManage && (
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={criar}
                className="h-8 px-3 rounded-lumos border border-dashed border-lumos-border hover:border-lumos-yellow/60 text-[11px] font-bold text-lumos-text-secondary hover:text-lumos-text-primary flex items-center gap-1.5 transition-colors">
                <Plus className="w-3.5 h-3.5" /> {meus.length ? 'Outro roteiro' : 'Roteiro desta tarefa'}
              </button>
              {livres.length > 0 && (
                <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
                  <Link2 className="w-3.5 h-3.5 text-lumos-text-secondary flex-shrink-0" />
                  <Select value="" onChange={vincular} className="input-lumos h-8 text-[11px] py-0 flex-1"
                    searchable={livres.length > 6} searchPlaceholder="Buscar roteiro…"
                    options={[{ value: '', label: 'ou vincular um roteiro já criado…' },
                      ...livres.map(r => ({ value: r.id, label: r.nome }))]} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {qf && <QuickForm title={qf.title} fields={qf.fields} submitLabel={qf.submitLabel} onSubmit={qf.onSubmit} onClose={() => setQf(null)} />}
    </div>
  );
}
