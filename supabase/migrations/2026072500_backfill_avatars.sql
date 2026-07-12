-- Backfill único das fotos de perfil. O sync automático (useAuth) só espelha a
-- foto de cada usuário quando ELE loga; este UPDATE copia a foto de TODOS de uma
-- vez, lendo o user_metadata do Auth, para não precisar esperar cada um entrar.
-- Roda como postgres (SQL editor), então enxerga o schema auth.

UPDATE public.app_users au
SET avatar_url = u.raw_user_meta_data->>'avatar_url'
FROM auth.users u
WHERE au.auth_user_id = u.id
  AND (u.raw_user_meta_data->>'avatar_url') IS NOT NULL
  AND au.avatar_url IS DISTINCT FROM (u.raw_user_meta_data->>'avatar_url');
