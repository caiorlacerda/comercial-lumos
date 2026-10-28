import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Link2, Plus, Unlink, X } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type Item, type TipoItem, TIPOS, tipoDoItem } from '@/lib/cronograma';
import type { ItemAutomatico } from '@/lib/cronogramaAutomatico';
import ItemAutomaticoView from '@/components/cronograma/ItemAutomaticoView';

/**
 * Uma célula do cronograma (linha × dia): a lista de itens, digitada no ritmo da planilha.
 *  · clique num item para editar; Enter grava; texto vazio apaga o item
 *  · "+" no fim da célula adiciona; Enter grava e abre o próximo; Esc ou vazio fecha
 *  · o ponto colorido troca o tipo (a cor da legenda) e vincula o item a um projeto/tarefa
 *  · arraste um item para mudar a ordem, o dia ou a pessoa (o DndContext fica na página)
 * Sem permissão de edição a célula só mostra.
 */

interface Props {
  linhaId: string;
  dia: string;
  itens: Item[];
  podeEditar: boolean;
  tipoPadrao: TipoItem;
  fimDeSemana?: boolean;
  destaque?: boolean;          // é a célula onde o item arrastado vai cair
  automaticos?: ItemAutomatico[];   // diárias/entregas que vêm sozinhas (só leitura)
  onAdicionar: (texto: string, tipo: TipoItem) => void;
  onAtualizar: (id: string, patch: Partial<Pick<Item, 'texto' | 'tipo'>>) => void;
  onRemover: (id: string) => void;
  onVincular: (item: Item) => void;
  onDesvincular: (id: string) => void;
}

function MenuDeTipo({ item, onEscolher, onVincular, onDesvincular, onFechar }: {
  item: Item;
  onEscolher: (t: TipoItem) => void;
  onVincular: () => void;
  onDesvincular: () => void;
  onFechar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onFechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [onFechar]);
  const ligado = !!item.project_id;
  return (
    <div ref={ref} className="absolute left-0 top-full mt-1 z-30 w-52 rounded-lumos border border-lumos-border bg-lumos-surface shadow-xl py-1">
      {TIPOS.map(t => (
        <button key={t.id} type="button" onClick={() => { onEscolher(t.id); onFechar(); }}
          className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-bold hover:bg-lumos-text-primary/5',
            item.tipo === t.id ? 'text-lumos-yellow' : 'text-lumos-text-primary')}>
          <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', t.ponto)} /> {t.label}
        </button>
      ))}
      <div className="my-1 border-t border-lumos-border/60" />
      <button type="button" onClick={() => { onVincular(); onFechar(); }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-bold text-lumos-text-primary hover:bg-lumos-text-primary/5">
        <Link2 className="w-3 h-3 flex-shrink-0" /> {ligado ? 'Trocar projeto/tarefa…' : 'Vincular a projeto/tarefa…'}
      </button>
      {ligado && (
        <button type="button" onClick={() => { onDesvincular(); onFechar(); }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-bold text-lumos-text-secondary hover:bg-lumos-text-primary/5">
          <Unlink className="w-3 h-3 flex-shrink-0" /> Remover vínculo
        </button>
      )}
    </div>
  );
}

