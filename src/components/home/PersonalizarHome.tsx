import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw } from 'lucide-react';
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

const LARGURA = { cheia: 'Largura total', principal: 'Coluna larga', lateral: 'Coluna estreita' } as const;
const rotuloLargura = (l: string) => LARGURA[l as keyof typeof LARGURA] ?? 'Coluna estreita';

const botaoIcone =
  'h-9 w-9 flex items-center justify-center rounded-lumos border border-lumos-border text-lumos-text-secondary ' +
  'hover:text-lumos-text-primary hover:border-lumos-text-secondary disabled:opacity-30 disabled:pointer-events-none transition-colors';

/** Mostra, esconde e reordena os blocos da Home. Cada mudança já fica salva. */
export default function PersonalizarHome({ aberto, onFechar, itens, mover, alternar, restaurar, personalizado }: Props) {
  const naTela = itens.filter(i => !i.oculto);
  const escondidos = itens.filter(i => i.oculto);

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
      <p className="text-xs text-lumos-text-secondary mb-5">
        Use as setas para mudar a ordem e o olho para esconder um bloco. As colunas se ajustam sozinhas: os blocos largos ficam à esquerda e os estreitos à direita.
      </p>

      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-lumos-text-secondary mb-2">
        Na sua Home ({naTela.length})
      </h3>
      {naTela.length === 0 ? (
        <p className="text-xs text-lumos-text-secondary border border-dashed border-lumos-border rounded-lumos px-3 py-4 text-center">
          Nenhum bloco na tela. Mostre algum da lista abaixo.
        </p>
      ) : (
        <ul className="space-y-2">
          {naTela.map(({ bloco }, i) => (
            <li key={bloco.id} className="flex items-center gap-3 rounded-lumos border border-lumos-border bg-lumos-surface/40 pl-3 pr-2 py-2">
              <span className="w-5 shrink-0 text-xs font-mono text-lumos-text-secondary text-center">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-lumos-text-primary truncate">{bloco.titulo}</span>
                <span className="block text-xs text-lumos-text-secondary">{rotuloLargura(bloco.largura)}</span>
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => mover(bloco.id, -1)}
                  disabled={i === 0}
                  aria-label={`Subir ${bloco.titulo}`}
                  title="Subir"
                  className={botaoIcone}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => mover(bloco.id, 1)}
                  disabled={i === naTela.length - 1}
                  aria-label={`Descer ${bloco.titulo}`}
                  title="Descer"
                  className={botaoIcone}
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => alternar(bloco.id)}
                  aria-label={`Esconder ${bloco.titulo}`}
                  title="Esconder da Home"
                  className={`${botaoIcone} ml-1 hover:text-danger-fg`}
                >
                  <EyeOff className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {escondidos.length > 0 && (
        <>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-lumos-text-secondary mt-6 mb-2">
            Escondidos ({escondidos.length})
          </h3>
          <ul className="space-y-2">
            {escondidos.map(({ bloco }) => (
              <li key={bloco.id} className="flex items-center gap-3 rounded-lumos border border-dashed border-lumos-border px-3 py-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-lumos-text-secondary truncate">{bloco.titulo}</span>
                  <span className="block text-xs text-lumos-text-secondary/70">{rotuloLargura(bloco.largura)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => alternar(bloco.id)}
                  aria-label={`Mostrar ${bloco.titulo}`}
                  className="btn-secondary h-9 px-3 text-xs flex items-center gap-1.5 shrink-0"
                >
                  <Eye className="w-4 h-4" /> Mostrar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
