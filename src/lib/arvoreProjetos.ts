// Funções puras da árvore de projetos da barra lateral (sem React nem Supabase).

export interface ProjetoArvore {
  id: string;
  name: string;
  client_id: string | null;
  code: string | null;
  category: string | null;
  status?: string;
  oculto_na_barra?: boolean | null;
}

export interface ClienteBasico {
  id: string;
  name: string;
}

export interface ClienteNaArvore extends ClienteBasico {
  projects: ProjetoArvore[];
}

export interface ProjetoOculto extends ProjetoArvore {
  clienteNome: string | null;
}

export interface ArvoreMontada {
  clientes: ClienteNaArvore[];
  semCliente: ProjetoArvore[];
  ocultos: ProjetoOculto[];
  encerrados: ProjetoArvore[];
}

// Sequência numérica do código (ex.: "2026-229" -> 229) para ordenar
export const codeSeq = (p: { code: string | null }): number => {
  const m = (p.code || '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
};

// Encerrado vence oculto; oculto sai da árvore; o resto agrupa por cliente.
export function montarArvore(projetos: ProjetoArvore[], clientes: ClienteBasico[]): ArvoreMontada {
  const nomePorCliente = new Map(clientes.map(c => [c.id, c.name]));

  const encerrados: ProjetoArvore[] = [];
  const ocultos: ProjetoOculto[] = [];
  const semCliente: ProjetoArvore[] = [];
  const porCliente = new Map<string, ProjetoArvore[]>();

  for (const p of projetos) {
    if (p.status === 'concluido') {
      encerrados.push(p);
    } else if (p.oculto_na_barra === true) {
      ocultos.push({ ...p, clienteNome: (p.client_id && nomePorCliente.get(p.client_id)) || null });
    } else if (p.client_id && nomePorCliente.has(p.client_id)) {
      const lista = porCliente.get(p.client_id) ?? [];
      lista.push(p);
      porCliente.set(p.client_id, lista);
    } else {
      semCliente.push(p);
    }
  }

  const crescente = (a: ProjetoArvore, b: ProjetoArvore) => codeSeq(a) - codeSeq(b);
  encerrados.sort((a, b) => codeSeq(b) - codeSeq(a));
  ocultos.sort(crescente);
  semCliente.sort(crescente);

  const arvore: ClienteNaArvore[] = [];
  for (const c of clientes) {
    const lista = porCliente.get(c.id);
    if (lista && lista.length > 0) arvore.push({ ...c, projects: lista.sort(crescente) });
  }

  return { clientes: arvore, semCliente, ocultos, encerrados };
}

export type TomPendencia = 'ok' | 'aviso' | 'desconhecido';

export interface LinhaPendencia {
  texto: string;
  tom: TomPendencia;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// null = não foi possível conferir; undefined em aReceber = projeto sem proposta (linha omitida)
export function resumoPendencias(c: {
  tarefas: number | null;
  videos: number | null;
  aReceber: number | null | undefined;
}): LinhaPendencia[] {
  const linhas: LinhaPendencia[] = [];

  if (c.tarefas === null) {
    linhas.push({ texto: 'Tarefas abertas: não foi possível conferir', tom: 'desconhecido' });
  } else if (c.tarefas > 0) {
    linhas.push({ texto: `${c.tarefas} ${c.tarefas === 1 ? 'tarefa aberta' : 'tarefas abertas'}`, tom: 'aviso' });
  }

  if (c.videos === null) {
    linhas.push({ texto: 'Vídeos aguardando o cliente: não foi possível conferir', tom: 'desconhecido' });
  } else if (c.videos > 0) {
    linhas.push({
      texto: `${c.videos} ${c.videos === 1 ? 'vídeo aguardando o cliente' : 'vídeos aguardando o cliente'}`,
      tom: 'aviso',
    });
  }

  if (c.aReceber === null) {
    linhas.push({ texto: 'A receber: não foi possível conferir', tom: 'desconhecido' });
  } else if (c.aReceber !== undefined && c.aReceber > 0.004) {
    linhas.push({ texto: `A receber: ${brl.format(c.aReceber)}`, tom: 'aviso' });
  }

  return linhas.length > 0 ? linhas : [{ texto: 'Nada em aberto encontrado.', tom: 'ok' }];
}
