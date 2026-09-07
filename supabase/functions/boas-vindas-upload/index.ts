// Bem-vindo à Lumos: upload dos itens do checklist de onboarding (logo,
// brand book, guidelines). O item "acessos" não passa por aqui — não tem
// arquivo, é marcado pela RPC marcar_item_boas_vindas.
//
// POST /boas-vindas-upload, corpo multipart/form-data:
//   token (texto do portal), item_key ('logo'|'brand_book'|'guidelines'),
//   nome_pessoa (texto, opcional), arquivo (o arquivo).
//
// Autorização: o token do portal, verificado aqui dentro (client_portals) —
// não JWT do Supabase, porque a maioria dos clientes acessa sem login. Por
// isso o deploy é --no-verify-jwt (mesmo motivo do stream-ingest 'auto').
// Quando o portal tem exige_login = true, o token deixa de bastar: o header
// Authorization tem que trazer uma sessão válida de um client_users ativo
// daquele cliente, igual as RPCs do portal fazem com auth.jwt().
//
// Secrets: GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_SHARED_DRIVE_ID,
// DRIVE_CLIENTES_FOLDER_ID, DRIVE_TEMPLATES_FOLDER_ID — os mesmos que a
// drive-provision já usa.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DRIVE_ID = Deno.env.get('DRIVE_SHARED_DRIVE_ID') ?? ''
const CLIENTES_FOLDER_ID = Deno.env.get('DRIVE_CLIENTES_FOLDER_ID') ?? ''
const TEMPLATES_FOLDER_ID = Deno.env.get('DRIVE_TEMPLATES_FOLDER_ID') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Teto de tamanho: o endpoint uploadType=multipart do Google é documentado até
// ~5MB; acima disso falharia de qualquer jeito, e sem teto nada impede um
// arquivo gigante. O front checa o mesmo número antes de tentar enviar.
const MAX_BYTES = 25 * 1024 * 1024

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SYSTEM_FILES = new Set(['.DS_Store', 'desktop.ini', 'Thumbs.db'])

const SUBPASTA: Record<string, string> = {
  logo: 'LOGOS',
  brand_book: 'BRAND-BOOK',
  guidelines: 'GUIDELINES',
}

// --- Google auth (idêntico ao drive-provision, duplicado de propósito: cada
//     edge function neste projeto é autocontida, sem módulo compartilhado) ---
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
    iat: now, exp: now + 3600,
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

// Idêntica à da drive-provision (duplicada de propósito: cada edge function
// deste projeto é autocontida).
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
  const q = encodeURIComponent(`'${parentId}' in parents and trashed=false and mimeType='${FOLDER_MIME}' and name='${name.replace(/'/g, "\\'")}'`)
  const page = await driveFetch(`files?q=${q}&fields=files(id)&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}`)
  return page.files?.[0]?.id ?? null
}

