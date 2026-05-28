export interface Fornecedor {
  id: string;
  nome: string;
  cnpj?: string | null;
  telefone?: string | null;
  email?: string | null;
  payment_info?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
}

export interface FornecedorServico {
  id: string;
  fornecedor_id: string;
  tipo_servico: string;
  valor?: number | null;
  notes?: string | null;
  created_at?: string;
}
