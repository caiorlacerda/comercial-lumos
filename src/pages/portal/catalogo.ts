import type { Entrega, Portal, VisaoProjeto } from './tipos';
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
  /** Versões que a página de revisão mostra (0 = não informado). */
  nVersoes: number;
  /** 'AAAA-MM-DD' do prazo de resposta, quando há. */
  prazo: string | null;
}
/** Dados extras por vídeo, chave = link de revisão (vêm de `portal_visao_projetos`). */
export type ExtrasCatalogo = Record<string, { nVersoes: number; prazo: string | null }>;
/** Junta o `revisoes` de `portal_visao_projetos` por link de revisão. Tolerante: função
 *  ausente (null), `revisoes` ausente/nulo ou entrada malformada viram "sem extras". */
export function extrasDeRevisoes(projetos?: Array<Pick<VisaoProjeto, 'revisoes'> | null | undefined> | null): ExtrasCatalogo {
  const out: ExtrasCatalogo = {};
  if (!Array.isArray(projetos)) return out;
  projetos.forEach(p => {
    const rs = p?.revisoes;
    if (!Array.isArray(rs)) return;
    rs.forEach(r => {
      if (!r || typeof r.review_token !== 'string' || !r.review_token) return;
      const n = Number(r.n_versoes);
      out[r.review_token] = {
        nVersoes: Number.isFinite(n) ? n : 0,
        prazo: typeof r.prazo === 'string' ? r.prazo : null,
      };
    });
  });
  return out;
}
export interface Fileira { id: string; titulo: string; itens: ItemCatalogo[] }

/** Dentro de um projeto: esperando o cliente primeiro, depois ajustes, depois aprovados. */
const ORDEM_ESTADO: Record<string, number> = { EM_REVISAO_CLIENTE: 0, ALTERACOES_CLIENTE: 1, APROVADO: 2 };

const tempo = (s: string | null) => (s ? new Date(s).getTime() || 0 : 0);

function item(projetoId: string, projeto: string, e: Entrega, i: number, extras?: ExtrasCatalogo): ItemCatalogo {
  const x = e.review_token && extras && Object.prototype.hasOwnProperty.call(extras, e.review_token) ? extras[e.review_token] : null;
  return {
    chave: `${projetoId}-${e.review_token ?? e.file_name}-${e.versao}-${i}`,
    projetoId, projeto,
    nome: nomeBonito(e.file_name ?? ''),
    versao: e.versao,
    status: e.status,
    largura: e.largura, altura: e.altura,
    reviewToken: e.review_token,
    entregueEm: e.entregue_em,
    nVersoes: x && Number.isFinite(x.nVersoes) ? x.nVersoes : 0,
    prazo: x && typeof x.prazo === 'string' ? x.prazo : null,
  };
}

/**
 * O catálogo do cliente: a fileira "Esperando você" (o mais antigo primeiro,
 * porque é o que está esperando há mais tempo) e uma fileira por projeto.
 * Só entra o que o portal já mostra (o banco só manda estados visíveis);
 * projeto sem vídeo não vira fileira. Um vídeo pode estar nas duas.
 * `extras` (opcional) traz versões e prazo por link de revisão; sem ele, ou sem
 * entrada para o vídeo, o item fica como era.
 */
export function montarFileiras(dados: Portal, extras?: ExtrasCatalogo): Fileira[] {
  const projetos = dados?.projetos ?? [];
  const espera: ItemCatalogo[] = [];
  const porProjeto: Fileira[] = [];

  projetos.forEach(p => {
    const nomeP = (p.nome ?? '').trim();
    const entregas = (p.entregas ?? []).filter(e => e && Object.prototype.hasOwnProperty.call(ORDEM_ESTADO, e.status));
    if (!entregas.length) return;
    const itens = entregas
      .map((e, i) => item(p.id, nomeP, e, i, extras))
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
