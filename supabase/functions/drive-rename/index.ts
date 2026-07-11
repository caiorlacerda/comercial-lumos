// Renomear vídeo — entrada autenticada p/ o app renomear o arquivo no Drive
// (e espelhar no banco). Deploy SEM --no-verify-jwt: só usuário logado chama;
// o segredo do drive-watch fica no servidor.

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

  let version_id: string | null = null, new_name: string | null = null
  try { const b = await req.json(); version_id = b?.version_id ?? null; new_name = b?.new_name ?? null } catch (_) {}
  if (!version_id || !new_name) return new Response(JSON.stringify({ error: 'version_id e new_name obrigatórios' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })

  const res = await fetch(DRIVE_WATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-drive-secret': WEBHOOK_SECRET },
    body: JSON.stringify({ action: 'rename', version_id, new_name }),
  })
  const body = await res.text()
  return new Response(body, { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
})
