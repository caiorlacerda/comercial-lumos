-- Módulo Equipamentos — Fase 2: reservas + manutenção.
-- Todo mundo do time (autenticado) gerencia — decisão de produto.

-- Reservas de equipamento (por período, opcionalmente ligadas a um projeto).
CREATE TABLE IF NOT EXISTS public.equipment_reservations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  status       text NOT NULL DEFAULT 'solicitada',   -- solicitada | aprovada | recusada | devolvida
  notes        text,
  decided_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equip_res_equipment ON public.equipment_reservations(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equip_res_status ON public.equipment_reservations(status);
ALTER TABLE public.equipment_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equip_res_all ON public.equipment_reservations;
CREATE POLICY equip_res_all ON public.equipment_reservations FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.equipment_reservations TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.equipment_reservations;

-- Ordens de manutenção.
CREATE TABLE IF NOT EXISTS public.equipment_maintenance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  reported_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  issue        text NOT NULL,
  status       text NOT NULL DEFAULT 'aberta',        -- aberta | em_andamento | concluida
  notes        text,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_equip_maint_equipment ON public.equipment_maintenance(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equip_maint_status ON public.equipment_maintenance(status);
ALTER TABLE public.equipment_maintenance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equip_maint_all ON public.equipment_maintenance;
CREATE POLICY equip_maint_all ON public.equipment_maintenance FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.equipment_maintenance TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.equipment_maintenance;
