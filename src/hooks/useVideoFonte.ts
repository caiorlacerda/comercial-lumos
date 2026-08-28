import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';

/**
 * DE ONDE O VÍDEO VEM.
 *
 * Caminho antigo: cada pedaço do arquivo passava por uma função nossa que
 * acorda do zero a cada pedido — medimos ~1,8s de espera por requisição, e o
 * player faz dezenas delas para tocar um vídeo só. Era isso que a equipe
 * sentia como "demora pra abrir" e "buffer ruim".
 *
 * Caminho novo: quando o vídeo já tem cópia no Cloudflare Stream, tocamos o
 * manifesto HLS, servido por CDN e já cortado em pedaços pequenos, que é o
 * formato que o navegador sabe bufferizar. De quebra vêm várias qualidades,
 * que é o que permite o botão de qualidade.
 *
 * A casca do player não muda: comentários com marcação de tempo, timecode e
 * desenho por cima continuam exatamente como estão. Muda só a fonte.
 *
 * Enquanto a cópia não está pronta, cai no caminho antigo sozinho — ninguém
 * fica sem assistir durante a migração.
 */

export type Qualidade = { id: number; altura: number; rotulo: string };

export function useVideoFonte(
  // Recebe o REF, não o elemento: na primeira renderização ref.current ainda é
  // nulo, e se dependêssemos dele o efeito poderia nunca rodar com o vídeo de
  // verdade — tela preta em quem ainda não tem cópia na CDN.
  videoRef: { current: HTMLVideoElement | null },
  hlsUrl: string | null | undefined,
  fallbackUrl: string,
) {
  const hlsRef = useRef<Hls | null>(null);
  const [qualidades, setQualidades] = useState<Qualidade[]>([]);
  const [qualidadeAtual, setQualidadeAtual] = useState(-1); // -1 = automática
  const [viaCdn, setViaCdn] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let vivo = true;

    const usarArquivoDireto = () => {
      if (!vivo) return;
      setViaCdn(false);
      setQualidades([]);
      if (video.src !== fallbackUrl) video.src = fallbackUrl;
    };

    if (!hlsUrl) { usarArquivoDireto(); return; }

    // Safari toca HLS nativo e faz isso melhor que qualquer biblioteca.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      setViaCdn(true);
      video.src = hlsUrl;
      return;
    }

    (async () => {
      const { default: HlsCtor } = await import('hls.js');
      if (!vivo || !HlsCtor.isSupported()) { usarArquivoDireto(); return; }

      const hls = new HlsCtor({
        // Buffer generoso: a CDN entrega rápido, então vale adiantar. Antes não
        // adiantava nada, porque cada pedaço custava quase dois segundos.
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        // Começa por uma qualidade modesta pra imagem aparecer logo, e sobe
        // assim que a banda se mostra. É o que faz o vídeo "abrir na hora".
        startLevel: -1,
        capLevelToPlayerSize: true,
      });
      hlsRef.current = hls;

      hls.on(HlsCtor.Events.MANIFEST_PARSED, (_e, dados: any) => {
        if (!vivo) return;
        setViaCdn(true);
        setQualidades(
          (dados.levels || [])
            .map((n: any, i: number) => ({ id: i, altura: n.height || 0, rotulo: n.height ? `${n.height}p` : `Nível ${i + 1}` }))
            .sort((x: Qualidade, y: Qualidade) => y.altura - x.altura),
        );
      });
      hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, dados: any) => {
        if (vivo) setQualidadeAtual(hls.autoLevelEnabled ? -1 : dados.level);
      });
      hls.on(HlsCtor.Events.ERROR, (_e, dados: any) => {
        if (!dados?.fatal) return;
        // Falhou de vez: melhor cair no arquivo direto do que deixar tela preta.
        hls.destroy(); hlsRef.current = null;
        usarArquivoDireto();
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    })();

    return () => {
      vivo = false;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [videoRef, hlsUrl, fallbackUrl]);

  const trocarQualidade = (id: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = id;        // -1 devolve pro automático
    setQualidadeAtual(id);
  };

  return { qualidades, qualidadeAtual, trocarQualidade, viaCdn };
}
