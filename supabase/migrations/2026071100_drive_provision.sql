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

-- 3) Webhook de banco: todo INSERT em projects chama a edge function
--    drive-provision, que cria as pastas no Drive (cliente + projeto).
--    ⚠️ TROQUE <SEGREDO> por um valor aleatório longo (ex.: saída de
--       `openssl rand -hex 24`) — o MESMO valor vai no secret
--       DRIVE_WEBHOOK_SECRET da edge function.
--    ⚠️ Se der erro "schema supabase_functions does not exist", habilite
--       Database Webhooks no painel (Database → Webhooks → Enable) e rode
--       este bloco de novo.
DROP TRIGGER IF EXISTS drive_provision_on_project_insert ON public.projects;
CREATE TRIGGER drive_provision_on_project_insert
  AFTER INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/drive-provision',
    'POST',
    '{"Content-Type":"application/json","x-drive-secret":"<SEGREDO>"}',
    '{}',
    '5000'
  );
