-- PLAYER RÁPIDO: cópia de reprodução no Cloudflare Stream
--
-- Hoje cada pedaço do vídeo passa pela nossa função, que acorda do zero a cada
-- pedido: medi ~1,8s de espera por requisição (~700ms de banco, ~220ms de login
-- no Google, ~850ms de Drive). O player faz dezenas dessas por vídeo, e é isso
-- que a equipe sente como "demora pra abrir" e "buffer ruim".
--
-- A saída é tirar o vídeo desse caminho: o Stream recebe uma cópia, converte em
-- várias qualidades e entrega por CDN. O Drive segue sendo a fonte da verdade e
-- o download; estas colunas só guardam o endereço da cópia de reprodução.
--
-- Seguro de rodar a qualquer momento: só adiciona colunas, não altera nada do
-- que já existe. Enquanto stream_uid estiver vazio, o player usa o caminho de
-- hoje — a migração acontece vídeo a vídeo, sem ninguém ficar sem assistir.

ALTER TABLE public.video_versions
  ADD COLUMN IF NOT EXISTS stream_uid    text,   -- id do vídeo no Cloudflare Stream
  ADD COLUMN IF NOT EXISTS stream_status text,   -- null = ainda não enviado; enviando/processando/pronto/erro
  ADD COLUMN IF NOT EXISTS stream_error  text;

-- Só precisamos varrer o que ainda não terminou, então o índice cobre
-- exatamente isso e fica minúsculo.
CREATE INDEX IF NOT EXISTS idx_video_versions_stream_pendente
  ON public.video_versions(stream_status)
  WHERE stream_status IS DISTINCT FROM 'pronto';

-- Conferência: deve listar as três colunas novas.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'video_versions'
  AND column_name IN ('stream_uid', 'stream_status', 'stream_error')
ORDER BY column_name;
