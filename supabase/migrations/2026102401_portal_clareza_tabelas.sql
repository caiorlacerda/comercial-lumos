-- PORTAL DO CLIENTE: tabelas da clareza de status (saúde, pendências do cliente, equipe do projeto).
-- Spec: docs/superpowers/specs/2026-10-24-portal-clareza-status-design.md
DO $$
BEGIN
  IF to_regprocedure('public.is_team()') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102300_somente_equipe.sql (falta is_team()).';
  END IF;
END $$;

-- 1) Saúde: uma linha por projeto
CREATE TABLE IF NOT EXISTS public.project_portal_saude (
  project_id      uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  calculada       text CHECK (calculada IN ('no_prazo', 'atencao', 'atrasado')),
  exibida         text CHECK (exibida   IN ('no_prazo', 'atencao', 'atrasado')),
  motivo          text,
  calculada_desde timestamptz,
  liberar_em      timestamptz,
  liberada_por    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.project_portal_saude ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saude_equipe_le ON public.project_portal_saude;
CREATE POLICY saude_equipe_le ON public.project_portal_saude
  FOR SELECT TO authenticated USING ((SELECT public.is_team()));
-- Escrita só pelas funções do portal (SECURITY DEFINER).
-- O Supabase concede tudo ao anon por padrão em tabelas novas; fecha o acesso direto do visitante.
-- Idem para authenticated (TRUNCATE não passa por RLS): revoga tudo e devolve só o necessário.
REVOKE ALL ON public.project_portal_saude FROM anon, authenticated;
GRANT SELECT ON public.project_portal_saude TO authenticated;
GRANT ALL ON public.project_portal_saude TO service_role;

-- 2) Pendências do cliente (project_id NULL = do cliente inteiro)
CREATE TABLE IF NOT EXISTS public.portal_pendencias (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  texto        text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 200),
  prazo        date,
  concluida_em timestamptz,
  created_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_pendencias_cliente_idx ON public.portal_pendencias (client_id, project_id);
CREATE INDEX IF NOT EXISTS portal_pendencias_project_idx ON public.portal_pendencias (project_id) WHERE project_id IS NOT NULL;
ALTER TABLE public.portal_pendencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pendencias_equipe ON public.portal_pendencias;
CREATE POLICY pendencias_equipe ON public.portal_pendencias
  FOR ALL TO authenticated USING ((SELECT public.is_team())) WITH CHECK ((SELECT public.is_team()));
REVOKE ALL ON public.portal_pendencias FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_pendencias TO authenticated;
GRANT ALL ON public.portal_pendencias TO service_role;

-- 3) Equipe que aparece no portal, por projeto
CREATE TABLE IF NOT EXISTS public.project_portal_equipe (
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  ordem       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, app_user_id)
);
ALTER TABLE public.project_portal_equipe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipe_portal_equipe ON public.project_portal_equipe;
CREATE POLICY equipe_portal_equipe ON public.project_portal_equipe
  FOR ALL TO authenticated USING ((SELECT public.is_team())) WITH CHECK ((SELECT public.is_team()));
REVOKE ALL ON public.project_portal_equipe FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_portal_equipe TO authenticated;
GRANT ALL ON public.project_portal_equipe TO service_role;

-- CONFERÊNCIA: as três tabelas existem, com RLS ligada, e o visitante não tem acesso direto.
SELECT c.relname, c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_le,
       has_table_privilege('authenticated', c.oid, 'TRUNCATE') AS auth_trunca
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('project_portal_saude', 'portal_pendencias', 'project_portal_equipe')
ORDER BY 1;
-- Esperado: rls = true, anon_le = false e auth_trunca = false nas três.

-- ROLLBACK (comentado)
-- DROP TABLE IF EXISTS public.project_portal_equipe, public.portal_pendencias, public.project_portal_saude;
