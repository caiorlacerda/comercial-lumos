// Upload pela plataforma (proxy em streaming). O navegador manda o arquivo pra
// ESTA função (CORS liberado por nós) e ela repassa os bytes direto pro Drive
// via upload resumável — sem bufferizar o arquivo inteiro. Evita o problema de
// CORS do endpoint de upload do Google (que não libera o navegador).
//
// POST /drive-upload?project_id=..&file_name=..&mime_type=..  (corpo = o arquivo)
// Deploy SEM --no-verify-jwt? Não: precisa de --no-verify-jwt=false (padrão) p/
// exigir login. Mas o corpo é binário — o gateway exige apikey+Authorization,
// que o app envia.

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
async function findChildFolder(parentId: string, name: string, token: string): Promise<string | null> {
  const q = encodeURIComponent(`'${parentId}' in parents and trashed=false and mimeType='${FOLDER_MIME}' and name='${name.replace(/'/g, "\\'")}'`)
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json()
  return body.files?.[0]?.id ?? null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405)

  const url = new URL(req.url)
  const projectId = url.searchParams.get('project_id') ?? ''
  const fileName = url.searchParams.get('file_name') ?? ''
  const mimeType = url.searchParams.get('mime_type') || 'video/mp4'
  const contentLength = req.headers.get('content-length')
  if (!projectId || !fileName) return json({ error: 'project_id e file_name obrigatórios' }, 400)
  if (!req.body) return json({ error: 'sem corpo' }, 400)

  try {
    const token = await googleToken()

    // Resolve a pasta 06_ENTREGA/01_REVISAO do projeto
    const { data: proj } = await db.from('projects').select('drive_folder_id, drive_upload_folder_id').eq('id', projectId).single()
    let folderId = proj?.drive_upload_folder_id as string | null
    if (!folderId && proj?.drive_folder_id) {
      const entrega = await findChildFolder(proj.drive_folder_id, '06_ENTREGA', token)
      folderId = entrega ? await findChildFolder(entrega, '01_REVISAO', token) : null
      if (folderId) await db.from('projects').update({ drive_upload_folder_id: folderId }).eq('id', projectId)
    }
    if (!folderId) return json({ error: 'Projeto sem pasta 01_REVISAO' }, 400)

    // 1) Abre a sessão resumável
    const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        ...(contentLength ? { 'X-Upload-Content-Length': contentLength } : {}),
      },
      body: JSON.stringify({ name: fileName, parents: [folderId] }),
    })
    const session = initRes.headers.get('location')
    if (!session) return json({ error: `init falhou ${initRes.status}` }, 502)

    // 2) Repassa o corpo (streaming) direto pro Google
    const putRes = await fetch(session, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType, ...(contentLength ? { 'Content-Length': contentLength } : {}) },
      body: req.body,
      // deno-lint-ignore no-explicit-any
      ...( { duplex: 'half' } as any ),
    })
    if (putRes.status < 200 || putRes.status >= 300) return json({ error: `upload falhou ${putRes.status}` }, 502)
    const file = await putRes.json().catch(() => ({}))
    return json({ ok: true, id: file.id ?? null })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err).slice(0, 200) }, 500)
  }
})
