-- Seed Local Database with Test Admin Account
-- Email: caio.lacerda@produtoralumos.com.br
-- Password: password123

-- 1. Insert into auth.users (authentication schema)
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'd0d4fb77-2f1d-4001-a1e6-231a473f3a1f', -- Custom user ID
  'authenticated',
  'authenticated',
  'caio.lacerda@produtoralumos.com.br',
  extensions.crypt('password123', extensions.gen_salt('bf', 10)),
  now(),
  null,
  null,
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Caio Lacerda"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

-- 2. Insert into public.app_users (application schema)
INSERT INTO public.app_users (
  id,
  auth_user_id,
  full_name,
  email,
  role,
  status
)
VALUES (
  'd0d4fb77-2f1d-4001-a1e6-231a473f3a1f',
  'd0d4fb77-2f1d-4001-a1e6-231a473f3a1f',
  'Caio Lacerda',
  'caio.lacerda@produtoralumos.com.br',
  'admin',
  'ativo'
) ON CONFLICT (id) DO NOTHING;
