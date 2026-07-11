-- Integração App Lumos × Google Drive (Fase 1: pastas automáticas)
--
-- 1) IDs das pastas do Drive gravados no banco (nunca localizar por nome)
ALTER TABLE public.clients  ADD COLUMN IF NOT EXISTS drive_folder_id text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS drive_folder_id text;

-- 2) Log de auditoria/erros da automação
CREATE TABLE IF NOT EXISTS public.drive_sync_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,          -- 'client' | 'project'
  entity_id   uuid,
  action      text NOT NULL,          -- 'create_folder' | 'skip' | 'error' | ...
  detail      text,
  status      text NOT NULL DEFAULT 'ok',  -- 'ok' | 'error'
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.drive_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read drive log" ON public.drive_sync_log;
CREATE POLICY "authenticated read drive log"
  ON public.drive_sync_log FOR SELECT TO authenticated
  USING (true);
-- (escritas vêm da edge function com service_role, que ignora RLS)

-- 3) Webhook de banco via pg_net: todo INSERT em projects chama a edge
--    function drive-provision, que cria as pastas no Drive (cliente+projeto).
--    ⚠️ TROQUE <SEGREDO> pelo MESMO valor do secret DRIVE_WEBHOOK_SECRET da
--       edge function (ex.: saída de `openssl rand -hex 24`).
--    Usa pg_net diretamente (o schema supabase_functions dos Database
--    Webhooks do painel pode não existir no projeto).
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Se o aviso falhar, só registra warning — NUNCA bloqueia a criação do projeto.
CREATE OR REPLACE FUNCTION public.notify_drive_provision()
RETURNS trigger AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/drive-provision',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'projects',
      'record', to_jsonb(NEW)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-drive-secret', '<SEGREDO>'
    ),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'drive-provision webhook falhou: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS drive_provision_on_project_insert ON public.projects;
CREATE TRIGGER drive_provision_on_project_insert
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.notify_drive_provision();
