-- Proxy de vídeo: transcodifica .mov/ProRes em MP4 H.264 para tocar no player.
-- O worker (Cloud Run + ffmpeg) gera o MP4 e grava proxy_file_id + status.
--
-- ⚠️ ANTES DE RODAR: troque <CLOUD_RUN_URL> pela URL do serviço no Cloud Run
--    (ex.: https://transcode-xxxx.a.run.app) e <SEGREDO> pelo mesmo valor do
--    secret TRANSCODE_SECRET do worker (ex.: `openssl rand -hex 24`).

ALTER TABLE public.video_versions
  ADD COLUMN IF NOT EXISTS proxy_file_id    text,
  ADD COLUMN IF NOT EXISTS transcode_status text,   -- null = não precisa; pending/processing/ready/error
  ADD COLUMN IF NOT EXISTS transcode_error  text;

CREATE EXTENSION IF NOT EXISTS pg_net;

-- BEFORE INSERT: marca 'pending' quando o arquivo é .mov/quicktime (precisa de proxy).
CREATE OR REPLACE FUNCTION public.mark_transcode_pending()
RETURNS trigger AS $$
BEGIN
  IF (NEW.file_name ILIKE '%.mov' OR NEW.mime_type ILIKE '%quicktime%')
     AND NEW.proxy_file_id IS NULL THEN
    NEW.transcode_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mark_transcode ON public.video_versions;
CREATE TRIGGER trg_mark_transcode
  BEFORE INSERT ON public.video_versions
  FOR EACH ROW EXECUTE FUNCTION public.mark_transcode_pending();

-- AFTER INSERT: se ficou 'pending', chama o worker (fire-and-forget via pg_net).
CREATE OR REPLACE FUNCTION public.call_transcode_worker()
RETURNS trigger AS $$
BEGIN
  IF NEW.transcode_status = 'pending' THEN
    PERFORM net.http_post(
      url := '<CLOUD_RUN_URL>/transcode',
      body := jsonb_build_object('version_id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-transcode-secret', '<SEGREDO>'
      ),
      timeout_milliseconds := 8000
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'transcode enqueue falhou p/ versao %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_call_transcode ON public.video_versions;
CREATE TRIGGER trg_call_transcode
  AFTER INSERT ON public.video_versions
  FOR EACH ROW EXECUTE FUNCTION public.call_transcode_worker();

-- Realtime para o player saber quando o proxy ficou pronto (se ainda não estiver).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.video_versions;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
