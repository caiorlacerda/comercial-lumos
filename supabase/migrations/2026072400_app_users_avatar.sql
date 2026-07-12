-- Foto de perfil visível para TODOS os usuários. Hoje a foto fica só no
-- user_metadata do Auth (legível apenas pelo próprio dono), então ninguém vê a
-- foto dos outros. Espelhamos a URL numa coluna de app_users (consultável por
-- quem tem permissão de ler a equipe) para exibir foto de responsáveis,
-- comentários, etc. O frontend (useAuth) sincroniza metadata -> coluna no login.

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS avatar_url text;

-- app_users no realtime: mudanças de nome/foto propagam ao vivo aos demais.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_users;
  END IF;
END $$;