async function createFolder(parentId: string, name: string): Promise<string> {
  const body = await driveFetch('files?fields=id', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  return body.id
}

async function ensureFolder(parentId: string, name: string): Promise<string> {
  return (await findChildFolder(parentId, name)) ?? (await createFolder(parentId, name))
}

async function folderAlive(folderId: string | null): Promise<boolean> {
  if (!folderId) return false
  try {
    const meta = await driveFetch(`files/${folderId}?fields=trashed`)
    return meta?.trashed !== true
  } catch (_) {
    return false
  }
}

// Espelha recursivamente um modelo: subpastas são criadas, arquivos são
// copiados (placeholders/modelos de doc), arquivos de sistema ignorados.
// Idêntica à da drive-provision — a estrutura da pasta do cliente tem que ficar
// igual independente de quem criou a pasta primeiro.
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

// Garante a pasta do cliente e devolve o id da subpasta _ASSETS dentro dela.
// Reusa clients.drive_folder_id se ainda existir (auto-cura se foi apagada,
// igual a drive-provision faz).
async function ensureClientAssetsFolder(client: { id: string; name: string; drive_folder_id: string | null }): Promise<string> {
  let clientFolderId = client.drive_folder_id
  let recemCriada = false
  if (!(await folderAlive(clientFolderId))) {
    const folderName = client.name.trim() || 'CLIENTE'
    clientFolderId = await ensureFolder(CLIENTES_FOLDER_ID, folderName)
    recemCriada = true
    await db.from('clients').update({ drive_folder_id: clientFolderId }).eq('id', client.id)
    await db.from('drive_sync_log').insert([{
      entity_type: 'client', entity_id: client.id, action: 'create_folder',
      detail: `Pasta do cliente "${folderName}" criada por boas-vindas-upload (${clientFolderId})`,
    }])
  }

  const clientAssetsId = await ensureFolder(clientFolderId!, '_ASSETS')

  // Pasta nova: monta a estrutura padrão do jeito que a drive-provision monta
  // (espelha _TEMPLATES/_ASSETS; sem template, cria as 5 subpastas na mão).
  // Sem isto, um cliente cujo primeiro contato com o Drive foi um upload de
  // boas-vindas nunca ganharia a estrutura — o folderAlive() curto-circuita
  // todas as vezes seguintes.
  if (recemCriada) {
    const clienteTemplateId = TEMPLATES_FOLDER_ID
      ? await findChildFolder(TEMPLATES_FOLDER_ID, '_ASSETS')
      : null
    if (clienteTemplateId) {
      await mirrorTemplate(clienteTemplateId, clientAssetsId)
    } else {
      for (const sub of ['BRAND-BOOK', 'FONTES', 'GRAFICOS', 'IMAGENS', 'LOGOS']) {
        await ensureFolder(clientAssetsId, sub)
      }
    }
  }

  // GUIDELINES não vem do template da organização, mas o checklist precisa
  // dela — garantida sempre, pasta nova ou antiga.
  await ensureFolder(clientAssetsId, 'GUIDELINES')

  return clientAssetsId
}

async function uploadFile(parentId: string, name: string, mimeType: string, bytes: Uint8Array): Promise<string> {
  const boundary = 'boasvindas' + crypto.randomUUID().replace(/-/g, '')
  const metadata = JSON.stringify({ name, parents: [parentId] })
  const parts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`,
  ]
  const tail = `\r\n--${boundary}--`
  const body = new Blob([parts[0], parts[1], bytes, tail])
  const token = await googleAccessToken()
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  const data = await res.json().catch(() => ({}))
  if (!data.id) throw new Error(`upload falhou: ${JSON.stringify(data).slice(0, 200)}`)
  return data.id
}

async function notificarTime(clientId: string, clientName: string, itemLabel: string) {
  const { data: portal } = await db.from('client_portals')
    .select('contact_user_ids').eq('client_id', clientId).eq('active', true).maybeSingle()
  const { data: admins } = await db.from('app_users')
    .select('id').eq('status', 'ativo').in('role', ['admin', 'atendimento'])
  const ids = new Set<string>([...(admins ?? []).map(a => a.id), ...(portal?.contact_user_ids ?? [])])
  if (!ids.size) return
  await db.from('notifications').insert([...ids].map(user_id => ({
    user_id,
    event_type: 'boas_vindas_item_enviado',
    category: 'producao',
    priority: 'normal',
    title: 'Bem-vindo à Lumos: novo material recebido',
    body: `${clientName} enviou ${itemLabel}.`,
    scope: 'team',
  })))
}

const ITEM_LABEL: Record<string, string> = {
  logo: 'o logo',
  brand_book: 'o brand book',
  guidelines: 'as guidelines de conteúdo',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405)

  let form: FormData
  try {
    form = await req.formData()
  } catch (_) {
    return json({ error: 'corpo precisa ser multipart/form-data' }, 400)
  }

  const token = String(form.get('token') || '')
  const itemKey = String(form.get('item_key') || '')
  const nomePessoa = String(form.get('nome_pessoa') || '')
  const arquivo = form.get('arquivo')

  if (!token || !itemKey) return json({ error: 'token e item_key obrigatórios' }, 400)
  if (!SUBPASTA[itemKey]) return json({ error: 'item_key inválido' }, 400)
  if (!(arquivo instanceof File)) return json({ error: 'arquivo obrigatório' }, 400)
  if (arquivo.size > MAX_BYTES) return json({ error: 'arquivo muito grande, o limite é 25MB' }, 413)

  const { data: portal } = await db.from('client_portals')
    .select('client_id, exige_login').eq('token', token).eq('active', true).maybeSingle()
  if (!portal) return json({ error: 'token inválido' }, 401)

  const { data: client } = await db.from('clients')
    .select('id, name, drive_folder_id').eq('id', portal.client_id).maybeSingle()
  if (!client) return json({ error: 'token inválido' }, 401)

  // Porta: com login ligado, o token do portal sozinho não envia mais nada.
  // Aqui não dá pra usar auth.jwt() (não é Postgres), então a sessão é
  // validada de verdade contra o Auth pelo cliente service_role.
  let assinatura = nomePessoa || null
  if (portal.exige_login) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ error: 'precisa_login' }, 401)
    const { data: userData, error: authErr } = await db.auth.getUser(jwt)
    const email = userData?.user?.email
    if (authErr || !email) return json({ error: 'sem_acesso' }, 401)
    // Comparação case-insensitive feita aqui, e não com .ilike(): em ilike o
    // "_" é curinga, e e-mail com underline é comum — casaria com quem não é.
    const alvo = email.toLowerCase()
    const { data: pessoas } = await db.from('client_users')
      .select('nome, email').eq('client_id', client.id).eq('ativo', true)
    const pessoa = (pessoas ?? []).find(p => (p.email || '').toLowerCase() === alvo)
    if (!pessoa) return json({ error: 'sem_acesso' }, 401)
    // Com sessão, quem assina é a sessão, não o texto que o navegador mandou.
    assinatura = pessoa.nome || alvo.split('@')[0]
  }

  try {
    const assetsId = await ensureClientAssetsFolder(client)
    const subfolderId = await ensureFolder(assetsId, SUBPASTA[itemKey])
    const bytes = new Uint8Array(await arquivo.arrayBuffer())
    const fileId = await uploadFile(subfolderId, arquivo.name, arquivo.type, bytes)

    const { error: upsertError } = await db.from('client_boas_vindas_itens').upsert({
      client_id: client.id,
      item_key: itemKey,
      tipo: 'arquivo',
      drive_file_id: fileId,
      nome_arquivo: arquivo.name,
      concluido_por: assinatura,
      concluido_em: new Date().toISOString(),
    }, { onConflict: 'client_id,item_key' })
    if (upsertError) throw upsertError

    // Notificação nunca deve transformar um upload que já deu certo em erro
    // pro cliente — mesmo princípio do resto do projeto (pg_net triggers só
    // avisam warning). Isolado do try/catch principal de propósito.
    try {
      await notificarTime(client.id, client.name, ITEM_LABEL[itemKey])
    } catch (notifyErr) {
      console.error('boas-vindas-upload: notificação falhou (upload já concluído):', notifyErr)
    }

    return json({ ok: true, drive_file_id: fileId, nome_arquivo: arquivo.name })
  } catch (err) {
    try {
      await db.from('drive_sync_log').insert([{
        entity_type: 'client', entity_id: client.id, action: 'error',
        detail: String((err as Error)?.message || err).slice(0, 900), status: 'error',
      }])
    } catch (_) { /* log nunca derruba o fluxo */ }
    return json({ error: 'falha ao enviar, tenta de novo' }, 500)
  }
})
