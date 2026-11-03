// Regras puras da estrutura de pastas do Drive (sem Deno, sem rede, sem banco).
// Ficam num arquivo à parte para poderem ser testadas sem subir a função.
//
// Estrutura v2 (projetos novos, exceto live):
//   Cliente › [Marca] › AAAA-MM › NNN_NOME-DO-PROJETO
//     00_DOCUMENTOS
//     01_BRUTO
//     02_ARTES › 01_TRILHAS
//     03_EXPORT › 01_REVISAO, 02_FINAL

export const NOMES_V2 = {
  documentos: '00_DOCUMENTOS',
  bruto: '01_BRUTO',
  artes: '02_ARTES',
  trilhas: '01_TRILHAS',
  export: '03_EXPORT',
  revisao: '01_REVISAO',
  final: '02_FINAL',
} as const

export type ChavePasta = keyof typeof NOMES_V2
export type PastasV2 = Record<ChavePasta, string>

/** Ordem de criação: o pai sempre vem antes do filho. */
export const ARVORE_V2: { chave: ChavePasta; pai: ChavePasta | null }[] = [
  { chave: 'documentos', pai: null },
  { chave: 'bruto', pai: null },
  { chave: 'artes', pai: null },
  { chave: 'trilhas', pai: 'artes' },
  { chave: 'export', pai: null },
  { chave: 'revisao', pai: 'export' },
  { chave: 'final', pai: 'export' },
]

export type Layout = 'v1' | 'v2'

/**
 * Qual layout vale para o projeto.
 *  · já é v2 → v2;
 *  · já tem pasta antiga → v1 (nunca converte sozinho: a migração é um passo à parte);
 *  · sem pasta ainda → v2, exceto live, que segue o template de live (v1);
 *  · banco sem as colunas novas (migration pendente) → v1, o comportamento de antes.
 */
export function layoutDoProjeto(p: {
  isLive: boolean
  driveFolderId: string | null
  driveLayout: string | null
  temColunasV2: boolean
}): Layout {
  if (!p.temColunasV2) return 'v1'
  if (p.driveLayout === 'v2') return 'v2'
  if (p.driveFolderId) return 'v1'
  return p.isLive ? 'v1' : 'v2'
}

/** "AAAA-MM" do projeto: da data de início; sem ela, da criação (no fuso de São Paulo). */
export function mesDoProjeto(dataInicio: string | null | undefined, criadoEm: string | null | undefined): string {
  for (const valor of [dataInicio, criadoEm]) {
    const mes = mesDe(valor)
    if (mes) return mes
  }
  throw new Error('Projeto sem data de início nem de criação')
}

function mesDe(valor: string | null | undefined): string | null {
  if (!valor) return null
  // Data pura (coluna date): o próprio texto. Passar por Date a leria como meia-noite UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor.slice(0, 7)
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return null
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })
    .formatToParts(d)
  const ano = partes.find(x => x.type === 'year')?.value
  const mes = partes.find(x => x.type === 'month')?.value
  return ano && mes ? `${ano}-${mes}` : null
}

/** Cliente com marcas só ganha pasta depois que o projeto escolhe uma. */
export function aguardandoMarca(marcasDoCliente: string[] | null | undefined, marcaDoProjeto: string | null | undefined): boolean {
  return (marcasDoCliente?.length ?? 0) > 0 && !(marcaDoProjeto ?? '').trim()
}

/** Nome seguro para pasta-contêiner (marca): sem barra, sem espaço sobrando. */
export function nomeDeContainer(nome: string): string {
  return nome.replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim()
}

/** drive_pastas está completo e utilizável? */
export function pastasV2Completas(p: unknown): p is PastasV2 {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return (Object.keys(NOMES_V2) as ChavePasta[]).every(k => typeof o[k] === 'string' && (o[k] as string).length > 0)
}
