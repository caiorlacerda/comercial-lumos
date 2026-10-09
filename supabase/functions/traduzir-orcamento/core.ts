// Núcleo puro da função traduzir-orcamento (sem imports: roda no Deno e nos testes de linha de comando).

export const MODELO = 'claude-sonnet-5-5';

export const LIMITES = {
  itens: 150,
  caracteresPorItem: 20000,
  caracteresTotal: 120000,
  itensPorLote: 40,
  caracteresPorLote: 30000,
};

export interface PedidoItem {
  id: string;
  tipo: 'texto' | 'html';
  origem: string;
}

export const NOME_FERRAMENTA = 'registrar_traducoes';

export const FERRAMENTA = {
  name: NOME_FERRAMENTA,
  description: 'Registra a tradução em inglês americano de cada texto recebido, sem omitir nenhum.',
  input_schema: {
    type: 'object',
    properties: {
      traducoes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'O mesmo id recebido.' },
            en: { type: 'string', description: 'A tradução em inglês americano.' },
          },
          required: ['id', 'en'],
        },
      },
    },
    required: ['traducoes'],
  },
};

export const SISTEMA = [
  'You translate text from Brazilian Portuguese into American English for commercial proposals (budgets) of an audiovisual production company.',
  'Each input has an id, a type ("texto" = plain text, "html" = rich text with HTML tags) and the Portuguese source text.',
  'Rules:',
  '- Use American English spelling and US industry terminology (crew, call time, shoot day, camera operator, post-production, deliverables, etc.).',
  '- Keep proper nouns, brand names, people, places, product names, numbers, times and units exactly as they are. Translate only the words around them.',
  '- For type "html": keep every HTML tag and the structure exactly as given and translate only the text between tags. Do not add or remove tags.',
  '- Do not add, omit, summarize or explain anything. One translation per input id.',
  '- Do not use arrows, check marks, emoji or other symbols outside plain Latin text and common punctuation.',
  `Always answer by calling the tool ${NOME_FERRAMENTA}, returning every id you received.`,
].join('\n');

export function validarPedido(corpo: unknown): { ok: true; itens: PedidoItem[] } | { ok: false; erro: string } {
  const itens = (corpo as { itens?: unknown } | null)?.itens;
  if (!Array.isArray(itens) || itens.length === 0) return { ok: false, erro: 'Envie ao menos um texto para traduzir.' };
  if (itens.length > LIMITES.itens) return { ok: false, erro: `Textos demais (máximo ${LIMITES.itens}).` };
  const ids = new Set<string>();
  const out: PedidoItem[] = [];
  let total = 0;
  for (const it of itens as Record<string, unknown>[]) {
    const id = typeof it?.id === 'string' ? it.id : '';
    const origem = typeof it?.origem === 'string' ? it.origem : '';
    const tipo = it?.tipo;
    if (!id || ids.has(id)) return { ok: false, erro: 'Cada texto precisa de um id único.' };
    if (tipo !== 'texto' && tipo !== 'html') return { ok: false, erro: 'Tipo de texto inválido.' };
    if (!origem.trim()) return { ok: false, erro: 'Há texto vazio no pedido.' };
    if (origem.length > LIMITES.caracteresPorItem) return { ok: false, erro: 'Há um texto grande demais.' };
    ids.add(id);
    total += origem.length;
    out.push({ id, tipo, origem });
  }
  if (total > LIMITES.caracteresTotal) return { ok: false, erro: 'O pedido é grande demais.' };
  return { ok: true, itens: out };
}

/** Divide em lotes (itens e caracteres) mantendo a ordem. */
export function dividirEmLotes(itens: PedidoItem[]): PedidoItem[][] {
  const lotes: PedidoItem[][] = [];
  let atual: PedidoItem[] = [];
  let chars = 0;
  for (const it of itens) {
    const cheio = atual.length >= LIMITES.itensPorLote
      || (atual.length > 0 && chars + it.origem.length > LIMITES.caracteresPorLote);
    if (cheio) { lotes.push(atual); atual = []; chars = 0; }
    atual.push(it);
    chars += it.origem.length;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

/** Lê a resposta da API (tool_use) e confere que TODOS os ids pedidos voltaram com texto. */
export function lerResposta(json: unknown, idsPedidos: string[]): { ok: true; traducoes: Record<string, string> } | { ok: false; erro: string } {
  const content = (json as { content?: unknown } | null)?.content;
  const uso = Array.isArray(content)
    ? (content as Record<string, unknown>[]).find((b) => b?.type === 'tool_use')
    : undefined;
  const lista = (uso?.input as { traducoes?: unknown } | undefined)?.traducoes;
  if (!Array.isArray(lista)) return { ok: false, erro: 'A IA não devolveu as traduções.' };
  const pedidos = new Set(idsPedidos);
  const traducoes: Record<string, string> = {};
  for (const t of lista as Record<string, unknown>[]) {
    const id = typeof t?.id === 'string' ? t.id : '';
    const en = typeof t?.en === 'string' ? t.en : '';
    if (pedidos.has(id) && en.trim() !== '') traducoes[id] = en;
  }
  const faltam = idsPedidos.filter((id) => !(id in traducoes));
  if (faltam.length > 0) return { ok: false, erro: 'Resposta da IA incompleta. Tente de novo.' };
  return { ok: true, traducoes };
}
