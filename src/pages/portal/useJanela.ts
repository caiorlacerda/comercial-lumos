import { useEffect, useRef } from 'react';

/**
 * O comportamento das janelas do portal, escrito uma vez só: fecha no Esc,
 * trava a rolagem de trás enquanto está aberta, prende o foco lá dentro (Tab
 * não escapa pro conteúdo atrás) e devolve o foco pro botão que a abriu quando
 * fecha. Sem isto, quem usa teclado ou leitor de tela continua "atrás" da
 * janela, mesmo com aria-modal="true".
 */
export function useJanela(
  aberta: boolean,
  modalRef: React.RefObject<HTMLDivElement | null>,
  gatilhoRef: React.RefObject<HTMLButtonElement | null>,
  fechar: () => void,
) {
  // O fechar entra por ref, não por dependência: assim trocar a função a cada
  // render não reabre o efeito nem rouba o foco de volta pro começo da janela.
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;
  useEffect(() => {
    if (!aberta) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const modal = modalRef.current;
    modal?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { fecharRef.current(); return; }
      if (e.key === 'Tab' && modal) {
        const focaveis = Array.from(modal.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ));
        if (!focaveis.length) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primeiro.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      gatilhoRef.current?.focus();
    };
  }, [aberta, modalRef, gatilhoRef]);
}
