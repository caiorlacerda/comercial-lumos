import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import Modal from '@/components/common/Modal';

/**
 * Formulário rápido no padrão da plataforma — substitui os prompt()/confirm()
 * do navegador. Um modal pequeno com 1 a 4 campos e Salvar/Cancelar.
 */
export interface QFField {
  key: string;
  label: string;
  type?: 'text' | 'time' | 'date' | 'textarea';
  placeholder?: string;
  value?: string;
  required?: boolean;
}

interface Props {
  title: string;
  fields: QFField[];
  submitLabel?: string;
  onSubmit: (valores: Record<string, string>) => void | Promise<void>;
  onClose: () => void;
}

export default function QuickForm({ title, fields, submitLabel = 'Salvar', onSubmit, onClose }: Props) {
  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(fields.map(f => [f.key, f.value ?? '']))
  );
  const [salvando, setSalvando] = useState(false);

  const set = (k: string, v: string) => setValores(prev => ({ ...prev, [k]: v }));
  const faltando = fields.some(f => f.required && !(valores[f.key] || '').trim());

  const enviar = async () => {
    if (faltando || salvando) return;
    setSalvando(true);
    try { await onSubmit(valores); onClose(); }
    finally { setSalvando(false); }
  };

  return (
    <Modal isOpen onClose={onClose} title={title} maxWidth="max-w-sm">
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void enviar(); }}>
        {fields.map((f, i) => (
          <div key={f.key}>
            <label className="text-[10px] font-black text-lumos-text-secondary uppercase tracking-widest">
              {f.label}{f.required && ' *'}
            </label>
            {f.type === 'textarea' ? (
              <textarea autoFocus={i === 0} rows={3} value={valores[f.key]} placeholder={f.placeholder}
                onChange={e => set(f.key, e.target.value)}
                className="input-lumos w-full mt-1 text-sm resize-y" />
            ) : (
              <input autoFocus={i === 0} type={f.type || 'text'} value={valores[f.key]} placeholder={f.placeholder}
                onChange={e => set(f.key, e.target.value)}
                className="input-lumos w-full h-10 mt-1 text-sm" />
            )}
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onClose} className="ml-auto text-[11px] font-bold text-lumos-text-secondary px-2">Cancelar</button>
          <button type="submit" disabled={faltando || salvando}
            className="btn-primary h-9 px-5 text-xs font-black disabled:opacity-60 flex items-center gap-1.5">
            {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
