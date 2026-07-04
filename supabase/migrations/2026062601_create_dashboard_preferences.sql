-- Migration: Create dashboard_preferences table
-- Created: 2026-06-26

CREATE TABLE IF NOT EXISTS public.dashboard_preferences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.dashboard_preferences ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS: Usuário gerencia apenas suas próprias preferências
DROP POLICY IF EXISTS "Users can manage their own dashboard preferences" ON public.dashboard_preferences;
CREATE POLICY "Users can manage their own dashboard preferences" 
  ON public.dashboard_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Conceder permissões para as roles de API
GRANT ALL ON public.dashboard_preferences TO authenticated, service_role;
