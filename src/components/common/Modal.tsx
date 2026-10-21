import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { useVisualNovo } from '@/lib/visualNovo';
import EscopoVisual from '@/components/ui/EscopoVisual';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Cabeçalho próprio (ex.: foto + nome). Quando informado, no lugar do título em texto. */
  header?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  className?: string;
  padding?: string;
  bodyClassName?: string;
  /** Renderiza direto no <body>: cobre a tela inteira, inclusive a barra lateral.
   *  Com o visual novo ligado, é o padrão (corrige a janela aparecendo por baixo do menu). */
  portal?: boolean;
  /** Tamanho padrão da janela. `maxWidth` (se informado) tem prioridade. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Camada (z-index) da janela. Padrão `z-50`; confirmações abertas sobre outras janelas usam uma mais alta. */
  camada?: string;
  /** Clicar no fundo escuro fecha a janela (padrão). Desligue em formulários longos, para não perder o que foi digitado. */
  fecharAoClicarFora?: boolean;
}

const TAMANHOS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-none h-full flex flex-col',
} as const;

/** Janelas abertas, da mais antiga para a mais nova: o Esc fecha só a de cima. */
const pilhaAbertas: symbol[] = [];

export default function Modal({
  isOpen,
  onClose,
  title,
  header,
  children,
  footer,
  maxWidth = '',
  className,
  padding = 'p-6',
  bodyClassName,
  portal,
  size,
  camada = 'z-50',
  fecharAoClicarFora = true,
}: ModalProps) {
  const visualNovo = useVisualNovo();
  const usarPortal = portal ?? visualNovo;
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Esc fecha a janela (só a de cima, se houver uma sobre a outra)
  const aoFechar = useRef(onClose);
  aoFechar.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const id = Symbol('modal');
    pilhaAbertas.push(id);
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (pilhaAbertas[pilhaAbertas.length - 1] !== id) return;
      aoFechar.current();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      const i = pilhaAbertas.indexOf(id);
      if (i >= 0) pilhaAbertas.splice(i, 1);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const conteudo = (
    <div className={clsx("fixed inset-0 flex items-center justify-center p-4 sm:p-6", camada)}>
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={fecharAoClicarFora ? onClose : undefined}
      />
      <div className={clsx(
        "bg-lumos-surface w-full max-h-full flex flex-col rounded-lumos shadow-2xl relative z-10 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300",
        maxWidth || (size ? TAMANHOS[size] : 'max-w-md'),
        className
      )}>
        <div className={clsx("flex items-center justify-between border-b border-lumos-border shrink-0", padding)}>
          {header ? (
            <div id="modal-title" className="min-w-0 flex-1">{header}</div>
          ) : (
            <h3 id="modal-title" className="text-xl font-black text-lumos-text-primary tracking-tight">
              {title}
            </h3>
          )}
          <button 
            onClick={onClose}
            className="p-2 -mr-2 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className={clsx('min-h-0 overflow-y-auto', padding, bodyClassName)}>
          {children}
        </div>

        {footer && (
          <div className={clsx("bg-lumos-bg/50 border-t border-lumos-border flex justify-end gap-3 shrink-0", padding, "py-4")}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return usarPortal ? createPortal(<EscopoVisual>{conteudo}</EscopoVisual>, document.body) : conteudo;
}
