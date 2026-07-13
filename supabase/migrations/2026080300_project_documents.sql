-- Documentos do projeto: arquivos fechados (subidos pro Drive do projeto) e
-- links de arquivos do Google (Docs/Sheets/Slides) ou qualquer URL.
--
-- Organização: lista única por projeto, cada item com uma etiqueta (tag).
-- O arquivo físico vive no Google Drive (pasta do projeto); aqui guardamos só
-- o metadado + o link, pra acessar rápido pela plataforma.

CREATE TABLE IF NOT EXISTS public.project_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  url           text NOT NULL,
  -- file | gdoc | gsheet | gslides | link
  kind          text NOT NULL DEFAULT 'file',
  -- roteiro | contrato | referencia | entrega | outro
  tag           text NOT NULL DEFAULT 'outro',
  drive_file_id text,
  mime_type     text,
  created_by    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_documents_project_id_idx
  ON public.project_documents (project_id);

-- RLS: mesma faixa de papéis que gerencia tarefas/produção (contratos e roteiros
-- não devem vazar para papéis fora da produção). get_user_role() já existe.
ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manage_project_documents ON public.project_documents;
CREATE POLICY manage_project_documents ON public.project_documents
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento', 'social_media'))
  WITH CHECK (public.get_user_role() IN ('admin', 'producao', 'editor', 'atendimento', 'social_media'));

-- Realtime: lista atualiza ao vivo entre usuários (padrão do app).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_documents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_documents;
  END IF;
END $$;
