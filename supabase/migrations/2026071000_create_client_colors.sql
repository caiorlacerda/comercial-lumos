-- Cores personalizadas por cliente (bolinhas da árvore de projetos na sidebar).
-- Tabela separada de clients para não precisar abrir política de UPDATE na
-- tabela de clientes: aqui qualquer usuário autenticado pode definir a cor
-- (é só apresentação, compartilhada pela equipe).
CREATE TABLE IF NOT EXISTS public.client_colors (
  client_id  uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  color      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.client_colors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read client colors" ON public.client_colors;
CREATE POLICY "authenticated read client colors"
  ON public.client_colors FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated insert client colors" ON public.client_colors;
CREATE POLICY "authenticated insert client colors"
  ON public.client_colors FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated update client colors" ON public.client_colors;
CREATE POLICY "authenticated update client colors"
  ON public.client_colors FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated delete client colors" ON public.client_colors;
CREATE POLICY "authenticated delete client colors"
  ON public.client_colors FOR DELETE TO authenticated
  USING (true);
