import React, { forwardRef } from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

// Botão padrão da Lumos. Substitui os botões feitos à mão (btn-primary, amarelos soltos e as
// muitas variações de vermelho). Mantenha as classes escritas por extenso: o Tailwind só gera
// o que enxerga no código.
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap rounded-lumos border transition-colors duration-150 ' +
  'disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumos-yellow';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-lumos-yellow border-lumos-yellow text-[#161616] hover:brightness-95',
  secondary: 'bg-lumos-surface border-lumos-border text-lumos-text-primary hover:bg-lumos-text-secondary/10',
  ghost: 'bg-transparent border-transparent text-lumos-text-secondary hover:bg-lumos-text-secondary/10 hover:text-lumos-text-primary',
  danger: 'bg-danger/10 border-danger/30 text-danger-fg hover:bg-danger hover:border-danger hover:text-white',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-sm',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ícone à esquerda do texto. */
  icon?: React.ReactNode;
  /** Mostra um indicador e bloqueia o clique. */
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(BASE, VARIANTS[variant], SIZES[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export default Button;

// Botão quadrado só com ícone. `aria-label` é obrigatório (leitor de tela e dica ao passar o mouse).
const ICON_SIZES: Record<'sm' | 'md', string> = { sm: 'size-8', md: 'size-10' };

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  'aria-label': string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={rest['aria-label']}
      className={clsx(BASE, VARIANTS[variant], ICON_SIZES[size], 'px-0', className)}
      {...rest}
    >
      {children}
    </button>
  );
});
