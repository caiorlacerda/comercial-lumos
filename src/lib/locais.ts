/** Cadastro central de locais das diárias (tabela `locais`). */
export interface Local {
  id: string;
  nome: string;
  endereco: string | null;
  observacoes: string | null;
  client_id: string | null;      // null = local geral
  cliente?: { name: string } | null;
}

/** Texto que a diária guarda em `local` (e que vai pra OD, Calendar e Maps): "Nome, endereço". */
export const textoDoLocal = (l: Pick<Local, 'nome' | 'endereco'>) =>
  l.endereco?.trim() ? `${l.nome.trim()}, ${l.endereco.trim()}` : l.nome.trim();

/** O que mandar pro geocoder da previsão do tempo: o endereço entende melhor que o nome do lugar. */
export const consultaDeClima = (l: Pick<Local, 'nome' | 'endereco'> | undefined | null, textoLivre: string | null) =>
  l?.endereco?.trim() || textoLivre;

/** Compara sem acento nem caixa, pra busca e pra achar duplicado. */
export const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
