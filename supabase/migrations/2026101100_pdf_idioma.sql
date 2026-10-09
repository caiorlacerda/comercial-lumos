-- PDF DA PROPOSTA EM INGLÊS (orçamento em dólar, Fase 3)
--
--   pdf_language  idioma do PDF: 'pt' (padrão) ou 'en'. Independente da moeda.
--   translations  glossário de traduções: {"versao":1,"textos":{"<texto original>":"<English>"}}.
--                 Chaveado pelo TEXTO ORIGINAL (não por id de item) para sobreviver a
--                 nova versão (itens ganham uuid novo). Gravado só depois que a pessoa
--                 revisa na tela; o PDF nunca chama a IA.
--
-- Aditiva e segura de rodar antes do deploy do front: todos os orçamentos existentes
-- ficam em 'pt' e sem traduções. O front NOVO grava essas colunas, então esta
-- migration tem que rodar ANTES dele. Idioma e traduções NÃO são travados na
-- aprovação (o gatilho de moeda só olha currency/fx_*).

ALTER TABLE public.budget_versions
  ADD COLUMN IF NOT EXISTS pdf_language text  NOT NULL DEFAULT 'pt',
  ADD COLUMN IF NOT EXISTS translations jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_versions_pdf_language_valido') THEN
    ALTER TABLE public.budget_versions
      ADD CONSTRAINT budget_versions_pdf_language_valido CHECK (pdf_language IN ('pt', 'en'));
  END IF;
END $$;
