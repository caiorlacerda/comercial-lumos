-- Soft delete de tarefas com lixeira de 30 dias.
-- Em vez de apagar de vez, o app marca deleted_at. A tarefa some das listas mas
-- fica recuperável por 30 dias; depois disso um job diário a remove de vez
-- (levando junto comentários/tags/atividade por cascade), pra não acumular lixo.

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_project_tasks_deleted_at
  ON public.project_tasks(deleted_at);

-- Purga diária (03:00) das tarefas na lixeira há mais de 30 dias. Requer pg_cron
-- (já usado no projeto). Reidempotente: remove o agendamento anterior se existir.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-deleted-tasks';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'purge-deleted-tasks',
  '0 3 * * *',
  $$DELETE FROM public.project_tasks
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - interval '30 days'$$
);
