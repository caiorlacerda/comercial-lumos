// Revisão de vídeo — Fase 2: monitor do dropzone + ação de finalizar.
//
// Chamada 1 (pg_cron, body {}): varre 06_ENTREGA/01_REVISAO de cada projeto
//   ativo, acha vídeos [NNN]_[PROJETO]_vNN.(mp4|mov) e registra os novos como
//   EM_REVISAO_INTERNA em video_versions (idempotente por drive_file_id).
// Chamada 2 (body {"action":"finalize","version_id":"..."}): copia o arquivo
//   da versão para 06_ENTREGA/02_APROVADO como vFINAL e marca APROVADO.
//
// Auth: header x-drive-secret == DRIVE_WEBHOOK_SECRET. Deploy --no-verify-jwt.
// Reusa os secrets/Service Account de drive-provision.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DRIVE_ID = Deno.env.get('DRIVE_SHARED_DRIVE_ID') ?? ''
const WEBHOOK_SECRET = Deno.env.get('DRIVE_WEBHOOK_SECRET') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SYSTEM_FILES = new Set(['.DS_Store', 'desktop.ini', 'Thumbs.db'])

// Qualquer vídeo serve — sem trava de nome. Detecta por mimeType de vídeo ou
// pela extensão (o Drive nem sempre preenche o mimeType de imediato no upload).
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|mpg|mpeg|wmv|mts|m2ts)$/i
function isVideoFile(file: any): boolean {
  return (typeof file.mimeType === 'string' && file.mimeType.startsWith('video/')) || VIDEO_EXT.test(file.name || '')
}

// --- Google auth (Service Account, JWT RS256) -----------------------------
let cachedToken: { token: string; exp: number } | null = null
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function googleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token
  const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '{}')
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON ausente')
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))
  const pem = (sa.private_key as string).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', raw.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${b64url(sig)}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token Google falhou: ${JSON.stringify(data).slice(0, 150)}`)
  cachedToken = { token: data.access_token, exp: now + 3500 }
  return data.access_token
}

async function driveFetch(path: string, init: RequestInit = {}, attempt = 1): Promise<any> {
  const token = await googleAccessToken()
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}${sep}supportsAllDrives=true`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if ((res.status === 429 || res.status >= 500) && attempt <= 3) {
    await new Promise(r => setTimeout(r, attempt * 1000)); return driveFetch(path, init, attempt + 1)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Drive ${res.status}: ${JSON.stringify(body.error?.message || body).slice(0, 200)}`)
  return body
}

