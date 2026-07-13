-- Criar a pasta do projeto no Drive sob demanda.
--
-- Antes, o provisionamento só rodava no INSERT do projeto e no UPDATE quando
-- nome/código/segmento mudavam. Projetos antigos (ou onde o provision falhou)
-- ficavam sem pasta e o app não deixava subir documentos.
--
-- Agora o trigger de UPDATE também dispara quando o projeto AINDA NÃO TEM pasta
-- (drive_folder_id IS NULL). Assim, um simples "toque" no projeto (ex.: o app
-- atualizando updated_at) reprovisiona a pasta. Reusa a função
-- notify_drive_provision() já existente — NÃO a redefine, pra preservar o
-- x-drive-secret que está embutido nela.
--
-- Sem risco de loop: quando a edge function grava o drive_folder_id, o novo
-- valor deixa de ser NULL, então esse UPDATE não re-dispara o trigger (e
-- nome/código/segmento não mudaram).

DROP TRIGGER IF EXISTS drive_provision_on_project_update ON public.projects;
CREATE TRIGGER drive_provision_on_project_update
  AFTER UPDATE ON public.projects
  FOR EACH ROW
  WHEN (
    OLD.name        IS DISTINCT FROM NEW.name
    OR OLD.code     IS DISTINCT FROM NEW.code
    OR OLD.category IS DISTINCT FROM NEW.category
    OR NEW.drive_folder_id IS NULL
  )
  EXECUTE FUNCTION public.notify_drive_provision();
