import React, { forwardRef } from 'react';
import { clsx } from 'clsx';

// Campo de formulário: rótulo + controle + ajuda/erro. Um só jeito de escrever rótulos e mensagens.
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx('block', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block mb-1.5 text-xs font-medium uppercase tracking-wider text-lumos-text-secondary">
          {label}
          {required && <span className="text-danger-fg"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-danger-fg">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-lumos-text-secondary">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL = 'input-lumos w-full text-sm disabled:opacity-60';
const ERRO = 'border-danger focus:border-danger focus:ring-danger';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ invalid, className, ...rest }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={clsx(CONTROL, 'h-10', invalid && ERRO, className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined} className={clsx(CONTROL, 'min-h-24 resize-y', invalid && ERRO, className)} {...rest} />;
  },
);
