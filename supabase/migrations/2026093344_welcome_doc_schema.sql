-- Welcome Doc: o checklist fixo vira um motor de template por cliente.
-- Ver spec: docs/superpowers/specs/2026-09-06-welcome-doc-lumos-design.md
--
-- client_boas_vindas_itens (já existe, já em produção) não muda de forma:
-- continua sendo "o que já foi preenchido". As tabelas novas descrevem
-- "o que existe pra preencher" — template versionado, instância por
-- cliente, e a lista de itens que uma instância publicada tem.

CREATE TABLE IF NOT EXISTS public.client_welcome_doc_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical   text NOT NULL CHECK (vertical IN ('digital', 'filmes', 'live')),
  version    int NOT NULL,
  sections   jsonb NOT NULL DEFAULT '[]'::jsonb,
  variables  jsonb NOT NULL DEFAULT '[]'::jsonb,
  checklist  jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical, version)
);

CREATE TABLE IF NOT EXISTS public.client_welcome_docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  template_id  uuid NOT NULL REFERENCES public.client_welcome_doc_templates(id),
  values       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

CREATE TABLE IF NOT EXISTS public.client_welcome_doc_itens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  welcome_doc_id uuid NOT NULL REFERENCES public.client_welcome_docs(id) ON DELETE CASCADE,
  item_key       text NOT NULL,
  group_key      text NOT NULL,
  titulo         text NOT NULL,
  descricao      text,
  requer_arquivo boolean NOT NULL DEFAULT true,
  sort_order     int NOT NULL DEFAULT 0,
  UNIQUE (welcome_doc_id, item_key)
);

CREATE INDEX IF NOT EXISTS client_welcome_doc_itens_doc_idx
  ON public.client_welcome_doc_itens (welcome_doc_id, group_key, sort_order);

-- Liga cada linha de status ao item de template que ela preenche. Linhas
-- antigas (criadas antes desta migração) ficam com isto NULL até a
-- migração de dados que amarra a Vitru (fora deste plano).
ALTER TABLE public.client_boas_vindas_itens
  ADD COLUMN IF NOT EXISTS welcome_doc_item_id uuid
    REFERENCES public.client_welcome_doc_itens(id) ON DELETE SET NULL;

-- O item agora pode vir de qualquer template — a validade do item_key
-- passa a ser garantida por existir (ou não) um client_welcome_doc_itens
-- correspondente, não por uma lista fixa no banco.
ALTER TABLE public.client_boas_vindas_itens DROP CONSTRAINT IF EXISTS client_boas_vindas_itens_item_key_check;

-- Progresso é sempre derivado, nunca uma coluna que pode ficar desatualizada.
CREATE OR REPLACE VIEW public.client_welcome_doc_progresso AS
SELECT d.id AS welcome_doc_id, d.client_id,
       count(s.*) FILTER (WHERE s.id IS NOT NULL) AS feitos,
       count(i.*) AS total
FROM public.client_welcome_docs d
JOIN public.client_welcome_doc_itens i ON i.welcome_doc_id = d.id
LEFT JOIN public.client_boas_vindas_itens s
  ON s.welcome_doc_item_id = i.id AND s.client_id = d.client_id
GROUP BY d.id;

-- ---------------------------------------------------------------------------
-- Autoria: só admin/atendimento ativos criam template, preenchem valores e
-- publicam. Mesmo padrão de pode_configurar_automacoes() (2026093340).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pode_editar_welcome_doc()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users u
    WHERE u.auth_user_id = auth.uid()
      AND u.status = 'ativo'
      AND u.role IN ('admin', 'atendimento')
  );
$$;

GRANT EXECUTE ON FUNCTION public.pode_editar_welcome_doc() TO authenticated;

ALTER TABLE public.client_welcome_doc_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_welcome_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_welcome_doc_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time le templates" ON public.client_welcome_doc_templates;
CREATE POLICY "time le templates" ON public.client_welcome_doc_templates
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "so admin/atendimento edita templates" ON public.client_welcome_doc_templates;
CREATE POLICY "so admin/atendimento edita templates" ON public.client_welcome_doc_templates
  FOR ALL TO authenticated USING (public.pode_editar_welcome_doc()) WITH CHECK (public.pode_editar_welcome_doc());

DROP POLICY IF EXISTS "time le welcome docs" ON public.client_welcome_docs;
CREATE POLICY "time le welcome docs" ON public.client_welcome_docs
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "so admin/atendimento edita welcome docs" ON public.client_welcome_docs;
CREATE POLICY "so admin/atendimento edita welcome docs" ON public.client_welcome_docs
  FOR ALL TO authenticated USING (public.pode_editar_welcome_doc()) WITH CHECK (public.pode_editar_welcome_doc());

DROP POLICY IF EXISTS "time le itens do welcome doc" ON public.client_welcome_doc_itens;
CREATE POLICY "time le itens do welcome doc" ON public.client_welcome_doc_itens
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "so admin/atendimento edita itens do welcome doc" ON public.client_welcome_doc_itens;
CREATE POLICY "so admin/atendimento edita itens do welcome doc" ON public.client_welcome_doc_itens
  FOR ALL TO authenticated USING (public.pode_editar_welcome_doc()) WITH CHECK (public.pode_editar_welcome_doc());

-- anon nunca lê/grava nenhuma das três direto: só pela RPC get_welcome_doc
-- (SECURITY DEFINER, Task 2) e pela edge function (service_role).
GRANT ALL ON public.client_welcome_doc_templates TO authenticated, service_role;
GRANT ALL ON public.client_welcome_docs TO authenticated, service_role;
GRANT ALL ON public.client_welcome_doc_itens TO authenticated, service_role;
GRANT SELECT ON public.client_welcome_doc_progresso TO authenticated, service_role;

-- Conferência (rodar à mão depois de aplicar):
-- SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('client_welcome_doc_templates','client_welcome_docs','client_welcome_doc_itens');
-- -- deve devolver as 3 linhas.
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'client_boas_vindas_itens' AND column_name = 'welcome_doc_item_id';
-- -- deve devolver 1 linha.
-- SELECT conname FROM pg_constraint WHERE conname = 'client_boas_vindas_itens_item_key_check';
-- -- deve devolver 0 linhas (constraint removida).
