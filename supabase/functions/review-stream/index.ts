// Streaming do vídeo de revisão para o player público (proxy do Drive).
// Valida o token do link → resolve o drive_file_id → transmite os bytes do
// Drive com Range (seek), sem expor o Drive nem exigir login.
// Deploy: --no-verify-jwt (é público, protegido pelo token do link).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'range', 'Access-Control-Expose-Headers': 'content-range, accept-ranges, content-length' }

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
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const pem = (sa.private_key as string).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', raw.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)))
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${b64url(sig)}` })
  const data = await res.json()
  cachedToken = { token: data.access_token, exp: now + 3500 }
  return data.access_token
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const token = url.searchParams.get('token') ?? ''
  if (!token) return new Response('missing token', { status: 400, headers: CORS })

  const wantsDownload = url.searchParams.get('download') === '1'

  // Token → arquivo do Drive (só links ativos)
  const { data: link } = await db.from('review_links').select('video_version_id, active, allow_download').eq('token', token).eq('active', true).maybeSingle()
  if (!link) return new Response('invalid token', { status: 403, headers: CORS })
  const { data: version } = await db.from('video_versions').select('drive_file_id, mime_type, file_name').eq('id', link.video_version_id).maybeSingle()
  if (!version?.drive_file_id) return new Response('not found', { status: 404, headers: CORS })

  const gToken = await googleToken()
  const range = req.headers.get('range')
  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${version.drive_file_id}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${gToken}`, ...(range ? { Range: range } : {}) } }
  )

  const headers = new Headers(CORS)
  headers.set('Content-Type', version.mime_type || driveRes.headers.get('content-type') || 'video/mp4')
  headers.set('Accept-Ranges', 'bytes')
  const cr = driveRes.headers.get('content-range'); if (cr) headers.set('Content-Range', cr)
  const cl = driveRes.headers.get('content-length'); if (cl) headers.set('Content-Length', cl)
  headers.set('Cache-Control', 'private, max-age=3600')

  // Download direto (só se o link permitir): força "salvar como" com o nome real
  if (wantsDownload && link.allow_download) {
    const safe = (version.file_name || 'video').replace(/["\\\r\n]/g, '_')
    headers.set('Content-Disposition', `attachment; filename="${safe}"`)
  }

  return new Response(driveRes.body, { status: driveRes.status, headers })
})
