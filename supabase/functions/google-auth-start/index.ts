import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  if (!clientId) {
    return new Response(
      JSON.stringify({ error: 'GOOGLE_CLIENT_ID não está configurada nas Secrets' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const redirectUri = 'https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/google-callback'
  const scope = 'https://www.googleapis.com/auth/calendar'

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&access_type=offline` +
    `&prompt=consent`

  // Retorna um redirecionamento HTTP 302 para iniciar o fluxo OAuth diretamente no navegador
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      'Location': authUrl
    }
  })
})
