import { useTheme } from '@/context/ThemeContext';

/**
 * Fundo de vidro canelado do pitch deck da Lumos, fixo atrás do conteúdo da tela.
 * Escuro no tema escuro, cinza claro no tema claro. O conteúdo da página precisa ter
 * `relative z-10` para ficar acima dele; a barra lateral e os cabeçalhos já ficam acima.
 */
export default function FundoDeck() {
  const { theme } = useTheme();
  const escuro = theme === 'dark';
  const base = escuro ? '/home/fundo-escuro' : '/home/fundo-claro';
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <img
        src={`${base}-1920.jpg`}
        srcSet={`${base}-1280.jpg 1280w, ${base}-1920.jpg 1920w`}
        sizes="100vw"
        alt=""
        className="h-full w-full object-cover"
        style={{ objectPosition: '82% 50%' }}
      />
      {/* Escurece/clareia um pouco para os cartões de vidro lerem bem */}
      <div className="absolute inset-0" style={{ background: escuro ? 'rgba(22,22,22,0.12)' : 'rgba(245,245,243,0.2)' }} />
    </div>
  );
}