function CampoDeTexto({ inicial, placeholder, onGravar, onCancelar, onApagarVazio }: {
  inicial: string; placeholder?: string;
  onGravar: (texto: string, continuar: boolean) => void;
  onCancelar: () => void;
  onApagarVazio?: () => void;
}) {
  const [texto, setTexto] = useState(inicial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const feito = useRef(false);

  // A caixa cresce com o texto (a planilha também deixava a célula crescer).
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [texto]);
  useEffect(() => { ref.current?.focus(); ref.current?.setSelectionRange(texto.length, texto.length); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const gravar = (continuar: boolean) => {
    if (feito.current) return;
    feito.current = true;
    const t = texto.trim();
    if (!t) { if (onApagarVazio) onApagarVazio(); else onCancelar(); return; }
    onGravar(t, continuar);
  };

  return (
    <textarea
      ref={ref} rows={1} value={texto} placeholder={placeholder}
      onChange={e => setTexto(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gravar(true); }
        else if (e.key === 'Escape') { e.preventDefault(); feito.current = true; onCancelar(); }
      }}
      onBlur={() => gravar(false)}
      className="w-full resize-none overflow-hidden bg-transparent outline-none text-[12px] leading-snug text-lumos-text-primary placeholder:text-lumos-text-secondary/60"
    />
  );
}

/** Nome do projeto (e da tarefa) ao qual o item está ligado; clicar abre o projeto. */
function Vinculo({ item }: { item: Item }) {
  const navigate = useNavigate();
  if (!item.project_id) return null;
  const nome = item.project?.name || 'Projeto';
  const rotulo = item.task?.titulo ? `${nome} · ${item.task.titulo}` : nome;
  return (
    <button type="button" onClick={() => navigate(`/producao/projetos?projectId=${item.project_id}`)} title={`Abrir o projeto: ${rotulo}`}
      className="mt-0.5 flex items-center gap-1 max-w-full text-[10px] font-bold text-lumos-text-secondary hover:text-lumos-yellow transition-colors">
      <Link2 className="w-2.5 h-2.5 flex-shrink-0" /> <span className="truncate">{rotulo}</span>
    </button>
  );
}

/** O item "no ar", que acompanha o mouse enquanto se arrasta (usado no DragOverlay da página). */
export function ItemFlutuante({ item }: { item: Item }) {
  const t = tipoDoItem(item.tipo);
  return (
    <div className={clsx('flex items-start gap-1.5 rounded border px-1.5 py-1 shadow-2xl ring-1 ring-lumos-yellow/60 cursor-grabbing bg-lumos-surface', t.caixa)}>
      <span className={clsx('mt-[3px] w-2.5 h-2.5 rounded-full flex-shrink-0', t.ponto)} />
      <p className="min-w-0 flex-1 text-[12px] leading-snug text-lumos-text-primary whitespace-pre-wrap break-words">{item.texto}</p>
    </div>
  );
}

function LinhaDeItem({ item, linhaId, dia, podeEditar, onAtualizar, onRemover, onVincular, onDesvincular }: {
  item: Item; linhaId: string; dia: string; podeEditar: boolean;
  onAtualizar: Props['onAtualizar']; onRemover: Props['onRemover'];
  onVincular: Props['onVincular']; onDesvincular: Props['onDesvincular'];
}) {
  const [editando, setEditando] = useState(false);
  const [menu, setMenu] = useState(false);
  const t = tipoDoItem(item.tipo);
  // Enquanto o texto está sendo editado o item não arrasta (senão o mouse não selecionaria o texto).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id, data: { tipo: 'item', linhaId, dia }, disabled: !podeEditar || editando,
  });

  return (
    <div ref={setNodeRef} {...(podeEditar && !editando ? { ...attributes, ...listeners } : {})}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('group relative flex items-start gap-1.5 rounded border px-1.5 py-1', t.caixa,
        podeEditar && !editando && 'cursor-grab active:cursor-grabbing', isDragging && 'opacity-30',
        // O vidro (backdrop-filter) do item cria um empilhamento próprio: sem isto o menu aberto ficaria atrás dos vizinhos.
        menu && 'z-20')}>
      {podeEditar ? (
        <button type="button" onClick={() => setMenu(m => !m)} title="Trocar o tipo ou vincular a um projeto"
          className={clsx('mt-[3px] w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-black/10 hover:scale-125 transition-transform', t.ponto)} />
      ) : (
        <span className={clsx('mt-[3px] w-2 h-2 rounded-full flex-shrink-0', t.ponto)} />
      )}
      {menu && (
        <MenuDeTipo item={item} onEscolher={tipo => onAtualizar(item.id, { tipo })}
          onVincular={() => onVincular(item)} onDesvincular={() => onDesvincular(item.id)} onFechar={() => setMenu(false)} />
      )}

      <div className="min-w-0 flex-1">
        {editando ? (
          <CampoDeTexto
            inicial={item.texto}
            onGravar={texto => { setEditando(false); if (texto !== item.texto) onAtualizar(item.id, { texto }); }}
            onCancelar={() => setEditando(false)}
            onApagarVazio={() => { setEditando(false); onRemover(item.id); }}
          />
        ) : (
          <p onClick={() => podeEditar && setEditando(true)} title={podeEditar ? 'Clique para editar · arraste para mover' : undefined}
            className="text-[12px] leading-snug text-lumos-text-primary whitespace-pre-wrap break-words">
            {item.texto}
          </p>
        )}
        {!editando && <Vinculo item={item} />}
      </div>

      {podeEditar && !editando && (
        <button type="button" onClick={() => onRemover(item.id)} title="Remover item"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 text-lumos-text-secondary hover:text-red-500 transition-opacity flex-shrink-0">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export default function CelulaCronograma({ linhaId, dia, itens, automaticos = [], podeEditar, tipoPadrao, fimDeSemana, destaque, onAdicionar, onAtualizar, onRemover, onVincular, onDesvincular }: Props) {
  const [novo, setNovo] = useState(false);
  // Depois de gravar com Enter o campo é remontado limpo, pronto para o próximo item.
  const [chave, setChave] = useState(0);
  // A célula inteira é um alvo para soltar um item (mesmo vazia).
  const { setNodeRef } = useDroppable({ id: `cel|${linhaId}|${dia}`, data: { tipo: 'celula', linhaId, dia }, disabled: !podeEditar });

  return (
    <div ref={setNodeRef}
      className={clsx('flex-1 min-h-[64px] p-1.5 space-y-1 transition-colors', fimDeSemana && 'bg-lumos-text-secondary/[0.07]',
        destaque && 'bg-lumos-yellow/15 ring-2 ring-inset ring-lumos-yellow/60')}>
      <SortableContext items={itens.map(i => i.id)} strategy={verticalListSortingStrategy}>
        {itens.map(i => (
          <LinhaDeItem key={i.id} item={i} linhaId={linhaId} dia={dia} podeEditar={podeEditar}
            onAtualizar={onAtualizar} onRemover={onRemover} onVincular={onVincular} onDesvincular={onDesvincular} />
        ))}
      </SortableContext>

      {automaticos.map(a => <ItemAutomaticoView key={a.id} item={a} />)}

      {podeEditar && novo && (
        <div className={clsx('rounded border border-dashed border-lumos-yellow/60 px-1.5 py-1', tipoDoItem(tipoPadrao).caixa)}>
          <CampoDeTexto
            key={chave} inicial="" placeholder="Escreva e dê Enter…"
            onGravar={(texto, continuar) => { onAdicionar(texto, tipoPadrao); if (continuar) setChave(c => c + 1); else setNovo(false); }}
            onCancelar={() => setNovo(false)}
          />
        </div>
      )}

      {podeEditar && !novo && (
        <button type="button" onClick={() => setNovo(true)} aria-label="Adicionar item"
          className={clsx('w-full flex items-center justify-center rounded text-lumos-text-secondary/60 hover:text-lumos-yellow hover:bg-lumos-yellow/10 transition-colors',
            itens.length + automaticos.length === 0 ? 'h-10' : 'h-5 opacity-0 hover:opacity-100 focus:opacity-100')}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
