-- TEXTO COLABORATIVO: estado dos documentos de texto editados por várias pessoas ao mesmo tempo.
--
-- O texto passa a ser editado como um documento Yjs (CRDT), que junta as edições de todo mundo sem
-- sobrescrever ninguém. Esta tabela guarda o estado completo (para quem abre depois e para o texto não se
-- perder quando todos fecham). `chave` identifica o texto, ex.: 'orcamento-briefing:<id da versão>'.
-- O HTML continua sendo gravado também na coluna original (briefing, descrição, anotações), para PDF,
-- busca e o resto do app, que leem HTML.
--
-- `versao` é um controle de concorrência: só grava quem leu a versão mais nova (o app tenta de novo).
-- Quem lê e escreve: equipe ativa (is_team()). Idempotente.
-- Desfazer:  DROP TABLE public.doc_states;   (os textos continuam nas colunas originais)

CREATE TABLE IF NOT EXISTS public.doc_states (
  chave         text PRIMARY KEY,
  estado        text NOT NULL,                       -- Y.Doc em base64
  versao        integer NOT NULL DEFAULT 1,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.doc_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doc_states_equipe ON public.doc_states;
CREATE POLICY doc_states_equipe ON public.doc_states FOR ALL TO authenticated
  USING ((SELECT public.is_team())) WITH CHECK ((SELECT public.is_team()));
DROP POLICY IF EXISTS somente_equipe ON public.doc_states;
CREATE POLICY somente_equipe ON public.doc_states AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_team())) WITH CHECK ((SELECT public.is_team()));
GRANT ALL ON public.doc_states TO authenticated, service_role;

-- CONFERÊNCIA (leitura): a tabela existe e está vazia
SELECT to_regclass('public.doc_states') IS NOT NULL AS tabela_existe, (SELECT count(*) FROM public.doc_states) AS documentos;
