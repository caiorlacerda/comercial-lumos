-- APROVAÇÃO PÚBLICA DE ORÇAMENTO, ETAPA 1 DE 2 (só soma um campo; não quebra nada)
--
-- A página /aprovar/:token precisa saber se o cliente "já respondeu" aquele link. Hoje ela
-- descobre isso lendo a tabela budget_approvals direto, como visitante, o que obriga a manter
-- uma regra de leitura aberta (USING true) nessa tabela.
--
-- Esta etapa faz a função que a página já usa para carregar a proposta devolver também
-- "ja_respondido". O front passa a usar esse campo e deixa de ler a tabela. Versões antigas
-- do front continuam funcionando (é só um campo a mais no JSON).
--
-- Obs.: o recorte da proposta (itens, cliente, contato) continua exatamente igual ao que a
-- função já devolvia; esta etapa não mexe em quem enxerga o quê, só soma o campo.
--
-- ORDEM: (1) esta migration, (2) merge/deploy do front, (3) migration 2026103103.
-- Seguro rodar mais de uma vez. Não mexe em dados nem na tabela.

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
    'fx_rate', CASE WHEN bv.currency = 'USD' THEN bv.fx_rate END,
    'notes_client', bv.notes_client,
    'payment_terms', bv.payment_terms,
    'validity_days', bv.validity_days,
    'public_token', bv.public_token,
    'ja_respondido', EXISTS (SELECT 1 FROM public.budget_approvals ba WHERE ba.version_id = bv.id),
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

