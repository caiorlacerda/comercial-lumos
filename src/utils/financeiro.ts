import { supabase } from '@/lib/supabase';
import { calcFinancials } from '@/utils/financials';

/**
 * Handle OS/Budget approval safely across all screens:
 * 1. Creates `projects` if not exists.
 * 2. Creates/updates `receivables`.
 * 3. Creates/updates `projetos_financeiro` linking it correctly to `projects`.
 * Ensures idempotency: handles 23505 gracefully, updates if exists.
 */
export async function syncBudgetApprovalFlow(budgetId: string, optionalTotalAmount?: number) {
  if (!budgetId || budgetId === 'draft') return;

  // FASE 2 DA VERDADE ÚNICA: a aprovação é uma função transacional no banco —
  // projeto, parcelas (conforme a condição de pagamento da proposta) e registro
  // financeiro nascem juntos ou nada nasce. O caminho antigo abaixo só roda se
  // a função ainda não existir no banco (migration pendente), pra nenhuma
  // aprovação ficar travada durante a transição.
  const { data: rpc, error: rpcErr } = await supabase.rpc('aprovar_orcamento', { p_budget_id: budgetId });
  if (!rpcErr && (rpc as { ok?: boolean } | null)?.ok) {
    await sincronizarTarefasPadrao(budgetId);
    return;
  }
  if (rpcErr && !/aprovar_orcamento|function|schema|404/i.test(rpcErr.message)) {
    throw new Error('Erro ao aprovar o orçamento: ' + rpcErr.message);
  }

  // 1. Fetch budget details (client_id, category, etc)
  const { data: budget, error: bErr } = await supabase
    .from('budgets')
    .select('id, project_name, code, client_id, category, active_version_id')
    .eq('id', budgetId)
    .single();

  if (bErr || !budget) {
    throw new Error('Erro ao buscar detalhes do orçamento: ' + (bErr?.message || 'Não encontrado'));
  }

  // 1b. Determine totalAmount
  let totalAmount = optionalTotalAmount;
  if (totalAmount === undefined && budget.active_version_id) {
    const [versionRes, itemsRes] = await Promise.all([
      supabase.from('budget_versions').select('id, margin_pct, nf_pct, discount_value').eq('id', budget.active_version_id).single(),
      supabase.from('budget_items').select('item_group, unit_cost, quantity').eq('version_id', budget.active_version_id),
    ]);
    if (versionRes.data && itemsRes.data) {
      const financials = calcFinancials(itemsRes.data as any, versionRes.data as any);
      totalAmount = financials.valorFinal;
    }
  }

  if (totalAmount === undefined || totalAmount < 0) {
    totalAmount = 0; 
  }

  // 2. Sync PROJECTS table
  let projectId: string | null = null;
  const { data: existingProj, error: errProjFind } = await supabase.from('projects').select('id, code').eq('budget_id', budgetId).maybeSingle();
  if (errProjFind) throw new Error('Erro ao buscar projeto: ' + errProjFind.message);

  if (existingProj) {
    projectId = existingProj.id;
    // Auto-corrige o código do projeto quando ele ficou vazio na criação (ex.:
    // projeto criado antes do orçamento ter código). O código do orçamento é a
    // fonte da verdade; só preenche quando está faltando, nunca sobrescreve.
    if ((!existingProj.code || existingProj.code === '' || existingProj.code === '----') && budget.code) {
      await supabase.from('projects').update({ code: budget.code }).eq('id', existingProj.id);
    }
  } else {
    const { data: newProj, error: pErr } = await supabase.from('projects').insert([{
      name: budget.project_name,
      code: budget.code || null,
      budget_id: budget.id,
      client_id: budget.client_id || null,
    }]).select('id').single();

    if (pErr) {
      if (pErr.code === '23505') {
        // Race condition: another request created it just now. Fetch it.
        const { data: raceProj, error: errRace } = await supabase.from('projects').select('id').eq('budget_id', budgetId).single();
        if (errRace) throw new Error('Erro ao buscar projeto após contenção: ' + errRace.message);
        projectId = raceProj.id;
      } else {
        throw new Error('Erro ao criar projeto: ' + pErr.message);
      }
    } else if (newProj) {
      projectId = newProj.id;
    }
  }

  if (!projectId) {
    throw new Error('Falha inesperada: não foi possível obter o ID do projeto.');
  }

  // 3. Sync RECEIVABLES table
  if (budget.active_version_id && totalAmount > 0) {
    const { data: existingRec, error: errRecFind } = await supabase.from('receivables').select('id, status').eq('budget_id', budgetId).maybeSingle();
    if (errRecFind) throw new Error('Erro ao buscar contas a receber: ' + errRecFind.message);

    if (existingRec) {
      if (existingRec.status !== 'recebido') {
        const { error: updErr } = await supabase.from('receivables').update({
          total_amount: totalAmount,
          budget_version_id: budget.active_version_id,
          updated_at: new Date().toISOString(),
        }).eq('id', existingRec.id);
        if (updErr) throw new Error('Erro ao atualizar contas a receber: ' + updErr.message);
      }
    } else {
      const { error: rErr } = await supabase.from('receivables').insert([{
        budget_id: budget.id,
        budget_version_id: budget.active_version_id,
        description: budget.project_name,
        client_id: budget.client_id,
        total_amount: totalAmount,
        status: 'aguardando',
      }]);
      if (rErr && rErr.code !== '23505') {
        throw new Error('Erro ao criar contas a receber: ' + rErr.message);
      }
    }
  }

  // 4. Sync PROJETOS_FINANCEIRO table
  const { data: config } = await supabase.from('config_financeiro').select('nf_percent').eq('id', 1).maybeSingle();
  const nfPercent = config?.nf_percent ?? 0.18;

  let categoryId = null;
  const catNameMap: Record<string, string> = { digital: 'Digital', filme: 'Filme', live: 'Live' };
  const catName = catNameMap[budget.category] || budget.category;
  if (catName) {
    const { data: category } = await supabase.from('categorias').select('id').eq('nome', catName).maybeSingle();
    if (category) categoryId = category.id;
  }

  const { data: existingFin, error: errFinFind } = await supabase.from('projetos_financeiro').select('id').eq('proposta_id', budgetId).maybeSingle();
  if (errFinFind) throw new Error('Erro ao buscar projeto financeiro: ' + errFinFind.message);

  if (existingFin) {
    const { error: fUpdErr } = await supabase.from('projetos_financeiro').update({
      project_id: projectId,
      valor_vendido: totalAmount,
    }).eq('id', existingFin.id);
    if (fUpdErr) throw new Error('Erro ao atualizar projeto financeiro: ' + fUpdErr.message);
  } else {
    const { error: insErr } = await supabase.from('projetos_financeiro').insert([{
      proposta_id: budgetId,
      project_id: projectId,
      cliente_id: budget.client_id,
      categoria_id: categoryId,
      valor_vendido: totalAmount,
      nf_percent: nfPercent,
      custos_total: 0,
      status_titulo: 'emitir_nf',
      origem: 'auto_aprovacao',
      pendente_preenchimento: true
    }]);

    if (insErr) {
      if (insErr.code === '23505') {
         const { data: raceFin, error: raceErr } = await supabase.from('projetos_financeiro').select('id').eq('proposta_id', budgetId).single();
         if (raceErr) throw new Error('Erro ao buscar projeto financeiro após contenção: ' + raceErr.message);
         await supabase.from('projetos_financeiro').update({ project_id: projectId, valor_vendido: totalAmount }).eq('id', raceFin.id);
      } else {
        throw new Error('Erro ao criar projeto financeiro: ' + insErr.message);
      }
    }
  }

  await sincronizarTarefasPadrao(budgetId, projectId, budget.category);
}



