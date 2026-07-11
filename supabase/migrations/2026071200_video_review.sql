-- Revisão de vídeo (Fase 2): detecção de versões no dropzone + máquina de estados.

-- 1) Toggle por projeto: após alteração do cliente, a próxima versão volta para
--    revisão interna primeiro (padrão) ou vai direto para o cliente.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS review_back_to_internal boolean NOT NULL DEFAULT true;

-- 2) Versões de vídeo detectadas em 06_ENTREGA/01_REVISAO
CREATE TABLE IF NOT EXISTS public.video_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id        uuid REFERENCES public.project_tasks(id) ON DELETE SET NULL, -- vínculo opcional (espelho de status)
  versao         integer NOT NULL,                 -- NN de _vNN
  file_name      text NOT NULL,
  drive_file_id  text NOT NULL UNIQUE,             -- idempotência: 1 registro por arquivo
  drive_web_link text,                             -- webViewLink para abrir no Drive
  status         text NOT NULL DEFAULT 'EM_REVISAO_INTERNA'
                 CHECK (status IN ('EM_REVISAO_INTERNA','ALTERACOES_INTERNAS',
                                   'EM_REVISAO_CLIENTE','ALTERACOES_CLIENTE','APROVADO')),
  approved_file_id text,                           -- id do vFINAL copiado em 02_APROVADO
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_versions_project ON public.video_versions(project_id);

ALTER TABLE public.video_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read video versions" ON public.video_versions;
CREATE POLICY "authenticated read video versions"
  ON public.video_versions FOR SELECT TO authenticated USING (true);

-- A equipe avança os estados pelo app (inserts vêm da edge function/service_role)
DROP POLICY IF EXISTS "authenticated update video versions" ON public.video_versions;
CREATE POLICY "authenticated update video versions"
  ON public.video_versions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 3) Polling do dropzone via pg_cron (a cada 3 min chama a edge function drive-watch).
--    ⚠️ TROQUE <SEGREDO> pelo mesmo DRIVE_WEBHOOK_SECRET das funções de Drive.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove agendamento anterior (idempotência ao rodar de novo)
SELECT cron.unschedule('drive-watch-every-3min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drive-watch-every-3min');

SELECT cron.schedule(
  'drive-watch-every-3min',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/drive-watch',
    headers := jsonb_build_object('Content-Type','application/json','x-drive-secret','<SEGREDO>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);
