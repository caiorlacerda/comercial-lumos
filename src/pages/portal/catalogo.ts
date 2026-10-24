import type { Entrega, Portal } from './tipos';
import { nomeBonito } from './formatacao';

export interface ItemCatalogo {
  chave: string;
  projetoId: string;
  projeto: string;
  nome: string;
  versao: number;
  status: string;
  largura: number | null;
  altura: number | null;
  reviewToken: string | null;
  entregueEm: string | null;
}
export interface Fileira { id: string; titulo: string; itens: ItemCatalogo[] }

/** Dentro de um projeto: esperando o cliente primeiro, depois ajustes, depois aprovados. */
const ORDEM_ESTADO: Record<string, number> = { EM_REVISAO_CLIENTE: 0, ALTERACOES_CLIENTE: 1, APROVADO: 2 };

const tempo = (s: string | null) => (s ? new Date(s).getTime() || 0 : 0);

function item(projetoId: string, projeto: string, e: Entrega, i: number): ItemCatalogo {
  return {
    chave: `${projetoId}-${e.review_token ?? e.file_name}-${e.versao}-${i}`,
    projetoId, projeto,
    nome: nomeBonito(e.file_name ?? ''),
    versao: e.versao,
    status: e.status,
    largura: e.largura, altura: e.altura,
    reviewToken: e.review_token,
    entregueEm: e.entregue_em,
  };
}

/**
 * O catálogo do cliente: a fileira "Esperando você" (o mais antigo primeiro,
 * porque é o que está esperando há mais tempo) e uma fileira por projeto.
 * Só entra o que o portal já mostra (o banco só manda estados visíveis);
 * projeto sem vídeo não vira fileira. Um vídeo pode estar nas duas.
 */
export function montarFileiras(dados: Portal): Fileira[] {
  const projetos = dados?.projetos ?? [];
  const espera: ItemCatalogo[] = [];
  const porProjeto: Fileira[] = [];

  projetos.forEach(p => {
    const nomeP = (p.nome ?? '').trim();
    const entregas = (p.entregas ?? []).filter(e => e && Object.prototype.hasOwnProperty.call(ORDEM_ESTADO, e.status));
    if (!entregas.length) return;
    const itens = entregas
      .map((e, i) => item(p.id, nomeP, e, i))
      .sort((a, b) =>
        (ORDEM_ESTADO[a.status] - ORDEM_ESTADO[b.status]) || (tempo(b.entregueEm) - tempo(a.entregueEm)));
    itens.filter(x => x.status === 'EM_REVISAO_CLIENTE').forEach(x => espera.push(x));
    porProjeto.push({ id: p.id, titulo: nomeP, itens });
  });

  espera.sort((a, b) => tempo(a.entregueEm) - tempo(b.entregueEm));
  const fileiras: Fileira[] = [];
  if (espera.length) fileiras.push({ id: 'espera', titulo: 'Esperando você', itens: espera });
  return fileiras.concat(porProjeto);
}
