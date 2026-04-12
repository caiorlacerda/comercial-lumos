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
  logistics_date?: string | null;
  logistics_time?: string | null;
  logistics_location?: string | null;
}

export interface VersionFinancials {
  custoEquipe: number;
  custoEquipamentos: number;
  custoEdicao: number;
  custoProducao: number;
  totalCusto: number;
  margem: number;
  subtotal: number;
  nf: number;
  valorFinal: number;
  lucro: number;
  margemReal: number;
}

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

  // 1. Margem (custo * pct)
  const marginPct = Number(version?.margin_pct || 0);
  const margem = totalCusto * marginPct;

  // 2. Subtotal (custo + margem)
  const subtotal = totalCusto + margem;

  // 3. NF (subtotal * pct)
  const nfPct = Number(version?.nf_pct || 0);
  const nf = subtotal * nfPct;

  // 4. Final Value
  // Note: user said valorFinal = subtotal + nf. We also have a discount_value to consider if it still exists.
  // The request says "valorFinal = subtotal + nf". I will include discount_value if it's there, 
  // but the prompt example didn't show it. I'll subtract it at the very end.
  const baseFinal = subtotal + nf;
  const valorFinal = baseFinal - Number(version?.discount_value || 0);

  // 5. Lucro líquido & Margem Real
  const lucro = valorFinal - totalCusto;
  const margemReal = valorFinal > 0 ? (margem / valorFinal) * 100 : 0;

  return {
    custoEquipe, custoEquipamentos, custoEdicao, custoProducao,
    totalCusto, margem, subtotal, nf,
    valorFinal, lucro, margemReal
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
