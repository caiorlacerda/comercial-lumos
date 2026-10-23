/**
 * "Manter conectado neste aparelho".
 *
 * O Supabase já guarda a sessão no navegador e renova sozinho. Quem derrubava a sessão era a regra
 * de inatividade do próprio app: depois de 3 horas parado, saía e pedia a senha de novo (daí digitar
 * a senha toda manhã). Com "manter conectado" (padrão), o limite sobe para 30 dias parado; desmarcando
 * (computador compartilhado), continua em 3 horas.
 */
const CHAVE = 'lumos_manter_conectado';

export const TIMEOUT_CURTO_MS = 3 * 60 * 60 * 1000;          // 3 horas
export const TIMEOUT_LONGO_MS = 30 * 24 * 60 * 60 * 1000;    // 30 dias

/** Sem escolha guardada, vale "manter conectado". */
export function lerManterConectado(): boolean {
  try { return localStorage.getItem(CHAVE) !== '0'; } catch { return true; }
}

export function definirManterConectado(v: boolean) {
  try { localStorage.setItem(CHAVE, v ? '1' : '0'); } catch { /* sem armazenamento: segue o padrão */ }
}

/** Limite de inatividade em vigor neste aparelho. */
export const limiteDeInatividadeMs = () => (lerManterConectado() ? TIMEOUT_LONGO_MS : TIMEOUT_CURTO_MS);
