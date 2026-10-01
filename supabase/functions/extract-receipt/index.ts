// supabase/functions/extract-receipt/index.ts
//
// Lê um recibo/nota (imagem ou PDF) com Claude e devolve fornecedor, valor,
// data e uma categoria sugerida — pra pré-preencher o formulário de
// Reembolso. Chamada autenticada pelo próprio app (JWT de quem está
// logado); qualquer funcionário ATIVO pode chamar, não só admin.
//
// Nunca falha "feio": se a leitura não for possível (imagem ruim, não é bem
// um recibo, erro de rede com a Anthropic), devolve os quatro campos como
// null com status 200 — a tela trata isso como "preenche à mão".

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const VALID_CATEGORIES = [
  'equipe', 'equipamento', 'locacao', 'transporte', 'alimentacao',
  'hospedagem', 'marketing', 'software', 'impostos', 'servicos_terceiros',
  'manutencao', 'outro',
]

const EMPTY = { supplier: null, amount: null, expense_date: null, category: null }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

    // 1. Autoriza: qualquer funcionário ativo (não precisa ser admin).
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

    // 2. Corpo: arquivo em base64 + mime type.
    const { file_base64, mime_type } = await req.json().catch(() => ({}))
    if (!file_base64 || typeof file_base64 !== 'string') {
      return json({ error: 'Arquivo é obrigatório.' }, 400)
    }
    // ~15MB de arquivo original (base64 é ~33% maior).
    if (file_base64.length > 20_000_000) {
      return json({ error: 'Arquivo muito grande.' }, 400)
    }
    const mime = typeof mime_type === 'string' && mime_type ? mime_type : 'image/jpeg'

    if (!ANTHROPIC_API_KEY) {
      console.error('extract-receipt: ANTHROPIC_API_KEY não configurada')
      return json(EMPTY)
    }

    // 3. Pergunta pro Claude, com a resposta forçada em formato de
    //    ferramenta (tool_choice) — sem isso, o modelo às vezes embrulha o
    //    JSON em texto solto ou crase de markdown, e quebraria o parse.
    const isPdf = mime === 'application/pdf'
    const content = [
      isPdf
        ? { type: 'document', source: { type: 'base64', media_type: mime, data: file_base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mime, data: file_base64 } },
      { type: 'text', text: 'Extraia os dados deste recibo ou nota fiscal.' },
    ]

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: 'Você lê recibos e notas fiscais brasileiras (fotos, prints de ' +
          'app de delivery/transporte, PDFs) e extrai os dados do gasto. Se não ' +
          'conseguir identificar um campo com confiança, deixe ele de fora — ' +
          'nunca invente um valor.',
        messages: [{ role: 'user', content }],
        tools: [{
          name: 'registrar_dados_recibo',
          description: 'Registra os dados extraídos do recibo.',
          input_schema: {
            type: 'object',
            properties: {
              supplier: { type: 'string', description: 'Nome do estabelecimento/fornecedor, ex.: "Cabana Burger"' },
              amount: { type: 'number', description: 'Valor TOTAL pago, em reais, como número decimal (ex.: 55.9). Ponto, nunca vírgula.' },
              expense_date: { type: 'string', description: 'Data da compra/pedido, no formato YYYY-MM-DD.' },
              category: { type: 'string', enum: VALID_CATEGORIES, description: 'Categoria do gasto que melhor descreve este recibo.' },
            },
          },
        }],
        tool_choice: { type: 'tool', name: 'registrar_dados_recibo' },
      }),
    })

    if (!anthropicRes.ok) {
      console.error('extract-receipt: Anthropic respondeu', anthropicRes.status, await anthropicRes.text().catch(() => ''))
      return json(EMPTY)
    }
    const data = await anthropicRes.json()
    const toolUse = (data.content ?? []).find((b: any) => b?.type === 'tool_use')
    const input = toolUse?.input ?? {}

    return json({
      supplier: typeof input.supplier === 'string' && input.supplier.trim() ? input.supplier.trim() : null,
      amount: typeof input.amount === 'number' && isFinite(input.amount) ? input.amount : null,
      expense_date: typeof input.expense_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.expense_date) ? input.expense_date : null,
      category: VALID_CATEGORIES.includes(input.category) ? input.category : null,
    })
  } catch (err) {
    console.error('extract-receipt:', err)
    return json(EMPTY)
  }
})
