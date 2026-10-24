-- PORTAL DO CLIENTE: recálculo horário da saúde dos projetos (pg_cron, SQL direto, sem HTTP).
-- A cada hora (no minuto 7), o banco roda public.portal_recalcular_saude() para todos os
-- projetos do portal: atualiza o estado calculado, aplica a espera de 24 h nas pioras e libera
-- o que já passou do prazo de espera. Sem isto, a saúde só era recalculada quando alguém abria o projeto.
--
-- ATENÇÃO, ANTES DE RODAR:
--   1) Rode SOMENTE depois da migration 2026102404_portal_saude_tolerancia.sql e depois de
--      revisar o ensaio (dry run) do cálculo. Esta migration não calcula nada sozinha: só agenda.
--   2) A PRIMEIRA execução global avisa todos os projetos em Atenção/Atrasado cujo cliente tem
--      portal ativo (1 notificação no app + push para cada destinatário). Para essa primeira rodada
--      ficar silenciosa, DESLIGUE a automação "Projeto vai ficar Atenção ou Atrasado no portal"
--      em Configurações → Automações ANTES de rodar este arquivo. A espera de 24 h continua valendo
--      (o cliente só passa a ver a piora depois dela). Religue a automação quando quiser os avisos.
--   3) Para DESLIGAR o recálculo horário, rode o comando comentado no fim do arquivo.
-- Idempotente: se o job já existir, é desagendado e agendado de novo.

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'Abortado: a extensão pg_cron não está habilitada (schema cron inexistente).';
  END IF;
  IF to_regprocedure('public.portal_recalcular_saude(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102402_portal_saude_funcoes.sql (portal_recalcular_saude).';
  END IF;
END $$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'portal-saude-recalcular';

SELECT cron.schedule(
  'portal-saude-recalcular',
  '7 * * * *',  -- a cada hora, no minuto 7 (UTC)
  $$SELECT public.portal_recalcular_saude()$$
);

-- Para desligar (comentado):
-- SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'portal-saude-recalcular';

-- CONFERÊNCIA (esperado): 1 linha, active = true.
SELECT jobname, schedule, active, command FROM cron.job WHERE jobname = 'portal-saude-recalcular';
