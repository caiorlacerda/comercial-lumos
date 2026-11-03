// Integração App Lumos × Google Drive — Fase 1 (pastas automáticas)
//
// Disparada por Database Webhook em INSERT na tabela projects.
// 1. Garante a pasta do CLIENTE em Clientes/ (criada no 1º projeto aprovado,
//    espelhando o modelo _TEMPLATES/_ASSETS; fallback: _ASSETS padrão).
// 2. Cria a pasta do PROJETO. Dois layouts (ver layout.ts):
//    · v2 (projetos novos, exceto live): Cliente › [Marca] › AAAA-MM › NNN_NOME, com as
//      subpastas 00_DOCUMENTOS, 01_BRUTO, 02_ARTES/01_TRILHAS, 03_EXPORT/01_REVISAO e
//      03_EXPORT/02_FINAL criadas POR CÓDIGO (sem template). Os IDs vão para projects.drive_pastas.
//      Cliente com marcas (clients.marcas) só ganha a pasta depois que o projeto escolhe uma.
//    · v1 (live e projetos antigos): [NNN]_[NOME] ou [NNN]_[NOME]_LIVE direto no cliente,
//      espelhando _TEMPLATE_PROJETO ou _TEMPLATE_LIVE.
// 3. Grava os IDs em clients/projects e loga em drive_sync_log.
//
// Idempotente: nunca duplica. Se a pasta do projeto existe pelo ID (mesmo em outro pai, porque
// alguém a moveu) NÃO cria outra; só renomeia quando ela ainda está no pai esperado.
// Retry com backoff em erros 429/5xx do Drive.
//
// Secrets necessários: GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_SHARED_DRIVE_ID,
// DRIVE_CLIENTES_FOLDER_ID, DRIVE_TEMPLATES_FOLDER_ID, DRIVE_WEBHOOK_SECRET.
// Deploy com --no-verify-jwt (a autenticação é o header x-drive-secret).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { ARVORE_V2, NOMES_V2, aguardandoMarca, layoutDoProjeto, mesDoProjeto, nomeDeContainer, type PastasV2 } from "./layout.ts"

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DRIVE_ID = Deno.env.get('DRIVE_SHARED_DRIVE_ID') ?? ''
const CLIENTES_FOLDER_ID = Deno.env.get('DRIVE_CLIENTES_FOLDER_ID') ?? ''
const TEMPLATES_FOLDER_ID = Deno.env.get('DRIVE_TEMPLATES_FOLDER_ID') ?? ''
const WEBHOOK_SECRET = Deno.env.get('DRIVE_WEBHOOK_SECRET') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const SYSTEM_FILES = new Set(['.DS_Store', 'desktop.ini', 'Thumbs.db'])
const FOLDER_MIME = 'application/vnd.google-apps.folder'

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------
async function log(entity_type: string, entity_id: string | null, action: string, detail: string, status: 'ok' | 'error' = 'ok') {
  try {
    await db.from('drive_sync_log').insert([{ entity_type, entity_id, action, detail: detail.slice(0, 900), status }])
  } catch (_) { /* log nunca derruba o fluxo */ }
}

// ---------------------------------------------------------------------------
// Autenticação Google (Service Account → access token via JWT RS256)
// ---------------------------------------------------------------------------
let cachedToken: { token: string; exp: number } | null = null

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function googleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token

  const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '{}')
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON ausente ou inválido')

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))

  const pem = (sa.private_key as string).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', raw.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)))
  const jwt = `${header}.${claims}.${b64url(sig)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Falha no token Google: ${JSON.stringify(data).slice(0, 200)}`)

  cachedToken = { token: data.access_token, exp: now + 3500 }
  return data.access_token
}

// ---------------------------------------------------------------------------
// Drive API (sempre com supportsAllDrives; retry em 429/5xx)
// ---------------------------------------------------------------------------
async function driveFetch(path: string, init: RequestInit = {}, attempt = 1): Promise<any> {
  const token = await googleAccessToken()
  const sep = path.includes('?') ? '&' : '?'
  const url = `https://www.googleapis.com/drive/v3/${path}${sep}supportsAllDrives=true`
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if ((res.status === 429 || res.status >= 500) && attempt <= 3) {
    await new Promise(r => setTimeout(r, attempt * 1200))
    return driveFetch(path, init, attempt + 1)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Drive ${res.status} em ${path.split('?')[0]}: ${JSON.stringify(body.error?.message || body).slice(0, 250)}`)
  return body
}

async function listChildren(parentId: string): Promise<{ id: string; name: string; mimeType: string; createdTime?: string }[]> {
  const items: { id: string; name: string; mimeType: string; createdTime?: string }[] = []
  let pageToken = ''
  do {
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`)
    const page = await driveFetch(
      `files?q=${q}&fields=files(id,name,mimeType,createdTime),nextPageToken&pageSize=200&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}${pageToken ? `&pageToken=${pageToken}` : ''}`
    )
    items.push(...(page.files || []))
    pageToken = page.nextPageToken || ''
  } while (pageToken)
  return items
}

