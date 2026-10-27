import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Plus, X } from 'lucide-react';
import { type Item, type TipoItem, TIPOS, tipoDoItem } from '@/lib/cronograma';

/**
 * Uma célula do cronograma (linha × dia): a lista de itens, digitada no ritmo da planilha.
 *  · clique num item para editar; Enter grava; texto vazio apaga o item
 *  · "+" no fim da célula adiciona; Enter grava e abre o próximo; Esc ou vazio fecha
 *  · o ponto colorido troca o tipo (a cor da legenda)
 * Sem permissão de edição a célula só mostra.
 */

interface Props {
  itens: Item[];
  podeEditar: boolean;
  tipoPadrao: TipoItem;
  fimDeSemana?: boolean;
  onAdicionar: (texto: string, tipo: TipoItem) => void;
  onAtualizar: (id: string, patch: Partial<Pick<Item, 'texto' | 'tipo'>>) => void;
  onRemover: (id: string) => void;
}

function MenuDeTipo({ atual, onEscolher, onFechar }: { atual: TipoItem; onEscolher: (t: TipoItem) => void; onFechar: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onFechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [onFechar]);
  return (
    <div ref={ref} className="absolute left-0 top-full mt-1 z-30 w-48 rounded-lumos border border-lumos-border bg-lumos-surface shadow-xl py-1">
      {TIPOS.map(t => (
        <button key={t.id} type="button" onClick={() => { onEscolher(t.id); onFechar(); }}
          className={clsx('w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-bold hover:bg-lumos-text-primary/5',
            atual === t.id ? 'text-lumos-yellow' : 'text-lumos-text-primary')}>
          <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', t.ponto)} /> {t.label}
        </button>
      ))}
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

function LinhaDeItem({ item, podeEditar, onAtualizar, onRemover }: {
  item: Item; podeEditar: boolean;
  onAtualizar: Props['onAtualizar']; onRemover: Props['onRemover'];
}) {
  const [editando, setEditando] = useState(false);
  const [menu, setMenu] = useState(false);
  const t = tipoDoItem(item.tipo);

  return (
    <div className={clsx('group relative flex items-start gap-1.5 rounded border px-1.5 py-1', t.caixa)}>
      {podeEditar ? (
        <button type="button" onClick={() => setMenu(m => !m)} title="Trocar o tipo"
          className={clsx('mt-[3px] w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-black/10 hover:scale-125 transition-transform', t.ponto)} />
      ) : (
        <span className={clsx('mt-[3px] w-2 h-2 rounded-full flex-shrink-0', t.ponto)} />
      )}
      {menu && <MenuDeTipo atual={item.tipo} onEscolher={tipo => onAtualizar(item.id, { tipo })} onFechar={() => setMenu(false)} />}

      <div className="min-w-0 flex-1">
        {editando ? (
          <CampoDeTexto
            inicial={item.texto}
            onGravar={texto => { setEditando(false); if (texto !== item.texto) onAtualizar(item.id, { texto }); }}
            onCancelar={() => setEditando(false)}
            onApagarVazio={() => { setEditando(false); onRemover(item.id); }}
          />
        ) : (
          <p onClick={() => podeEditar && setEditando(true)}
            className={clsx('text-[12px] leading-snug text-lumos-text-primary whitespace-pre-wrap break-words', podeEditar && 'cursor-text')}>
            {item.texto}
          </p>
        )}
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

export default function CelulaCronograma({ itens, podeEditar, tipoPadrao, fimDeSemana, onAdicionar, onAtualizar, onRemover }: Props) {
  const [novo, setNovo] = useState(false);
  // Depois de gravar com Enter o campo é remontado limpo, pronto para o próximo item.
  const [chave, setChave] = useState(0);

  return (
    <div className={clsx('min-h-[64px] p-1.5 space-y-1', fimDeSemana && 'bg-lumos-text-secondary/[0.07]')}>
      {itens.map(i => (
        <LinhaDeItem key={i.id} item={i} podeEditar={podeEditar} onAtualizar={onAtualizar} onRemover={onRemover} />
      ))}

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
            itens.length === 0 ? 'h-10' : 'h-5 opacity-0 hover:opacity-100 focus:opacity-100')}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
