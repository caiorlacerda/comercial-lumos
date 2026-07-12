-- Cadastro de dados da equipe interna da Lumos (RH). Dados sensíveis (CPF,
-- endereço, PIX...) ficam restritos a admin/produção. Só os aniversários são
-- expostos a todos (via RPCs security definer) para o calendário e o confete
-- na home — sem vazar o resto.

CREATE TABLE IF NOT EXISTS public.team_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id       uuid REFERENCES public.app_users(id) ON DELETE SET NULL, -- vínculo opcional ao login
  full_name         text NOT NULL,
  email             text,
  whatsapp          text,
  cpf               text,
  rg                text,
  birth_date        date,
  address           text,
  role_title        text,   -- cargo/função
  department        text,   -- setor (Produção, Comercial, Edição…)
  joined_at         date,   -- entrada na Lumos
  pix_key           text,   -- para pagamentos/reembolsos
  emergency_contact text,   -- contato de emergência
  shirt_size        text,   -- tamanho de camiseta (brindes/uniforme)
  photo_url         text,
  notes             text,
  ordem             integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_team_members_updated_at ON public.team_members;
CREATE TRIGGER update_team_members_updated_at
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
-- Só admin e produção leem/gerenciam os dados completos.
DROP POLICY IF EXISTS manage_team_members ON public.team_members;
CREATE POLICY manage_team_members ON public.team_members
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'producao'))
  WITH CHECK (public.get_user_role() IN ('admin', 'producao'));
GRANT ALL ON public.team_members TO authenticated, service_role;

-- Realtime para a página de dados atualizar ao vivo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_members;
  END IF;
END $$;

-- ── RPCs de aniversário (expõem SÓ nome/foto/dia, para todos os usuários) ────
-- Aniversariantes de HOJE (fuso de São Paulo) — para o confete + banner na home.
CREATE OR REPLACE FUNCTION public.birthdays_today()
RETURNS TABLE(id uuid, full_name text, photo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tm.id, tm.full_name, COALESCE(tm.photo_url, au.avatar_url)
  FROM public.team_members tm
  LEFT JOIN public.app_users au ON au.id = tm.app_user_id
  WHERE tm.birth_date IS NOT NULL
    AND EXTRACT(MONTH FROM tm.birth_date) = EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/Sao_Paulo'))
    AND EXTRACT(DAY   FROM tm.birth_date) = EXTRACT(DAY   FROM (now() AT TIME ZONE 'America/Sao_Paulo'));
$$;
GRANT EXECUTE ON FUNCTION public.birthdays_today() TO authenticated;

-- Aniversários de um mês (1-12) — para pintar no calendário. Retorna só nome+dia.
CREATE OR REPLACE FUNCTION public.birthdays_in_month(p_month int)
RETURNS TABLE(full_name text, day int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tm.full_name, EXTRACT(DAY FROM tm.birth_date)::int
  FROM public.team_members tm
  WHERE tm.birth_date IS NOT NULL
    AND EXTRACT(MONTH FROM tm.birth_date) = p_month
  ORDER BY EXTRACT(DAY FROM tm.birth_date), tm.full_name;
$$;
GRANT EXECUTE ON FUNCTION public.birthdays_in_month(int) TO authenticated;
