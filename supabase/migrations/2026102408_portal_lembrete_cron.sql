-- PORTAL DO CLIENTE (Pacote B): rotina diária do lembrete de revisão (pg_cron, SQL direto, sem HTTP).
-- Todo dia às 12:00 UTC (09:00 de Brasília) o banco roda public.portal_lembrar_revisoes(): para cada vídeo que
-- continua esperando o cliente além do prazo de revisão, cria 1 notificação por destinatário (admins, atendimento e
-- contatos do portal) e repete a cada 3 dias enquanto o vídeo não for respondido.
--
-- ORIENTAÇÃO, ANTES DE RODAR:
--   a) Ordem: rode SOMENTE depois de 2026102406_portal_prazo_revisao.sql e de 2026102407_portal_lembrete_revisao.sql,
--      e depois da consulta de ensaio (dry run) abaixo. Este arquivo só agenda; o guard aborta se faltar a função.
--   b) Consulta de ensaio (só lê, nada é gravado): seleciona exatamente o que a função seleciona (versão mais nova de
--      cada vídeo, link de revisão ativo, projeto visível e não concluído/cancelado/arquivado, portal ativo com prazo,
--      prazo vencido) e mostra quantos destinatários cada vídeo teria. Atenção: a função envia no máximo 10 vídeos
--      por rodada (a rotina roda 1x por dia; uma chamada manual envia mais 10; os nunca lembrados primeiro, depois os de
--      prazo mais antigo), então total_videos pode levar vários dias para escoar.
--        WITH e AS (SELECT DISTINCT ON (COALESCE(vv.group_id, vv.id)) vv.* FROM video_versions vv ORDER BY COALESCE(vv.group_id, vv.id), vv.versao DESC),
--        alvo AS (
--          SELECT c.name AS cliente, p.name AS projeto, p.status AS projeto_status, e.file_name, e.versao,
--                 (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS entregue,
--                 public.portal_somar_dias_uteis((COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date, cp.prazo_revisao_dias) AS prazo,
--                 (SELECT count(DISTINCT a.id) FROM app_users a WHERE a.status = 'ativo' AND NOT a.hidden
--                    AND (a.role IN ('admin','atendimento') OR a.id = ANY (cp.contact_user_ids))) AS destinatarios
--          FROM e
--          JOIN projects p ON p.id = e.project_id AND p.portal_visivel AND p.status NOT IN ('concluido','cancelado','arquivado')
--          JOIN clients c ON c.id = p.client_id
--          JOIN client_portals cp ON cp.client_id = p.client_id AND cp.active AND cp.prazo_revisao_dias IS NOT NULL
--          WHERE e.status = 'EM_REVISAO_CLIENTE'
--            AND EXISTS (SELECT 1 FROM review_links rl WHERE rl.group_id = e.group_id AND rl.active))
--        SELECT *, count(*) OVER () AS total_videos, sum(destinatarios) OVER () AS total_notificacoes
--        FROM alvo WHERE prazo < (now() AT TIME ZONE 'America/Sao_Paulo')::date ORDER BY prazo;
--   c) Primeira rodada: acontece às 09:00 de Brasília seguinte (pode ser hoje, se você rodar antes das 09:00) e avisa os
--      vídeos que já estejam esperando o cliente além do prazo, no máximo 10 por rodada (a rotina roda 1x por dia; uma
--      chamada manual envia mais 10). Atenção: entregue_em só é gravado na PRIMEIRA vez que o vídeo vai ao cliente
--      (gatilho da 2026093324) e as linhas antigas receberam datas preenchidas retroativamente; por isso há risco de
--      MUITOS vídeos antigos na fila (cada um com push para todos os destinatários). Use a consulta de ensaio antes de rodar.
--   d) A automação "portal_revisao_lembra" pode ficar LIGADA. Com ela DESLIGADA a função não envia nem anota nada, então
--      nada se perde: ao religar, tudo o que ainda estiver vencido sai (10 por rodada). Não existe "fila" de lembretes
--      atrasados, só o estado atual dos vídeos. A tela de Configurações → Automações ("Cliente atrasado na revisão de um
--      vídeo") vem neste mesmo PR, então a automação pode ser desligada por lá OU pelo SQL:
--        -- desligar:
--        INSERT INTO automacoes (chave, ativa) VALUES ('portal_revisao_lembra', false)
--          ON CONFLICT (chave) DO UPDATE SET ativa = false, updated_at = now();
--        -- religar:
--        UPDATE automacoes SET ativa = true, updated_at = now() WHERE chave = 'portal_revisao_lembra';
--   e) Depois da primeira execução, confira o resultado do job:
--        SELECT * FROM cron.job_run_details
--        WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'portal-lembrar-revisoes')
--        ORDER BY start_time DESC LIMIT 3;
--      e o que foi registrado e notificado:
--        SELECT l.*, vv.file_name FROM portal_lembretes_revisao l
--        JOIN LATERAL (SELECT file_name FROM video_versions WHERE group_id = l.group_id ORDER BY versao DESC LIMIT 1) vv ON true
--        ORDER BY ultimo_em DESC;
--        SELECT title, created_at FROM notifications WHERE event_type = 'cliente_atrasado_revisao' ORDER BY created_at DESC LIMIT 30;
--      CUIDADO: rodar manualmente SELECT public.portal_lembrar_revisoes(); envia notificações (e pushes) REAIS.
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
