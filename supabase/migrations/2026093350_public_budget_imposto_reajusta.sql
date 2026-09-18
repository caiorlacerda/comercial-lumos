-- get_public_budget_by_token(): não estava versionada no repositório (criada
-- direto no banco). Alterada só pra devolver `imposto_reajusta_preco` junto
-- com margin_pct/nf_pct — sem isso, a página pública de aprovação (que
-- também roda calcFinancials) nunca saberia que uma proposta nova deve
-- reajustar o preço pelo imposto, e mostraria pro cliente um total diferente
-- do que a tela interna calcula. Resto da função idêntico ao que já rodava.
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
$function$
