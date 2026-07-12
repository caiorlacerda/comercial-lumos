-- Cofre de Acessos: além de admin/produção (que gerenciam), os cargos que usam
-- as ferramentas (editor, atendimento, social_media) passam a poder LER as
-- senhas, para não precisarem ficar perguntando. Edição continua só
-- admin/produção (policy manage_access_credentials permanece).

DROP POLICY IF EXISTS read_access_credentials ON public.access_credentials;
CREATE POLICY read_access_credentials ON public.access_credentials
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento', 'social_media'));
