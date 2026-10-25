/**
 * Guarda na memória o que cada tela já carregou. Ao voltar para a tela, ela aparece na hora com o
 * que tinha (sem esqueleto) e atualiza por baixo, sem piscar. Vale só enquanto o app está aberto e
 * é apagado ao sair da conta ou trocar de usuário.
 */
const guardado = new Map<string, unknown>();

export const lerCache = <T,>(chave: string): T | undefined => guardado.get(chave) as T | undefined;
export const gravarCache = (chave: string, valor: unknown) => { guardado.set(chave, valor); };
export const limparCache = () => guardado.clear();
