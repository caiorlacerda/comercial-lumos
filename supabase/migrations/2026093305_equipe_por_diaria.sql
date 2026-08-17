-- EQUIPE POR DIÁRIA: cada diária tem a própria escala (time interno ou
-- fornecedor, com função). A cobrança de nota passa a nascer DA ESCALA:
-- fornecedor escalado em diária com data = cobrança automática, ancorada na
-- última diária DELE no projeto (não mais na equipe geral do projeto).

CREATE TABLE IF NOT EXISTS public.diaria_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diaria_id  uuid NOT NULL REFERENCES public.project_diarias(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES public.app_users(id) ON DELETE CASCADE,
  freela_id  uuid REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  funcao     text,
  added_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- exatamente UM dos dois: ou gente do time, ou fornecedor
  CHECK ((user_id IS NULL) <> (freela_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_diaria_members_diaria ON public.diaria_members(diaria_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaria_members_user
  ON public.diaria_members(diaria_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_diaria_members_freela
  ON public.diaria_members(diaria_id, freela_id) WHERE freela_id IS NOT NULL;

ALTER TABLE public.diaria_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS diaria_members_all ON public.diaria_members;
CREATE POLICY diaria_members_all ON public.diaria_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.diaria_members TO authenticated;

-- Tempo real (melhor esforço; ignora se já está na publication)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.diaria_members;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── Sync v2: cobrança nasce da escala das diárias ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_cobranca_diaria(p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_projeto text;
  m RECORD;
BEGIN
  IF p_project_id IS NULL THEN RETURN; END IF;
  SELECT name INTO v_projeto FROM projects WHERE id = p_project_id;

  -- Quem saiu da escala de todas as diárias: cobrança agendada cancela.
  UPDATE nota_requests nr SET status = 'cancelada', updated_at = now()
  WHERE nr.project_id = p_project_id AND nr.origem = 'diaria' AND nr.status = 'agendada'
    AND NOT EXISTS (
      SELECT 1 FROM diaria_members dm
      JOIN project_diarias d ON d.id = dm.diaria_id
      WHERE d.project_id = p_project_id AND dm.freela_id = nr.fornecedor_id
    );

  -- Cada fornecedor escalado: âncora na última diária DELE com data.
  FOR m IN
    SELECT dm.freela_id,
           max(d.data) AS ultima,
           (array_agg(dm.funcao ORDER BY d.data DESC NULLS LAST) FILTER (WHERE NULLIF(trim(dm.funcao), '') IS NOT NULL))[1] AS funcao
    FROM diaria_members dm
    JOIN project_diarias d ON d.id = dm.diaria_id
    WHERE d.project_id = p_project_id AND dm.freela_id IS NOT NULL
    GROUP BY dm.freela_id
  LOOP
    IF m.ultima IS NULL THEN
      -- só diárias sem data: nada pra cobrar ainda
      UPDATE nota_requests SET status = 'cancelada', updated_at = now()
      WHERE fornecedor_id = m.freela_id AND project_id = p_project_id
        AND origem = 'diaria' AND status = 'agendada';
      CONTINUE;
    END IF;

    UPDATE nota_requests
    SET data_servico = m.ultima,
        enviar_em    = m.ultima + 28,
        pagar_em     = m.ultima + 35,
        updated_at   = now()
    WHERE fornecedor_id = m.freela_id AND project_id = p_project_id
      AND origem = 'diaria' AND status = 'agendada'
      AND data_servico IS DISTINCT FROM m.ultima;

    IF NOT EXISTS (
      SELECT 1 FROM nota_requests
      WHERE fornecedor_id = m.freela_id AND project_id = p_project_id
        AND status IN ('agendada', 'email_enviado')
    ) AND NOT EXISTS (
      SELECT 1 FROM nota_requests
      WHERE fornecedor_id = m.freela_id AND project_id = p_project_id
        AND status IN ('nota_recebida', 'paga') AND data_servico >= m.ultima
    ) THEN
      INSERT INTO nota_requests
        (fornecedor_id, project_id, descricao, valor, data_servico, enviar_em, pagar_em, origem)
      VALUES (
        m.freela_id, p_project_id,
        COALESCE(m.funcao, 'Diárias de produção') || COALESCE(' · ' || v_projeto, ''),
        NULL, m.ultima, m.ultima + 28, m.ultima + 35, 'diaria'
      );
    END IF;
  END LOOP;
END; $$;

-- ── Gatilhos na escala ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_trg_sync_escala()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid;
BEGIN
  SELECT project_id INTO v_pid FROM project_diarias
  WHERE id = COALESCE(NEW.diaria_id, OLD.diaria_id);
  PERFORM fn_sync_cobranca_diaria(v_pid);
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_nota_escala ON public.diaria_members;
CREATE TRIGGER trg_nota_escala
  AFTER INSERT OR UPDATE OF freela_id, funcao OR DELETE ON public.diaria_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_escala();

-- A equipe GERAL do projeto não dispara mais cobrança (a escala manda).
DROP TRIGGER IF EXISTS trg_nota_membro ON public.project_members;
DROP TRIGGER IF EXISTS trg_nota_membro_saiu ON public.project_members;
