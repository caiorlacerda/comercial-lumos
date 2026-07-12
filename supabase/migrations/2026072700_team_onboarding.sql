-- Onboarding self-service: cada usuário preenche os próprios dados no primeiro
-- acesso (ligados ao login dele). Novos campos, flag de onboarding, e RLS que
-- deixa a pessoa gerenciar A PRÓPRIA linha (admin/produção continuam vendo tudo).

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS shoe_size    text,
  ADD COLUMN IF NOT EXISTS pants_size   text,
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- Garante no máximo uma linha por usuário (o onboarding faz upsert por aqui).
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_app_user
  ON public.team_members(app_user_id) WHERE app_user_id IS NOT NULL;

-- id do app_user logado (para as policies de "linha própria")
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;

-- Admin/produção continuam com acesso total (policy já existe: manage_team_members).
-- Além disso, cada usuário pode LER/CRIAR/EDITAR a própria linha:
DROP POLICY IF EXISTS tm_select_own ON public.team_members;
CREATE POLICY tm_select_own ON public.team_members
  FOR SELECT TO authenticated
  USING (app_user_id = public.current_app_user_id());

DROP POLICY IF EXISTS tm_insert_own ON public.team_members;
CREATE POLICY tm_insert_own ON public.team_members
  FOR INSERT TO authenticated
  WITH CHECK (app_user_id = public.current_app_user_id());

DROP POLICY IF EXISTS tm_update_own ON public.team_members;
CREATE POLICY tm_update_own ON public.team_members
  FOR UPDATE TO authenticated
  USING (app_user_id = public.current_app_user_id())
  WITH CHECK (app_user_id = public.current_app_user_id());

-- birthdays_today passa a devolver o app_user_id, para o app saber com precisão
-- se o aniversariante é o próprio usuário logado (mensagem personalizada). A foto
-- vem do avatar do login (app_users.avatar_url), com fallback ao photo_url.
-- (DROP porque mudou o tipo de retorno — CREATE OR REPLACE não permite isso.)
DROP FUNCTION IF EXISTS public.birthdays_today();
CREATE OR REPLACE FUNCTION public.birthdays_today()
RETURNS TABLE(id uuid, app_user_id uuid, full_name text, photo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tm.id, tm.app_user_id, tm.full_name, COALESCE(au.avatar_url, tm.photo_url)
  FROM public.team_members tm
  LEFT JOIN public.app_users au ON au.id = tm.app_user_id
  WHERE tm.birth_date IS NOT NULL
    AND EXTRACT(MONTH FROM tm.birth_date) = EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/Sao_Paulo'))
    AND EXTRACT(DAY   FROM tm.birth_date) = EXTRACT(DAY   FROM (now() AT TIME ZONE 'America/Sao_Paulo'));
$$;
GRANT EXECUTE ON FUNCTION public.birthdays_today() TO authenticated;