async function findChildFolder(parentId: string, name: string): Promise<string | null> {
  const children = await listChildren(parentId)
  const found = children.find(c => c.mimeType === FOLDER_MIME && c.name === name)
  return found?.id ?? null
}

async function createFolder(parentId: string, name: string): Promise<string> {
  const body = await driveFetch('files?fields=id', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  return body.id
}

// Garante pasta (reusa se já existir com o mesmo nome — idempotência)
async function ensureFolder(parentId: string, name: string): Promise<string> {
  return (await findChildFolder(parentId, name)) ?? (await createFolder(parentId, name))
}

// A pasta salva no banco ainda existe e NÃO está na lixeira? O Drive mantém o
// ID válido mesmo depois de mandar pra lixeira — sem esta checagem, o app
// continuaria gravando dentro de uma pasta deletada (invisível).
async function folderAlive(folderId: string | null): Promise<boolean> {
  if (!folderId) return false
  try {
    const meta = await driveFetch(`files/${folderId}?fields=trashed`)
    return meta?.trashed !== true
  } catch (_) {
    return false // 404 / sem acesso → tratar como inexistente
  }
}

// A pasta existe pelo ID e continua "viva": não está na lixeira e o pai dela também não.
// O pai pode ser QUALQUER um: se alguém moveu a pasta (reorganização), ela continua sendo a
// pasta do projeto e o app não cria outra. Pai na lixeira (cliente apagado) conta como perdida,
// porque o filho mantém trashed=false mesmo assim.
async function pastaViva(folderId: string | null): Promise<boolean> {
  if (!folderId) return false
  try {
    const meta = await driveFetch(`files/${folderId}?fields=trashed,parents`)
    if (meta?.trashed === true) return false
    const pai = Array.isArray(meta?.parents) ? meta.parents[0] : null
    if (!pai) return true
    const metaPai = await driveFetch(`files/${pai}?fields=trashed`)
    return metaPai?.trashed !== true
  } catch (_) {
    return false // 404 / sem acesso → tratar como inexistente
  }
}

async function paiDaPasta(folderId: string): Promise<string | null> {
  try {
    const meta = await driveFetch(`files/${folderId}?fields=parents`)
    return Array.isArray(meta?.parents) ? (meta.parents[0] ?? null) : null
  } catch (_) {
    return null
  }
}

// Pasta-contêiner (marca, mês): achada pelo nome, criada se faltar. Se duas execuções criarem a
// mesma ao mesmo tempo, todas passam a usar a mais antiga (a sobra fica vazia; nada é apagado).
async function ensureContainer(parentId: string, name: string): Promise<string> {
  const doMesmoNome = async () => (await listChildren(parentId))
    .filter(c => c.mimeType === FOLDER_MIME && c.name === name)
    .sort((a, b) => String(a.createdTime || '').localeCompare(String(b.createdTime || '')))
  const existentes = await doMesmoNome()
  if (existentes.length) return existentes[0].id
  await createFolder(parentId, name)
  return (await doMesmoNome())[0].id
}

// Layout v2: cria as subpastas por código e devolve o ID de cada uma.
// `fresh` = a pasta do projeto acabou de nascer (não precisa procurar antes de criar).
async function criarSubpastasV2(raizId: string, fresh: boolean): Promise<PastasV2> {
  const ids: Partial<PastasV2> = {}
  for (const no of ARVORE_V2) {
    const pai = no.pai ? ids[no.pai]! : raizId
    ids[no.chave] = fresh ? await createFolder(pai, NOMES_V2[no.chave]) : await ensureFolder(pai, NOMES_V2[no.chave])
  }
  return ids as PastasV2
}

// Espelha recursivamente um modelo: subpastas são criadas, arquivos são
// copiados (placeholders/modelos de doc), arquivos de sistema ignorados.
// Otimizado p/ velocidade: os irmãos de cada nível são processados EM PARALELO
// e, quando o alvo é recém-criado (targetIsFresh), pula-se o findChildFolder
// (a subpasta ainda não existe) — evita dezenas de listagens sequenciais.
async function mirrorTemplate(templateFolderId: string, targetFolderId: string, targetIsFresh = false): Promise<void> {
  const children = await listChildren(templateFolderId)
  await Promise.all(children.map(async (child) => {
    if (SYSTEM_FILES.has(child.name)) return
    if (child.mimeType === FOLDER_MIME) {
      const newId = targetIsFresh
        ? await createFolder(targetFolderId, child.name)
        : await ensureFolder(targetFolderId, child.name)
      // Filhos de uma pasta recém-criada são sempre novos → recursa como fresh.
      await mirrorTemplate(child.id, newId, true)
    } else {
      await driveFetch(`files/${child.id}/copy?fields=id`, {
        method: 'POST',
        body: JSON.stringify({ name: child.name, parents: [targetFolderId] }),
      })
    }
  }))
}

// ---------------------------------------------------------------------------
// Nomenclatura
// ---------------------------------------------------------------------------
// "Mini Missão" → "MINI-MISSAO" (sem acento, sem espaço, caixa alta)
function slugify(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'PROJETO'
}

// Nome atual da pasta no Drive (para decidir se precisa renomear)
async function currentFolderName(folderId: string): Promise<string | null> {
  try {
    const meta = await driveFetch(`files/${folderId}?fields=name`)
    return meta?.name ?? null
  } catch (_) {
    return null
  }
}

// Renomeia a pasta do projeto se o nome-padrão mudou (edição de nome/código na
// plataforma). Só faz PATCH quando realmente difere — seguro e idempotente.
async function renameFolderIfNeeded(folderId: string, expected: string, projectId: string): Promise<void> {
  const current = await currentFolderName(folderId)
  if (!current || current === expected) return
  await driveFetch(`files/${folderId}`, { method: 'PATCH', body: JSON.stringify({ name: expected }) })
  await log('project', projectId, 'rename_folder', `Pasta renomeada de "${current}" para "${expected}"`)
}

// "#2026-227" → "227"; ao passar de 999 mantém os dígitos ("1000")
function jobCode(code: string | null): string {
  const m = (code || '').match(/(\d+)$/)
  if (!m) return '000'
  return m[1].length >= 3 ? m[1] : m[1].padStart(3, '0')
}

// ---------------------------------------------------------------------------
// Provisionamento
// ---------------------------------------------------------------------------
async function ensureClientFolder(client: { id: string; name: string; drive_folder_id: string | null }): Promise<string> {
  // Só reusa o ID salvo se a pasta ainda existir (não estiver na lixeira).
  // Se foi deletada, recria e regrava o novo ID no banco (auto-cura).
  if (await folderAlive(client.drive_folder_id)) return client.drive_folder_id!

  // Pasta do cliente usa o nome EXATAMENTE como escrito no app ("Abby", não
  // "ABBY") — a normalização caixa-alta/sem-acento vale só para a pasta do
  // projeto e arquivos, conforme o spec.
  const folderName = client.name.trim() || 'CLIENTE'
  const folderId = await ensureFolder(CLIENTES_FOLDER_ID, folderName)

  // Estrutura interna: espelha _TEMPLATES/_ASSETS dentro de um _ASSETS do
  // cliente (o template tem BRAND-BOOK/FONTES/GRAFICOS/IMAGENS/LOGOS na raiz).
  // Fallback: cria o _ASSETS padrão se o template não existir.
  const clienteTemplateId = await findChildFolder(TEMPLATES_FOLDER_ID, '_ASSETS')
  const clientAssetsId = await ensureFolder(folderId, '_ASSETS')
  if (clienteTemplateId) {
    await mirrorTemplate(clienteTemplateId, clientAssetsId)
  } else {
    for (const sub of ['BRAND-BOOK', 'FONTES', 'GRAFICOS', 'IMAGENS', 'LOGOS']) {
      await ensureFolder(clientAssetsId, sub)
    }
  }

  await db.from('clients').update({ drive_folder_id: folderId }).eq('id', client.id)
  await log('client', client.id, 'create_folder', `Pasta do cliente "${folderName}" criada/vinculada (${folderId})`)
  return folderId
}

// Marcas do cliente (lista fechada). Banco sem a coluna (migration pendente) → sem marcas.
async function marcasDoCliente(clientId: string): Promise<string[]> {
  try {
    const { data, error } = await db.from('clients').select('marcas').eq('id', clientId).single()
    if (error) return []
    return Array.isArray(data?.marcas) ? data.marcas : []
  } catch (_) {
    return []
  }
}

// O trigger de UPDATE dispara a cada edição de um projeto sem pasta; o aviso "aguardando marca"
// só precisa ficar registrado uma vez.
async function logUmaVez(projectId: string, action: string, detail: string): Promise<void> {
  try {
    const { data } = await db.from('drive_sync_log').select('id')
      .eq('entity_type', 'project').eq('entity_id', projectId).eq('action', action).limit(1)
    if (!data?.length) await log('project', projectId, action, detail)
  } catch (_) { /* log nunca derruba o fluxo */ }
}

// Onde a pasta v2 DEVE estar: Cliente › [Marca] › AAAA-MM. Só procura, nunca cria.
async function paiEsperadoV2(project: any, clientFolderId: string): Promise<string | null> {
  let pai: string | null = clientFolderId
  if (project.marca) pai = await findChildFolder(pai, nomeDeContainer(project.marca))
  if (!pai) return null
  return await findChildFolder(pai, mesDoProjeto(project.data_inicio, project.created_at))
}

// A pasta do projeto já existe pelo ID. Não cria outra. Renomeia só se o nome/código mudou E ela
// ainda está no pai de origem; se alguém a moveu, ela fica exatamente onde está.
async function conferirPastaExistente(project: any, layout: 'v1' | 'v2', clientFolderId: string, folderName: string): Promise<void> {
  const id: string = project.drive_folder_id
  const paiAtual = await paiDaPasta(id)
  const paiEsperado = layout === 'v2' ? await paiEsperadoV2(project, clientFolderId) : clientFolderId
  if (paiEsperado && paiAtual === paiEsperado) {
    await renameFolderIfNeeded(id, folderName, project.id)
  } else {
    await log('project', project.id, 'skip_rename', 'Pasta do projeto fora do pai de origem (foi movida): mantida onde está, sem renomear nem recriar')
  }

  // Backfill (só v1): projetos antigos podem não ter o ID do dropzone salvo ainda.
  if (layout === 'v1' && !project.drive_upload_folder_id) {
    const entregaId = await findChildFolder(id, '06_ENTREGA')
    const up = entregaId ? await findChildFolder(entregaId, '01_REVISAO') : null
    if (up) await db.from('projects').update({ drive_upload_folder_id: up }).eq('id', project.id)
  }
  await log('project', project.id, 'ok', 'Pasta verificada no Drive (idempotência)')
}

// Layout antigo (live e projetos já existentes): pasta direto no cliente, espelhando o template.
async function criarProjetoV1(project: any, clientFolderId: string, folderName: string, isLive: boolean): Promise<void> {
  const existingFolder = await findChildFolder(clientFolderId, folderName)
  const projectFolderId = existingFolder ?? await createFolder(clientFolderId, folderName)

  // Estrutura real do Drive tem um nível a mais: _TEMPLATE_PROJETO/NNN_NOMEPROJETO
  // (ou _TEMPLATE_LIVE/..._LIVE).
  const wrapperName = isLive ? '_TEMPLATE_LIVE' : '_TEMPLATE_PROJETO'
  const innerName = isLive ? 'NNN_NOMEPROJETO_LIVE' : 'NNN_NOMEPROJETO'
  const wrapperId = await findChildFolder(TEMPLATES_FOLDER_ID, wrapperName)
  const templateId = wrapperId ? await findChildFolder(wrapperId, innerName) : null
  if (templateId) {
    await mirrorTemplate(templateId, projectFolderId, !existingFolder)
  } else {
    await log('project', project.id, 'template_missing', `${wrapperName}/${innerName} não encontrado — pasta criada vazia`, 'error')
  }

  // Localiza o dropzone de upload (06_ENTREGA/01_REVISAO) p/ linkar no app
  let uploadFolderId: string | null = null
  const entregaId = await findChildFolder(projectFolderId, '06_ENTREGA')
  if (entregaId) uploadFolderId = await findChildFolder(entregaId, '01_REVISAO')

  await db.from('projects')
    .update({ drive_folder_id: projectFolderId, drive_upload_folder_id: uploadFolderId })
    .eq('id', project.id)
  await log('project', project.id, 'create_folder', `Pasta "${folderName}" criada em "${project.client.name.trim()}" (${projectFolderId})`)
}

// Layout novo: Cliente › [Marca] › AAAA-MM › NNN_NOME, subpastas por código, IDs no banco.
async function criarProjetoV2(project: any, clientFolderId: string, folderName: string): Promise<void> {
  const marcas = await marcasDoCliente(project.client.id)
  if (aguardandoMarca(marcas, project.marca)) {
    await logUmaVez(project.id, 'wait_marca', `Cliente tem marcas (${marcas.join(', ')}): a pasta será criada quando o projeto escolher uma`)
    return
  }

  let paiId = clientFolderId
  if (project.marca) paiId = await ensureContainer(paiId, nomeDeContainer(project.marca))
  const mes = mesDoProjeto(project.data_inicio, project.created_at)
  paiId = await ensureContainer(paiId, mes)

  // Reusa pasta homônima já existente (execução anterior que caiu no meio).
  const existente = await findChildFolder(paiId, folderName)
  const projectFolderId = existente ?? await createFolder(paiId, folderName)
  const pastas = await criarSubpastasV2(projectFolderId, !existente)

  await db.from('projects')
    .update({ drive_folder_id: projectFolderId, drive_upload_folder_id: pastas.revisao, drive_layout: 'v2', drive_pastas: pastas })
    .eq('id', project.id)
  const caminho = [project.client.name.trim(), project.marca ? nomeDeContainer(project.marca) : null, mes, folderName].filter(Boolean).join(' › ')
  await log('project', project.id, 'create_folder', `Pasta v2 criada: ${caminho} (${projectFolderId})`)
}

async function provisionProject(projectId: string): Promise<void> {
  // Busca o projeto completo (o payload do webhook pode não ter tudo)
  const { data: project, error } = await db
    .from('projects')
    .select('*, client:clients(id, name, drive_folder_id), budget:budgets(category)')
    .eq('id', projectId)
    .single()
  if (error || !project) throw new Error(`Projeto ${projectId} não encontrado: ${error?.message}`)

  if (!project.client) {
    await log('project', projectId, 'skip', 'Projeto sem cliente — pasta não criada (vincule um cliente e recrie)', 'error')
    return
  }

  // 1. Pasta do cliente PRIMEIRO (auto-cura se tiver ido pra lixeira)
  const clientFolderId = await ensureClientFolder(project.client)

  // Nome-padrão da pasta do projeto (NNN_NOME[_LIVE])
  const category: string = project.category ?? project.budget?.category ?? 'digital'
  const isLive = category === 'live'
  const folderName = `${jobCode(project.code)}_${slugify(project.name)}${isLive ? '_LIVE' : ''}`

  const layout = layoutDoProjeto({
    isLive,
    driveFolderId: project.drive_folder_id,
    driveLayout: project.drive_layout ?? null,
    temColunasV2: 'drive_layout' in project, // select('*'): a coluna só vem se a migration já rodou
  })

  // 2. Idempotência: a pasta salva existe pelo ID? Então não recria, esteja onde estiver.
  if (await pastaViva(project.drive_folder_id)) {
    await conferirPastaExistente(project, layout, clientFolderId, folderName)
    return
  }

  // 3. Cria no layout do projeto.
  if (layout === 'v2') await criarProjetoV2(project, clientFolderId, folderName)
  else await criarProjetoV1(project, clientFolderId, folderName, isLive)
}

// ---------------------------------------------------------------------------
// HTTP handler (webhook do banco)
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 })

  if (!WEBHOOK_SECRET || req.headers.get('x-drive-secret') !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  let projectId: string | null = null
  try {
    const body = await req.json()
    // INSERT ou UPDATE de projeto (o provision é idempotente e renomeia se preciso)
    if (body?.table === 'projects' && body?.record?.id) projectId = body.record.id
    // Reprocessamento manual: POST {"project_id": "..."}
    if (!projectId && body?.project_id) projectId = body.project_id
  } catch (_) { /* payload inválido */ }

  if (!projectId) return new Response(JSON.stringify({ skipped: true }), { status: 200 })

  const work = provisionProject(projectId).catch(async (err) => {
    console.error('drive-provision falhou:', err)
    await log('project', projectId, 'error', String(err?.message || err), 'error')
  })

  // Responde já e continua processando em background (criação de ~30 pastas)
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work)
  } else {
    await work
  }

  return new Response(JSON.stringify({ accepted: true, project_id: projectId }), { status: 202 })
})
