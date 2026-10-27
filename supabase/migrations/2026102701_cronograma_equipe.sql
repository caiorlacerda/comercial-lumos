-- CRONOGRAMA DA EQUIPE (substitui a planilha "LUMOS | Cronograma da equipe")
--
-- Uma semana por registro; as linhas são pessoas (usuário da plataforma OU nome livre) e as
-- linhas especiais (Criação, Externas, Entregas); cada célula (linha × dia) é uma lista de itens
-- com tipo (edição, gravação/meeting, externa, entrega) que define a cor.
--
-- Leitura: toda a equipe (política restritiva somente_equipe, como no resto do app).
-- Escrita: só admin e Gestão de Produção, e isso vale NO BANCO, não só na tela.
--
-- cronograma_itens.task_id / project_id ficam prontos para a etapa de ligação com tarefas.

-- ── Quem edita ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pode_editar_cronograma()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.auth_user_id = auth.uid() AND u.status = 'ativo' AND u.role IN ('admin', 'producao')
  );
$$;
REVOKE ALL ON FUNCTION public.pode_editar_cronograma() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_editar_cronograma() TO authenticated;

-- ── Tabelas ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cronograma_semanas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inicio              date NOT NULL UNIQUE,            -- sempre a segunda-feira
  projetos_andamento  text NOT NULL DEFAULT '',
  projetos_iniciar    text NOT NULL DEFAULT '',
  created_by          uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cronograma_semana_segunda CHECK (extract(isodow FROM inicio) = 1)
);

CREATE TABLE IF NOT EXISTS public.cronograma_linhas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semana_id   uuid NOT NULL REFERENCES public.cronograma_semanas(id) ON DELETE CASCADE,
  ordem       integer NOT NULL DEFAULT 0,
  tipo        text NOT NULL DEFAULT 'pessoa' CHECK (tipo IN ('pessoa', 'criacao', 'externas', 'entregas')),
  user_id     uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  nome        text,                                    -- nome livre (Freela 01...) ou rótulo da linha especial
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cronograma_linhas_semana ON public.cronograma_linhas (semana_id, ordem);

CREATE TABLE IF NOT EXISTS public.cronograma_itens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linha_id    uuid NOT NULL REFERENCES public.cronograma_linhas(id) ON DELETE CASCADE,
  dia         date NOT NULL,
  ordem       integer NOT NULL DEFAULT 0,
  texto       text NOT NULL DEFAULT '',
  tipo        text NOT NULL DEFAULT 'edicao' CHECK (tipo IN ('edicao', 'gravacao', 'externa', 'entrega')),
  task_id     uuid REFERENCES public.project_tasks(id) ON DELETE SET NULL,
  project_id  uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cronograma_itens_linha ON public.cronograma_itens (linha_id, dia, ordem);

-- ── Segurança: leitura = equipe; escrita = admin e Gestão de Produção ────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cronograma_semanas', 'cronograma_linhas', 'cronograma_itens'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ler', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_team()))', t || '_ler', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_inserir', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.pode_editar_cronograma()))', t || '_inserir', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_alterar', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.pode_editar_cronograma())) WITH CHECK ((SELECT public.pode_editar_cronograma()))', t || '_alterar', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_apagar', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.pode_editar_cronograma()))', t || '_apagar', t);

    -- mesma trava do resto do app (ver 2026102300_somente_equipe.sql)
    EXECUTE format('DROP POLICY IF EXISTS somente_equipe ON public.%I', t);
    EXECUTE format('CREATE POLICY somente_equipe ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_team())) WITH CHECK ((SELECT public.is_team()))', t);
  END LOOP;
END $$;

-- Tempo real: quem está com a tela aberta vê a mudança de quem está editando.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cronograma_semanas', 'cronograma_linhas', 'cronograma_itens'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN OTHERS THEN NULL;   -- já estava na publicação
    END;
  END LOOP;
END $$;

-- ── Criar a semana: vazia (com as linhas especiais) ou copiando outra ─────────
-- p_copiar_de = segunda-feira da semana de origem (NULL = semana nova, vazia).
-- p_com_itens = leva também os itens (as datas deslocam junto com a semana).
CREATE OR REPLACE FUNCTION public.cronograma_criar_semana(
  p_inicio date,
  p_copiar_de date DEFAULT NULL,
  p_com_itens boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_novo   uuid;
  v_origem uuid;
  v_eu     uuid;
  v_dias   integer;
  l        RECORD;
  v_linha  uuid;
BEGIN
  IF NOT public.pode_editar_cronograma() THEN RAISE EXCEPTION 'sem_permissao'; END IF;
  IF extract(isodow FROM p_inicio) <> 1 THEN RAISE EXCEPTION 'inicio_deve_ser_segunda'; END IF;
  IF EXISTS (SELECT 1 FROM cronograma_semanas WHERE inicio = p_inicio) THEN RAISE EXCEPTION 'semana_ja_existe'; END IF;

  SELECT id INTO v_eu FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1;
  INSERT INTO cronograma_semanas (inicio, created_by) VALUES (p_inicio, v_eu) RETURNING id INTO v_novo;

  IF p_copiar_de IS NOT NULL THEN
    SELECT id INTO v_origem FROM cronograma_semanas WHERE inicio = p_copiar_de;
    IF v_origem IS NULL THEN RAISE EXCEPTION 'semana_de_origem_nao_existe'; END IF;
    v_dias := p_inicio - p_copiar_de;

    UPDATE cronograma_semanas n
    SET projetos_andamento = o.projetos_andamento, projetos_iniciar = o.projetos_iniciar
    FROM cronograma_semanas o WHERE n.id = v_novo AND o.id = v_origem;

    FOR l IN SELECT * FROM cronograma_linhas WHERE semana_id = v_origem ORDER BY ordem, created_at LOOP
      INSERT INTO cronograma_linhas (semana_id, ordem, tipo, user_id, nome)
      VALUES (v_novo, l.ordem, l.tipo, l.user_id, l.nome) RETURNING id INTO v_linha;
      IF p_com_itens THEN
        INSERT INTO cronograma_itens (linha_id, dia, ordem, texto, tipo, task_id, project_id, created_by)
        SELECT v_linha, i.dia + v_dias, i.ordem, i.texto, i.tipo, i.task_id, i.project_id, v_eu
        FROM cronograma_itens i WHERE i.linha_id = l.id;
      END IF;
    END LOOP;
  ELSE
    INSERT INTO cronograma_linhas (semana_id, ordem, tipo, nome) VALUES
      (v_novo, 100, 'criacao', 'Criação'),
      (v_novo, 101, 'externas', 'Externas'),
      (v_novo, 102, 'entregas', 'Entregas');
  END IF;

  RETURN v_novo;
END; $$;
REVOKE ALL ON FUNCTION public.cronograma_criar_semana(date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cronograma_criar_semana(date, date, boolean) TO authenticated;
