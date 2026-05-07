export interface PontoEncontro {
  nome: string;
  endereco: string;
}

export interface Locacao {
  nome: string;
  endereco: string;
  observacoes: string;
}

export interface Contato {
  funcao: string;
  nome: string;
  telefone: string;
}

export interface MembroEquipe {
  funcao: string;
  nome: string;
}

export interface AtividadePlano {
  inicio: string;
  fim: string;
  descricao: string;
  responsavel: string;
  destaque: boolean;
}

export interface Talento {
  nome: string;
  funcao: string;
  horario_chegada: string;
  horario_gravacao: string;
  obs: string;
}

export interface SecoesAtivas {
  clima: boolean;
  ponto_encontro: boolean;
  locacao: boolean;
  contatos: boolean;
  equipe: boolean;
  plano_acao: boolean;
  talentos: boolean;
}

export interface OrdemDoDia {
  id: string;
  codigo: string;
  titulo: string;
  data_producao: string | null;
  data_emissao: string;
  clima: string | null;
  ponto_encontro: PontoEncontro | null;
  locacao: Locacao | null;
  contatos: Contato[] | null;
  equipe: MembroEquipe[] | null;
  plano_acao: AtividadePlano[] | null;
  talentos: Talento[] | null;
  secoes_ativas: SecoesAtivas;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export const SECOES_ATIVAS_DEFAULT: SecoesAtivas = {
  clima: true,
  ponto_encontro: true,
  locacao: true,
  contatos: true,
  equipe: true,
  plano_acao: true,
  talentos: true,
};
