import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';
import type { Item } from '@/lib/cronograma';

/**
 * Liga um item do cronograma a um projeto e, se quiser, a uma tarefa dele. O texto do item não muda:
 * o vínculo só aparece como um atalho (nome do projeto) embaixo dele, que abre o projeto.
 */

export interface Vinculo { project: { id: string; name: string }; task: { id: string; titulo: string } | null }

export default function VincularItemModal({ item, onClose, onSalvar }: {
  item: Item;
  onClose: () => void;
  onSalvar: (vinculo: Vinculo) => Promise<void> | void;
}) {
  const [projetos, setProjetos] = useState<{ id: string; name: string; status: string }[]>([]);
  const [tarefas, setTarefas] = useState<{ id: string; titulo: string }[]>([]);
  const [projetoId, setProjetoId] = useState(item.project_id || '');
  const [tarefaId, setTarefaId] = useState(item.task_id || '');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    supabase.from('projects').select('id, name, status').order('status').order('created_at', { ascending: false })
      .then(({ data }) => setProjetos((data as any[]) || []));
  }, []);

  useEffect(() => {
    if (!projetoId) { setTarefas([]); return; }
    let vivo = true;
    supabase.from('project_tasks').select('id, titulo').eq('project_id', projetoId).is('deleted_at', null)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (vivo) setTarefas((data as any[]) || []); });
    return () => { vivo = false; };
  }, [projetoId]);

  const salvar = async () => {
    const projeto = projetos.find(p => p.id === projetoId);
    if (!projeto) return;
    const tarefa = tarefas.find(t => t.id === tarefaId) || null;
    setSalvando(true);
    await onSalvar({ project: { id: projeto.id, name: projeto.name }, task: tarefa });
    setSalvando(false);
  };

  return (
    <Modal isOpen onClose={onClose} title="Vincular a projeto/tarefa">
      <div className="space-y-4">
        <p className="text-xs text-lumos-text-secondary whitespace-pre-wrap break-words border-l-2 border-lumos-yellow/60 pl-2.5">{item.texto}</p>
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Projeto</label>
          <Select value={projetoId} onChange={v => { setProjetoId(v); setTarefaId(''); }} searchable placeholder="Escolha um projeto" className="input-lumos w-full"
            options={projetos.map(p => ({ value: p.id, label: p.status === 'concluido' ? `${p.name} · encerrado` : p.name }))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase text-lumos-text-secondary tracking-wider block">Tarefa (opcional)</label>
          <Select value={tarefaId} onChange={setTarefaId} searchable placeholder={projetoId ? 'Nenhuma tarefa específica' : 'Escolha o projeto primeiro'} className="input-lumos w-full"
            options={[{ value: '', label: 'Nenhuma tarefa específica' }, ...tarefas.map(t => ({ value: t.id, label: t.titulo }))]} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="h-10 px-4 text-xs font-black rounded-lumos border border-lumos-border text-lumos-text-primary hover:border-lumos-yellow/50">Cancelar</button>
          <button disabled={!projetoId || salvando} onClick={salvar} className="btn-primary h-10 px-5 text-xs font-black disabled:opacity-50">Vincular</button>
        </div>
      </div>
    </Modal>
  );
}
