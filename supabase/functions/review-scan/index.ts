// "Verificar agora" — entrada autenticada p/ o app disparar um scan imediato
// do dropzone de um projeto. Deploy SEM --no-verify-jwt: o gateway do Supabase
// já exige um usuário logado (o segredo do drive-watch fica só no servidor).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const DRIVE_WATCH_URL = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/drive-watch`
const WEBHOOK_SECRET = Deno.env.get('DRIVE_WEBHOOK_SECRET') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let projectId: string | null = null
  try { projectId = (await req.json())?.project_id ?? null } catch (_) {}

  const res = await fetch(DRIVE_WATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-drive-secret': WEBHOOK_SECRET },
    body: JSON.stringify({ action: 'scan', project_id: projectId }),
  })
  const body = await res.text()
  return new Response(body, { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
})
