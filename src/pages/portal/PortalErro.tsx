import { Component } from 'react';
import type { ReactNode } from 'react';
import PortalFrame from './PortalFrame';
import { lerSalvo } from './armazenamento';

/** Se qualquer parte da tela quebrar, o cliente vê um aviso com saída em vez de
 *  uma página em branco. */
export default class PortalErro extends Component<{ children: ReactNode }, { quebrou: boolean }> {
  state = { quebrou: false };
  static getDerivedStateFromError() { return { quebrou: true }; }
  componentDidCatch(erro: unknown) { console.error('[portal] erro de tela', erro); }
  render() {
    if (!this.state.quebrou) return this.props.children;
    const tema = lerSalvo('portal_tema') === 'claro' ? 'claro' : 'escuro';
    return (
      <PortalFrame tema={tema} centralizado padding={24} fundo={false}>
        <div style={{ textAlign: 'center' }} role="alert">
          <p className="rotulo">Algo deu errado ao mostrar o portal.</p>
          <button type="button" className="botao" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      </PortalFrame>
    );
  }
}
