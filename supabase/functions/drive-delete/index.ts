// Excluir vídeo(s) — entrada autenticada. Repassa pro drive-watch (que tem o
// Service Account) para mandar o arquivo pra lixeira no Drive e apagar o registro.
// Deploy SEM --no-verify-jwt: só usuário logado chama.

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

  let ids: string[] = []
  try { const b = await req.json(); if (Array.isArray(b?.version_ids)) ids = b.version_ids } catch (_) {}
  if (!ids.length) return new Response(JSON.stringify({ error: 'version_ids obrigatório' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })

  const res = await fetch(DRIVE_WATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-drive-secret': WEBHOOK_SECRET },
    body: JSON.stringify({ action: 'delete', version_ids: ids }),
  })
  const body = await res.text()
  return new Response(body, { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
})
