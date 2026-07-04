import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const timeMin = url.searchParams.get('timeMin') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // 30 dias atrás
    const timeMax = url.searchParams.get('timeMax') || new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() // 60 dias à frente

    // 1. Inicializa o cliente do Supabase com service_role para ler a tabela de tokens
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    // 2. Busca as credenciais de autenticação salvas
    const { data: authRecord, error: authError } = await supabaseClient
      .from('google_calendar_auth')
      .select('*')
      .maybeSingle()

    if (authError) throw authError

    if (!authRecord) {
      return new Response(
        JSON.stringify({ error: 'Integração Google Calendar não configurada. Faça login com o OAuth primeiro.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID')

    if (!clientId || !clientSecret || !calendarId) {
      throw new Error('Chaves de ambiente GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou GOOGLE_CALENDAR_ID ausentes')
    }

    let activeAccessToken = authRecord.access_token
    let isExpired = true

    if (authRecord.expires_at) {
      // Considera expirado se faltar menos de 2 minutos para expirar
      const now = new Date()
      const expiry = new Date(authRecord.expires_at)
      isExpired = now.getTime() >= (expiry.getTime() - 120 * 1000)
    }

    // 3. Se expirou, solicita um novo access_token usando o refresh_token
    if (isExpired || !activeAccessToken) {
      console.log('Access token expirado ou nulo. Solicitando refresh ao Google...')
      
      const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: authRecord.refresh_token,
          grant_type: 'refresh_token',
        }),
      })

      if (!refreshResponse.ok) {
        const errText = await refreshResponse.text()
        throw new Error(`Falha ao renovar token de acesso do Google: ${errText}`)
      }

      const refreshData = await refreshResponse.json()
      activeAccessToken = refreshData.access_token

      // Atualiza o token ativo e a nova data de expiração no banco
      const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
      const { error: updateError } = await supabaseClient
        .from('google_calendar_auth')
        .update({
          access_token: activeAccessToken,
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', authRecord.id)

      if (updateError) throw updateError
      console.log('Token de acesso atualizado com sucesso no banco.')
    }

    // 4. Consulta a API do Google Calendar para buscar os eventos
    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
      `timeMin=${encodeURIComponent(timeMin)}` +
      `&timeMax=${encodeURIComponent(timeMax)}` +
      `&singleEvents=true` +
      `&orderBy=startTime`

    const eventsResponse = await fetch(calendarUrl, {
      headers: {
        Authorization: `Bearer ${activeAccessToken}`,
      },
    })

    if (!eventsResponse.ok) {
      const errText = await eventsResponse.text()
      throw new Error(`Erro na chamada da API do Google Calendar: ${errText}`)
    }

    const eventsData = await eventsResponse.json()
    const googleEvents = eventsData.items || []

    // 5. Formata os eventos para um JSON limpo e estruturado para o frontend
    const formattedEvents = googleEvents.map((item: any) => ({
      id: item.id,
      title: item.summary || 'Sem título',
      description: item.description || '',
      start: item.start?.dateTime || item.start?.date || '',
      end: item.end?.dateTime || item.end?.date || '',
      allDay: !item.start?.dateTime, // Se não tiver dateTime, é evento de dia inteiro
      color: item.colorId || null,
      htmlLink: item.htmlLink || '',
    }))

    return new Response(
      JSON.stringify({ events: formattedEvents }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
