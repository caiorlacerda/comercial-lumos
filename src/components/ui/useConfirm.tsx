import { useCallback, useState } from 'react';
import Modal from '@/components/common/Modal';
import { clsx } from 'clsx';

interface ConfirmOpts { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; }

// Confirmação com a cara da Lumos (substitui o window.confirm nativo do SO).
// Uso: const { confirm, dialog } = useConfirm();  ... if (await confirm('...')) {}
// Renderize {dialog} uma vez no componente.
export function useConfirm() {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback((opts: ConfirmOpts | string) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise<boolean>(resolve => setState({ ...o, resolve }));
  }, []);

  const close = (v: boolean) => { state?.resolve(v); setState(null); };

  const dialog = state ? (
    <Modal
      isOpen
      onClose={() => close(false)}
      title={state.title || 'Confirmar'}
      size="sm"
      camada="z-[300]"
      portal
      footer={(
        <>
          <button onClick={() => close(false)} className="btn-secondary h-10 px-4 text-xs font-bold">
            {state.cancelLabel || 'Cancelar'}
          </button>
          <button onClick={() => close(true)} className={clsx('h-10 px-4 rounded-lumos text-xs font-bold transition-all', state.danger ? 'bg-red-500 text-white hover:brightness-110' : 'btn-primary')}>
            {state.confirmLabel || 'Confirmar'}
          </button>
        </>
      )}
    >
      <p className="text-sm text-lumos-text-secondary leading-relaxed whitespace-pre-line">{state.message}</p>
    </Modal>
  ) : null;

  return { confirm, dialog };
}

interface PromptOpts {
  title?: string;
  message?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  multiline?: boolean;
}

/**
 * Pergunta um texto com a cara da Lumos — substitui o window.prompt do
 * navegador, que abre uma caixa do sistema operacional, sem o nosso tema e
 * sem dizer de onde vem.
 *
 * Devolve a string digitada, ou null se a pessoa cancelou — mesmo contrato do
 * prompt nativo, pra troca ser direta em quem já tratava o null.
 *
 * Uso: const { prompt, dialog } = usePrompt();  const v = await prompt({...});
 * Renderize {dialog} uma vez no componente.
 */
export function usePrompt() {
  const [state, setState] = useState<(PromptOpts & { resolve: (v: string | null) => void }) | null>(null);
  const [texto, setTexto] = useState('');

  const prompt = useCallback((opts: PromptOpts | string) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    setTexto(o.value ?? '');
    return new Promise<string | null>(resolve => setState({ ...o, resolve }));
  }, []);

  const fechar = (v: string | null) => { state?.resolve(v); setState(null); setTexto(''); };

  const dialog = state ? (
    <Modal
      isOpen
      onClose={() => fechar(null)}
      title={state.title || 'Digite o texto'}
      size="sm"
      camada="z-[300]"
      portal
      footer={(
        <>
          <button onClick={() => fechar(null)} className="btn-secondary h-10 px-4 text-xs font-bold">Cancelar</button>
          <button onClick={() => fechar(texto)} className="btn-primary h-10 px-4 text-xs font-bold">
            {state.confirmLabel || 'Confirmar'}
          </button>
        </>
      )}
    >
      {state.message && <p className="text-sm text-lumos-text-secondary leading-relaxed mb-3">{state.message}</p>}
      {state.label && (
        <label className="block text-[10px] font-black uppercase tracking-widest text-lumos-text-secondary mb-1.5">{state.label}</label>
      )}
      {state.multiline ? (
        <textarea autoFocus value={texto} onChange={e => setTexto(e.target.value)}
          placeholder={state.placeholder} rows={4}
          className="input-lumos w-full text-xs resize-none py-2 leading-snug" />
      ) : (
        <input autoFocus type="text" value={texto} onChange={e => setTexto(e.target.value)}
          placeholder={state.placeholder}
          onKeyDown={e => { if (e.key === 'Enter') fechar(texto); }}
          className="input-lumos w-full h-10 text-xs" />
      )}
    </Modal>
  ) : null;

  return { prompt, dialog };
}
