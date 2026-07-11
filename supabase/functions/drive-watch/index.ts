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
    const page = await driveFetch(`files?q=${q}&fields=files(id,name,mimeType,webViewLink,size,videoMediaMetadata,createdTime,owners(displayName),lastModifyingUser(displayName),properties),nextPageToken&pageSize=200&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}${pageToken ? `&pageToken=${pageToken}` : ''}`)
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

// --- FPS: lê o cabeçalho (moov) do arquivo no Drive e calcula o frame rate ---
// O Drive não expõe FPS; parseamos as boxes MP4/MOV via Range (sem baixar tudo).
function snapFps(x: number): number {
  const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120]
  let best = x, bd = Infinity
  for (const c of common) { const d = Math.abs(c - x); if (d < bd) { bd = d; best = c } }
  return bd < 0.6 ? best : Math.round(x * 100) / 100
}
// Lista as boxes (atoms) filhas dentro de [start,end) de um buffer.
function mp4Boxes(buf: Uint8Array, start: number, end: number): { type: string; ds: number; de: number }[] {
  const out: { type: string; ds: number; de: number }[] = []
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let o = start
  while (o + 8 <= end) {
    let size = dv.getUint32(o)
    const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7])
    let hdr = 8
    if (size === 1) { const hi = dv.getUint32(o + 8), lo = dv.getUint32(o + 12); size = hi * 4294967296 + lo; hdr = 16 }
    else if (size === 0) size = end - o
    if (size < hdr || o + size > end) break
    out.push({ type, ds: o + hdr, de: o + size })
    o += size
  }
  return out
}
interface VideoMeta { fps: number | null; width: number | null; height: number | null; durationMs: number | null }
function metaFromMoov(buf: Uint8Array, start: number, end: number): VideoMeta {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const top = mp4Boxes(buf, start, end)
  let durationMs: number | null = null
  const mvhd = top.find(b => b.type === 'mvhd')
  if (mvhd) {
    if (buf[mvhd.ds] === 1) { const ts = dv.getUint32(mvhd.ds + 20); const dur = dv.getUint32(mvhd.ds + 24) * 4294967296 + dv.getUint32(mvhd.ds + 28); if (ts) durationMs = Math.round(dur / ts * 1000) }
    else { const ts = dv.getUint32(mvhd.ds + 12); const dur = dv.getUint32(mvhd.ds + 16); if (ts) durationMs = Math.round(dur / ts * 1000) }
  }
  let fps: number | null = null, width: number | null = null, height: number | null = null
  for (const trak of top.filter(b => b.type === 'trak')) {
    const kids = mp4Boxes(buf, trak.ds, trak.de)
    const mdia = kids.find(b => b.type === 'mdia'), tkhd = kids.find(b => b.type === 'tkhd')
    if (!mdia) continue
    const mk = mp4Boxes(buf, mdia.ds, mdia.de)
    const hdlr = mk.find(b => b.type === 'hdlr'), mdhd = mk.find(b => b.type === 'mdhd'), minf = mk.find(b => b.type === 'minf')
    if (!hdlr || !mdhd || !minf) continue
    if (String.fromCharCode(buf[hdlr.ds + 8], buf[hdlr.ds + 9], buf[hdlr.ds + 10], buf[hdlr.ds + 11]) !== 'vide') continue
    const timescale = buf[mdhd.ds] === 1 ? dv.getUint32(mdhd.ds + 20) : dv.getUint32(mdhd.ds + 12)
    const stbl = mp4Boxes(buf, minf.ds, minf.de).find(b => b.type === 'stbl')
    const stts = stbl && mp4Boxes(buf, stbl.ds, stbl.de).find(b => b.type === 'stts')
    if (stts && dv.getUint32(stts.ds + 4) >= 1) {
      const sampleDelta = dv.getUint32(stts.ds + 12)
      if (timescale && sampleDelta) fps = snapFps(timescale / sampleDelta)
    }
    if (tkhd) {
      const wOff = buf[tkhd.ds] === 1 ? tkhd.ds + 88 : tkhd.ds + 76
      const w = dv.getUint32(wOff) / 65536, h = dv.getUint32(wOff + 4) / 65536
      if (w > 0 && h > 0) { width = Math.round(w); height = Math.round(h) }
    }
    break
  }
  return { fps, width, height, durationMs }
}
async function probeVideoMeta(driveFileId: string): Promise<VideoMeta | null> {
  const token = await googleAccessToken()
  const url = `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media&supportsAllDrives=true`
  const read = async (a: number, b: number): Promise<Uint8Array> => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Range: `bytes=${a}-${b}` } })
    return new Uint8Array(await res.arrayBuffer())
  }
  let offset = 0
  for (let i = 0; i < 96; i++) {
    const head = await read(offset, offset + 15)
    if (head.length < 8) break
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
    let size = dv.getUint32(0); let hdr = 8
    const type = String.fromCharCode(head[4], head[5], head[6], head[7])
    if (size === 1) { const hi = dv.getUint32(8), lo = dv.getUint32(12); size = hi * 4294967296 + lo; hdr = 16 }
    if (type === 'moov') {
      if (size > 12_000_000) return null // moov gigante: aborta p/ não baixar demais
      const moov = await read(offset, offset + size - 1)
      return metaFromMoov(moov, hdr, moov.length)
    }
    if (size <= 0) break
    offset += size
  }
  return null
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

      // Vídeos novos (qualquer nome). Cada upload nasce como um VÍDEO separado
      // (grupo próprio, versão 1) — a equipe empilha versões manualmente no app.
      const novos = (await listChildren(revisaoId))
        .filter((f: any) => f.mimeType !== FOLDER_MIME && !SYSTEM_FILES.has(f.name) && !knownIds.has(f.id) && isVideoFile(f))
        .sort((a: any, b: any) => String(a.createdTime || '').localeCompare(String(b.createdTime || '')))
      if (!novos.length) continue

      for (const file of novos) {
        const vmm = file.videoMediaMetadata || {}
        // Drive só calcula width/height/duração um tempo DEPOIS do upload; então
        // lemos direto do cabeçalho (moov) como fonte imediata. FPS o Drive nunca dá.
        const pm = await probeVideoMeta(file.id).catch(() => null)
        const { error } = await db.from('video_versions').insert([{
          project_id: proj.id,
          versao: 1, // grupo próprio → sempre começa em v01 (group_id = DEFAULT)
          file_name: file.name,
          drive_file_id: file.id,
          drive_web_link: file.webViewLink ?? null,
          status: 'EM_REVISAO_INTERNA',
          width: vmm.width ?? pm?.width ?? null,
          height: vmm.height ?? pm?.height ?? null,
          duration_ms: vmm.durationMillis ? Number(vmm.durationMillis) : (pm?.durationMs ?? null),
          size_bytes: file.size ? Number(file.size) : null,
          mime_type: file.mimeType ?? null,
          // uploads pela plataforma gravam o nome do usuário do app numa propriedade;
          // uploads direto no Drive usam o Google de quem subiu.
          uploaded_by: file.properties?.app_uploader ?? file.lastModifyingUser?.displayName ?? file.owners?.[0]?.displayName ?? null,
          uploaded_at: file.createdTime ?? null,
          fps: pm?.fps ?? null,
        }])
        if (!error) { found++; knownIds.add(file.id); await log(proj.id, 'new_version', `Novo vídeo detectado: ${file.name}`) }
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

// Backfill: preenche quem subiu / data / FPS nos vídeos que ainda não têm.
// Processa poucos por vez (auto-cura a cada ciclo). Sentinela '' / 0 evita
// reprocessar arquivos sem info / sem FPS legível para sempre.
async function backfillMeta(limit = 8): Promise<number> {
  const { data: rows } = await db
    .from('video_versions').select('id, drive_file_id, uploaded_by, uploaded_at, fps, width, duration_ms, size_bytes')
    .or('uploaded_by.is.null,fps.is.null,width.is.null,duration_ms.is.null').limit(limit)
  let done = 0
  for (const r of rows || []) {
    try {
      const patch: Record<string, unknown> = {}
      const meta = await driveFetch(`files/${r.drive_file_id}?fields=createdTime,size,owners(displayName),lastModifyingUser(displayName),properties,videoMediaMetadata`)
      const vmm = meta.videoMediaMetadata || {}
      if (!r.uploaded_by) patch.uploaded_by = meta.properties?.app_uploader ?? meta.lastModifyingUser?.displayName ?? meta.owners?.[0]?.displayName ?? ''
      if (!r.uploaded_at) patch.uploaded_at = meta.createdTime ?? null
      if (r.size_bytes == null && meta.size) patch.size_bytes = Number(meta.size)
      const needProbe = r.fps == null || (r.width == null && !vmm.width) || (r.duration_ms == null && !vmm.durationMillis)
      const pm = needProbe ? await probeVideoMeta(r.drive_file_id).catch(() => null) : null
      if (r.width == null && (vmm.width || pm?.width)) { patch.width = vmm.width ?? pm!.width; patch.height = vmm.height ?? pm!.height }
      if (r.duration_ms == null && (vmm.durationMillis || pm?.durationMs)) patch.duration_ms = vmm.durationMillis ? Number(vmm.durationMillis) : pm!.durationMs
      if (r.fps == null) patch.fps = pm?.fps ?? 0
      if (Object.keys(patch).length) { await db.from('video_versions').update(patch).eq('id', r.id); done++ }
    } catch (_) { /* tenta no próximo ciclo */ }
  }
  return done
}

// Renomeia o arquivo no Drive + espelha o file_name no banco.
async function renameVersion(versionId: string, newName: string): Promise<void> {
  const clean = newName.trim(); if (!clean) throw new Error('nome vazio')
  const { data: v, error } = await db.from('video_versions').select('drive_file_id').eq('id', versionId).single()
  if (error || !v?.drive_file_id) throw new Error('versão não encontrada')
  await driveFetch(`files/${v.drive_file_id}?fields=id`, { method: 'PATCH', body: JSON.stringify({ name: clean }) })
  await db.from('video_versions').update({ file_name: clean }).eq('id', versionId)
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
    if (payload?.action === 'rename' && payload?.version_id && payload?.new_name) {
      await renameVersion(payload.version_id, payload.new_name)
      return new Response(JSON.stringify({ ok: true, renamed: payload.version_id }), { status: 200 })
    }
    // Scan sob demanda de um projeto (botão "Verificar agora" no app)
    if (payload?.action === 'scan') {
      const res = await scanDropzones(payload.project_id)
      const finalized = await finalizePending()
      return new Response(JSON.stringify({ ok: true, ...res, finalized }), { status: 200 })
    }
    // Varredura periódica: detecta novos vídeos + finaliza aprovados + backfill
    const res = await scanDropzones()
    const finalized = await finalizePending()
    const filled = await backfillMeta()
    return new Response(JSON.stringify({ ok: true, ...res, finalized, filled }), { status: 200 })
  } catch (err: any) {
    console.error('drive-watch falhou:', err)
    await log(null, 'error', String(err?.message || err), 'error')
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 })
  }
})
