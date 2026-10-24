// Memória do navegador (localStorage/sessionStorage). Movido de PortalCliente.tsx sem alterar.

export const NOME_SALVO = 'rev_nome';
export const EMAIL_SALVO = 'rev_email';

/** O navegador pode negar o armazenamento (aba privada do Safari, bloqueio de
 *  cookies): ler ou gravar aí lança erro, e erro durante o render é tela branca.
 *  O portal funciona sem lembrar de nada, então qualquer falha aqui é ignorada. */
export const lerSalvo = (chave: string) => {
  try { return localStorage.getItem(chave) || ''; } catch { return ''; }
};
export const gravarSalvo = (chave: string, valor: string) => {
  try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: só não lembra */ }
};
export const apagarSalvo = (chave: string) => {
  try { localStorage.removeItem(chave); } catch { /* idem */ }
};

/**
 * DE ONDE A PESSOA VEIO.
 *
 * Ao abrir um vídeo, o portal deixa um bilhete dizendo pra onde voltar. Vai na
 * sessão do navegador, e não na URL, porque o endereço do vídeo é o que o
 * cliente repassa por e-mail — e o do portal abre a conta inteira dele.
 * Quem chega pelo link do e-mail simplesmente não tem bilhete, e o player não
 * inventa um botão de voltar pra lugar nenhum.
 */
export const BILHETE = 'lumos_voltar';
