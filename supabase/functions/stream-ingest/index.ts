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
//   { action: 'lote', limite }              manda as que ainda não foram (as com erro
//                                            só entram com incluirErros: true)
//   { action: 'conferir' }                  atualiza o status do que está processando
//   { action: 'situacao' }                  quanto já migrou
//   { action: 'auto', version_id }          o gatilho do banco chama isto sozinho
//                                            a cada vídeo novo (trg_enviar_pro_stream,
//                                            migration 2026093341). Sem sessão de
//                                            ninguém: autenticado pelo mesmo segredo do
//                                            Drive (x-drive-secret), não por JWT de admin.
//
// Deploy: COM --no-verify-jwt (o gatilho do banco não carrega sessão de ninguém,
// então o próprio portão do Supabase não pode exigir JWT antes de chegar aqui).
// Quem protege cada ação é o código: 'auto' exige o segredo; todas as outras
// continuam exigindo admin, como sempre.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
const CF_ACCOUNT = Deno.env.get('CLOUDFLARE_ACCOUNT_ID') ?? ''
const CF_TOKEN = Deno.env.get('CLOUDFLARE_STREAM_TOKEN') ?? ''
const PULL_SECRET = Deno.env.get('DRIVE_WEBHOOK_SECRET') ?? ''
const PULL_BASE_URL = Deno.env.get('PULL_BASE_URL') ?? ''

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
  // Com PULL_BASE_URL configurado (URL do worker no Cloud Run, sem barra no
  // final), o Stream busca o vídeo lá: os bytes não passam pelo Supabase e não
  // contam na cota de egress dele. Sem a variável, segue o caminho antigo pela
  // review-stream, que funciona mas gasta a cota.
  const base = PULL_BASE_URL ? `${PULL_BASE_URL.replace(/\/+$/, '')}/pull` : `${SUPABASE_URL}/functions/v1/review-stream`
  return `${base}?v=${versionId}&exp=${exp}&sig=${sig}`
}

// Só admin ativo mexe nisso: é o que gasta a conta do Stream. A função roda sem a
// verificação automática de JWT (por causa da ação 'auto'), então o token é
// conferido AQUI, no servidor de autenticação. Antes o payload era só decodificado,
// sem checar a assinatura: um token forjado com o sub de um admin passava.
async function ehAdmin(req: Request): Promise<boolean> {
  try {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return false
    const { data: { user }, error } = await db.auth.getUser(jwt)
    if (error || !user) return false
    const { data } = await db.from('app_users').select('role, status').eq('auth_user_id', user.id).maybeSingle()
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

// O Stream recusa rajada de pedidos ("Please wait and consider throttling your
// request speed"). Subir vários vídeos de uma vez (um pacote de campanha) fazia os
// últimos caírem em 'erro' — e erro não é reenviado sozinho, então eles ficavam
// tocando pelo caminho antigo, que gasta a cota de egress do Supabase.
const ehLimite = (status: number, msg: string) => status === 429 || /throttl|too many|rate limit/i.test(msg)
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms))

