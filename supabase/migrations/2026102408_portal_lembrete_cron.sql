-- PORTAL DO CLIENTE (Pacote B): rotina diária do lembrete de revisão (pg_cron, SQL direto, sem HTTP).
-- Todo dia às 12:00 UTC (09:00 de Brasília) o banco roda public.portal_lembrar_revisoes(): para cada vídeo que
-- continua esperando o cliente além do prazo de revisão, cria 1 notificação por destinatário (admins, atendimento e
-- contatos do portal) e repete a cada 3 dias enquanto o vídeo não for respondido.
--
-- ORIENTAÇÃO, ANTES DE RODAR:
--   a) Ordem: rode SOMENTE depois de 2026102406_portal_prazo_revisao.sql e de 2026102407_portal_lembrete_revisao.sql,
--      e depois da consulta de ensaio (dry run) abaixo. Este arquivo só agenda; o guard aborta se faltar a função.
--   b) Consulta de ensaio (só lê, nada é gravado): lista os vídeos que receberão lembrete na primeira rodada.
--        SELECT c.name AS cliente, p.name AS projeto, e.file_name, e.versao,
--               (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS entregue,
--               public.portal_somar_dias_uteis((COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date, cp.prazo_revisao_dias) AS prazo
--        FROM (SELECT DISTINCT ON (COALESCE(vv.group_id, vv.id)) vv.* FROM video_versions vv ORDER BY COALESCE(vv.group_id, vv.id), vv.versao DESC) e
--        JOIN projects p ON p.id = e.project_id AND p.portal_visivel
--        JOIN clients c ON c.id = p.client_id
--        JOIN client_portals cp ON cp.client_id = p.client_id AND cp.active AND cp.prazo_revisao_dias IS NOT NULL
--        WHERE e.status = 'EM_REVISAO_CLIENTE'
--          AND public.portal_somar_dias_uteis((COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date, cp.prazo_revisao_dias) < (now() AT TIME ZONE 'America/Sao_Paulo')::date
--        ORDER BY prazo;
--      (A consulta de ensaio não filtra por link ativo; a função também exige link de revisão ativo, então o real pode ser um pouco menor.)
--   c) Primeira rodada: acontece às 09:00 de Brasília (12:00 UTC) do dia seguinte a rodar este arquivo e avisa TODO vídeo
--      que já esteja esperando o cliente além do prazo. Atenção: entregue_em só é gravado na PRIMEIRA vez que o vídeo
--      vai ao cliente (gatilho da 2026093324) e as linhas antigas receberam datas preenchidas retroativamente; por isso
--      a primeira rodada pode lembrar de MUITOS vídeos que já estavam esperando. Use a consulta de ensaio antes de rodar.
--   d) A automação "portal_revisao_lembra" (Configurações → Automações) pode ficar LIGADA. Com ela DESLIGADA a função
--      não envia nem anota nada, então nada se perde: ao religar, tudo o que ainda estiver vencido sai de uma vez
--      (não existe "fila" de lembretes atrasados, só o estado atual dos vídeos).
--   e) Depois da primeira execução, confira o resultado do job:
--        SELECT * FROM cron.job_run_details
--        WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'portal-lembrar-revisoes')
--        ORDER BY start_time DESC LIMIT 3;
--   f) Para DESLIGAR a rotina, rode o comando comentado no fim do arquivo.
-- Idempotente: se o job já existir, é desagendado e agendado de novo.

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'Abortado: a extensão pg_cron não está habilitada (schema cron inexistente).';
  END IF;
  IF to_regprocedure('public.portal_lembrar_revisoes()') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102407_portal_lembrete_revisao.sql (portal_lembrar_revisoes).';
  END IF;
END $$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'portal-lembrar-revisoes';

SELECT cron.schedule(
  'portal-lembrar-revisoes',
  '0 12 * * *',  -- todo dia às 12:00 UTC (09:00 de Brasília)
  $$SELECT public.portal_lembrar_revisoes()$$
);

-- Para desligar (comentado):
-- SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'portal-lembrar-revisoes';

-- CONFERÊNCIA (esperado: 1 linha, active = true, lembretes_ligados = true).
SELECT jobname, schedule, active, command, public.automacao_ativa('portal_revisao_lembra') AS lembretes_ligados
FROM cron.job WHERE jobname = 'portal-lembrar-revisoes';
