-- REFORMA DO FINANCEIRO (modelo do benchmark)
-- 1) Movimentações: extrato bancário importado (CSV ou PDF do Cora) vira
--    lançamento com deduplicação por hash; um registro por importação.
-- 2) Metas: meta de lucro por mês (Meta vs Previsto vs Realizado).
-- 3) Contas: cadastro dos dados bancários da produtora (copiar e colar).
-- Permissões continuam as de sempre: tudo isso é área de admin no app.

-- ── Movimentações ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      text,
  formato       text,             -- csv | pdf
  periodo       text,             -- "01/07/2026 a 01/08/2026" quando o arquivo informa
  saldo_inicial numeric,
  saldo_final   numeric,
  novas         int NOT NULL DEFAULT 0,
  duplicadas    int NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data          date NOT NULL,
  descricao     text NOT NULL,      -- "Transf Pix enviada", "Boleto pago"…
  tipo          text NOT NULL,      -- credito | debito
  identificacao text,               -- contraparte
  valor         numeric NOT NULL,   -- com sinal (débito negativo)
  categoria     text,
  project_id    uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  hash_dedup    text UNIQUE,        -- null em lançamento manual
  import_id     uuid REFERENCES public.bank_imports(id) ON DELETE SET NULL,
  origem        text NOT NULL DEFAULT 'extrato',  -- extrato | manual
  notas         text,
  created_by    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_tx_data ON public.bank_transactions (data DESC);
CREATE INDEX IF NOT EXISTS idx_bank_tx_project ON public.bank_transactions (project_id);

-- ── Metas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.metas_financeiras (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo       text NOT NULL DEFAULT 'lucro',
  ano        int  NOT NULL,
  mes        int  NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor      numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, ano, mes)
);

-- ── Contas da produtora (dados bancários pra copiar e colar) ───────────────
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  tipo       text NOT NULL DEFAULT 'banco',   -- banco | dinheiro | cartao
  banco      text,
  agencia    text,
  conta      text,
  pix        text,
  titular    text,
  documento  text,
  principal  boolean NOT NULL DEFAULT false,
  ordem      int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Conta principal já nasce cadastrada com o que está no extrato do Cora.
INSERT INTO public.bank_accounts (nome, tipo, banco, agencia, conta, titular, documento, principal, ordem)
SELECT 'Conta principal', 'banco', 'Cora SCFI', '0001', '4091799-2',
       'LUMOS PRODUTORA AUDIOVISUAL LTDA', '51.253.010/0001-70', true, 0
WHERE NOT EXISTS (SELECT 1 FROM public.bank_accounts);

-- ── RLS (padrão do app: acesso controlado por permissão na interface) ──────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_imports', 'bank_transactions', 'metas_financeiras', 'bank_accounts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t || '_all', t);
    EXECUTE format('GRANT ALL ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Tempo real (melhor esforço)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.bank_transactions;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── Notas mudou de endereço: link da notificação acompanha ────────────────
CREATE OR REPLACE FUNCTION public.submit_nota(
  p_token text,
  p_path text,
  p_file_name text,
  p_dados_pagamento text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      dados_pagamento = COALESCE(NULLIF(trim(p_dados_pagamento), ''), dados_pagamento),
      updated_at = now()
  WHERE id = v.id;

  IF NULLIF(trim(p_dados_pagamento), '') IS NOT NULL THEN
    UPDATE fornecedores SET payment_info = trim(p_dados_pagamento), updated_at = now()
    WHERE id = v.fornecedor_id;
  END IF;

  FOR v_admin IN
    SELECT id FROM app_users WHERE status = 'ativo' AND role = 'admin'
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      v_admin.id, 'nota_fiscal_recebida', 'financeiro', 'high',
      'Nota fiscal recebida 📄',
      v.fornecedor_nome || ' enviou a nota do job "' || v.descricao || '"'
        || CASE WHEN NULLIF(trim(p_dados_pagamento), '') IS NOT NULL THEN ' e confirmou os dados de pagamento' ELSE '' END
        || '. Pagamento previsto pra ' || to_char(v.pagar_em, 'DD/MM/YYYY') || '.',
      '/financeiro/notas',
      jsonb_build_object('nota_request_id', v.id)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.submit_nota(text, text, text, text) TO anon, authenticated;
