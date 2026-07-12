import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus, Trash2, ChevronUp, ChevronDown, GripVertical, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import Select from '@/components/ui/Select';
import { useConfirm } from '@/components/ui/useConfirm';

type Segmento = 'digital' | 'filme' | 'live';
interface TemplateTask { id: string; segmento: Segmento; titulo: string; descricao: string | null; prioridade: string; ordem: number; }

const SEGMENTS: { value: Segmento; label: string }[] = [
  { value: 'digital', label: 'Digital' },
  { value: 'filme', label: 'Filme' },
  { value: 'live', label: 'Live' },
];
const PRIORITY_OPTIONS = [
  { value: 'baixa', label: 'Baixa', dotClass: 'bg-blue-400' },
  { value: 'media', label: 'Média', dotClass: 'bg-amber-400' },
  { value: 'alta', label: 'Alta', dotClass: 'bg-red-400' },
];

export default function TemplatesTarefas() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [seg, setSeg] = useState<Segmento>('digital');
  const [items, setItems] = useState<TemplateTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (s: Segmento) => {
    setLoading(true);
    const { data } = await supabase.from('project_task_templates').select('*').eq('segmento', s).order('ordem', { ascending: true });
    setItems((data as TemplateTask[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(seg); }, [seg, load]);

  const addTask = async () => {
    const titulo = newTitle.trim();
    if (!titulo) return;
    setAdding(true);
    const ordem = (items.length ? Math.max(...items.map(i => i.ordem)) : 0) + 10;
    const { data, error } = await supabase.from('project_task_templates')
      .insert({ segmento: seg, titulo, prioridade: 'media', ordem }).select('*').single();
    setAdding(false);
    if (error) { toast.error('Não foi possível adicionar.'); return; }
    setItems(prev => [...prev, data as TemplateTask]);
    setNewTitle('');
  };

  const patch = async (id: string, fields: Partial<TemplateTask>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...fields } : i));
    const { error } = await supabase.from('project_task_templates').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error('Não foi possível salvar.'); load(seg); }
  };

  const remove = async (t: TemplateTask) => {
    if (!(await confirm({ message: `Excluir a tarefa "${t.titulo}" do template?`, confirmLabel: 'Excluir', danger: true }))) return;
    setItems(prev => prev.filter(i => i.id !== t.id));
    const { error } = await supabase.from('project_task_templates').delete().eq('id', t.id);
    if (error) { toast.error('Não foi possível excluir.'); load(seg); }
  };

  // Reordena trocando com o vizinho e regravando os "ordem" sequencialmente
  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[index], next[j]] = [next[j], next[index]];
    const reindexed = next.map((it, k) => ({ ...it, ordem: (k + 1) * 10 }));
    setItems(reindexed);
    await Promise.all(reindexed.map(it => supabase.from('project_task_templates').update({ ordem: it.ordem }).eq('id', it.id)));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-lumos-text-primary tracking-tight uppercase flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-lumos-yellow" /> Templates de Tarefas
          </h1>
          <p className="text-sm font-medium text-lumos-text-secondary mt-1">
            As tarefas-padrão aplicadas a cada segmento ao criar um projeto ou usar “Aplicar Template”.
          </p>
        </div>
      </div>

      {/* Abas de segmento */}
      <div className="flex items-center gap-2">
        {SEGMENTS.map(s => (
          <button key={s.value} onClick={() => setSeg(s.value)}
            className={clsx('px-4 py-2 rounded-lumos text-xs font-black uppercase tracking-widest transition-all border',
              seg === s.value ? 'bg-lumos-yellow text-black border-lumos-yellow' : 'border-lumos-border text-lumos-text-secondary hover:text-lumos-text-primary')}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="card border border-lumos-border bg-lumos-surface p-6">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-lumos-yellow" /></div>
        ) : (
          <div className="space-y-2">
            {items.length === 0 && (
              <p className="text-xs text-lumos-text-secondary italic text-center py-6">Nenhuma tarefa neste template ainda. Adicione a primeira abaixo.</p>
            )}
            {items.map((t, index) => (
              <div key={t.id} className="flex items-start gap-3 p-3 rounded-lumos border border-lumos-border/50 bg-lumos-bg/30">
                <div className="flex flex-col items-center gap-0.5 pt-1.5 text-lumos-text-secondary/60">
                  <GripVertical className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-black">{index + 1}</span>
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <input
                    value={t.titulo}
                    onChange={e => setItems(prev => prev.map(i => i.id === t.id ? { ...i, titulo: e.target.value } : i))}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== '') patch(t.id, { titulo: v }); }}
                    className="input-lumos w-full h-9 text-sm font-bold"
                    placeholder="Título da tarefa"
                  />
                  <textarea
                    value={t.descricao || ''}
                    onChange={e => setItems(prev => prev.map(i => i.id === t.id ? { ...i, descricao: e.target.value } : i))}
                    onBlur={e => patch(t.id, { descricao: e.target.value })}
                    rows={1} placeholder="Descrição (opcional)…"
                    className="input-lumos w-full text-xs resize-none min-h-[36px] max-h-32 py-2"
                  />
                </div>
                <div className="w-32 flex-shrink-0">
                  <span className="text-[9px] font-black uppercase text-lumos-text-secondary/60 tracking-wider block mb-1">Prioridade</span>
                  <Select value={t.prioridade} onChange={v => patch(t.id, { prioridade: v })} options={PRIORITY_OPTIONS}
                    className="input-lumos h-9 text-[11px] py-0" />
                </div>
                <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-4">
                  <button onClick={() => move(index, -1)} disabled={index === 0} className="p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow disabled:opacity-30 transition-colors"><ChevronUp className="w-4 h-4" /></button>
                  <button onClick={() => move(index, 1)} disabled={index === items.length - 1} className="p-1 rounded text-lumos-text-secondary hover:text-lumos-yellow disabled:opacity-30 transition-colors"><ChevronDown className="w-4 h-4" /></button>
                </div>
                <button onClick={() => remove(t)} className="p-1.5 rounded text-lumos-text-secondary hover:text-red-400 transition-colors flex-shrink-0 mt-3" title="Excluir"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}

            {/* Adicionar */}
            <div className="flex items-center gap-2 pt-3">
              <input
                value={newTitle} onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTask(); }}
                placeholder="Nova tarefa do template… (Enter para adicionar)"
                className="input-lumos flex-1 h-10 text-sm"
              />
              <button onClick={addTask} disabled={adding || !newTitle.trim()} className="btn-primary h-10 px-4 text-sm font-bold flex items-center gap-1.5 disabled:opacity-50">
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar
              </button>
            </div>
          </div>
        )}
      </div>

      {dialog}
    </div>
  );
}
