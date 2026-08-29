import { clsx } from 'clsx';

/**
 * GUIAS DE ENQUADRAMENTO sobre o player.
 *
 * A Lumos entrega o mesmo material em 16:9, 9:16 e 1:1. Sem guia, conferir se o
 * texto cabe no cortado é adivinhação — e o erro só aparece depois de exportar.
 * Aqui a moldura fica por cima do vídeo, no lugar certo, calculada a partir do
 * tamanho REAL do vídeo dentro do quadro (object-contain deixa barra preta, e
 * desenhar sobre a barra daria uma guia mentirosa).
 *
 * A máscara escurece o que fica de fora, que é como se enxerga o corte de
 * verdade em vez de imaginar.
 */

export const PROPORCOES = [
  { id: '2.35', label: '2.35 : 1', valor: 2.35 },
  { id: '1.85', label: '1.85 : 1', valor: 1.85 },
  { id: '16:9', label: '16 : 9', valor: 16 / 9 },
  { id: '9:16', label: '9 : 16', valor: 9 / 16 },
  { id: '4:3', label: '4 : 3', valor: 4 / 3 },
  { id: '1:1', label: '1 : 1', valor: 1 },
] as const;

export type GuiaId = (typeof PROPORCOES)[number]['id'] | null;

interface Props {
  guia: GuiaId;
  mascara: boolean;
  /** Dimensões nativas do vídeo — sem elas não dá pra saber onde ele começa. */
  larguraVideo: number;
  alturaVideo: number;
}

export default function GuiasDeEnquadramento({ guia, mascara, larguraVideo, alturaVideo }: Props) {
  if (!guia || !larguraVideo || !alturaVideo) return null;
  const alvo = PROPORCOES.find(p => p.id === guia);
  if (!alvo) return null;

  const doVideo = larguraVideo / alturaVideo;

  // Em % do vídeo exibido. object-contain: o vídeo ocupa 100% de um dos eixos.
  let larg = 100, alt = 100;
  if (alvo.valor > doVideo) alt = (doVideo / alvo.valor) * 100;   // corta em cima e embaixo
  else larg = (alvo.valor / doVideo) * 100;                        // corta nas laterais

  const x = (100 - larg) / 2;
  const y = (100 - alt) / 2;

  return (
    <div className="absolute inset-0 pointer-events-none z-[5]">
      {/* O vídeo pode não preencher o quadro (barra preta). A moldura vive num
          contêiner com a proporção do vídeo, então ela nunca cai na barra. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative" style={{ aspectRatio: `${larguraVideo} / ${alturaVideo}`, maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%' }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative" style={{ aspectRatio: `${larguraVideo} / ${alturaVideo}`, height: '100%', maxWidth: '100%' }}>
              {mascara && (
                <>
                  <div className="absolute bg-black/60" style={{ left: 0, top: 0, width: '100%', height: `${y}%` }} />
                  <div className="absolute bg-black/60" style={{ left: 0, bottom: 0, width: '100%', height: `${y}%` }} />
                  <div className="absolute bg-black/60" style={{ top: `${y}%`, bottom: `${y}%`, left: 0, width: `${x}%` }} />
                  <div className="absolute bg-black/60" style={{ top: `${y}%`, bottom: `${y}%`, right: 0, width: `${x}%` }} />
                </>
              )}
              <div
                className={clsx('absolute border-2 border-lumos-yellow/90',
                  !mascara && 'shadow-[0_0_0_1px_rgba(0,0,0,0.6)]')}
                style={{ left: `${x}%`, top: `${y}%`, width: `${larg}%`, height: `${alt}%` }}
              >
                <span className="absolute -top-0.5 left-1 -translate-y-full text-[9px] font-black uppercase tracking-widest text-lumos-yellow bg-black/70 px-1.5 py-0.5 rounded">
                  {alvo.label}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
