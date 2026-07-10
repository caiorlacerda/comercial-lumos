import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const errorParam = url.searchParams.get('error')

    if (errorParam) {
      throw new Error(`Google OAuth error: ${errorParam}`)
    }

    if (!code) {
      return new Response(
        JSON.stringify({ error: 'Código de autorização (code) ausente na URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não estão configuradas nas Secrets')
    }

    const redirectUri = 'https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/google-callback'

    // 1. Troca o código de autorização pelos tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text()
      throw new Error(`Falha ao obter tokens do Google: ${errBody}`)
    }

    const tokenData = await tokenResponse.json()

    if (!tokenData.refresh_token) {
      throw new Error(
        'Google não retornou refresh_token. Certifique-se de revogar o acesso do app no painel de segurança do Google (https://myaccount.google.com/connections) e tente novamente para forçar o consentimento.'
      )
    }

    // 2. Inicializa o cliente do Supabase usando a service_role para contornar RLS
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    // 3. Remove tokens de autorização antigos para evitar acúmulo de sujeira
    const { error: deleteError } = await supabaseClient
      .from('google_calendar_auth')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // Deleta todos

    if (deleteError) throw deleteError

    // 4. Insere o novo token
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    const { error: insertError } = await supabaseClient
      .from('google_calendar_auth')
      .insert({
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        expires_at: expiresAt,
      })

    if (insertError) throw insertError

    // Retorna uma página HTML amigável informando sucesso ao administrador
    const htmlSuccess = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Conexão Bem Sucedida!</title>
        <style>
          body {
            background-color: #0b0c10;
            color: #ffffff;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            background-color: #1f2833;
            padding: 2.5rem;
            border-radius: 12px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            text-align: center;
            max-width: 400px;
            border: 1px solid #c5a059;
          }
          h1 {
            color: #c5a059;
            margin-top: 0;
            font-size: 1.8rem;
          }
          p {
            color: #c5c6c7;
            font-size: 0.95rem;
            line-height: 1.6;
          }
          .btn {
            display: inline-block;
            margin-top: 1.5rem;
            padding: 0.6rem 1.5rem;
            background-color: #c5a059;
            color: #0b0c10;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
            transition: background-color 0.2s;
          }
          .btn:hover {
            background-color: #e5b869;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Conexão Realizada! 🎉</h1>
          <p>O Google Calendar compartilhado foi conectado com sucesso ao App Lumos. A sincronização de leitura e escrita em background já está ativa.</p>
          <a href="#" onclick="window.close();" class="btn">Fechar Janela</a>
        </div>
      </body>
      </html>
    `

    const responseHeaders = new Headers()
    Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v))
    responseHeaders.set('content-type', 'text/html; charset=utf-8')

    return new Response(htmlSuccess, {
      headers: responseHeaders,
      status: 200,
    })
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
