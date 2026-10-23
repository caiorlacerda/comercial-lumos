/** Últimos projetos abertos neste aparelho (para a busca mostrar "Recentes" antes de digitar). */
const CHAVE = 'lumos_projetos_recentes';
export interface ProjetoRecente { id: string; name: string; client?: string | null }

export function lerProjetosRecentes(): ProjetoRecente[] {
  try {
    const l = JSON.parse(localStorage.getItem(CHAVE) || '[]');
    return Array.isArray(l) ? l.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string') : [];
  } catch { return []; }
}

export function registrarProjetoRecente(p: ProjetoRecente) {
  try {
    const resto = lerProjetosRecentes().filter(x => x.id !== p.id);
    localStorage.setItem(CHAVE, JSON.stringify([p, ...resto].slice(0, 8)));
  } catch { /* sem armazenamento: só não lembra */ }
}
