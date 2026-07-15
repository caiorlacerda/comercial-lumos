-- Ranking de atividade (quem mais mexeu no app) + tempo online por pessoa.
--
-- Atividade: sai de logs que JÁ existem (task_activity, task_comments,
-- review_comments do time, project_documents). Não precisa de infra nova.
--
-- Tempo online: NÃO existe no histórico (só guardávamos last_seen). A partir daqui
-- a gente acumula minutos/dia — o heartbeat de 30s chama track_presence(), que
-- conta no máximo 1 min por minuto real (dedupe por last_ping_at).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Presença acumulada por dia.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presence_daily (
  user_id      uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  day          date NOT NULL DEFAULT current_date,
  minutes      integer NOT NULL DEFAULT 0,
  last_ping_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.presence_daily ENABLE ROW LEVEL SECURITY;
-- Só a função (SECURITY DEFINER) escreve; a leitura é via get_activity_ranking.

CREATE OR REPLACE FUNCTION public.track_presence()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM app_users WHERE auth_user_id = auth.uid() AND status = 'ativo';
  IF v_uid IS NULL THEN RETURN; END IF;

  INSERT INTO presence_daily (user_id, day, minutes, last_ping_at)
  VALUES (v_uid, current_date, 1, now())
  ON CONFLICT (user_id, day) DO UPDATE SET
    -- Só conta +1 se já passou ~1 min desde a última batida contabilizada, para
    -- várias abas/dispositivos não multiplicarem o tempo.
    minutes = presence_daily.minutes
      + CASE WHEN now() - presence_daily.last_ping_at >= interval '50 seconds' THEN 1 ELSE 0 END,
    last_ping_at = CASE WHEN now() - presence_daily.last_ping_at >= interval '50 seconds' THEN now() ELSE presence_daily.last_ping_at END;
END; $$;

GRANT EXECUTE ON FUNCTION public.track_presence() TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Ranking de atividade (admin). Agrega ações por pessoa numa janela de dias.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_activity_ranking(p_days integer DEFAULT 7)
RETURNS TABLE (
  user_id           uuid,
  full_name         text,
  avatar_url        text,
  role              text,
  tarefas_criadas   bigint,
  edicoes_tarefa    bigint,
  comentarios       bigint,
  comentarios_video bigint,
  documentos        bigint,
  total             bigint,
  dias_ativos       bigint,
  minutos_online    bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_since timestamptz;
BEGIN
  -- Só admin (o ranking compara pessoas).
  IF (SELECT au.role FROM app_users au WHERE au.auth_user_id = auth.uid() AND au.status = 'ativo') <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem ver o ranking de atividade.';
  END IF;

  v_since := now() - (GREATEST(p_days, 1) || ' days')::interval;

  RETURN QUERY
  WITH ta AS (
    SELECT actor_id AS uid,
           count(*) FILTER (WHERE action = 'created') AS criadas,
           count(*) FILTER (WHERE action <> 'created') AS edicoes
    FROM task_activity WHERE created_at >= v_since AND actor_id IS NOT NULL
    GROUP BY actor_id
  ),
  tc AS (
    SELECT tcm.user_id AS uid, count(*) AS c
    FROM task_comments tcm WHERE tcm.created_at >= v_since
    GROUP BY tcm.user_id
  ),
  rc AS (
    SELECT author_user_id AS uid, count(*) AS c
    FROM review_comments WHERE is_team = true AND created_at >= v_since AND author_user_id IS NOT NULL
    GROUP BY author_user_id
  ),
  pd AS (
    SELECT created_by AS uid, count(*) AS c
    FROM project_documents WHERE created_at >= v_since AND created_by IS NOT NULL
    GROUP BY created_by
  ),
  dias AS (
    SELECT uid, count(DISTINCT d) AS n FROM (
      SELECT actor_id AS uid, created_at::date AS d FROM task_activity WHERE created_at >= v_since AND actor_id IS NOT NULL
      UNION ALL SELECT user_id, created_at::date FROM task_comments WHERE created_at >= v_since
      UNION ALL SELECT author_user_id, created_at::date FROM review_comments WHERE is_team = true AND created_at >= v_since AND author_user_id IS NOT NULL
      UNION ALL SELECT created_by, created_at::date FROM project_documents WHERE created_at >= v_since AND created_by IS NOT NULL
    ) x GROUP BY uid
  ),
  onl AS (
    SELECT pdl.user_id AS uid, sum(pdl.minutes) AS mins
    FROM presence_daily pdl WHERE pdl.day >= v_since::date
    GROUP BY pdl.user_id
  )
  SELECT
    u.id, u.full_name, u.avatar_url, u.role::text,
    COALESCE(ta.criadas, 0), COALESCE(ta.edicoes, 0),
    COALESCE(tc.c, 0), COALESCE(rc.c, 0), COALESCE(pd.c, 0),
    COALESCE(ta.criadas, 0) + COALESCE(ta.edicoes, 0) + COALESCE(tc.c, 0) + COALESCE(rc.c, 0) + COALESCE(pd.c, 0),
    COALESCE(dias.n, 0), COALESCE(onl.mins, 0)
  FROM app_users u
  LEFT JOIN ta   ON ta.uid   = u.id
  LEFT JOIN tc   ON tc.uid   = u.id
  LEFT JOIN rc   ON rc.uid   = u.id
  LEFT JOIN pd   ON pd.uid   = u.id
  LEFT JOIN dias ON dias.uid = u.id
  LEFT JOIN onl  ON onl.uid  = u.id
  WHERE u.status = 'ativo'
  ORDER BY 10 DESC, 11 DESC;  -- total, depois dias ativos
END; $$;

GRANT EXECUTE ON FUNCTION public.get_activity_ranking(integer) TO authenticated;
