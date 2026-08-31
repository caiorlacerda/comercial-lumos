-- 2026093335_permissao_fechar_agenda.sql
-- QUEM PODE FECHAR DIA NA AGENDA, DECIDIDO PELO BANCO
--
-- Fechar uma data avulsa (agenda_bloqueios) ou um dia da semana inteiro
-- (agenda_semana_fechada) vale pra produtora inteira: o dia some do calendário
-- de todos os clientes, em todos os portais. Até aqui a trava era só de tela,
-- o botão aparecia pra quem gere produção, mas a policy aceitava a escrita de
-- QUALQUER pessoa logada. Agora o próprio banco recusa.
--
-- Quem passa: papel 'admin', papel 'producao', ou quem recebeu a permissão
-- 'fechar_agenda' na mão em custom_permissions. O papel 'atendimento' foi
-- unificado em 'time' junto com editores e social media, então liberar por
-- papel abriria demais: por isso a permissão nominal.
--
-- Atenção à sutileza do custom_permissions: ele também BLOQUEIA. Se a chave
-- 'fechar_agenda' existir com valor false, ela vence o padrão do papel,
-- inclusive pra admin. É exatamente o que a função can() faz em
-- src/hooks/useAuth.tsx, e as duas precisam decidir igual, senão alguém vê o
-- botão na tela e leva erro do banco.
--
-- Leitura continua liberada pra qualquer usuário logado: o time precisa ver o
-- que está fechado, mesmo sem poder mexer.
--
-- Nada aqui altera as migrações 2026093329 a 2026093334, que já rodaram em
-- produção: a função é CREATE OR REPLACE e as policies antigas são derrubadas
-- pelo nome antes de entrarem as novas.
--
-- ANTES DE RODAR: feche as abas do app (app.produtoralumos.com.br e a
-- preview). Trocar política exige lock exclusivo na tabela, e o app lendo ao
-- mesmo tempo pode gerar deadlock. Se der "lock timeout", espere alguns
-- segundos e rode de novo.

SET lock_timeout = '15s';

-- ── Quem pode fechar dia na agenda ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pode_fechar_agenda()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app_users u
    WHERE u.auth_user_id = auth.uid()
      AND u.status = 'ativo'
      AND CASE
            -- Chave presente em custom_permissions vence o padrão do papel,
            -- pra liberar (true) e pra bloquear (false). Mesma ordem do can().
            WHEN jsonb_exists(COALESCE(u.custom_permissions, '{}'::jsonb), 'fechar_agenda')
              THEN u.custom_permissions ->> 'fechar_agenda' = 'true'
            ELSE u.role IN ('admin', 'producao')
          END
  );
$$;

GRANT EXECUTE ON FUNCTION public.pode_fechar_agenda() TO authenticated;

-- ── agenda_bloqueios: todo mundo lê, só quem pode fechar escreve ──────────
DROP POLICY IF EXISTS "time le e escreve bloqueios" ON public.agenda_bloqueios;
DROP POLICY IF EXISTS "time le bloqueios" ON public.agenda_bloqueios;
DROP POLICY IF EXISTS "so quem pode fecha bloqueios" ON public.agenda_bloqueios;
DROP POLICY IF EXISTS "so quem pode altera bloqueios" ON public.agenda_bloqueios;
DROP POLICY IF EXISTS "so quem pode reabre bloqueios" ON public.agenda_bloqueios;

CREATE POLICY "time le bloqueios" ON public.agenda_bloqueios
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "so quem pode fecha bloqueios" ON public.agenda_bloqueios
  FOR INSERT TO authenticated WITH CHECK (public.pode_fechar_agenda());

CREATE POLICY "so quem pode altera bloqueios" ON public.agenda_bloqueios
  FOR UPDATE TO authenticated
  USING (public.pode_fechar_agenda()) WITH CHECK (public.pode_fechar_agenda());

CREATE POLICY "so quem pode reabre bloqueios" ON public.agenda_bloqueios
  FOR DELETE TO authenticated USING (public.pode_fechar_agenda());

-- ── agenda_semana_fechada: mesma regra ────────────────────────────────────
DROP POLICY IF EXISTS "time le e escreve semana fechada" ON public.agenda_semana_fechada;
DROP POLICY IF EXISTS "time le semana fechada" ON public.agenda_semana_fechada;
DROP POLICY IF EXISTS "so quem pode fecha semana" ON public.agenda_semana_fechada;
DROP POLICY IF EXISTS "so quem pode altera semana" ON public.agenda_semana_fechada;
DROP POLICY IF EXISTS "so quem pode reabre semana" ON public.agenda_semana_fechada;

CREATE POLICY "time le semana fechada" ON public.agenda_semana_fechada
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "so quem pode fecha semana" ON public.agenda_semana_fechada
  FOR INSERT TO authenticated WITH CHECK (public.pode_fechar_agenda());

CREATE POLICY "so quem pode altera semana" ON public.agenda_semana_fechada
  FOR UPDATE TO authenticated
  USING (public.pode_fechar_agenda()) WITH CHECK (public.pode_fechar_agenda());

CREATE POLICY "so quem pode reabre semana" ON public.agenda_semana_fechada
  FOR DELETE TO authenticated USING (public.pode_fechar_agenda());

-- ── Rede de segurança: política sem RLS ligado não protege nada ───────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agenda_bloqueios', 'agenda_semana_fechada'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ── Conferência: as duas tabelas com rls_ligado = true e quatro políticas
--    cada uma, uma de SELECT e três de escrita. Aparece na aba Results. ────
SELECT c.relname AS tabela,
       c.relrowsecurity AS rls_ligado,
       p.policyname AS politica,
       p.cmd AS comando
FROM pg_class c
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE c.relname IN ('agenda_bloqueios', 'agenda_semana_fechada')
ORDER BY c.relname, p.cmd;
