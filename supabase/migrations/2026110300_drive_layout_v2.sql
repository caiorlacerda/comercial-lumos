-- DRIVE: ESTRUTURA NOVA DE PASTAS (layout v2) NOS PROJETOS NOVOS
--
-- Hierarquia do projeto novo:  Cliente › PROJETOS › [Sub-marca] › AAAA-MM › NNN_NOME › subpastas
--   (ao lado de PROJETOS, o cliente novo tem MARCA: brandbook, logos, fontes, guidelines; o cliente
--   antigo continua com a _ASSETS, que o código aceita no lugar da MARCA e não renomeia sozinho)
-- Subpastas: 00_DOCUMENTOS, 01_BRUTO, 02_ARTES/01_TRILHAS, 03_EXPORT/01_REVISAO, 03_EXPORT/02_FINAL.
--
-- O que esta migration faz (só estrutura; nenhum dado existente muda):
--   · projects.marca          sub-marca do projeto (opcional; vem da lista fechada do cliente; fica DENTRO de PROJETOS)
--   · projects.drive_layout   'v1' = estrutura antiga (default, todos os projetos de hoje)
--                             'v2' = estrutura nova (marcada pela drive-provision ao criar a pasta)
--   · projects.drive_pastas   IDs das subpastas do projeto v2:
--                             {documentos, bruto, artes, trilhas, export, revisao, final}
--   · clients.marcas          lista fechada de marcas do cliente (ex.: Vitru → Uniasselvi, Continuada, Vitru)
--   · trigger de UPDATE       também dispara quando a marca muda (é assim que a pasta de um cliente com
--                             marcas nasce depois que a produção escolhe a marca); mantém a condição de
--                             categoria que já existe em produção
--
-- ORDEM: rodar esta migration ANTES de subir as edge functions e o front desta mudança.
-- Seguro rodar mais de uma vez. Reusa notify_drive_provision() (não a redefine, para preservar o segredo).

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS marca        text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS drive_layout text NOT NULL DEFAULT 'v1';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS drive_pastas jsonb;
ALTER TABLE public.clients  ADD COLUMN IF NOT EXISTS marcas       text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_drive_layout_check' AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_drive_layout_check CHECK (drive_layout IN ('v1', 'v2'));
  END IF;
END $$;

COMMENT ON COLUMN public.projects.drive_layout IS
  'Estrutura de pastas do projeto no Drive: v1 (antiga, subpastas achadas pelo nome) ou v2 (nova, subpastas pelo ID em drive_pastas).';
COMMENT ON COLUMN public.projects.drive_pastas IS
  'Layout v2: IDs das subpastas {documentos, bruto, artes, trilhas, export, revisao, final}. O código usa estes IDs e nunca procura pasta pelo nome.';
COMMENT ON COLUMN public.clients.marcas IS
  'Marcas do cliente (lista fechada). Cliente com marcas só ganha a pasta do projeto depois que o projeto escolhe uma.';

-- Trigger de UPDATE: dispara quando nome, código ou marca mudam, ou enquanto o projeto não tem pasta.
-- Em produção ele TAMBÉM dispara quando a categoria muda (projects.category foi criada à mão, fora das
-- migrations do repositório). Essa condição é preservada quando a coluna existe; sem a coluna (banco
-- recriado do zero) ela é omitida, como nas migrations anteriores. Num bloco só: o trigger nunca fica
-- sem existir no meio do caminho.
DO $$
DECLARE
  condicao text := 'OLD.name IS DISTINCT FROM NEW.name OR OLD.code IS DISTINCT FROM NEW.code '
                || 'OR OLD.marca IS DISTINCT FROM NEW.marca OR NEW.drive_folder_id IS NULL';
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'category'
  ) THEN
    condicao := condicao || ' OR OLD.category IS DISTINCT FROM NEW.category';
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS drive_provision_on_project_update ON public.projects';
  EXECUTE 'CREATE TRIGGER drive_provision_on_project_update AFTER UPDATE ON public.projects '
       || 'FOR EACH ROW WHEN (' || condicao || ') EXECUTE FUNCTION public.notify_drive_provision()';
END $$;
