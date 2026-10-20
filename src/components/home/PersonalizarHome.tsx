import { ChevronDown, ChevronUp, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import Modal from '@/components/common/Modal';
import type { ItemLayout } from './useHomeLayout';

interface Props {
  aberto: boolean;
  onFechar: () => void;
  itens: ItemLayout[];
  mover: (id: string, direcao: -1 | 1) => void;
  alternar: (id: string) => void;
  restaurar: () => void;
  personalizado: boolean;
}

/** Mostra, esconde e reordena os blocos da Home. Cada mudança já fica salva. */
export default function PersonalizarHome({ aberto, onFechar, itens, mover, alternar, restaurar, personalizado }: Props) {
  return (
    <Modal
      isOpen={aberto}
      onClose={onFechar}
      title="Personalizar a Home"
      maxWidth="max-w-lg"
      portal
      footer={(
        <>
          <button
            type="button"
            onClick={restaurar}
            disabled={!personalizado}
            className="btn-secondary h-10 px-4 text-xs flex items-center gap-2 disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Restaurar padrão
          </button>
          <button type="button" onClick={onFechar} className="btn-primary h-10 px-5 text-xs font-bold">Pronto</button>
        </>
      )}
    >
      <p className="text-xs text-lumos-text-secondary mb-4">
        Mostre ou esconda os blocos e mude a ordem com as setas. As colunas se ajustam sozinhas: os blocos largos ficam à esquerda e os estreitos à direita.
      </p>
      <ul className="space-y-2">
        {itens.map(({ bloco, oculto }, i) => (
          <li
            key={bloco.id}
            className={clsx(
              'flex items-center gap-2 rounded-lumos border border-lumos-border px-3 py-2.5',
              oculto && 'opacity-55'
            )}
          >
            <button
              type="button"
              onClick={() => alternar(bloco.id)}
              title={oculto ? 'Mostrar' : 'Esconder'}
              aria-label={oculto ? `Mostrar ${bloco.titulo}` : `Esconder ${bloco.titulo}`}
              className="p-1.5 rounded text-lumos-text-secondary hover:text-lumos-yellow transition-colors"
            >
              {oculto ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-lumos-text-primary truncate">{bloco.titulo}</span>
              <span className="block text-[10px] uppercase tracking-wider text-lumos-text-secondary">
                {bloco.largura === 'cheia' ? 'Largura total' : bloco.largura === 'principal' ? 'Coluna larga' : 'Coluna estreita'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => mover(bloco.id, -1)}
              disabled={i === 0}
              aria-label={`Subir ${bloco.titulo}`}
              className="p-1.5 rounded text-lumos-text-secondary hover:text-lumos-text-primary disabled:opacity-30 transition-colors"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => mover(bloco.id, 1)}
              disabled={i === itens.length - 1}
              aria-label={`Descer ${bloco.titulo}`}
              className="p-1.5 rounded text-lumos-text-secondary hover:text-lumos-text-primary disabled:opacity-30 transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
