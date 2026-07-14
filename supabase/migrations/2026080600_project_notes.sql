-- Anotações do projeto (rich text com menções de pessoas/arquivos/vídeos).
-- Guardado como HTML na própria linha do projeto. RLS/edição já cobertas pelas
-- policies de projects (admin/produção editam).
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS notes text;
