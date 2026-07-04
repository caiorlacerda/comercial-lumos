-- Migration: Create google_calendar_auth table for secure OAuth token storage
-- Created: 2026-07-04
-- Scope: Google Calendar shared account refresh tokens

CREATE TABLE IF NOT EXISTS public.google_calendar_auth (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refresh_token text NOT NULL,
  access_token  text,
  expires_at    timestamptz,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- 1. Habilitar Row Level Security (RLS)
ALTER TABLE public.google_calendar_auth ENABLE ROW LEVEL SECURITY;

-- 2. Limitar privilégios de acesso no banco (Segurança Reforçada)
-- Revoga todos os privilégios desta tabela de roles públicas, anônimas ou de usuários autenticados normais.
REVOKE ALL ON TABLE public.google_calendar_auth FROM public, authenticated, anon;

-- Concede privilégios totais apenas ao postgres e ao service_role (usado pelas Edge Functions do Supabase)
GRANT ALL ON TABLE public.google_calendar_auth TO postgres, service_role;

-- 3. Adicionar uma política de RLS vazia/bloqueante para garantir que nenhum usuário da API cliente possa ler.
-- Por padrão, como não há políticas de SELECT para authenticated/anon, qualquer requisição vinda do client-side do Supabase retornará 0 linhas.
DROP POLICY IF EXISTS "Block all client-side access" ON public.google_calendar_auth;
CREATE POLICY "Block all client-side access" 
  ON public.google_calendar_auth
  FOR ALL 
  TO service_role 
  USING (true)
  WITH CHECK (true);