// Pergunta ao Stream como está UMA cópia e grava o resultado. É o mesmo trabalho
// da ação 'conferir'; fica aqui para os dois usarem a mesma regra.
async function conferirUma(v: { id: string; stream_uid: string }): Promise<'pronto' | 'erro' | 'andando'> {
  const r = await cf(`/${v.stream_uid}`)
  if (r.corpo?.result?.readyToStream) {
    // O endereço do manifesto vem do próprio Cloudflare: é ele que carrega
    // o código da conta, e não dá pra montar na mão sem chutar.
    await gravar(v.id, { stream_status: 'pronto', stream_hls: r.corpo?.result?.playback?.hls ?? null })
    return 'pronto'
  }
  if (r.corpo?.result?.status?.state === 'error') {
    const erro = String(r.corpo?.result?.status?.errorReasonText || 'erro no processamento').slice(0, 300)
    await db.from('video_versions').update({ stream_status: 'erro', stream_error: erro }).eq('id', v.id)
    return 'erro'
  }
  return 'andando'
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
    return { id: v.id, ok: false, erro, limite: ehLimite(r.status, erro) }
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

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

// Depois de responder ao gatilho do banco, a função continua trabalhando por uns
// minutos, sem ninguém esperando:
//  · se o Stream recusou por excesso de pedidos, tenta de novo com intervalos
//    crescentes;
//  · se a cópia foi aceita, confere de tempos em tempos e marca 'pronto' assim
//    que ficar pronta. Antes isso só acontecia quando um admin abria a tela de
//    migração — até lá o vídeo tocava pelo caminho antigo, mesmo já estando no
//    Stream.
// O que passar de ~5 minutos fica para a conferência da tela de migração.
async function acompanhar(v: { id: string; file_name: string | null }, primeira: Record<string, unknown>) {
  try {
    let atual = primeira
    for (const espera of [15_000, 40_000, 80_000]) {
      if (atual.ok || !atual.limite) break
      await dormir(espera)
      atual = await enviarUma(v)
    }
    const uid = atual.ok ? String(atual.uid || '') : ''
    if (!uid) return
    for (let i = 0; i < 10; i++) {
      await dormir(20_000)
      if (await conferirUma({ id: v.id, stream_uid: uid }) !== 'andando') return
    }
  } catch (err) {
    console.error('acompanhar falhou', v.id, err)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!CF_ACCOUNT || !CF_TOKEN) return json({ error: 'faltam CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_STREAM_TOKEN' }, 500)

  let corpo: any = {}
  try { corpo = (await req.json()) ?? {} } catch (_) {}
  const acao = corpo.action ?? 'situacao'

  // Porta separada pro gatilho do banco: manda UM vídeo, sem sessão de
  // ninguém, autenticada só pelo segredo que o Drive já usa. Fica antes do
  // portão de admin de propósito — esta é a única ação que não passa por ele,
  // e ela não faz mais nada além de enviar a versão pedida.
  if (acao === 'auto') {
    if (!PULL_SECRET || req.headers.get('x-drive-secret') !== PULL_SECRET) {
      return json({ error: 'unauthorized' }, 401)
    }
    if (!corpo.version_id) return json({ error: 'falta version_id' }, 400)
    try {
      const { data: v } = await db.from('video_versions').select('id, file_name').eq('id', corpo.version_id).maybeSingle()
      if (!v) return json({ error: 'versão não encontrada' }, 404)
      const resultado = await enviarUma(v)
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(acompanhar(v, resultado))
      return json(resultado)
    } catch (err: any) {
      return json({ error: String(err?.message || err).slice(0, 300) }, 500)
    }
  }

  if (!await ehAdmin(req)) return json({ error: 'só admin' }, 403)

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
      // Os que deram erro ficam de fora, a não ser que se peça de propósito
      // (incluirErros). Cada tentativa faz o Stream puxar o arquivo INTEIRO pela
      // review-stream, o que sai da cota de egress do Supabase; e como o "Migrar
      // acervo" repete o lote até acabar, um vídeo com erro era puxado de novo a
      // cada rodada — com arquivo de ~1,5 GB, isso pesa. Resolva o erro (veja
      // stream_error) e então reenvie por 'enviar' ou com incluirErros: true.
      // Exceção: erro por excesso de pedidos (throttling) não é defeito do vídeo, é
      // do ritmo do envio — esses entram sempre.
      const filtroStatus = corpo.incluirErros === true
        ? 'stream_status.is.null,stream_status.eq.erro'
        : 'stream_status.is.null,and(stream_status.eq.erro,stream_error.ilike.*throttl*)'
      const { data: pendentes } = await db.from('video_versions')
        .select('id, file_name')
        .is('stream_uid', null)
        .or(filtroStatus)
        .order('created_at', { ascending: false })
        .limit(limite)
      const feitos = []
      for (const v of pendentes || []) {
        const r = await enviarUma(v)
        feitos.push(r)
        // Bateu no limite do Stream: insistir só piora. Para aqui; a próxima
        // rodada continua de onde parou.
        if (!r.ok && r.limite) break
        await dormir(1_500)
      }
      const { count } = await db.from('video_versions')
        .select('id', { count: 'exact', head: true }).is('stream_uid', null)
      return json({ enviados: feitos.filter(f => f.ok).length, falhas: feitos.filter(f => !f.ok), aindaFaltam: count ?? null })
    }

    if (acao === 'conferir') {
      const { data: emAndamento } = await db.from('video_versions')
        .select('id, stream_uid').eq('stream_status', 'processando').not('stream_uid', 'is', null).limit(50)

      // Vídeos que ficaram prontos ANTES de a gente passar a guardar o endereço
      // do manifesto. Sem ele o player não tem pra onde apontar, então busca o
      // que falta aqui mesmo, na mesma varredura.
      const { data: semManifesto } = await db.from('video_versions')
        .select('id, stream_uid').eq('stream_status', 'pronto')
        .is('stream_hls', null).not('stream_uid', 'is', null).limit(50)
      let manifestosRecuperados = 0
      for (const v of semManifesto || []) {
        const r = await cf(`/${v.stream_uid}`)
        const hls = r.corpo?.result?.playback?.hls
        if (hls) { await gravar(v.id, { stream_hls: hls }); manifestosRecuperados++ }
      }

      let prontos = 0, comErro = 0
      for (const v of emAndamento || []) {
        const res = await conferirUma({ id: v.id, stream_uid: v.stream_uid as string })
        if (res === 'pronto') prontos++
        else if (res === 'erro') comErro++
      }
      return json({ conferidos: (emAndamento || []).length, viraramPronto: prontos, comErro, manifestosRecuperados })
    }

    // situacao
    const conta = async (filtro: (q: any) => any) => {
      const { count } = await filtro(db.from('video_versions').select('id', { count: 'exact', head: true }))
      return count ?? 0
    }
    return json({
      total: await conta((q: any) => q),
      prontos: await conta((q: any) => q.eq('stream_status', 'pronto')),
      // Pronto mas sem manifesto ainda cai no caminho antigo, então conta como
      // trabalho pendente — senão a barra diz 100% com gente esperando vídeo.
      prontosSemManifesto: await conta((q: any) => q.eq('stream_status', 'pronto').is('stream_hls', null)),
      processando: await conta((q: any) => q.eq('stream_status', 'processando')),
      comErro: await conta((q: any) => q.eq('stream_status', 'erro')),
      naoEnviados: await conta((q: any) => q.is('stream_uid', null)),
    })
  } catch (err: any) {
    return json({ error: String(err?.message || err).slice(0, 300) }, 500)
  }
})
