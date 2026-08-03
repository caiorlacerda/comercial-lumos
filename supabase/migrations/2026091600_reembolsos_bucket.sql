-- Comprovantes de reembolso agora vão pro Supabase Storage (antes iam pro Google
-- Drive do usuário, o que travava quem não tinha o escopo de Drive no login Google).
INSERT INTO storage.buckets (id, name, public) VALUES ('reembolsos', 'reembolsos', true) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "reembolsos read" ON storage.objects;
CREATE POLICY "reembolsos read" ON storage.objects FOR SELECT USING (bucket_id = 'reembolsos');
DROP POLICY IF EXISTS "reembolsos insert" ON storage.objects;
CREATE POLICY "reembolsos insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'reembolsos');
DROP POLICY IF EXISTS "reembolsos update" ON storage.objects;
CREATE POLICY "reembolsos update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'reembolsos');
DROP POLICY IF EXISTS "reembolsos delete" ON storage.objects;
CREATE POLICY "reembolsos delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'reembolsos');
