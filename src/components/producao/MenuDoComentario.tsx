import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Pencil, Trash2 } from 'lucide-react';

/**
 * Menu "Editar / Excluir" do PRÓPRIO comentário, das duas telas de revisão (interna e do cliente).
 *
 * Antes ele abria dentro do cartão: a lista de comentários rola (cortava o menu nos últimos itens) e o
 * painel tem vidro (backdrop-filter), que prende o "toque fora para fechar" ao tamanho do painel em vez
 * da tela. Aqui ele sai para o <body>:
 *  · no computador: janelinha junto do botão, que abre para cima se não couber embaixo;
 *  · no celular: folha que sobe de baixo, com botões de 48 px e o fundo cobrindo a tela toda.
 * `tema` é a classe de tema da tela ('dark' | 'theme-light'): fora dela as cores perdem o tema.
 */

export default function MenuDoComentario({ ancora, tema, onEditar, onExcluir, onFechar }: {
  ancora: RefObject<HTMLElement | null>;
  tema: string;
  onEditar: () => void;
  onExcluir: () => void;
  onFechar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [desktop] = useState(() => window.matchMedia?.('(min-width: 1024px)').matches ?? true);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  useLayoutEffect(() => {
    if (!desktop) return;
    const a = ancora.current?.getBoundingClientRect();
    if (!a) return;
    const h = ref.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(a.right - 128, window.innerWidth - 136));
    setPos(a.bottom + 4 + h > window.innerHeight - 8 ? { left, bottom: window.innerHeight - a.top + 4 } : { left, top: a.bottom + 4 });
  }, [ancora, desktop]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    const fecha = () => onFechar();
    document.addEventListener('keydown', esc);
    if (desktop) { window.addEventListener('scroll', fecha, true); window.addEventListener('resize', fecha); }
    return () => {
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', fecha, true); window.removeEventListener('resize', fecha);
    };
  }, [desktop, onFechar]);

  const item = (cls: string) => clsx('w-full flex items-center gap-2 font-bold hover:bg-lumos-text-secondary/10', desktop ? 'px-3 py-1.5 text-[11px]' : 'h-12 px-4 text-sm rounded-lumos', cls);
  const icone = desktop ? 'w-3 h-3' : 'w-4 h-4';

  return createPortal(
    // Os cliques não podem "vazar" para o cartão do comentário (que abriria o ponto do vídeo).
    <div className={clsx(tema, 'font-work-sans')} onClick={e => e.stopPropagation()}>
      <div className="fixed inset-0 z-[500]" onClick={onFechar} />
      <div ref={ref}
        style={desktop ? { position: 'fixed', ...(pos ?? { top: -9999, left: 0 }) } : undefined}
        className={desktop
          ? 'z-[501] w-32 py-1 rounded-lumos bg-lumos-surface border border-lumos-border shadow-2xl'
          : 'fixed inset-x-0 bottom-0 z-[501] rounded-t-2xl bg-lumos-surface border-t border-lumos-border shadow-2xl p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]'}>
        <button onClick={onEditar} className={item('text-lumos-text-primary lg:text-lumos-text-secondary lg:hover:text-lumos-text-primary')}>
          <Pencil className={icone} /> Editar
        </button>
        <button onClick={onExcluir} className={item('text-red-500 hover:bg-red-500/10')}>
          <Trash2 className={icone} /> Excluir
        </button>
        {!desktop && (
          <button onClick={onFechar} className="w-full h-12 mt-1 rounded-lumos border border-lumos-border text-sm font-bold text-lumos-text-secondary">Cancelar</button>
        )}
      </div>
    </div>,
    document.body,
  );
}
