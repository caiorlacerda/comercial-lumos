-- Módulo Equipamentos — Fase 3: listas por projeto + templates de lista.

-- Lista de equipamento de cada projeto.
CREATE TABLE IF NOT EXISTS public.project_equipment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  quantity     int NOT NULL DEFAULT 1,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_equipment_project ON public.project_equipment(project_id);
ALTER TABLE public.project_equipment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_equipment_all ON public.project_equipment;
CREATE POLICY project_equipment_all ON public.project_equipment FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.project_equipment TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_equipment;

-- Templates de lista de equipamento (itens em jsonb: [{equipment_id, quantity}]).
CREATE TABLE IF NOT EXISTS public.equipment_list_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  items      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.equipment_list_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equip_templates_all ON public.equipment_list_templates;
CREATE POLICY equip_templates_all ON public.equipment_list_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.equipment_list_templates TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.equipment_list_templates;
