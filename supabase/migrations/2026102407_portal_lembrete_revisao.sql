-- PORTAL DO CLIENTE (Pacote B): lembrete interno quando um vídeo fica parado com o cliente além do prazo de revisão.
--   1) Tabela portal_lembretes_revisao: um registro por vídeo (group_id) com a data do último lembrete e quantas vezes avisou.
--   2) Função portal_lembrar_revisoes(): cria 1 notificação por destinatário para cada vídeo vencido e devolve quantos
--      vídeos receberam lembrete. A rotina diária que a chama é um arquivo à parte (2026102408_portal_lembrete_cron.sql).
--
-- Quem recebe: usuários ATIVOS e NÃO ocultos que sejam admin ou atendimento, mais os contatos do portal do cliente.
-- Quando avisa: a versão MAIS NOVA do vídeo está em EM_REVISAO_CLIENTE, o link de revisão está ativo, o projeto está
-- visível no portal, o portal do cliente está ativo e tem prazo configurado, e o prazo (dias úteis a partir da entrega,
-- fuso America/Sao_Paulo) já passou. Se a versão mais nova for interna, o link do cliente está bloqueado e NÃO se avisa.
-- Repete a cada 3 dias enquanto o vídeo continuar parado. Com a automação "portal_revisao_lembra" desligada a função
-- não avisa nem anota nada (ao religar, sai o que ainda estiver vencido).
--
-- ATENÇÃO — ao agendar a rotina (arquivo 408), todo vídeo que já esteja esperando o cliente além do prazo recebe um
-- lembrete na primeira rodada. Para ver quantos, rode antes a consulta de ensaio (só lê) que está no cabeçalho do 408.
--
-- Pré-requisitos: 2026102406_portal_prazo_revisao.sql (coluna prazo_revisao_dias e portal_somar_dias_uteis) e a função
-- automacao_ativa(). Idempotente (pode rodar de novo).
DO $$
BEGIN
  IF to_regprocedure('public.portal_somar_dias_uteis(date,integer)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102406_portal_prazo_revisao.sql.';
  END IF;
  IF to_regprocedure('public.automacao_ativa(text)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: falta automacao_ativa().';
  END IF;
END $$;

SET lock_timeout = '15s';

CREATE TABLE IF NOT EXISTS public.portal_lembretes_revisao (
  group_id  uuid PRIMARY KEY,
  ultimo_em timestamptz NOT NULL DEFAULT now(),
  vezes     integer NOT NULL DEFAULT 1
);
ALTER TABLE public.portal_lembretes_revisao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_lembretes_revisao FROM anon, authenticated;
GRANT ALL ON public.portal_lembretes_revisao TO service_role;

CREATE OR REPLACE FUNCTION public.portal_lembrar_revisoes()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hoje   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_avisar boolean;
  v_total  integer := 0;
  r        RECORD;
  u        RECORD;
  v_nome   text;
BEGIN
  -- O agendador roda sem usuário; quem estiver logado precisa ser da equipe.
  IF auth.uid() IS NOT NULL AND NOT public.is_team() THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  v_avisar := public.automacao_ativa('portal_revisao_lembra');
  IF NOT v_avisar THEN RETURN 0; END IF;

  FOR r IN
    SELECT COALESCE(e.group_id, e.id) AS grupo, e.versao, e.file_name,
           p.id AS project_id, p.client_id, c.name AS cliente,
           (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS entregue,
           cp.contact_user_ids,
           public.portal_somar_dias_uteis(
             (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date,
             cp.prazo_revisao_dias) AS prazo
    FROM (
      -- Versão mais nova de cada vídeo, SEM filtrar por status antes: se a mais nova é interna, o link do cliente está bloqueado.
      SELECT DISTINCT ON (COALESCE(vv.group_id, vv.id)) vv.*
      FROM video_versions vv
      ORDER BY COALESCE(vv.group_id, vv.id), vv.versao DESC
    ) e
    JOIN projects p ON p.id = e.project_id AND p.portal_visivel
    JOIN clients c ON c.id = p.client_id
    JOIN client_portals cp ON cp.client_id = p.client_id AND cp.active AND cp.prazo_revisao_dias IS NOT NULL
    WHERE e.status = 'EM_REVISAO_CLIENTE'
      AND EXISTS (SELECT 1 FROM review_links rl WHERE rl.group_id = e.group_id AND rl.active)
      AND public.portal_somar_dias_uteis(
            (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date,
            cp.prazo_revisao_dias) < v_hoje
      AND NOT EXISTS (
            SELECT 1 FROM portal_lembretes_revisao l
            WHERE l.group_id = COALESCE(e.group_id, e.id) AND l.ultimo_em > now() - interval '3 days')
    ORDER BY COALESCE(e.group_id, e.id)
  LOOP
    v_nome := regexp_replace(r.file_name, '\.[^.]+$', '');
    FOR u IN
      SELECT DISTINCT a.id FROM app_users a
      WHERE a.status = 'ativo' AND NOT a.hidden
        AND (a.role IN ('admin', 'atendimento') OR a.id = ANY (COALESCE(r.contact_user_ids, ARRAY[]::uuid[])))
    LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (
        u.id, 'cliente_atrasado_revisao', 'producao', 'normal',
        r.cliente || ' está há ' || (v_hoje - r.entregue) || ' dias sem responder: ' || v_nome || ' v' || lpad(r.versao::text, 2, '0'),
        'O prazo de revisão (' || to_char(r.prazo, 'DD/MM') || ') passou. Vale cobrar o retorno do cliente.',
        '/producao/projetos?projectId=' || r.project_id::text || '&tab=entregas',
        jsonb_build_object('project_id', r.project_id, 'group_id', r.grupo)
      );
    END LOOP;
    INSERT INTO portal_lembretes_revisao (group_id, ultimo_em, vezes) VALUES (r.grupo, now(), 1)
    ON CONFLICT (group_id) DO UPDATE SET ultimo_em = now(), vezes = portal_lembretes_revisao.vezes + 1;
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END; $$;

-- A trava de equipe está no corpo da função (authenticated pode executar, mas só a equipe passa); visitante (anon) não executa.
REVOKE ALL ON FUNCTION public.portal_lembrar_revisoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_lembrar_revisoes() TO authenticated, service_role;

-- ROLLBACK (comentado): apague antes o job do arquivo 2026102408 (cron.unschedule), depois:
-- DROP FUNCTION IF EXISTS public.portal_lembrar_revisoes();
-- DROP TABLE IF EXISTS public.portal_lembretes_revisao;

-- CONFERÊNCIA (último comando; esperado: anon_executa = false, authenticated_executa = true (a trava de equipe está no corpo),
-- anon_le_tabela = false, authenticated_le_tabela = false, lembretes_registrados = 0 antes da primeira rodada).
SELECT has_function_privilege('anon', 'public.portal_lembrar_revisoes()', 'EXECUTE')          AS anon_executa,
       has_function_privilege('authenticated', 'public.portal_lembrar_revisoes()', 'EXECUTE') AS authenticated_executa,
       has_table_privilege('anon', 'public.portal_lembretes_revisao', 'SELECT')               AS anon_le_tabela,
       has_table_privilege('authenticated', 'public.portal_lembretes_revisao', 'SELECT')      AS authenticated_le_tabela,
       (SELECT count(*) FROM public.portal_lembretes_revisao)                                 AS lembretes_registrados;
