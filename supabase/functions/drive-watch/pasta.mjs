// Resolve a pasta de revisão (01_Revisao) de um projeto SEM nunca devolver uma pasta na lixeira.
//
// Por quê: o Drive aceita upload pelo ID de uma pasta que está na lixeira. O arquivo sobe, a barra some, mas o
// scan (que só olha pastas vivas) nunca o registra e a entrega "some". Foi o que aconteceu no Continuada (#14).
//
// O campo `trashed` do Drive já vale também para pasta cujo PAI está na lixeira, então uma checagem só cobre os dois.
//
// Este arquivo é IDÊNTICO em supabase/functions/drive-upload/ e supabase/functions/drive-watch/ (cada função é
// publicada sozinha); o teste scripts/testes-drive/pasta-revisao.test.mjs confere que as duas cópias não divergem.
//
// `drive` é injetado (testável sem rede):
//   estaViva(id)        -> true se a pasta existe, é pasta e NÃO está na lixeira (nem por pai); false caso contrário
//   achar(paiId, nome)  -> id da subpasta viva com esse nome, ou null

export const ERRO_PASTA_LIXEIRA = 'pasta_revisao_na_lixeira'
export const ERRO_SEM_PASTA = 'sem_pasta_revisao'

/** Caminho da pasta de revisão dentro da pasta do projeto, por layout (v2 com o nome novo: só a primeira letra maiúscula). */
export const caminhoRevisao = (layout) => (layout === 'v2' ? ['03_Export', '01_Revisao'] : ['06_ENTREGA', '01_REVISAO'])

/**
 * Procura a subpasta pelo nome novo e, se não achar, pelo nome antigo em caixa alta (as pastas criadas antes de 16/11,
 * ex.: 03_EXPORT). Assim nada depende de o Drive diferenciar maiúsculas e minúsculas na busca.
 */
async function acharComVariantes(drive, paiId, nome) {
  for (const variante of new Set([nome, nome.toUpperCase()])) {
    const id = await drive.achar(paiId, variante)
    if (id) return id
  }
  return null
}

/** ID salvo no banco para a pasta de revisão (v2 guarda em drive_pastas.revisao). */
export const idSalvo = (proj) =>
  (proj?.drive_layout === 'v2' ? (proj?.drive_pastas?.revisao ?? proj?.drive_upload_folder_id) : proj?.drive_upload_folder_id) ?? null

/** O que gravar em `projects` quando a pasta muda (mantém os dois campos do v2 em sincronia). */
export function camposParaGravar(proj, folderId) {
  if (proj?.drive_layout === 'v2') {
    return { drive_upload_folder_id: folderId, drive_pastas: { ...(proj?.drive_pastas || {}), revisao: folderId } }
  }
  return { drive_upload_folder_id: folderId }
}

export async function resolverPastaRevisao({ proj, drive }) {
  const salvo = idSalvo(proj)
  if (salvo && (await drive.estaViva(salvo))) return { ok: true, folderId: salvo, mudou: false }

  // v2 sem nenhum ID salvo nunca procura por nome (decisão da migração v2). Com ID salvo que morreu, procura.
  const podeProcurar = proj?.drive_layout !== 'v2' || !!salvo
  let achada = null
  if (podeProcurar && proj?.drive_folder_id) {
    let atual = proj.drive_folder_id
    for (const nome of caminhoRevisao(proj.drive_layout)) {
      atual = await acharComVariantes(drive, atual, nome)
      if (!atual) break
    }
    achada = atual
  }
  if (achada) {
    return { ok: true, folderId: achada, mudou: true, trocouDe: salvo, gravar: camposParaGravar(proj, achada) }
  }
  if (salvo) {
    return {
      ok: false, codigo: ERRO_PASTA_LIXEIRA, salvo,
      mensagem: 'A pasta de revisão deste projeto está na lixeira do Drive e não há outra no lugar. Restaure a pasta no Drive (ou avise a equipe de tecnologia) e tente de novo. Nada foi enviado.',
    }
  }
  return { ok: false, codigo: ERRO_SEM_PASTA, salvo: null, mensagem: 'Projeto sem pasta de revisão (01_Revisao)' }
}
