import type { ReactNode } from 'react';
import FundoDeck from '@/components/common/FundoDeck';
import { PORTAL_CSS } from '../portalCliente.css';

/** A moldura do portal: fundo, folha de estilo e tema, escritos uma vez só.
 *  Antes, cada tela (erro, entrada, nome, carregando, portal) repetia isto. */
export default function PortalFrame({ tema, children, centralizado = false, padding, fundo = true }: {
  tema: 'escuro' | 'claro';
  children: ReactNode;
  /** Centraliza o conteúdo na tela inteira (telas de erro, entrada e carregando). */
  centralizado?: boolean;
  padding?: number;
  /** O ErrorBoundary não monta o fundo animado para não repetir um erro dele. */
  fundo?: boolean;
}) {
  return (
    <div className={`portal-lumos ${tema === 'claro' ? 'claro' : ''}`}
      style={centralizado ? { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding } : undefined}>
      {fundo && <div className="fundo-portal" aria-hidden><FundoDeck tema={tema === 'claro' ? 'light' : 'dark'} /></div>}
      <style>{PORTAL_CSS}</style>
      {children}
    </div>
  );
}
