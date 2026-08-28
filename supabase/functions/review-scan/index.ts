// "Verificar agora" — entrada autenticada p/ o app disparar um scan imediato
// do dropzone de um projeto. Deploy SEM --no-verify-jwt: o gateway do Supabase
// já exige um usuário logado (o segredo do drive-watch fica só no servidor).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const DRIVE_WATCH_URL = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/drive-watch`
const WEBHOOK_SECRET = Deno.env.get('DRIVE_WEBHOOK_SECRET') ?? ''
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

// Quem está pedindo? O gateway já garante que há login; aqui olhamos o papel,
// porque a faxina de duplicados mexe em arquivo e não é pra qualquer um.
async function ehAdmin(req: Request): Promise<boolean> {
  try {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    let p = jwt.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? ''
    while (p.length % 4) p += '='
    const sub = JSON.parse(atob(p))?.sub
    if (!sub) return false
    const { data } = await db.from('app_users').select('role, status').eq('auth_user_id', sub).maybeSingle()
    return data?.status === 'ativo' && data?.role === 'admin'
  } catch (_) { return false }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let corpo: any = {}
  try { corpo = (await req.json()) ?? {} } catch (_) {}
  const projectId = corpo?.project_id ?? null

  // Faxina das cópias duplicadas: só admin, e por padrão em modo ensaio.
  let repasse: Record<string, unknown> = { action: 'scan', project_id: projectId }
  if (corpo?.action === 'dedupe') {
    if (!(await ehAdmin(req))) {
      return new Response(JSON.stringify({ error: 'só admin' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    repasse = { action: 'dedupe', dry_run: corpo.dry_run !== false }
  }

  const res = await fetch(DRIVE_WATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-drive-secret': WEBHOOK_SECRET },
    body: JSON.stringify(repasse),
  })
  const body = await res.text()
  return new Response(body, { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
})