async function listChildren(parentId: string): Promise<any[]> {
  const items: any[] = []; let pageToken = ''
  do {
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`)
    const page = await driveFetch(`files?q=${q}&fields=files(id,name,mimeType,webViewLink,size,videoMediaMetadata,createdTime,owners(displayName),lastModifyingUser(displayName)),nextPageToken&pageSize=200&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}${pageToken ? `&pageToken=${pageToken}` : ''}`)
    items.push(...(page.files || [])); pageToken = page.nextPageToken || ''
  } while (pageToken)
  return items
}
async function findChildFolder(parentId: string, name: string): Promise<string | null> {
  return (await listChildren(parentId)).find(c => c.mimeType === FOLDER_MIME && c.name === name)?.id ?? null
}
async function ensureFolder(parentId: string, name: string): Promise<string> {
  const found = await findChildFolder(parentId, name)
  if (found) return found
  const body = await driveFetch('files?fields=id', { method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }) })
  return body.id
}

async function log(entity_id: string | null, action: string, detail: string, status: 'ok' | 'error' = 'ok') {
  try { await db.from('drive_sync_log').insert([{ entity_type: 'video', entity_id, action, detail: detail.slice(0, 900), status }]) } catch (_) {}
}

// --- Monitor do dropzone --------------------------------------------------
async function scanDropzones(onlyProjectId?: string): Promise<{ found: number }> {
  let query = db
    .from('projects').select('id, drive_folder_id').eq('status', 'ativo').not('drive_folder_id', 'is', null)
  if (onlyProjectId) query = query.eq('id', onlyProjectId)
  const { data: projects } = await query
  const { data: known } = await db.from('video_versions').select('drive_file_id')
  const knownIds = new Set((known || []).map((k: any) => k.drive_file_id))

  let found = 0
  for (const proj of projects || []) {
    try {
      const entregaId = await findChildFolder(proj.drive_folder_id, '06_ENTREGA')
      if (!entregaId) continue
      const revisaoId = await findChildFolder(entregaId, '01_REVISAO')
      if (!revisaoId) continue

      // Vídeos novos (qualquer nome), ordenados do upload mais antigo p/ o mais
      // novo, para numerar as versões na ordem em que foram subidos.
      const novos = (await listChildren(revisaoId))
        .filter((f: any) => f.mimeType !== FOLDER_MIME && !SYSTEM_FILES.has(f.name) && !knownIds.has(f.id) && isVideoFile(f))
        .sort((a: any, b: any) => String(a.createdTime || '').localeCompare(String(b.createdTime || '')))
      if (!novos.length) continue

      // Próxima versão = maior versão já registrada do projeto + 1
      const { data: maxRow } = await db
        .from('video_versions').select('versao').eq('project_id', proj.id).order('versao', { ascending: false }).limit(1)
      let nextV = (((maxRow?.[0]?.versao as number) ?? 0)) + 1

      for (const file of novos) {
        const vmm = file.videoMediaMetadata || {}
        const { error } = await db.from('video_versions').insert([{
          project_id: proj.id,
          versao: nextV,
          file_name: file.name,
          drive_file_id: file.id,
          drive_web_link: file.webViewLink ?? null,
          status: 'EM_REVISAO_INTERNA',
          width: vmm.width ?? null,
          height: vmm.height ?? null,
          duration_ms: vmm.durationMillis ? Number(vmm.durationMillis) : null,
          size_bytes: file.size ? Number(file.size) : null,
          mime_type: file.mimeType ?? null,
          uploaded_by: file.lastModifyingUser?.displayName ?? file.owners?.[0]?.displayName ?? null,
          uploaded_at: file.createdTime ?? null,
        }])
        if (!error) { found++; knownIds.add(file.id); await log(proj.id, 'new_version', `Nova versão v${String(nextV).padStart(2, '0')} detectada: ${file.name}`); nextV++ }
        else if (!String(error.message).includes('duplicate')) await log(proj.id, 'error', `Insert falhou p/ ${file.name}: ${error.message}`, 'error')
      }
    } catch (err: any) {
      await log(proj.id, 'error', `Scan falhou: ${err.message}`, 'error')
    }
  }
  return { found }
}

// --- Finalizar (copiar vFINAL para 02_APROVADO) ---------------------------
async function finalizeVersion(versionId: string): Promise<void> {
  const { data: v, error } = await db
    .from('video_versions').select('*, project:projects(drive_folder_id)').eq('id', versionId).single()
  if (error || !v) throw new Error(`Versão ${versionId} não encontrada`)
  if (v.approved_file_id) return // já finalizada (idempotência)
  const projFolderId = v.project?.drive_folder_id
  if (!projFolderId) throw new Error('Projeto sem pasta no Drive')

  const entregaId = await ensureFolder(projFolderId, '06_ENTREGA')
  const aprovadoId = await ensureFolder(entregaId, '02_APROVADO')
  // Nome do aprovado: insere _APROVADO antes da extensão (funciona com qualquer nome)
  const dot = (v.file_name as string).lastIndexOf('.')
  const finalName = dot > 0
    ? `${(v.file_name as string).slice(0, dot)}_APROVADO${(v.file_name as string).slice(dot)}`
    : `${v.file_name}_APROVADO`

  const copy = await driveFetch(`files/${v.drive_file_id}/copy?fields=id`, {
    method: 'POST', body: JSON.stringify({ name: finalName, parents: [aprovadoId] }),
  })
  await db.from('video_versions').update({ approved_file_id: copy.id, status: 'APROVADO', updated_at: new Date().toISOString() }).eq('id', versionId)
  await log(v.project_id, 'finalize', `vFINAL "${finalName}" copiado para 02_APROVADO`)
}

// Finaliza versões que o app marcou como APROVADO mas ainda não têm o vFINAL
// copiado (o cliente não tem o segredo p/ chamar direto — o cron resolve).
async function finalizePending(): Promise<number> {
  const { data: pend } = await db
    .from('video_versions').select('id').eq('status', 'APROVADO').is('approved_file_id', null)
  let done = 0
  for (const v of pend || []) {
    try { await finalizeVersion(v.id); done++ } catch (err: any) { await log(v.id, 'error', `Finalize falhou: ${err.message}`, 'error') }
  }
  return done
}

// --- HTTP -----------------------------------------------------------------
serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 })
  if (!WEBHOOK_SECRET || req.headers.get('x-drive-secret') !== WEBHOOK_SECRET)
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })

  let payload: any = {}
  try { payload = await req.json() } catch (_) {}

  try {
    // Ação explícita (opcional/manual)
    if (payload?.action === 'finalize' && payload?.version_id) {
      await finalizeVersion(payload.version_id)
      return new Response(JSON.stringify({ ok: true, finalized: payload.version_id }), { status: 200 })
    }
    // Scan sob demanda de um projeto (botão "Verificar agora" no app)
    if (payload?.action === 'scan') {
      const res = await scanDropzones(payload.project_id)
      const finalized = await finalizePending()
      return new Response(JSON.stringify({ ok: true, ...res, finalized }), { status: 200 })
    }
    // Varredura periódica: detecta novas versões + finaliza aprovadas pendentes
    const res = await scanDropzones()
    const finalized = await finalizePending()
    return new Response(JSON.stringify({ ok: true, ...res, finalized }), { status: 200 })
  } catch (err: any) {
    console.error('drive-watch falhou:', err)
    await log(null, 'error', String(err?.message || err), 'error')
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 })
  }
})
