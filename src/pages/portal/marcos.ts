import { MARCOS } from './motivos';
import type { Projeto } from './tipos';

/** A etapa que vem depois da atual, com a data que já temos. Sem etapa atual
 *  (nada em andamento) ou já na última, não há próximo marco para mostrar. */
export function proximoMarco(p: Projeto): { rotulo: string; data: string | null } | null {
  const st = p.stages || {};
  const iAtual = MARCOS.findIndex(m => m.status.some(s => (st[s] || 0) > 0));
  if (iAtual === -1 || iAtual >= MARCOS.length - 1) return null;
  const prox = MARCOS[iAtual + 1];
  const fase = p.cronograma.find(c => prox.status.includes(c.etapa));
  return { rotulo: prox.label, data: fase?.prazo_cliente || fase?.fim || null };
}
