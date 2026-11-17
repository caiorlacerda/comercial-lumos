// Estrutura de pastas do Drive no app (espelha supabase/functions/drive-provision/layout.ts).
//
// v1 = projetos antigos e lives: subpastas achadas pelo nome.
// v2 = projetos novos: Cliente › Projetos › [Sub-marca] › AAAA-MM › NNN_NOME, com as subpastas 00_Documentos, 01_Bruto,
//      02_Artes/01_Trilhas e 03_Export/01_Revisao + 02_Final. O app usa os IDs salvos em projects.drive_pastas
//      e nunca procura nem cria pasta por nome nesse layout.

export type DriveLayout = 'v1' | 'v2';

export interface PastasV2 {
  documentos: string;
  bruto: string;
  artes: string;
  trilhas: string;
  export: string;
  revisao: string;
  final: string;
}

/** Cliente com marcas só ganha a pasta do projeto depois que o projeto escolhe uma. */
export function aguardandoMarca(marcasDoCliente: string[] | null | undefined, marcaDoProjeto: string | null | undefined): boolean {
  return (marcasDoCliente?.length ?? 0) > 0 && !(marcaDoProjeto ?? '').trim();
}

/**
 * Pasta de destino de uma categoria de documento num projeto v2 (ID salvo).
 * Roteiro, briefing, relatório e demais documentos → 00_Documentos; "Entrega (portal)" → 03_Export/02_Final.
 * Devolve null se o projeto não é v2 ou o ID não está registrado (quem chama cai na raiz do projeto).
 */
export function pastaV2DaCategoria(pastas: Partial<PastasV2> | null | undefined, categoria: string): string | null {
  if (!pastas) return null;
  if (categoria === 'entrega') return pastas.final || null;
  if (categoria === 'geral' || categoria === 'roteiro' || categoria === 'producao') return pastas.documentos || null;
  return null;
}
