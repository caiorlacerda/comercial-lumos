// Salva a Ordem de Serviço (PDF) na subpasta "OS" da pasta do projeto no Drive,
// usando a conta de serviço — ou seja, sem depender de a pessoa estar logada no
// Google. O navegador gera o PDF e manda os bytes pra cá.
//
// POST /drive-os-upload?project_id=..&file_name=..   (corpo = o PDF)
// Exige login no app (JWT verificado pelo gateway + conferido aqui: só equipe ativa).
// Idempotente: se já existe um arquivo com o mesmo nome na pasta OS, devolve ele.
//
// Secrets: GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_SHARED_DRIVE_ID (os mesmos do drive-upload).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DRIVE_ID = Deno.env.get('DRIVE_SHARED_DRIVE_ID') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const MAX_BYTES = 15 * 1024 * 1024

// --- Google auth (Service Account) ---------------------------------------
let cachedToken: { token: string; exp: number } | null = null
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function googleToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token
  const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '{}')
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const pem = (sa.private_key as string).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', raw.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)))
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${b64url(sig)}` })
  const data = await res.json()
  if (!data.access_token) throw new Error('token google falhou')
  cachedToken = { token: data.access_token, exp: now + 3500 }
  return data.access_token
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

async function findInFolder(parentId: string, name: string, token: string, folder: boolean): Promise<{ id: string; webViewLink?: string } | null> {
  const mime = folder ? `mimeType='${FOLDER_MIME}'` : `mimeType!='${FOLDER_MIME}'`
  const q = encodeURIComponent(`'${parentId}' in parents and trashed=false and ${mime} and name='${esc(name)}'`)
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json()
  return body.files?.[0] ?? null
}

async function createFolder(parentId: string, name: string, token: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`criar pasta falhou ${res.status}`)
  return body.id
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405)

  try {
    // Só equipe ativa: confere o login e o cadastro em app_users.
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: auth } = await db.auth.getUser(jwt)
    if (!auth?.user) return json({ error: 'sem login' }, 401)
    const { data: me } = await db.from('app_users').select('status').eq('auth_user_id', auth.user.id).maybeSingle()
    if (!me || me.status !== 'ativo') return json({ error: 'sem permissão' }, 403)

    const url = new URL(req.url)
    const projectId = url.searchParams.get('project_id') ?? ''
    const fileName = (url.searchParams.get('file_name') ?? '').replace(/[\\/]/g, '-').slice(0, 200)
    if (!projectId || !fileName) return json({ error: 'project_id e file_name obrigatórios' }, 400)

    const pdf = new Uint8Array(await req.arrayBuffer())
    if (pdf.length < 5 || pdf.length > MAX_BYTES) return json({ error: 'arquivo inválido' }, 400)
    // %PDF-
    if (!(pdf[0] === 0x25 && pdf[1] === 0x50 && pdf[2] === 0x44 && pdf[3] === 0x46)) return json({ error: 'não é um PDF' }, 400)

    const { data: proj } = await db.from('projects').select('drive_folder_id').eq('id', projectId).maybeSingle()
    if (!proj?.drive_folder_id) return json({ error: 'pasta do projeto ainda não está pronta' }, 409)

    const token = await googleToken()
    const osFolder = (await findInFolder(proj.drive_folder_id, 'OS', token, true))?.id
      ?? await createFolder(proj.drive_folder_id, 'OS', token)

    const existing = await findInFolder(osFolder, fileName, token, false)
    if (existing) return json({ ok: true, id: existing.id, webViewLink: existing.webViewLink ?? null, already: true })

    // Upload multipart (PDF pequeno): metadados + bytes numa só chamada.
    const boundary = 'lumos' + crypto.randomUUID().replace(/-/g, '')
    const enc = new TextEncoder()
    const head = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: fileName, parents: [osFolder] }) +
      `\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`)
    const tail = enc.encode(`\r\n--${boundary}--`)
    const body = new Uint8Array(head.length + pdf.length + tail.length)
    body.set(head, 0); body.set(pdf, head.length); body.set(tail, head.length + pdf.length)

    const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    const file = await up.json().catch(() => ({}))
    if (!up.ok || !file.id) return json({ error: `upload falhou ${up.status}` }, 502)
    return json({ ok: true, id: file.id, webViewLink: file.webViewLink ?? null })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err).slice(0, 200) }, 500)
  }
})
