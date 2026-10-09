-- ORÇAMENTO EM DÓLAR (Fase 1)
--
-- A proposta pode ser cobrada em US$. O dólar é só uma conversão FINAL do preço:
-- custo, margem e imposto seguem em reais, e o financeiro (aprovar_orcamento,
-- receivables, projetos_financeiro, vw_rentabilidade) NÃO muda — continua
-- recebendo o valor em reais de sempre.
--
-- Esta migration é ADITIVA e segura de rodar antes do deploy do front: todas as
-- propostas existentes ficam em R$ (padrão 'BRL'); o front antigo ignora as
-- colunas novas. Já o front NOVO grava essas colunas, então esta migration tem
-- que rodar ANTES dele.
--
--   fx_market_rate  cotação de mercado usada (R$ por US$, PTAX de compra)
--   fx_spread_pct   margem de segurança (fração; 0.03 = 3%)
--   fx_rate         cotação TRAVADA = mercado × (1 − margem)
--   fx_rate_at      quando a cotação foi obtida/digitada
--   fx_source       'ptax' (Banco Central) ou 'manual'

ALTER TABLE public.budget_versions
  ADD COLUMN IF NOT EXISTS currency       text         NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS fx_market_rate numeric(12,4),
  ADD COLUMN IF NOT EXISTS fx_spread_pct  numeric(5,4) NOT NULL DEFAULT 0.03,
  ADD COLUMN IF NOT EXISTS fx_rate        numeric(12,4),
  ADD COLUMN IF NOT EXISTS fx_rate_at     timestamptz,
  ADD COLUMN IF NOT EXISTS fx_source      text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_versions_moeda_valida') THEN
    ALTER TABLE public.budget_versions
      ADD CONSTRAINT budget_versions_moeda_valida CHECK (
        currency IN ('BRL', 'USD')
        AND (currency = 'BRL' OR (fx_rate IS NOT NULL AND fx_rate > 0))
        AND (fx_source IS NULL OR fx_source IN ('ptax', 'manual'))
        AND fx_spread_pct >= 0 AND fx_spread_pct < 1
      );
  END IF;
END $$;

-- TRAVA NA APROVAÇÃO: com o orçamento aprovado, moeda e cotação não mudam.
-- Gravar o MESMO valor (o editor reenvia a versão inteira a cada salvamento) e
-- mexer em qualquer outro campo continua permitido. Para alterar, o orçamento
-- volta antes para "Em negociação".
CREATE OR REPLACE FUNCTION public.fn_trava_cotacao_aprovado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.currency       IS DISTINCT FROM OLD.currency
   OR NEW.fx_market_rate IS DISTINCT FROM OLD.fx_market_rate
   OR NEW.fx_spread_pct  IS DISTINCT FROM OLD.fx_spread_pct
   OR NEW.fx_rate        IS DISTINCT FROM OLD.fx_rate
   OR NEW.fx_source      IS DISTINCT FROM OLD.fx_source)
  AND EXISTS (SELECT 1 FROM budgets b WHERE b.id = NEW.budget_id AND b.status = 'aprovado')
  THEN
    RAISE EXCEPTION 'Moeda e cotação não podem mudar com o orçamento aprovado. Volte o orçamento para "Em negociação" antes de alterar.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trava_cotacao_aprovado ON public.budget_versions;
CREATE TRIGGER trg_trava_cotacao_aprovado
  BEFORE UPDATE ON public.budget_versions
  FOR EACH ROW EXECUTE FUNCTION public.fn_trava_cotacao_aprovado();

-- Um registro por dia útil, guardado pela Edge Function `cotacao` (cache e
-- plano B quando o Banco Central estiver fora do ar). Só a função (service
-- role) lê e escreve: RLS ligado e nenhuma policy.
CREATE TABLE IF NOT EXISTS public.cotacoes_dia (
  data       date PRIMARY KEY,
  compra     numeric(12,4) NOT NULL,
  venda      numeric(12,4) NOT NULL,
  fonte      text          NOT NULL DEFAULT 'ptax',
  buscado_em timestamptz   NOT NULL DEFAULT now()
);
ALTER TABLE public.cotacoes_dia ENABLE ROW LEVEL SECURITY;

-- A página pública de aprovação precisa saber a moeda e a cotação para mostrar
-- o mesmo valor em US$ que o editor. Resto da função idêntico ao de
-- 2026093350 (CREATE OR REPLACE preserva as permissões atuais).
CREATE OR REPLACE FUNCTION public.get_public_budget_by_token(p_token uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'id', bv.id,
    'budget_id', bv.budget_id,
    'version_number', bv.version_number,
    'margin_pct', bv.margin_pct,
    'nf_pct', bv.nf_pct,
    'imposto_reajusta_preco', bv.imposto_reajusta_preco,
    'discount_value', bv.discount_value,
    'currency', bv.currency,
    'fx_rate', bv.fx_rate,
    'notes_client', bv.notes_client,
    'payment_terms', bv.payment_terms,
    'validity_days', bv.validity_days,
    'public_token', bv.public_token,
    'created_at', bv.created_at,
    'budgets', json_build_object(
      'project_name', b.project_name,
      'code', b.code,
      'category', b.category,
      'status', b.status,
      'clients', json_build_object(
        'name', c.name,
        'agency_name', c.agency_name
      )
    ),
    'contact', CASE WHEN cc.id IS NOT NULL THEN json_build_object(
      'name', cc.name,
      'email', cc.email
    ) ELSE NULL END,
    'items', (
      SELECT json_agg(
        json_build_object(
          'id', bi.id,
          'item_group', bi.item_group,
          'name', bi.name,
          'description', bi.description,
          'unit_cost', bi.unit_cost,
          'quantity', bi.quantity,
          'unit_label', bi.unit_label,
          'sort_order', bi.sort_order
        ) ORDER BY bi.sort_order
      )
      FROM budget_items bi
      WHERE bi.version_id = bv.id
    )
  )
  INTO result
  FROM budget_versions bv
  JOIN budgets b ON b.id = bv.budget_id
  LEFT JOIN clients c ON c.id = b.client_id
  LEFT JOIN client_contacts cc ON cc.id = bv.contact_id
  WHERE bv.public_token = p_token;

  RETURN result;
END;
$function$;
