import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { useVisualNovo } from '@/lib/visualNovo';
import EscopoVisual from '@/components/ui/EscopoVisual';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
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
}

const TAMANHOS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-none h-full flex flex-col',
} as const;

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = '',
  className,
  padding = 'p-6',
  bodyClassName,
  portal,
  size
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

  if (!isOpen) return null;

  const conteudo = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div className={clsx(
        "bg-lumos-surface w-full rounded-lumos shadow-2xl relative z-10 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300",
        maxWidth || (size ? TAMANHOS[size] : 'max-w-md'),
        className
      )}>
        <div className={clsx("flex items-center justify-between border-b border-lumos-border", padding)}>
          <h3 id="modal-title" className="text-xl font-black text-lumos-text-primary tracking-tight">
            {title}
          </h3>
          <button 
            onClick={onClose}
            className="p-2 -mr-2 text-lumos-text-secondary hover:text-lumos-text-primary hover:bg-lumos-text-secondary/10 rounded-full transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className={clsx(padding, bodyClassName)}>
          {children}
        </div>

        {footer && (
          <div className={clsx("bg-lumos-bg/50 border-t border-lumos-border flex justify-end gap-3", padding, "py-4")}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return usarPortal ? createPortal(<EscopoVisual>{conteudo}</EscopoVisual>, document.body) : conteudo;
}
