import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Portal } from '../tipos';
import { montarFileiras } from '../catalogo';
import { useCapasPorVisibilidade } from '../useCapasPorVisibilidade';
import FileiraCatalogo from '../catalogo/FileiraCatalogo';

const CHAVE_ROLAGEM = 'lumos_catalogo_rolagem';
const VALIDADE_MS = 30 * 60 * 1000;

interface Posicao { quando: number; y: number; fileiras: Record<string, number> }

export default function Catalogo({ dados, capas, pedirCapas, marcarVolta }: {
  dados: Portal;
  capas: Record<string, string | null>;
  pedirCapas: (tokens: string[]) => Promise<void>;
  marcarVolta: () => void;
}) {
  const fileiras = useMemo(() => montarFileiras(dados), [dados]);
  const observar = useCapasPorVisibilidade(pedirCapas);
  const faixas = useRef(new Map<string, HTMLDivElement>());

  const registrar = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) faixas.current.set(id, el); else faixas.current.delete(id);
  }, []);

  // Ao sair para o vídeo: guarda a rolagem vertical e a de cada fileira, e deixa o bilhete de volta.
  const aoAbrir = useCallback(() => {
    try {
      const fileirasPos: Record<string, number> = {};
      faixas.current.forEach((el, id) => { fileirasPos[id] = el.scrollLeft; });
      const p: Posicao = { quando: Date.now(), y: window.scrollY, fileiras: fileirasPos };
      sessionStorage.setItem(CHAVE_ROLAGEM, JSON.stringify(p));
    } catch { /* sem sessionStorage: só não restaura */ }
    marcarVolta();
  }, [marcarVolta]);

  // Ao voltar: restaura UMA vez, depois que o shell termina de rolar para o topo.
  // O bilhete é lido e apagado uma só vez e fica numa ref: no modo estrito o React
  // monta, desmonta e monta o efeito de novo, e sem a ref a segunda montagem
  // não acharia mais o bilhete (a primeira teve o temporizador cancelado).
  const bilhete = useRef<Posicao | null | undefined>(undefined);
  useEffect(() => {
    if (bilhete.current === undefined) {
      let p: Posicao | null = null;
      try {
        const bruto = sessionStorage.getItem(CHAVE_ROLAGEM);
        sessionStorage.removeItem(CHAVE_ROLAGEM);
        p = bruto ? (JSON.parse(bruto) as Posicao) : null;
      } catch { p = null; }
      bilhete.current = p && Number.isFinite(p.quando) && Date.now() - p.quando <= VALIDADE_MS ? p : null;
    }
    const alvo = bilhete.current;
    if (!alvo) return;
    const t = window.setTimeout(() => {
      bilhete.current = null;
      faixas.current.forEach((el, id) => { const x = alvo.fileiras?.[id]; if (typeof x === 'number') el.scrollLeft = x; });
      if (typeof alvo.y === 'number') window.scrollTo({ top: alvo.y, behavior: 'auto' });
    }, 160);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <main className="painel">
      <div className="folha">
        <div className="cabeca-proj">
          <p className="rotulo">Catálogo</p>
          <h2>Todos os vídeos<br />em um só lugar</h2>
        </div>
        {fileiras.length === 0 ? (
          <p className="nota">Nada para ver ainda. Quando um vídeo estiver pronto para você, ele aparece aqui.</p>
        ) : fileiras.map(f => (
          <FileiraCatalogo key={f.id} fileira={f} capas={capas} observar={observar} aoAbrir={aoAbrir}
            mostrarProjeto={f.id === 'espera'} registrar={registrar} />
        ))}
      </div>
    </main>
  );
}
