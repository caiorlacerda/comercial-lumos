-- Diárias com horário de início e fim: no Google Calendar o evento deixa de
-- ser "dia inteiro" e vira compromisso com hora marcada.
ALTER TABLE public.project_diarias
  ADD COLUMN IF NOT EXISTS hora_inicio time,
  ADD COLUMN IF NOT EXISTS hora_fim time;
