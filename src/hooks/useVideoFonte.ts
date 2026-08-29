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
    let guarda: number | undefined;

    const usarArquivoDireto = () => {
      if (!vivo) return;
      window.clearTimeout(guarda);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      setViaCdn(false);
      setQualidades([]);
      if (video.src !== fallbackUrl) video.src = fallbackUrl;
    };

    if (!hlsUrl) { usarArquivoDireto(); return; }

    /**
     * REDE DE SEGURANÇA do caminho da CDN.
     *
     * Cada etapa daqui pra frente pode falhar sem avisar ninguém: o pedaço do
     * hls.js pode não chegar (chunk velho logo depois de um deploy, rede da
     * empresa barrando), o navegador pode dizer que toca HLS nativo e não tocar
     * (o Chrome responde "maybe" e depois não decodifica), a CDN pode não
     * responder. Em qualquer um desses casos o vídeo simplesmente não recebia
     * fonte nenhuma: girava pra sempre, sem mensagem e sem botão de qualidade
     * — que foi exatamente a tela que apareceu num teste.
     *
     * Então: se em alguns segundos nada tiver começado a carregar, cai pro
     * arquivo direto. Ele é mais lento, mas toca. Player parado pra sempre é
     * pior que vídeo lento.
     */
    guarda = window.setTimeout(() => {
      if (!vivo || video.readyState !== 0) return;
      console.warn('[lumos] a CDN não respondeu a tempo; tocando o arquivo direto.');
      usarArquivoDireto();
    }, 8000);

    (async () => {
      let HlsCtor: typeof import('hls.js').default;
      try {
        HlsCtor = (await import('hls.js')).default;
      } catch {
        // Sem o hls.js não existe caminho de CDN: vai direto pro arquivo, em
        // vez de deixar a promessa morrer no silêncio.
        usarArquivoDireto();
        return;
      }
      if (!vivo) { window.clearTimeout(guarda); return; }

      // O hls.js vem PRIMEIRO. O Chrome responde "maybe" para o tipo do HLS,
      // que é um valor verdadeiro, então testar canPlayType antes fazia todo
      // mundo cair no player nativo: o vídeo até tocava, mas sem lista de
      // qualidades (o menu sumia) e sem controle nenhum de adaptação — abria
      // no nível mais baixo e demorava pra subir. Nativo só quando o hls.js
      // não roda mesmo, que é o caso do Safari e do iOS.
      if (!HlsCtor.isSupported()) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          setViaCdn(true);
          video.src = hlsUrl;
        } else {
          usarArquivoDireto();
        }
        return;
      }

      const hls = new HlsCtor({
        // Buffer generoso: a CDN entrega rápido, então vale adiantar. Antes não
        // adiantava nada, porque cada pedaço custava quase dois segundos.
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        startLevel: -1,
        capLevelToPlayerSize: true,
        // Sem isso o hls.js supõe uma banda pessimista, abre na pior qualidade
        // e leva um tempão pra subir — foi exatamente a queixa. Partindo de uma
        // estimativa realista, ele já entra numa qualidade decente e corrige
        // pra baixo se a internet não acompanhar.
        abrEwmaDefaultEstimate: 5_000_000,
      });
      hlsRef.current = hls;

      hls.on(HlsCtor.Events.MANIFEST_PARSED, (_e, dados: any) => {
        if (!vivo) return;
        setViaCdn(true);
        setQualidades(
          (dados.levels || [])
            .map((n: any, i: number) => {
              // Em vídeo vertical a altura é o lado GRANDE: 1080x1920 apareceria
              // como "1920p". O nome da qualidade sempre segue o lado menor, que
              // é o que a equipe e o cliente reconhecem.
              const lado = n.width && n.height ? Math.min(n.width, n.height) : (n.height || 0);
              return { id: i, altura: lado, rotulo: lado ? `${lado}p` : `Nível ${i + 1}` };
            })
            .sort((x: Qualidade, y: Qualidade) => y.altura - x.altura),
        );
      });
      hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, dados: any) => {
        if (vivo) setQualidadeAtual(hls.autoLevelEnabled ? -1 : dados.level);
      });
      hls.on(HlsCtor.Events.ERROR, (_e, dados: any) => {
        if (!dados?.fatal) return;
        // Falhou de vez: melhor cair no arquivo direto do que deixar tela preta.
        usarArquivoDireto();
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    })();

    return () => {
      vivo = false;
      window.clearTimeout(guarda);
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

