-- PORTAL DO CLIENTE: recálculo horário da saúde dos projetos (pg_cron, SQL direto, sem HTTP).
-- A cada hora (no minuto 7) o banco roda public.portal_recalcular_saude() para todos os
-- projetos do portal: atualiza o estado calculado, aplica a espera de 24 h nas pioras e libera
-- o que já passou do prazo de espera. Sem isto, a saúde só era recalculada quando alguém abria o projeto.
--
-- ORIENTAÇÃO, ANTES DE RODAR:
--   a) Rode SOMENTE depois da migration 2026102404_portal_saude_tolerancia.sql e depois de
--      revisar o ensaio (dry run) do cálculo. Este arquivo só agenda; o guard abaixo aborta se a
--      tolerância de 2 dias ainda não estiver aplicada.
--   b) Mantenha LIGADA a automação "Projeto vai ficar Atenção ou Atrasado no portal"
--      (chave portal_saude_avisa), em Configurações → Automações. A primeira execução global
--      acontece no próximo HH:07 (relógio UTC do cron, ou seja, até 1 hora depois de rodar este
--      arquivo) e avisa todo projeto em Atenção/Atrasado cujo cliente tenha portal ativo:
--      1 notificação no app + push para cada destinatário (admins, atendimento e contatos do portal).
--   c) Desligar a automação depois NÃO reenvia os avisos que foram suprimidos enquanto ela esteve
--      desligada: o aviso só dispara numa piora NOVA. Por isso não a desligue para "silenciar" a
--      primeira rodada: a espera de 24 h valeria, mas a equipe nunca seria avisada.
--   d) Todo projeto de cliente com portal ativo que esteja "No prazo" passa a aparecer na hora
--      para o cliente como "No prazo" (melhoras aparecem imediatamente). O cliente verá o novo
--      bloco "Situação" com esse estado.
--   e) Depois da primeira execução, confira o resultado do job:
--        SELECT * FROM cron.job_run_details
--        WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'portal-saude-recalcular')
--        ORDER BY start_time DESC LIMIT 3;
--      e revise o que está segurado pelas próximas 24 h (a equipe pode corrigir a causa ou
--      clicar em "Mostrar agora" dentro desse prazo):
--        SELECT s.project_id, p.name, s.calculada, s.motivo, s.liberar_em
--        FROM project_portal_saude s JOIN projects p ON p.id = s.project_id
--        WHERE s.liberar_em IS NOT NULL ORDER BY s.liberar_em;
--   f) Para DESLIGAR o recálculo horário, rode o comando comentado no fim do arquivo.
-- Idempotente: se o job já existir, é desagendado e agendado de novo.

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'Abortado: a extensão pg_cron não está habilitada (schema cron inexistente).';
  END IF;
  IF to_regprocedure('public.portal_recalcular_saude(uuid)') IS NULL
     OR to_regprocedure('public.portal_saude_calcular(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102402_portal_saude_funcoes.sql (portal_recalcular_saude).';
  END IF;
  IF position('há mais de 2 dias' in (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.portal_saude_calcular(uuid)'))) = 0 THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102404_portal_saude_tolerancia.sql (tolerância de 2 dias).';
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

-- CONFERÊNCIA (esperado: 1 linha, active = true, avisos_ligados = true).
SELECT jobname, schedule, active, command, public.automacao_ativa('portal_saude_avisa') AS avisos_ligados
FROM cron.job WHERE jobname = 'portal-saude-recalcular';
