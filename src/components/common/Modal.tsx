import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  className?: string;
  padding?: string;
}

export default function Modal({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  footer,
  maxWidth = '',
  className,
  padding = 'p-6'
}: ModalProps) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div className={clsx(
        "bg-lumos-surface w-full rounded-lumos shadow-2xl relative z-10 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300",
        maxWidth || 'max-w-md',
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
        
        <div className={padding}>
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
}
