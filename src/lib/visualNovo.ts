import { useSyncExternalStore } from 'react';

/**
 * Interruptor do "visual novo" (visual do deck da Lumos).
 *
 * O visual novo já está no código, mas só aparece para quem ligar o interruptor. Para o resto do
 * time nada muda. O estado fica só neste aparelho (localStorage), sem banco de dados.
 *
 * Como ligar/desligar:
 *  - Link com `?visual=novo` liga; `?visual=antigo` desliga. O parâmetro é gravado e some da URL.
 *  - Quem é admin também tem um botão em Configurações > Aparência.
 *
 * Estado atual: `PADRAO_LIGADO = true`, ou seja, o visual novo vale para todo mundo que nunca mexeu no
 * interruptor. Quem desligou de propósito (`?visual=antigo`) continua no antigo. Para voltar tudo ao
 * antigo de uma vez, troque para `false` e faça deploy.
 *
 * A TELA DE LOGIN é a exceção: ela só muda para o visual novo quando a pessoa liga explicitamente
 * (`?visual=novo`), porque a decisão de liberar o login ficou para depois, junto com as páginas públicas.
 */
const CHAVE = 'lumos-visual-novo';
const EVENTO = 'lumos-visual-novo-mudou';
const PADRAO_LIGADO = true;

function ler(): boolean {
  try {
    const v = localStorage.getItem(CHAVE);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* localStorage indisponível: cai no padrão */ }
  return PADRAO_LIGADO;
}

/** Só é verdadeiro se a pessoa ligou de propósito (ignora o padrão). Usado pelo login. */
function lerExplicito(): boolean {
  try { return localStorage.getItem(CHAVE) === '1'; } catch { return false; }
}

export function definirVisualNovo(ligado: boolean) {
  try { localStorage.setItem(CHAVE, ligado ? '1' : '0'); } catch { /* sem armazenamento */ }
  window.dispatchEvent(new Event(EVENTO));
}

/** Lê `?visual=novo|antigo` na URL, grava a escolha e limpa o parâmetro. Chamar uma vez na abertura. */
export function aplicarVisualDaUrl() {
  try {
    const url = new URL(window.location.href);
    const v = url.searchParams.get('visual');
    if (v !== 'novo' && v !== 'antigo') return;
    definirVisualNovo(v === 'novo');
    url.searchParams.delete('visual');
    window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
  } catch { /* URL inválida: ignora */ }
}

/** Liga/desliga a classe `visual-novo` no <html> (base de fontes e cores do visual novo no CSS). */
function sincronizarClasse() {
  document.documentElement.classList.toggle('visual-novo', ler());
}

/** Chamar uma vez na abertura: aplica a classe e acompanha mudanças do interruptor. */
export function iniciarVisualNovo() {
  sincronizarClasse();
  window.addEventListener(EVENTO, sincronizarClasse);
  window.addEventListener('storage', sincronizarClasse);
}

function assinar(cb: () => void) {
  window.addEventListener(EVENTO, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENTO, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useVisualNovo(): boolean {
  return useSyncExternalStore(assinar, ler, () => PADRAO_LIGADO);
}

/** Igual a useVisualNovo, mas só liga se a pessoa pediu explicitamente (padrão não conta). */
export function useVisualNovoExplicito(): boolean {
  return useSyncExternalStore(assinar, lerExplicito, () => false);
}
