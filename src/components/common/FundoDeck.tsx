import { useTheme } from '@/context/ThemeContext';

// Grão fino (ruído) para as duas versões, como nos fundos do deck.
const GRAO = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/**
 * Fundo de luz difusa do pitch deck da Lumos, fixo atrás do conteúdo da tela (sem fractal):
 * um feixe dourado que nasce fino no canto inferior esquerdo, se abre e se dissipa.
 * Escuro no tema escuro (imagem do deck) e cinza quente no claro (gradientes).
 * O conteúdo da página precisa ter `relative z-10` para ficar acima dele; a barra lateral
 * e os cabeçalhos já ficam acima.
 */
export default function FundoDeck({ tema }: { tema?: 'dark' | 'light' } = {}) {
  const { theme: temaDoApp } = useTheme();
  const theme = tema ?? temaDoApp;

  if (theme === 'dark') {
    return (
      <div className="fundo-deck pointer-events-none fixed inset-0 z-0" aria-hidden>
        <img
          src="/home/fundo-escuro-1920.jpg"
          srcSet="/home/fundo-escuro-1280.jpg 1280w, /home/fundo-escuro-1920.jpg 1920w"
          sizes="100vw"
          alt=""
          className="h-full w-full object-cover"
          style={{ objectPosition: '40% 50%' }}
        />
        <div className="absolute inset-0" style={{ background: 'rgba(22,22,22,0.12)' }} />
      </div>
    );
  }

  return (
    <div className="fundo-deck pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden style={{ background: 'linear-gradient(135deg, #e9e6e1 0%, #d9d5ce 100%)' }}>
      {/* brilho quente largo */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 60% at 28% 78%, rgba(239,199,0,0.28), rgba(239,199,0,0) 70%)' }} />
      {/* o feixe: fino na origem, abre e se dissipa */}
      <div
        className="absolute"
        style={{
          left: '-8%', bottom: '10%', width: '120%', height: '38%',
          transform: 'rotate(-17deg)', transformOrigin: '10% 100%',
          background: 'radial-gradient(ellipse 55% 50% at 30% 60%, rgba(239,199,0,0.75) 0%, rgba(239,199,0,0.38) 45%, rgba(239,199,0,0) 80%)',
          filter: 'blur(36px)',
        }}
      />
      <div className="absolute inset-0" style={{ backgroundImage: GRAO, opacity: 0.1, mixBlendMode: 'multiply' }} />
    </div>
  );
}
