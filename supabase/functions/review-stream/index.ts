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

// --- Cache da resolução token → arquivo ----------------------------------
// Tocar um vídeo dispara DEZENAS de requisições de trecho, e cada uma refazia
// as MESMAS três consultas ao banco antes de pedir o primeiro byte ao Drive.
// Era o grosso dos ~2s de espera que a equipe sentia como "buffer ruim".
// Guardamos o resultado por pouco tempo: 15s é curto o bastante para uma versão
// nova aparecer quase na hora e longo o bastante para sumir com o custo durante
// a reprodução.
type Resolvido = { fileId: string; origId: string; mime: string; fileName: string; allowDownload: boolean; useProxy: boolean }
const TTL_MS = 15_000
const cacheLink = new Map<string, { valor: Resolvido | null; exp: number }>()

async function resolverToken(token: string, wantsDownload: boolean): Promise<Resolvido | null> {
  const chave = `${token}|${wantsDownload ? 'dl' : 'st'}`
  const hit = cacheLink.get(chave)
  if (hit && hit.exp > Date.now()) return hit.valor

  const guardar = (valor: Resolvido | null) => {
    cacheLink.set(chave, { valor, exp: Date.now() + TTL_MS })
    if (cacheLink.size > 500) for (const [k, v] of cacheLink) { if (v.exp < Date.now()) cacheLink.delete(k) }
    return valor
  }

  const { data: link } = await db.from('review_links').select('video_version_id, group_id, allow_download').eq('token', token).eq('active', true).maybeSingle()
  if (!link) return guardar(null)

  // O link segue o GRUPO: resolve sempre a versão mais recente (maior versão).
  // Uma consulta só resolve os dois casos — antes eram duas.
  let version: any = null
  if (link.group_id) {
    const { data } = await db.from('video_versions')
      .select('drive_file_id, mime_type, file_name, proxy_file_id, transcode_status')
      .eq('group_id', link.group_id).order('versao', { ascending: false }).limit(1).maybeSingle()
    version = data
  }
  if (!version) {
    const { data } = await db.from('video_versions')
      .select('drive_file_id, mime_type, file_name, proxy_file_id, transcode_status')
      .eq('id', link.video_version_id).maybeSingle()
    version = data
  }
  if (!version?.drive_file_id) return guardar(null)

  // Se há um proxy MP4 pronto (transcode do ProRes/.mov), reproduz ele. O
  // download continua entregando o arquivo original.
  const useProxy = !!version.proxy_file_id && version.transcode_status === 'ready' && !wantsDownload
  return guardar({
    fileId: useProxy ? version.proxy_file_id : version.drive_file_id,
    origId: version.drive_file_id,
    mime: version.mime_type || '',
    fileName: version.file_name || '',
    allowDownload: !!link.allow_download,
    useProxy,
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const token = url.searchParams.get('token') ?? ''
  if (!token) return new Response('missing token', { status: 400, headers: CORS })

  const wantsDownload = url.searchParams.get('download') === '1'

  const t0 = Date.now()
  const alvo = await resolverToken(token, wantsDownload)
  const msResolver = Date.now() - t0
  if (!alvo) return new Response('invalid token', { status: 403, headers: CORS })

  const version = { mime_type: alvo.mime, file_name: alvo.fileName }
  const link = { allow_download: alvo.allowDownload }
  const useProxy = alvo.useProxy
  const fileId = alvo.fileId

  const t1 = Date.now()
  const gToken = await googleToken()
  const msToken = Date.now() - t1
  const t2 = Date.now()
  const range = req.headers.get('range')
  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${gToken}`, ...(range ? { Range: range } : {}) } }
  )

  const headers = new Headers(CORS)
  const rawType = version.mime_type || driveRes.headers.get('content-type') || 'video/mp4'
  // Proxy já é MP4. Para o original .mov/quicktime, servir como video/mp4 ajuda
  // o Chrome a tocar os que são H.264 (container compatível). No download,
  // mantém o tipo real.
  const isMov = /quicktime/i.test(rawType) || /\.mov$/i.test(version.file_name || '')
  headers.set('Content-Type', useProxy ? 'video/mp4' : ((isMov && !wantsDownload) ? 'video/mp4' : rawType))
  headers.set('Accept-Ranges', 'bytes')
  const cr = driveRes.headers.get('content-range'); if (cr) headers.set('Content-Range', cr)
  const cl = driveRes.headers.get('content-length'); if (cl) headers.set('Content-Length', cl)
  headers.set('Cache-Control', 'private, max-age=3600')
  // Deixa o custo de cada etapa visível no DevTools (aba Network → Timing) e
  // medível de fora, pra ninguém precisar adivinhar de novo onde o tempo foi.
  headers.set('Server-Timing', `resolver;dur=${msResolver}, gtoken;dur=${msToken}, drive;dur=${Date.now() - t2}`)
  headers.set('Access-Control-Expose-Headers', 'content-range, accept-ranges, content-length, server-timing')

  // Download direto (só se o link permitir): força "salvar como" com o nome real
  if (wantsDownload && link.allow_download) {
    const safe = (version.file_name || 'video').replace(/["\\\r\n]/g, '_')
    headers.set('Content-Disposition', `attachment; filename="${safe}"`)
  }

  return new Response(driveRes.body, { status: driveRes.status, headers })
})
