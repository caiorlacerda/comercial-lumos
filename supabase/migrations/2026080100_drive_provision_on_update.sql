-- Renomear a pasta do Drive quando o projeto é EDITADO (nome/código).
-- Reusa a função notify_drive_provision() já existente (que carrega o segredo
-- real no banco) — NÃO a redefine, pra não sobrescrever o x-drive-secret.
--
-- IMPORTANTE: o trigger é condicional (WHEN) e só dispara quando nome ou
-- código mudam. Isso evita loop: a própria drive-provision atualiza
-- drive_folder_id/drive_upload_folder_id, e essas mudanças NÃO re-disparam.
--
-- O comentário original também citava "segmento" (OLD/NEW.category), mas
-- projects nunca teve coluna category em nenhuma migration — só
-- budgets.category existe. Isso fazia essa migration falhar ao recriar o
-- banco do zero (descoberto só agora, ao rodar `supabase start` pela
-- primeira vez); bem provável que esse trigger nunca tenha sido criado de
-- verdade em produção também. Removida a condição inexistente.

DROP TRIGGER IF EXISTS drive_provision_on_project_update ON public.projects;
CREATE TRIGGER drive_provision_on_project_update
  AFTER UPDATE ON public.projects
  FOR EACH ROW
  WHEN (
    OLD.name IS DISTINCT FROM NEW.name
    OR OLD.code IS DISTINCT FROM NEW.code
  )
  EXECUTE FUNCTION public.notify_drive_provision();
