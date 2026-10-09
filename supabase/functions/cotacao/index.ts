// supabase/functions/cotacao/index.ts
//
// Cotação do dólar para as propostas em US$: PTAX de COMPRA do Banco Central
// (a Lumos vende os dólares ao banco). Guarda um registro por dia em
// cotacoes_dia; se o Banco Central estiver fora do ar, devolve a última guardada
// (do_cache: true). Chamada autenticada pelo app (JWT); qualquer funcionário
// ATIVO pode chamar.
//
// Deploy: supabase functions deploy cotacao   (com verificação de JWT, o padrão)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { escolherCotacao, urlPtax, type CotacaoPtax } from "./ptax.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // 1. Autoriza: qualquer funcionário ativo.
    try {
      const authHeader = req.headers.get('Authorization') ?? ''
      if (!authHeader) return json({ error: 'Não autenticado.' }, 401)
      const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
      const { data: { user: caller } } = await callerClient.auth.getUser()
      if (!caller) return json({ error: 'Sessão inválida.' }, 401)
      const { data: callerProfile } = await callerClient
        .from('app_users').select('id, status').eq('auth_user_id', caller.id).single()
      if (!callerProfile || callerProfile.status !== 'ativo') {
        return json({ error: 'Usuário inativo.' }, 403)
      }
    } catch (authErr) {
      console.error('cotacao: erro de autenticação', authErr)
      return json({ error: 'Sessão inválida.' }, 401)
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // 2. Banco Central (com limite de tempo).
    let cot: CotacaoPtax | null = null
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      try {
        const r = await fetch(urlPtax(new Date()), { signal: ctrl.signal })
        if (r.ok) cot = escolherCotacao(await r.json())
        else console.error('cotacao: Banco Central respondeu', r.status)
      } finally {
        clearTimeout(timer)
      }
    } catch (e) {
      console.error('cotacao: falha ao consultar o Banco Central', e)
    }

    if (cot) {
      // Guardar é só cache: se falhar, a cotação fresca ainda é devolvida.
      try {
        const { error: upErr } = await db.from('cotacoes_dia').upsert(
          { data: cot.data, compra: cot.compra, venda: cot.venda, fonte: 'ptax', buscado_em: new Date().toISOString() },
          { onConflict: 'data' },
        )
        if (upErr) console.error('cotacao: não consegui guardar a cotação do dia', upErr)
      } catch (e) {
        console.error('cotacao: não consegui guardar a cotação do dia', e)
      }
      return json({ data: cot.data, compra: cot.compra, venda: cot.venda, fonte: 'ptax', do_cache: false })
    }

    // 3. Plano B: a última cotação guardada.
    const { data: ultima } = await db.from('cotacoes_dia')
      .select('data, compra, venda, fonte').order('data', { ascending: false }).limit(1).maybeSingle()
    if (ultima) {
      return json({ data: ultima.data, compra: Number(ultima.compra), venda: Number(ultima.venda), fonte: ultima.fonte, do_cache: true })
    }
    return json({ error: 'Não foi possível obter a cotação agora.' }, 502)
  } catch (err) {
    console.error('cotacao: erro inesperado', err)
    return json({ error: 'Erro interno.' }, 500)
  }
})
