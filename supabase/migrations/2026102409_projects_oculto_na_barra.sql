-- Barra lateral: ocultar projeto para o time todo (24/10/2026)
--
-- Marca simples no projeto. NÃO muda `status`: o projeto continua ativo e
-- aparece em Todos os Projetos, tarefas, financeiro, portal e vídeos em
-- revisão. Só some da árvore da barra lateral (fica no grupo "Ocultos").
--
-- Rodar à mão no SQL Editor do Supabase. É seguro rodar mais de uma vez.
-- O app funciona antes e depois deste SQL: sem a coluna, os itens
-- "Ocultar da barra" / "Mostrar na barra" simplesmente não aparecem.
--
-- Desfazer (se um dia precisar): ALTER TABLE public.projects DROP COLUMN oculto_na_barra;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS oculto_na_barra boolean NOT NULL DEFAULT false;

-- Conferência: deve mostrar coluna_existe = true e ocultos = 0.
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'oculto_na_barra'
  ) AS coluna_existe,
  (SELECT count(*) FROM public.projects WHERE oculto_na_barra) AS ocultos;
