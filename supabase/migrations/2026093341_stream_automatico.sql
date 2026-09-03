-- ENVIO AUTOMÁTICO PRO CLOUDFLARE STREAM
--
-- Até aqui, todo vídeo novo caía no caminho lento (a review-stream, que
-- acorda do zero a cada pedido) até alguém lembrar de clicar em "Migrar
-- acervo". Em 03/09/2026 isso rendeu 31 vídeos parados nesse caminho, um
-- deles no meio de uma aprovação. Este gatilho tira o "lembrar" da equação:
-- todo INSERT em video_versions já chama a stream-ingest sozinho, pedindo o
-- envio daquela versão.
--
-- Mesmo padrão do gatilho que cria pasta no Drive quando nasce um projeto
-- (migration 2026071100): pg_net, fogo e esquece, nunca bloqueia o que
-- disparou. Se o Stream estiver fora do ar, o vídeo cai no "Migrar acervo"
-- como plano B, que continua existindo pra isso e pros que derem erro.
--
-- ⚠️ ANTES DE RODAR: troque <SEGREDO> pelo MESMO valor do secret
--    DRIVE_WEBHOOK_SECRET que você já colou quando configurou o Drive. Não é
--    segredo novo, é o mesmo, reusado.
--
-- ⚠️ TAMBÉM: a função stream-ingest precisa estar redeployada com a ação
--    'auto' antes de rodar isto (a IA cuida do deploy, SQL é só você).

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notificar_video_para_stream()
RETURNS trigger AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/stream-ingest',
    body := jsonb_build_object(
      'action', 'auto',
      'version_id', NEW.id
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-drive-secret', '<SEGREDO>'
    ),
    timeout_milliseconds := 8000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca derruba o upload por causa disto. O vídeo continua tocando pelo
  -- caminho antigo até "Migrar acervo" pegar ele.
  RAISE WARNING 'notificar_video_para_stream falhou para %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.notificar_video_para_stream() IS
  'Vídeo novo entra em video_versions: chama a stream-ingest sozinho, pra nunca mais precisar de "Migrar acervo" na mão.';

DROP TRIGGER IF EXISTS trg_enviar_pro_stream ON public.video_versions;
CREATE TRIGGER trg_enviar_pro_stream
  AFTER INSERT ON public.video_versions
  FOR EACH ROW EXECUTE FUNCTION public.notificar_video_para_stream();

-- Conferência: o gatilho tem que aparecer na lista.
SELECT tgname AS gatilho, tgenabled AS ligado
FROM pg_trigger
WHERE tgrelid = 'public.video_versions'::regclass AND tgname = 'trg_enviar_pro_stream';
