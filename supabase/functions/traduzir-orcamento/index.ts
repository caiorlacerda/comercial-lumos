// supabase/functions/traduzir-orcamento/index.ts
//
// Traduz os textos de um orçamento (português do Brasil → inglês americano) com Claude,
// para o PDF da proposta em inglês. O app guarda o resultado depois que a pessoa REVISA;
// o PDF nunca chama esta função. Chamada autenticada (JWT); qualquer funcionário ATIVO
// pode chamar. Usa a mesma ANTHROPIC_API_KEY do extract-receipt.
//
// Diferente do extract-receipt, falha de verdade: erro da IA, resposta incompleta ou
// pedido inválido voltam como { error } com status 4xx/5xx — o app mostra a mensagem,
// em vez de "vazio com 200" (que mascararia uma tradução que não aconteceu).
//
// Deploy: supabase functions deploy traduzir-orcamento   (com verificação de JWT, o padrão)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { FERRAMENTA, MODELO, NOME_FERRAMENTA, SISTEMA, dividirEmLotes, lerResposta, validarPedido } from "./core.ts"

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
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

    // 1. Autoriza: qualquer funcionário ativo.
    try {
      const authHeader = req.headers.get('Authorization') ?? ''
      if (!authHeader) return json({ error: 'Não autenticado.' }, 401)
      const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
      const { data: { user: caller } } = await callerClient.auth.getUser()
      if (!caller) return json({ error: 'Sessão inválida.' }, 401)
      const { data: callerProfile } = await callerClient
        .from('app_users').select('id, status').eq('auth_user_id', caller.id).single()
      if (!callerProfile || callerProfile.status !== 'ativo') return json({ error: 'Usuário inativo.' }, 403)
    } catch (authErr) {
      console.error('traduzir-orcamento: erro de autenticação', authErr)
      return json({ error: 'Sessão inválida.' }, 401)
    }

    if (!ANTHROPIC_API_KEY) {
      console.error('traduzir-orcamento: ANTHROPIC_API_KEY ausente')
      return json({ error: 'Tradução indisponível no momento.' }, 502)
    }

    // 2. Valida o pedido.
    const corpo = await req.json().catch(() => null)
    const pedido = validarPedido(corpo)
    if (!pedido.ok) return json({ error: pedido.erro }, 400)

    // 3. Traduz em lotes, um de cada vez.
    const traducoes: Record<string, string> = {}
    for (const lote of dividirEmLotes(pedido.itens)) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 55000)
      let resp: Response
      try {
        resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: MODELO,
            max_tokens: 8192,
            system: SISTEMA,
            tools: [FERRAMENTA],
            tool_choice: { type: 'tool', name: NOME_FERRAMENTA },
            messages: [{ role: 'user', content: JSON.stringify({ itens: lote }) }],
          }),
        })
      } catch (e) {
        console.error('traduzir-orcamento: falha de rede com a Anthropic', e)
        return json({ error: 'Não consegui falar com o serviço de tradução. Tente de novo.' }, 502)
      } finally {
        clearTimeout(timer)
      }
      if (!resp.ok) {
        console.error('traduzir-orcamento: Anthropic respondeu', resp.status, (await resp.text().catch(() => '')).slice(0, 300))
        return json({ error: 'O serviço de tradução recusou o pedido. Tente de novo.' }, 502)
      }
      const lido = lerResposta(await resp.json().catch(() => null), lote.map((i) => i.id))
      if (!lido.ok) return json({ error: lido.erro }, 502)
      Object.assign(traducoes, lido.traducoes)
    }

    return json({ traducoes, modelo: MODELO })
  } catch (err) {
    console.error('traduzir-orcamento: erro inesperado', err)
    return json({ error: 'Erro interno.' }, 500)
  }
})
