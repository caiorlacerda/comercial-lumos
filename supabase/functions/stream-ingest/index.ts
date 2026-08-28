// Envia a cópia de reprodução dos vídeos para o Cloudflare Stream.
//
// Por quê: hoje cada pedaço do vídeo passa pela review-stream, que acorda do
// zero a cada pedido (~1,8s de espera por requisição). O Stream recebe uma
// cópia, converte em várias qualidades e entrega por CDN, então o player passa
// a puxar de lá. O Drive continua sendo a fonte da verdade e o download.
//
// Como a cópia chega lá: o Stream busca o arquivo sozinho, por uma URL assinada
// e de curta validade da review-stream. Nada de bytes atravessando esta função,
// que é o que estouraria o tempo dela com arquivo grande.
//
// Ações (POST, JSON):
//   { action: 'testar' }                    confere as credenciais
//   { action: 'enviar', version_id }        manda uma versão
//   { action: 'lote', limite }              manda as que ainda não foram
//   { action: 'conferir' }                  atualiza o status do que está processando
//   { action: 'situacao' }                  quanto já migrou
//
// Deploy: SEM --no-verify-jwt (exige login). Quem chama é o app ou o drive-watch.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
const CF_ACCOUNT = Deno.env.get('CLOUDFLARE_ACCOUNT_ID') ?? ''
const CF_TOKEN = Deno.env.get('CLOUDFLARE_STREAM_TOKEN') ?? ''
const PULL_SECRET = Deno.env.get('DRIVE_WEBHOOK_SECRET') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CF_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/stream`
const cf = async (caminho: string, init: RequestInit = {}) => {
  const r = await fetch(`${CF_BASE}${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const corpo = await r.json().catch(() => ({}))
  return { ok: r.ok && corpo?.success !== false, status: r.status, corpo }
}

// A mesma assinatura que a review-stream confere do outro lado.
async function urlAssinada(versionId: string, minutos = 120): Promise<string> {
  const exp = String(Date.now() + minutos * 60_000)
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(PULL_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${versionId}.${exp}`))
  const sig = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${SUPABASE_URL}/functions/v1/review-stream?v=${versionId}&exp=${exp}&sig=${sig}`
}

// Só admin ativo mexe nisso: é o que gasta a conta do Stream.
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


// A coluna stream_hls é nova. Enquanto o ALTER não roda, gravar com ela faria o
// UPDATE INTEIRO falhar — e aí o vídeo iria pro Stream sem ficar registrado
// aqui, virando envio repetido. Então tenta com, e cai pra sem.
async function gravar(id: string, campos: Record<string, unknown>) {
  const r = await db.from('video_versions').update(campos).eq('id', id)
  if (!r.error) return
  if (!/stream_hls|column/i.test(String(r.error.message))) return
  const { stream_hls: _ignora, ...semHls } = campos as any
  await db.from('video_versions').update(semHls).eq('id', id)
}

async function enviarUma(v: { id: string; file_name: string | null }): Promise<Record<string, unknown>> {
  const url = await urlAssinada(v.id)
  const r = await cf('/copy', {
    method: 'POST',
    body: JSON.stringify({
      url,
      meta: { name: v.file_name || v.id, version_id: v.id },
      // Nada de expiração automática: o vídeo fica enquanto a gente quiser.
      requireSignedURLs: false,
    }),
  })
  if (!r.ok) {
    const erro = String(r.corpo?.errors?.[0]?.message || r.status).slice(0, 300)
    await db.from('video_versions').update({ stream_status: 'erro', stream_error: erro }).eq('id', v.id)
    return { id: v.id, ok: false, erro }
  }
  const uid = r.corpo?.result?.uid
  await gravar(v.id, {
    stream_uid: uid,
    stream_hls: r.corpo?.result?.playback?.hls ?? null,
    stream_status: 'processando',
    stream_error: null,
  })
  return { id: v.id, ok: true, uid }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!CF_ACCOUNT || !CF_TOKEN) return json({ error: 'faltam CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_STREAM_TOKEN' }, 500)
  if (!await ehAdmin(req)) return json({ error: 'só admin' }, 403)

  let corpo: any = {}
  try { corpo = (await req.json()) ?? {} } catch (_) {}
  const acao = corpo.action ?? 'situacao'

  try {
    if (acao === 'testar') {
      const r = await cf('?per_page=1')
      return json({
        credenciaisOk: r.ok,
        status: r.status,
        detalhe: r.ok ? 'conta acessível' : String(r.corpo?.errors?.[0]?.message || r.corpo).slice(0, 300),
        segredoDeBuscaConfigurado: !!PULL_SECRET,
      })
    }

    if (acao === 'enviar' && corpo.version_id) {
      const { data: v } = await db.from('video_versions').select('id, file_name').eq('id', corpo.version_id).maybeSingle()
      if (!v) return json({ error: 'versão não encontrada' }, 404)
      return json(await enviarUma(v))
    }

    if (acao === 'lote') {
      // Poucos por vez: o Stream busca cada arquivo pela nossa função, e não
      // adianta empilhar trabalho que a conta vai processar em fila mesmo.
      const limite = Math.min(Number(corpo.limite || 10), 25)
      const { data: pendentes } = await db.from('video_versions')
        .select('id, file_name')
        .is('stream_uid', null)
        .or('stream_status.is.null,stream_status.eq.erro')
        .order('created_at', { ascending: false })
        .limit(limite)
      const feitos = []
      for (const v of pendentes || []) feitos.push(await enviarUma(v))
      const { count } = await db.from('video_versions')
        .select('id', { count: 'exact', head: true }).is('stream_uid', null)
      return json({ enviados: feitos.filter(f => f.ok).length, falhas: feitos.filter(f => !f.ok), aindaFaltam: count ?? null })
    }

    if (acao === 'conferir') {
      const { data: emAndamento } = await db.from('video_versions')
        .select('id, stream_uid').eq('stream_status', 'processando').not('stream_uid', 'is', null).limit(50)
      let prontos = 0, comErro = 0
      for (const v of emAndamento || []) {
        const r = await cf(`/${v.stream_uid}`)
        const st = r.corpo?.result?.status?.state
        if (r.corpo?.result?.readyToStream) {
          // O endereço do manifesto vem do próprio Cloudflare: é ele que carrega
          // o código da conta, e não dá pra montar na mão sem chutar.
          await gravar(v.id, {
            stream_status: 'pronto',
            stream_hls: r.corpo?.result?.playback?.hls ?? null,
          }); prontos++
        } else if (st === 'error') {
          const erro = String(r.corpo?.result?.status?.errorReasonText || 'erro no processamento').slice(0, 300)
          await db.from('video_versions').update({ stream_status: 'erro', stream_error: erro }).eq('id', v.id); comErro++
        }
      }
      return json({ conferidos: (emAndamento || []).length, viraramPronto: prontos, comErro })
    }

    // situacao
    const conta = async (filtro: (q: any) => any) => {
      const { count } = await filtro(db.from('video_versions').select('id', { count: 'exact', head: true }))
      return count ?? 0
    }
    return json({
      total: await conta((q: any) => q),
      prontos: await conta((q: any) => q.eq('stream_status', 'pronto')),
      processando: await conta((q: any) => q.eq('stream_status', 'processando')),
      comErro: await conta((q: any) => q.eq('stream_status', 'erro')),
      naoEnviados: await conta((q: any) => q.is('stream_uid', null)),
    })
  } catch (err: any) {
    return json({ error: String(err?.message || err).slice(0, 300) }, 500)
  }
})
