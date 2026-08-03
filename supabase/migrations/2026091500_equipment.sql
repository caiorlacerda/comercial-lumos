-- Módulo Equipamentos — Fase 1: inventário.
-- Todo mundo do time (autenticado) gerencia — decisão de produto.

CREATE TABLE IF NOT EXISTS public.equipment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  category      text,
  brand         text,
  model         text,
  serial_number text,
  quantity      int NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'disponivel',   -- disponivel | em_uso | manutencao | inativo
  location      text,
  photo_url     text,
  purchase_date date,
  value         numeric,
  notes         text,
  created_by    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON public.equipment(category);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON public.equipment(status);

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipment_all ON public.equipment;
CREATE POLICY equipment_all ON public.equipment FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.equipment TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.equipment;

-- Bucket público das fotos; escrita por qualquer usuário logado (o time gerencia).
INSERT INTO storage.buckets (id, name, public) VALUES ('equipamentos', 'equipamentos', true) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "equip storage read" ON storage.objects;
CREATE POLICY "equip storage read" ON storage.objects FOR SELECT USING (bucket_id = 'equipamentos');
DROP POLICY IF EXISTS "equip storage insert" ON storage.objects;
CREATE POLICY "equip storage insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'equipamentos');
DROP POLICY IF EXISTS "equip storage update" ON storage.objects;
CREATE POLICY "equip storage update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'equipamentos');
DROP POLICY IF EXISTS "equip storage delete" ON storage.objects;
CREATE POLICY "equip storage delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'equipamentos');
