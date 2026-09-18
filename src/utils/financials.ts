export interface BudgetItem {
  id: string;
  item_group: 'equipe' | 'equipamentos' | 'edicao' | 'producao';
  name: string;
  unit_cost: number;
  quantity: number;
  unit_label: string;
  override_margin?: number | null;
  sort_order: number;
  catalog_item_id?: string | null;
  description?: string | null;
}

export interface ClientContact {
  id: string;
  client_id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  is_primary: boolean;
}

export interface BudgetVersion {
  id: string;
  budget_id?: string;
  contact_id?: string;
  margin_pct: number;
  nf_pct: number;
  discount_value: number;
  version_number: number;
  notes_internal?: string | null;
  notes_client?: string | null;
  payment_terms?: string | null;
  validity_days?: number | null;
  /** Como o cliente paga (Fase 2): gera as parcelas na aprovação. */
  payment_plan?: 'a_vista' | 'entrada_saldo' | null;
  payment_days?: number | null;
  payment_entry_pct?: number | null;
  logistics_date?: string | null;
  logistics_time?: string | null;
  logistics_location?: string | null;
  public_token?: string | null;
  /** Novas propostas: o imposto reajusta o preço pra manter a margem líquida
   *  pretendida (ver calcFinancials). Propostas antigas ficam com `false`
   *  pra continuar exatamente como sempre foram — não é recalculado. */
  imposto_reajusta_preco?: boolean;
}

export interface VersionFinancials {
  custoEquipe: number;
  custoEquipamentos: number;
  custoEdicao: number;
  custoProducao: number;
  totalCusto: number;
  /** O que sobra do preço depois do custo direto: valorFinal - totalCusto. */
  margem: number;
  /** Imposto da nota. Sai de DENTRO da margem, não é somado ao preço. */
  nf: number;
  /** Margem já sem o imposto — o que de fato fica com a Lumos. */
  lucro: number;
  /** O que o cliente paga. */
  valorFinal: number;
  /** margem / valorFinal, em %. Com desconto zero, bate com o margin_pct pedido. */
  margemReal: number;
  /** Quantas vezes o custo, só como referência de mercado. */
  markup: number;
}

/** Margem 100% seria preço infinito. Trava num teto que ainda deixa negociar. */
const MARGEM_MAX = 0.95;

export function calcFinancials(items: BudgetItem[], version: BudgetVersion): VersionFinancials {
  const sum = (group: string) =>
    (items || [])
      .filter(i => i?.item_group === group)
      .reduce((acc, i) => acc + (Number(i?.unit_cost || 0) * Number(i?.quantity || 0)), 0);

  const custoEquipe = sum('equipe');
  const custoEquipamentos = sum('equipamentos');
  const custoEdicao = sum('edicao');
  const custoProducao = sum('producao');
  const totalCusto = custoEquipe + custoEquipamentos + custoEdicao + custoProducao;

  // A margem é MARGEM, não markup: é a fatia do preço que não é custo direto.
  // Então o preço nasce do custo dividido pelo que sobra, e não do custo
  // multiplicado pela margem — com 40% pedidos, 40% do preço é margem.
  const marginPct = Math.min(Math.max(Number(version?.margin_pct || 0), 0), MARGEM_MAX);
  const nfPct = Number(version?.nf_pct || 0);

  // Duas contas possíveis pro preço, escolhidas por proposta (não por regra
  // global) — `imposto_reajusta_preco` trava no momento em que a proposta
  // nasce e nunca muda depois, pra não reprecificar o que já existe:
  //
  // - Antiga (`false`/ausente): o imposto é só informativo — sai de DENTRO da
  //   margem, sem mexer no preço. Mudar o imposto não muda o total do cliente.
  // - Nova (`true`): o preço já embute o imposto, pra sobrar a margem
  //   pretendida DEPOIS de pagar o imposto. Custo / (1 − margem − imposto) —
  //   quanto maior o imposto, maior o preço, na mesma proporção.
  const reajustaComImposto = version?.imposto_reajusta_preco === true;
  const denom = reajustaComImposto
    ? Math.max(1 - marginPct - nfPct, 0.05)
    : Math.max(1 - marginPct, 0.05);
  const base = totalCusto > 0 ? totalCusto / denom : 0;

  // Desconto entra depois, e come a margem: o custo direto não muda.
  const valorFinal = Math.max(base - Number(version?.discount_value || 0), 0);

  const margem = valorFinal - totalCusto;

  // O imposto é uma fatia da NOTA (18% do que o cliente paga), não um
  // acréscimo — na conta nova, o preço já foi calculado pra essa fatia caber
  // e ainda sobrar a margem pretendida; na antiga, essa fatia só é descontada
  // do lucro pra fins de acompanhamento, sem já ter sido embutida no preço.
  const nf = valorFinal * nfPct;

  const lucro = margem - nf;
  const margemReal = valorFinal > 0 ? (margem / valorFinal) * 100 : 0;
  const markup = totalCusto > 0 ? valorFinal / totalCusto : 0;

  return {
    custoEquipe, custoEquipamentos, custoEdicao, custoProducao,
    totalCusto, margem, nf, lucro, valorFinal, margemReal, markup,
  };
}

export const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};
