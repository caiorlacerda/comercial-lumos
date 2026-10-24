// Ícones SVG do portal. Movido de PortalCliente.tsx sem alterar.

export const Sol = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const Lua = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
export const IconeZap = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.14c-.25.7-1.44 1.33-1.99 1.38-.53.05-1.02.24-3.44-.72-2.9-1.15-4.75-4.11-4.89-4.3-.14-.19-1.17-1.56-1.17-2.98 0-1.42.74-2.12 1-2.41.26-.29.57-.36.76-.36h.55c.18 0 .41-.03.64.49.25.6.84 2.07.91 2.22.07.15.12.32.02.51-.34.69-.71.66-.51 1 .74 1.27 1.48 1.71 2.6 2.28.19.1.3.08.42-.05.12-.14.48-.56.61-.75.13-.19.26-.16.44-.1.18.07 1.15.54 1.35.64.2.1.33.15.38.23.05.09.05.51-.2 1.21Z" />
  </svg>
);
export const IconeSlack = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M6 15.2A2.1 2.1 0 1 1 3.9 13H6v2.2Zm1.1 0A2.1 2.1 0 0 1 9.2 13a2.1 2.1 0 0 1 2.1 2.2v5.3a2.1 2.1 0 1 1-4.2 0v-5.3ZM9.2 6.1A2.1 2.1 0 1 1 11.3 4v2.1H9.2Zm0 1.1a2.1 2.1 0 0 1 0 4.2H3.9a2.1 2.1 0 0 1 0-4.2h5.3ZM18 9.3a2.1 2.1 0 1 1 2.1 2.1H18V9.3Zm-1.1 0a2.1 2.1 0 0 1-4.2 0V3.9a2.1 2.1 0 1 1 4.2 0v5.4ZM14.8 18a2.1 2.1 0 1 1-2.1 2.1V18h2.1Zm0-1.1a2.1 2.1 0 0 1 0-4.2h5.3a2.1 2.1 0 0 1 0 4.2h-5.3Z" />
  </svg>
);
export const IconeMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" />
  </svg>
);

/** Setinha do menu, virada quando ele está aberto. */
export const ChevronDown = ({ aberto }: { aberto: boolean }) => (
  <svg className={aberto ? 'seta virada' : 'seta'} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconeFechar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
/** Seta do cabeçalho do calendário: o mesmo chevron do menu, deitado. */
export const SetaMes = ({ dir }: { dir: 'esq' | 'dir' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    style={{ transform: dir === 'esq' ? 'rotate(90deg)' : 'rotate(-90deg)' }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
