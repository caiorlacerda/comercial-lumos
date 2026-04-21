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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // Verify if caller is admin
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Não autenticado')

    const { data: callerProfile } = await supabaseClient
      .from('app_users')
      .select('role')
      .eq('auth_user_id', user?.id)
      .single()

    if (callerProfile?.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Acesso negado: Apenas administradores podem listar usuários pendentes' }), 
        { status: 403, headers: corsHeaders }
      )
    }

    // 1. Get all auth users
    const { data: { users }, error: authError } = await supabaseClient.auth.admin.listUsers()
    if (authError) throw authError

    // 2. Get all app users IDs
    const { data: appUsers, error: dbError } = await supabaseClient
      .from('app_users')
      .select('auth_user_id')
    
    if (dbError) throw dbError

    const appUserIds = new Set(appUsers.map(u => u.auth_user_id))

    // 3. Filter pending users
    const pendingUsers = users.filter(u => !appUserIds.has(u.id))

    return new Response(
      JSON.stringify(pendingUsers),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
