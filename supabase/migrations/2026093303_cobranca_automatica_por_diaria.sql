-- COBRANÇA DE NOTA 100% AUTOMÁTICA A PARTIR DAS DIÁRIAS
--
-- Regra: fornecedor na equipe do projeto (project_members.freela_id) +
-- diária com data definida = cobrança criada sozinha, com origem 'diaria'.
-- · A data do serviço é a ÚLTIMA diária do projeto; se o fornecedor está em
--   várias diárias, é uma cobrança só, que acompanha a última data enquanto
--   o e-mail não saiu (agendada).
-- · E-mail sai sozinho no cron 28 dias depois; pagamento previsto em 35.
-- · Removeu o fornecedor da equipe, ou a diária perdeu a data? Cobrança
--   agendada de diária se cancela sozinha.
-- · Custo lançado depois só COMPLETA o valor da cobrança de diária aberta
--   (não duplica). Custo de fornecedor fora das diárias continua criando a
--   própria cobrança, como antes.

-- ── 1. Origem da cobrança ──────────────────────────────────────────────────
ALTER TABLE public.nota_requests
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual';

UPDATE public.nota_requests SET origem = 'custo'
WHERE cost_id IS NOT NULL AND origem = 'manual';

-- ── 2. Sincroniza as cobranças de diária de um projeto ────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_cobranca_diaria(p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ultima  date;
  v_projeto text;
  m RECORD;
BEGIN
  IF p_project_id IS NULL THEN RETURN; END IF;

  SELECT max(data) INTO v_ultima FROM project_diarias
  WHERE project_id = p_project_id AND data IS NOT NULL;
  SELECT name INTO v_projeto FROM projects WHERE id = p_project_id;

  FOR m IN
    SELECT pm.freela_id, pm.funcao
    FROM project_members pm
    WHERE pm.project_id = p_project_id AND pm.freela_id IS NOT NULL
  LOOP
    IF v_ultima IS NULL THEN
      -- Projeto ficou sem diária datada: cobrança de diária ainda não
      -- enviada não tem mais razão de ser.
      UPDATE nota_requests SET status = 'cancelada', updated_at = now()
      WHERE fornecedor_id = m.freela_id AND project_id = p_project_id
        AND origem = 'diaria' AND status = 'agendada';
      CONTINUE;
    END IF;

    -- Cobrança agendada acompanha a última diária (28/35 recontam).
    UPDATE nota_requests
    SET data_servico = v_ultima,
        enviar_em    = v_ultima + 28,
        pagar_em     = v_ultima + 35,
        updated_at   = now()
    WHERE fornecedor_id = m.freela_id AND project_id = p_project_id
      AND origem = 'diaria' AND status = 'agendada'
      AND data_servico IS DISTINCT FROM v_ultima;

    -- Nada em aberto e nada concluído cobrindo essa data → cria.
    IF NOT EXISTS (
      SELECT 1 FROM nota_requests
      WHERE fornecedor_id = m.freela_id AND project_id = p_project_id
        AND status IN ('agendada', 'email_enviado')
    ) AND NOT EXISTS (
      SELECT 1 FROM nota_requests
      WHERE fornecedor_id = m.freela_id AND project_id = p_project_id
        AND status IN ('nota_recebida', 'paga') AND data_servico >= v_ultima
    ) THEN
      INSERT INTO nota_requests
        (fornecedor_id, project_id, descricao, valor, data_servico, enviar_em, pagar_em, origem)
      VALUES (
        m.freela_id, p_project_id,
        COALESCE(NULLIF(trim(m.funcao), ''), 'Diárias de produção') || COALESCE(' · ' || v_projeto, ''),
        NULL, v_ultima, v_ultima + 28, v_ultima + 35, 'diaria'
      );
    END IF;
  END LOOP;
END; $$;

-- ── 3. Gatilhos: equipe do projeto e diárias ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_trg_sync_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.freela_id IS NOT NULL THEN
    PERFORM fn_sync_cobranca_diaria(NEW.project_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_nota_membro ON public.project_members;
CREATE TRIGGER trg_nota_membro
  AFTER INSERT OR UPDATE OF freela_id ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_membro();

-- Fornecedor saiu da equipe: cancela a cobrança de diária não enviada.
CREATE OR REPLACE FUNCTION public.fn_trg_membro_saiu()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.freela_id IS NOT NULL THEN
    UPDATE nota_requests SET status = 'cancelada', updated_at = now()
    WHERE fornecedor_id = OLD.freela_id AND project_id = OLD.project_id
      AND origem = 'diaria' AND status = 'agendada';
  END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_nota_membro_saiu ON public.project_members;
CREATE TRIGGER trg_nota_membro_saiu
  AFTER DELETE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_membro_saiu();

CREATE OR REPLACE FUNCTION public.fn_trg_sync_diaria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM fn_sync_cobranca_diaria(COALESCE(NEW.project_id, OLD.project_id));
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_nota_diaria ON public.project_diarias;
CREATE TRIGGER trg_nota_diaria
  AFTER INSERT OR UPDATE OF data OR DELETE ON public.project_diarias
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_diaria();

-- ── 4. Custo passa a conversar com a cobrança de diária ───────────────────
CREATE OR REPLACE FUNCTION public.fn_agendar_nota_do_custo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_projeto text;
  v_diaria_aberta uuid;
BEGIN
  IF NEW.fornecedor_id IS NULL THEN RETURN NEW; END IF;

  -- Uma cobrança por custo.
  IF EXISTS (SELECT 1 FROM nota_requests WHERE cost_id = NEW.id) THEN RETURN NEW; END IF;

  -- Já existe cobrança de diária em aberto pro mesmo fornecedor no projeto?
  -- Então o custo só completa o valor dela (sem duplicar cobrança).
  SELECT id INTO v_diaria_aberta FROM nota_requests
  WHERE fornecedor_id = NEW.fornecedor_id AND project_id = NEW.project_id
    AND origem = 'diaria' AND status IN ('agendada', 'email_enviado')
  LIMIT 1;
  IF v_diaria_aberta IS NOT NULL THEN
    UPDATE nota_requests SET valor = COALESCE(valor, NEW.amount), updated_at = now()
    WHERE id = v_diaria_aberta;
    RETURN NEW;
  END IF;

  SELECT name INTO v_projeto FROM projects WHERE id = NEW.project_id;

  INSERT INTO nota_requests
    (fornecedor_id, project_id, cost_id, descricao, valor, data_servico, enviar_em, pagar_em, created_by, origem)
  VALUES (
    NEW.fornecedor_id, NEW.project_id, NEW.id,
    NEW.description || COALESCE(' · ' || v_projeto, ''),
    NEW.amount, NEW.cost_date,
    NEW.cost_date + 28, NEW.cost_date + 35,
    NEW.created_by, 'custo'
  );
  RETURN NEW;
END; $$;
