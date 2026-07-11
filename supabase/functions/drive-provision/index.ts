// Integração App Lumos × Google Drive — Fase 1 (pastas automáticas)
//
// Disparada por Database Webhook em INSERT na tabela projects.
// 1. Garante a pasta do CLIENTE em Clientes/ (criada no 1º projeto aprovado,
//    espelhando o modelo _TEMPLATES/CLIENTE; fallback: _ASSETS padrão).
// 2. Cria a pasta do PROJETO ([NNN]_[NOME] ou [NNN]_[NOME]_LIVE) espelhando
//    _TEMPLATES/DIGITAL ou _TEMPLATES/LIVE conforme a categoria.
// 3. Grava os IDs em clients/projects.drive_folder_id e loga em drive_sync_log.
//
// Idempotente: nunca duplica (checa drive_folder_id e, na criação, reusa
// pasta homônima já existente). Retry com backoff em erros 429/5xx do Drive.
//
// Secrets necessários: GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_SHARED_DRIVE_ID,
// DRIVE_CLIENTES_FOLDER_ID, DRIVE_TEMPLATES_FOLDER_ID, DRIVE_WEBHOOK_SECRET.
// Deploy com --no-verify-jwt (a autenticação é o header x-drive-secret).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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

async function listChildren(parentId: string): Promise<{ id: string; name: string; mimeType: string }[]> {
  const items: { id: string; name: string; mimeType: string }[] = []
  let pageToken = ''
  do {
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`)
    const page = await driveFetch(
      `files?q=${q}&fields=files(id,name,mimeType),nextPageToken&pageSize=200&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}${pageToken ? `&pageToken=${pageToken}` : ''}`
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

// Espelha recursivamente um modelo: subpastas são criadas, arquivos são
// copiados (placeholders/modelos de doc), arquivos de sistema ignorados.
async function mirrorTemplate(templateFolderId: string, targetFolderId: string): Promise<void> {
  const children = await listChildren(templateFolderId)
  for (const child of children) {
    if (SYSTEM_FILES.has(child.name)) continue
    if (child.mimeType === FOLDER_MIME) {
      const newId = await ensureFolder(targetFolderId, child.name)
      await mirrorTemplate(child.id, newId)
    } else {
      await driveFetch(`files/${child.id}/copy?fields=id`, {
        method: 'POST',
        body: JSON.stringify({ name: child.name, parents: [targetFolderId] }),
      })
    }
  }
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
  if (client.drive_folder_id) return client.drive_folder_id

  const folderName = slugify(client.name)
  const folderId = await ensureFolder(CLIENTES_FOLDER_ID, folderName)

  // Estrutura interna: espelha _TEMPLATES/CLIENTE se existir; senão _ASSETS padrão
  const clienteTemplateId = await findChildFolder(TEMPLATES_FOLDER_ID, 'CLIENTE')
  if (clienteTemplateId) {
    await mirrorTemplate(clienteTemplateId, folderId)
  } else {
    const assetsId = await ensureFolder(folderId, '_ASSETS')
    for (const sub of ['BRAND-BOOK', 'FONTES', 'GRAFICOS', 'IMAGENS', 'LOGOS']) {
      await ensureFolder(assetsId, sub)
    }
  }

  await db.from('clients').update({ drive_folder_id: folderId }).eq('id', client.id)
  await log('client', client.id, 'create_folder', `Pasta do cliente "${folderName}" criada/vinculada (${folderId})`)
  return folderId
}

async function provisionProject(projectId: string): Promise<void> {
  // Busca o projeto completo (o payload do webhook pode não ter tudo)
  const { data: project, error } = await db
    .from('projects')
    .select('*, client:clients(id, name, drive_folder_id), budget:budgets(category)')
    .eq('id', projectId)
    .single()
  if (error || !project) throw new Error(`Projeto ${projectId} não encontrado: ${error?.message}`)

  if (project.drive_folder_id) {
    await log('project', projectId, 'skip', 'Projeto já tem pasta no Drive (idempotência)')
    return
  }
  if (!project.client) {
    await log('project', projectId, 'skip', 'Projeto sem cliente — pasta não criada (vincule um cliente e recrie)', 'error')
    return
  }

  // 1. Pasta do cliente (nasce no 1º projeto aprovado)
  const clientFolderId = await ensureClientFolder(project.client)

  // 2. Pasta do projeto
  const category: string = project.category ?? project.budget?.category ?? 'digital'
  const isLive = category === 'live'
  const folderName = `${jobCode(project.code)}_${slugify(project.name)}${isLive ? '_LIVE' : ''}`
  const projectFolderId = await ensureFolder(clientFolderId, folderName)

  // 3. Espelha o template da categoria
  const templateName = isLive ? 'LIVE' : 'DIGITAL'
  const templateId = await findChildFolder(TEMPLATES_FOLDER_ID, templateName)
  if (templateId) {
    await mirrorTemplate(templateId, projectFolderId)
  } else {
    await log('project', projectId, 'template_missing', `_TEMPLATES/${templateName} não encontrado — pasta criada vazia`, 'error')
  }

  await db.from('projects').update({ drive_folder_id: projectFolderId }).eq('id', projectId)
  await log('project', projectId, 'create_folder', `Pasta "${folderName}" criada em ${slugify(project.client.name)} (${projectFolderId})`)
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
    if (body?.table === 'projects' && body?.type === 'INSERT') projectId = body.record?.id ?? null
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
