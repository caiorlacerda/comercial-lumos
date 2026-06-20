import { supabase } from '@/lib/supabase';

/**
 * Handle OS/Budget approval:
 * 1. Fetch budget details (client_id, category).
 * 2. Fetch default financial config (nf_percent).
 * 3. Create initial proyectos_financeiro record with pendente_preenchimento = true.
 */
export async function handleBudgetApproval(budgetId: string, totalAmount: number) {
  try {
    if (!budgetId || budgetId === 'draft') return;

    // 1. Fetch budget details
    const { data: budget, error: bErr } = await supabase
      .from('budgets')
      .select('client_id, category')
      .eq('id', budgetId)
      .single();

    if (bErr || !budget) {
      console.error('[handleBudgetApproval] Error fetching budget details:', bErr);
      return;
    }

    // 2. Fetch active default financial configuration
    const { data: config } = await supabase
      .from('config_financeiro')
      .select('nf_percent')
      .eq('id', 1)
      .single();

    const nfPercent = config?.nf_percent ?? 0.18;

    // 3. Resolve category ID by matching the name
    let categoryId = null;
    const catNameMap: Record<string, string> = {
      digital: 'Digital',
      filme: 'Filme',
      live: 'Live'
    };
    const catName = catNameMap[budget.category] || budget.category;
    
    if (catName) {
      const { data: category } = await supabase
        .from('categorias')
        .select('id')
        .eq('nome', catName)
        .maybeSingle();
      if (category) categoryId = category.id;
    }

    // 4. Check if there's already a projects_financeiro for this budget
    const { data: existing } = await supabase
      .from('projetos_financeiro')
      .select('id')
      .eq('proposta_id', budgetId)
      .maybeSingle();

    if (!existing) {
      // Find the corresponding project_id from projects table
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('budget_id', budgetId)
        .maybeSingle();

      // 5. Create projects_financeiro record
      const { error: insErr } = await supabase
        .from('projetos_financeiro')
        .insert({
          proposta_id: budgetId,
          project_id: project?.id || null,
          cliente_id: budget.client_id,
          categoria_id: categoryId,
          valor_vendido: totalAmount,
          nf_percent: nfPercent,
          custos_total: 0, // Automatically synced by DB trigger
          status_titulo: 'emitir_nf',
          origem: 'auto_aprovacao',
          pendente_preenchimento: true
        });
      
      if (insErr) {
        console.error('[handleBudgetApproval] Error inserting projects_financeiro:', insErr);
      }
    }
  } catch (err) {
    console.error('[handleBudgetApproval] Unexpected error:', err);
  }
}
