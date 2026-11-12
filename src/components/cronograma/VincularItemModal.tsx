import { useEffect, useMemo, useState } from 'react';
import { Search, Unlink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Modal from '@/components/common/Modal';
import Select from '@/components/ui/Select';
import StatusTarefa from '@/components/cronograma/StatusTarefa';
import { carregarTarefasConcluidas, useTarefasCatalogo } from '@/components/cronograma/TarefasCatalogo';
import { type Item, type Linha, type TarefaCatalogo, type Vinculo, nomeDaLinha, normalizar, vinculoDeTarefa } from '@/lib/cronograma';

/**
 * Liga um item do cronograma a uma TAREFA da plataforma em um passo: busca por nome de tarefa ou de projeto e clica.
 * As tarefas da pessoa da linha vêm primeiro. O texto do item não muda: o vínculo aparece embaixo dele como atalho
 * que abre a tarefa. (Quem só quer ligar a um projeto, sem tarefa, usa a opção no fim.)
 */
export type { Vinculo };

const MAX = 60;

export default function VincularItemModal({ item, linha, onClose, onSalvar }: {
  item: Item;
  linha: Linha | null;
  onClose: () => void;
  onSalvar: (vinculo: Vinculo | null) => Promise<void> | void;
}) {
  const abertas = useTarefasCatalogo();
  const [busca, setBusca] = useState('');
  const [incluirConcluidas, setIncluirConcluidas] = useState(false);
  const [concluidas, setConcluidas] = useState<TarefaCatalogo[]>([]);
  const [projetos, setProjetos] = useState<{ id: string; name: string; status: string }[]>([]);
  const [projetoId, setProjetoId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const userId = linha?.user_id ?? null;
  const pessoa = linha?.user?.full_name?.split(' ')[0] || (linha ? nomeDaLinha(linha) : '');

  useEffect(() => {
    if (!incluirConcluidas || concluidas.length) return;
    carregarTarefasConcluidas().then(setConcluidas);
  }, [incluirConcluidas, concluidas.length]);

  const lista = useMemo(() => {
    const palavras = normalizar(busca).split(/[^a-z0-9]+/).filter(Boolean);
    const todas = incluirConcluidas ? [...abertas, ...concluidas] : abertas;
    return todas.filter(t => {
      if (!palavras.length) return true;
      const h = normalizar(`${t.projeto} ${t.titulo}`);
      return palavras.every(p => h.includes(p));
    });
  }, [abertas, concluidas, incluirConcluidas, busca]);

  const dela = lista.filter(t => !!userId && t.responsavel_id === userId);
  const outras = lista.filter(t => !(userId && t.responsavel_id === userId));
  const cortou = dela.length + outras.length > MAX;
  const mostrarDela = dela.slice(0, MAX);
  const mostrarOutras = outras.slice(0, Math.max(0, MAX - mostrarDela.length));

  const salvar = async (v: Vinculo | null) => { setSalvando(true); await onSalvar(v); setSalvando(false); };

  const carregarProjetos = () => {
    if (projetos.length) return;
    supabase.from('projects').select('id, name, status').order('status').order('created_at', { ascending: false })
      .then(({ data }) => setProjetos((data as any[]) || []));
  };

  const cartao = (t: TarefaCatalogo) => (
    <button key={t.id} type="button" disabled={salvando} onClick={() => salvar(vinculoDeTarefa(t))}
      className={`w-full text-left px-2.5 py-2 rounded-lumos border hover:border-lumos-yellow/60 hover:bg-lumos-yellow/5 transition-colors disabled:opacity-50 ${item.task_id === t.id ? 'border-lumos-yellow/60 bg-lumos-yellow/10' : 'border-lumos-border/60'}`}>
      <span className="block text-xs font-bold text-lumos-text-primary break-words">{t.titulo}</span>
      <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-lumos-text-secondary min-w-0">
        <span className="truncate">{t.projeto || 'Sem projeto'}</span>
        <StatusTarefa status={t.status} />
      </span>
    </button>
  );

  return (
    <Modal isOpen onClose={onClose} title="Vincular a uma tarefa">
      <div className="space-y-3">
        <p className="text-xs text-lumos-text-secondary whitespace-pre-wrap break-words border-l-2 border-lumos-yellow/60 pl-2.5">{item.texto}</p>

        {item.project_id && (
          <div className="flex items-center justify-between gap-2 rounded-lumos bg-lumos-surface border border-lumos-border/60 px-2.5 py-2">
            <p className="text-[11px] text-lumos-text-secondary min-w-0 truncate">
              Ligado a: <strong className="text-lumos-text-primary">{item.project?.name || 'Projeto'}{item.task?.titulo ? ` · ${item.task.titulo}` : ''}</strong>
            </p>
            <button type="button" disabled={salvando} onClick={() => salvar(null)}
              className="flex items-center gap-1 text-[11px] font-bold text-lumos-text-secondary hover:text-red-500 flex-shrink-0">
              <Unlink className="w-3 h-3" /> Remover
            </button>
          </div>
        )}

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-lumos-text-secondary" />
          <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por tarefa ou projeto…"
            className="input-lumos w-full h-10 pl-9 text-sm" />
        </div>

        <div className="max-h-[46vh] overflow-y-auto space-y-3 pr-0.5">
          {mostrarDela.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-black uppercase tracking-wider text-lumos-yellow">Tarefas de {pessoa}</p>
              {mostrarDela.map(cartao)}
            </div>
          )}
          {mostrarOutras.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-black uppercase tracking-wider text-lumos-text-secondary">{mostrarDela.length ? 'Outras tarefas' : 'Tarefas'}</p>
              {mostrarOutras.map(cartao)}
            </div>
          )}
          {!mostrarDela.length && !mostrarOutras.length && (
            <p className="text-xs text-lumos-text-secondary text-center py-6">Nenhuma tarefa encontrada{!incluirConcluidas ? ' entre as em aberto' : ''}.</p>
          )}
          {cortou && <p className="text-[10px] text-lumos-text-secondary text-center">Mostrando as {MAX} primeiras. Digite para filtrar.</p>}
        </div>

        <label className="flex items-center gap-2 text-[11px] text-lumos-text-secondary cursor-pointer">
          <input type="checkbox" checked={incluirConcluidas} onChange={e => setIncluirConcluidas(e.target.checked)} />
          Incluir tarefas já aprovadas
        </label>

        <details className="rounded-lumos border border-lumos-border/60 px-2.5 py-2" onToggle={e => { if ((e.target as HTMLDetailsElement).open) carregarProjetos(); }}>
          <summary className="text-[11px] font-bold text-lumos-text-secondary cursor-pointer">Ligar só a um projeto (sem tarefa)</summary>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Select value={projetoId} onChange={setProjetoId} searchable placeholder="Escolha um projeto" className="input-lumos w-full"
                options={projetos.map(p => ({ value: p.id, label: p.status === 'concluido' ? `${p.name} · encerrado` : p.name }))} />
            </div>
            <button type="button" disabled={!projetoId || salvando} className="btn-primary h-10 px-4 text-xs font-black disabled:opacity-50"
              onClick={() => { const p = projetos.find(x => x.id === projetoId); if (p) salvar({ project: { id: p.id, name: p.name }, task: null }); }}>
              Ligar
            </button>
          </div>
        </details>
      </div>
    </Modal>
  );
}
