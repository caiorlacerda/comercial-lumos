-- FORNECEDORES ESTILO AISTRA + FLUXO AUTOMÁTICO DE NOTA FISCAL
--
-- 1) Fornecedor ganha `tipo` (profissional | empresa) e `cidade`.
-- 2) Fluxo da nota: custo de projeto com fornecedor agenda uma cobrança.
--    28 dias depois do serviço o sistema manda e-mail pro fornecedor com um
--    link público pra ele subir a nota; o pagamento fica previsto pra 35 dias.
--    O time acompanha tudo na aba Notas da página de Fornecedores.

-- ── 1. Campos novos do fornecedor ──────────────────────────────────────────
ALTER TABLE public.fornecedores
  ADD COLUMN IF NOT EXISTS tipo   text NOT NULL DEFAULT 'profissional',
  ADD COLUMN IF NOT EXISTS cidade text;

-- Backfill: empresa só quando tem CNPJ e o nome tem cara de empresa (MEI de
-- freelancer continua profissional; o campo Tipo no editor corrige exceções).
UPDATE public.fornecedores
SET tipo = 'empresa'
WHERE length(regexp_replace(COALESCE(cnpj, ''), '\D', '', 'g')) = 14
  AND nome ~* 'ltda|eireli|\ms\.?a\.?\M|produç|producoes|studio|filmes?|locadora|rental|marketing|log[íi]stica|equipamentos|serviços|servicos'
  AND tipo = 'profissional';

-- ── 2. Cobranças de nota fiscal ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nota_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id    uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  project_id       uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  cost_id          uuid REFERENCES public.project_costs(id) ON DELETE SET NULL,
  descricao        text NOT NULL,
  valor            numeric,
  data_servico     date NOT NULL,
  enviar_em        date NOT NULL,   -- data_servico + 28
  pagar_em         date NOT NULL,   -- data_servico + 35
  token            text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  status           text NOT NULL DEFAULT 'agendada',
  -- agendada → email_enviado → nota_recebida → paga (ou cancelada)
  email_enviado_at timestamptz,
  nota_arquivo     jsonb,           -- { name, path }
  nota_enviada_at  timestamptz,
  created_by       uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nota_requests_due ON public.nota_requests (status, enviar_em);
CREATE INDEX IF NOT EXISTS idx_nota_requests_fornecedor ON public.nota_requests (fornecedor_id);

ALTER TABLE public.nota_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nota_requests all" ON public.nota_requests;
CREATE POLICY "nota_requests all" ON public.nota_requests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 3. Custo com fornecedor agenda a cobrança sozinho ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_agendar_nota_do_custo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
  v_projeto text;
BEGIN
  IF NEW.fornecedor_id IS NULL THEN RETURN NEW; END IF;

  -- Só agenda se o fornecedor tem e-mail pra receber a cobrança.
  SELECT email INTO v_email FROM fornecedores WHERE id = NEW.fornecedor_id;
  IF v_email IS NULL OR v_email = '' THEN RETURN NEW; END IF;

  -- Uma cobrança por custo.
  IF EXISTS (SELECT 1 FROM nota_requests WHERE cost_id = NEW.id) THEN RETURN NEW; END IF;

  SELECT name INTO v_projeto FROM projects WHERE id = NEW.project_id;

  INSERT INTO nota_requests
    (fornecedor_id, project_id, cost_id, descricao, valor, data_servico, enviar_em, pagar_em, created_by)
  VALUES (
    NEW.fornecedor_id, NEW.project_id, NEW.id,
    NEW.description || COALESCE(' · ' || v_projeto, ''),
    NEW.amount, NEW.cost_date,
    NEW.cost_date + 28, NEW.cost_date + 35,
    NEW.created_by
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_agendar_nota_do_custo ON public.project_costs;
CREATE TRIGGER trg_agendar_nota_do_custo
  AFTER INSERT OR UPDATE OF fornecedor_id ON public.project_costs
  FOR EACH ROW EXECUTE FUNCTION public.fn_agendar_nota_do_custo();

-- Custo apagado cancela cobrança que ainda não foi enviada.
CREATE OR REPLACE FUNCTION public.fn_cancelar_nota_do_custo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE nota_requests SET status = 'cancelada', updated_at = now()
  WHERE cost_id = OLD.id AND status IN ('agendada', 'email_enviado');
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_cancelar_nota_do_custo ON public.project_costs;
CREATE TRIGGER trg_cancelar_nota_do_custo
  BEFORE DELETE ON public.project_costs
  FOR EACH ROW EXECUTE FUNCTION public.fn_cancelar_nota_do_custo();

-- ── 4. Página pública /nota/:token ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nota_request(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v RECORD;
BEGIN
  SELECT nr.id, nr.descricao, nr.valor, nr.pagar_em, nr.status, nr.nota_arquivo,
         f.nome AS fornecedor_nome, p.name AS projeto_nome
  INTO v
  FROM nota_requests nr
  JOIN fornecedores f ON f.id = nr.fornecedor_id
  LEFT JOIN projects p ON p.id = nr.project_id
  WHERE nr.token = p_token AND nr.status <> 'cancelada';

  IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'link_invalido'); END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'fornecedor', v.fornecedor_nome,
    'projeto', v.projeto_nome,
    'descricao', v.descricao,
    'valor', v.valor,
    'pagar_em', v.pagar_em,
    'status', v.status,
    'arquivo', v.nota_arquivo -> 'name'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.submit_nota(p_token text, p_path text, p_file_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v RECORD;
  v_admin RECORD;
BEGIN
  SELECT nr.*, f.nome AS fornecedor_nome INTO v
  FROM nota_requests nr JOIN fornecedores f ON f.id = nr.fornecedor_id
  WHERE nr.token = p_token AND nr.status IN ('agendada', 'email_enviado', 'nota_recebida');
  IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'link_invalido'); END IF;

  UPDATE nota_requests
  SET nota_arquivo = jsonb_build_object('name', p_file_name, 'path', p_path),
      nota_enviada_at = now(),
      status = 'nota_recebida',
      updated_at = now()
  WHERE id = v.id;

  FOR v_admin IN
    SELECT id FROM app_users WHERE status = 'ativo' AND role = 'admin'
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      v_admin.id, 'nota_fiscal_recebida', 'financeiro', 'high',
      'Nota fiscal recebida 📄',
      v.fornecedor_nome || ' enviou a nota do job "' || v.descricao || '". Pagamento previsto pra ' || to_char(v.pagar_em, 'DD/MM/YYYY') || '.',
      '/producao/fornecedores?tab=notas',
      jsonb_build_object('nota_request_id', v.id)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_nota_request(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_nota(text, text, text) TO anon, authenticated;

-- ── 5. Bucket das notas ───────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES ('notas-fiscais', 'notas-fiscais', true) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "notas read" ON storage.objects;
CREATE POLICY "notas read" ON storage.objects FOR SELECT USING (bucket_id = 'notas-fiscais');

-- Fornecedor (anon) só sobe arquivo na pasta do próprio token, e só enquanto
-- a cobrança está aberta.
DROP POLICY IF EXISTS "notas insert anon" ON storage.objects;
CREATE POLICY "notas insert anon" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'notas-fiscais'
    AND EXISTS (
      SELECT 1 FROM public.nota_requests
      WHERE token = (storage.foldername(name))[1]
        AND status IN ('agendada', 'email_enviado', 'nota_recebida')
    )
  );

DROP POLICY IF EXISTS "notas delete" ON storage.objects;
CREATE POLICY "notas delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'notas-fiscais');
