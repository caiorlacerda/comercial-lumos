-- CRON DIÁRIO DA COBRANÇA DE NOTA
-- Todo dia às 9h (Brasília) o banco chama a edge function nota-cron, que
-- envia os e-mails das cobranças que chegaram na data (serviço + 28 dias).
-- A chave usada abaixo é a anon key, que é pública (a mesma do app).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('lumos-nota-cron');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'lumos-nota-cron',
  '0 12 * * *',  -- 12h UTC = 9h Brasília
  $$
  SELECT net.http_post(
    url     := 'https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/nota-cron',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5bnRwZWt5Zmh6d2ZpaGpoenVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2ODc1MzgsImV4cCI6MjA5MTI2MzUzOH0.G810cohhcylCmUAV0iQFXPSQsyMfcsia6L_exkuDVKo"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