/**
 * Tarefas padrão do segmento: roda depois da aprovação, isolada de propósito —
 * falha aqui nunca derruba a aprovação em si.
 */
async function sincronizarTarefasPadrao(budgetId: string, projectIdConhecido?: string | null, categoriaConhecida?: string | null) {
  try {
    let projectId = projectIdConhecido || null;
    let categoria = categoriaConhecida || null;
    if (!projectId || !categoria) {
      const { data: b } = await supabase.from('budgets')
        .select('category, project:projects(id)').eq('id', budgetId).maybeSingle();
      projectId = projectId || (b?.project as { id?: string }[] | { id?: string } | null as any)?.id
        || (Array.isArray(b?.project) ? b?.project[0]?.id : null) || null;
      categoria = categoria || b?.category || null;
    }
    if (!projectId) {
      const { data: p } = await supabase.from('projects').select('id').eq('budget_id', budgetId).maybeSingle();
      projectId = p?.id || null;
    }
    if (!projectId || !categoria) return;

    const { count } = await supabase.from('project_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId).is('deleted_at', null);
    if (count && count > 0) return;

    const { data: templates } = await supabase.from('project_task_templates')
      .select('titulo, descricao, ordem, prioridade')
      .eq('segmento', categoria).order('ordem', { ascending: true });
    if (!templates || templates.length === 0) return;

    await supabase.from('project_tasks').insert(templates.map(t => ({
      project_id: projectId,
      titulo: t.titulo,
      descricao: t.descricao,
      status: 'na_fila',
      prioridade: t.prioridade,
      ordem: t.ordem,
      data_inicio: null,
      data_fim: null,
    })));
  } catch (err) {
    console.error('[aprovacao] tarefas padrão não sincronizaram:', err);
  }
}
