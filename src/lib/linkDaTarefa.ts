/**
 * LINK PRÓPRIO DA TAREFA: /tarefa/<id>. Só o id vai no link, então ele continua valendo
 * mesmo se a tarefa mudar de nome, de lista ou de projeto. O acesso é o do app: precisa
 * estar logado (o link não é público).
 */
const CAMINHO_DE_TAREFA = /^\/tarefa\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVE_DESTINO = 'lumos_destino_apos_login';

export const caminhoDaTarefa = (id: string) => `/tarefa/${id}`;
export const urlDaTarefa = (origem: string, id: string) => `${origem.replace(/\/+$/, '')}${caminhoDaTarefa(id)}`;
export const ehCaminhoDeTarefa = (caminho: string) => CAMINHO_DE_TAREFA.test(caminho);

/**
 * Quem abre o link sem estar logado passa pelo login: guardamos para onde ia.
 * Só aceita link de tarefa, para o login nunca virar redirecionamento para qualquer endereço.
 */
export function guardarDestinoDoLogin(caminho: string) {
  if (!ehCaminhoDeTarefa(caminho)) return;
  try { sessionStorage.setItem(CHAVE_DESTINO, caminho); } catch { /* sem armazenamento: cai na Home */ }
}

/** Para onde ir depois de entrar (e esquece, para valer uma vez só). */
export function consumirDestinoDoLogin(): string {
  try {
    const destino = sessionStorage.getItem(CHAVE_DESTINO);
    sessionStorage.removeItem(CHAVE_DESTINO);
    return destino && ehCaminhoDeTarefa(destino) ? destino : '/';
  } catch { return '/'; }
}
