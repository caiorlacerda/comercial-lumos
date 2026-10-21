import { useEffect, type ReactNode } from 'react';
import { carregarFontesDeck } from '@/lib/fontesDeck';

/**
 * Moldura das páginas públicas (quem não tem login: fornecedor, cliente, convidado).
 * Mesmo visual do login: fundo de vidro canelado com a luz da Lumos, topo com logotipo e ano,
 * cartão de vidro, DM Sans no texto, Instrument Serif nos títulos e JetBrains Mono nos rótulos.
 * É sempre escura, independente do tema do app (quem abre o link não tem tema escolhido).
 */
export const DM = "'DM Sans', Arial, sans-serif";
export const SERIF = "'Instrument Serif', Georgia, serif";
export const MONO = "'JetBrains Mono', 'Courier New', monospace";

/** Rótulo de campo (mono, caixa alta). Use com `style={{ fontFamily: MONO }}`. */
export const ROTULO_PUBLICO = 'block text-[11px] uppercase tracking-[3px] text-[#d5d3d0] mb-2';
/** Campo de texto, senha, data, select e textarea (acrescente a altura: `h-12`, `h-24`…). */
export const CAMPO_PUBLICO = 'w-full rounded-xl px-4 text-[15px] text-white placeholder:text-white/35 bg-[#161616]/55 '
  + 'border border-white/[0.22] outline-none transition-colors focus:border-[#efc700]';
export const BOTAO_AMARELO = 'flex items-center justify-center gap-2 rounded-full bg-[#efc700] text-[#161616] font-semibold '
  + 'transition hover:brightness-110 disabled:opacity-60';
export const BOTAO_CONTORNO = 'flex items-center justify-center gap-2 rounded-full border border-white/[0.22] text-white/90 '
  + 'transition-colors hover:bg-white/10 disabled:opacity-60';
/** Cartão de vidro (borda fina, fundo escuro translúcido e desfoque; escuro o bastante para o texto ler sobre as faixas claras do fundo). */
export const CARTAO_VIDRO = 'rounded-xl border border-white/[0.22] bg-[#161616]/60 backdrop-blur-[20px]';
/** Cartão de vidro mais fechado, para formulários longos (leitura sobre a imagem de fundo). */
export const CARTAO_VIDRO_FORTE = 'rounded-xl border border-white/[0.22] bg-[#161616]/75 backdrop-blur-[20px]';

interface Props {
  children: ReactNode;
  /** Largura máxima do conteúdo (classe Tailwind). Padrão: janela estreita, como o login. */
  largura?: string;
  /** Texto pequeno à direita do rodapé. */
  rodape?: string;
}

export default function PaginaPublica({ children, largura = 'max-w-md', rodape }: Props) {
  useEffect(() => { carregarFontesDeck(); }, []);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#161616] text-white" style={{ fontFamily: DM }}>
      <img
        src="/login/fundo-1920.jpg"
        srcSet="/login/fundo-1280.jpg 1280w, /login/fundo-1920.jpg 1920w"
        sizes="100vw"
        alt=""
        className="fixed inset-0 h-full w-full object-cover"
        style={{ objectPosition: '68% 50%' }}
      />
      <div className="fixed inset-0 pointer-events-none bg-[#161616]/45" />
      <div className="fixed inset-x-0 top-0 h-[260px] pointer-events-none" style={{ background: 'linear-gradient(180deg, #161616b3 0%, #16161600 100%)' }} />
      <div className="fixed inset-x-0 bottom-0 h-[260px] pointer-events-none" style={{ background: 'linear-gradient(180deg, #16161600 0%, #16161699 100%)' }} />

      <main
        className="relative z-10 flex min-h-[100dvh] flex-col px-5 sm:px-10"
        style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <header className="flex items-center gap-5 sm:gap-8">
          <img src="/login/logo-lumos-branco.svg" alt="Produtora Lumos" className="h-6 w-auto sm:h-[30px]" />
          <div className="h-px flex-1 bg-white/70" />
          <span className="text-[11px] sm:text-[13.5px] tracking-[3px]" style={{ fontFamily: MONO }}>{new Date().getFullYear()}</span>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center py-8 sm:py-10">
          <div className={`w-full ${largura} animate-in fade-in zoom-in-95 duration-700`}>
            {children}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-[2px] text-[#d5d3d0] sm:text-[11px]" style={{ fontFamily: MONO }}>
          <span className="whitespace-nowrap">Produtora Lumos</span>
          {rodape && <span className="text-right">{rodape}</span>}
        </footer>
      </main>
    </div>
  );
}
