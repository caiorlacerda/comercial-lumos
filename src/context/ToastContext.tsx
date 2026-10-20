import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useVisualNovo } from '@/lib/visualNovo';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="w-4 h-4 flex-shrink-0" />,
  error: <XCircle className="w-4 h-4 flex-shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 flex-shrink-0" />,
  info: <Info className="w-4 h-4 flex-shrink-0" />,
};

const STYLES: Record<ToastType, string> = {
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
  warning: 'bg-yellow-500 text-black',
  info: 'bg-lumos-surface text-lumos-text-primary border border-lumos-border',
};

// Visual novo: aviso no mesmo vidro do app (fundo do cartão, borda e ícone na cor do significado).
const STYLES_NOVO: Record<ToastType, string> = {
  success: 'bg-lumos-surface text-lumos-text-primary border border-ok/50',
  error: 'bg-lumos-surface text-lumos-text-primary border border-danger/50',
  warning: 'bg-lumos-surface text-lumos-text-primary border border-warn/50',
  info: 'bg-lumos-surface text-lumos-text-primary border border-lumos-border',
};
const ICON_COR_NOVO: Record<ToastType, string> = {
  success: 'text-ok-fg',
  error: 'text-danger-fg',
  warning: 'text-warn-fg',
  info: 'text-info-fg',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const visualNovo = useVisualNovo();

  const add = useCallback((message: string, type: ToastType) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const value: ToastContextValue = {
    success: (m) => add(m, 'success'),
    error: (m) => add(m, 'error'),
    warning: (m) => add(m, 'warning'),
    info: (m) => add(m, 'info'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed z-[200] flex flex-col gap-2 items-center pointer-events-none bottom-20 left-1/2 -translate-x-1/2 w-full max-w-sm px-4 lg:top-6 lg:bottom-auto lg:left-1/2 lg:-translate-x-1/2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lumos shadow-2xl text-sm font-semibold w-full pointer-events-auto animate-in fade-in slide-in-from-bottom-4 lg:slide-in-from-top-4 duration-300 ${visualNovo ? STYLES_NOVO[toast.type] : STYLES[toast.type]}`}
          >
            {visualNovo ? <span className={`flex-shrink-0 ${ICON_COR_NOVO[toast.type]}`}>{ICONS[toast.type]}</span> : ICONS[toast.type]}
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => remove(toast.id)}
              className="opacity-70 hover:opacity-100 transition-opacity ml-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
