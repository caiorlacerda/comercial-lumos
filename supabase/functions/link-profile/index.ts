import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
function errMsg(e: any): string {
  if (!e) return 'Erro desconhecido'
  if (typeof e === 'string') return e
  return e.message || e.error_description || e.error || e.msg || e.hint || e.details || JSON.stringify(e, Object.getOwnPropertyNames(e))
}

// Self-heal do vínculo perfil ⇄ conta de auth.
//
// Toda a plataforma depende de app_users.auth_user_id == auth.uid(). Quando esses
// dois se descasam (conta pré-cadastrada por email, reconvite que gerou um novo
// auth id, link antigo, etc.), a pessoa loga mas não acha o próprio perfil e cai
// no "Acesso Pendente" — mesmo tendo cadastro.
//
// Como o email é UNIQUE em app_users e a sessão do Supabase garante que a pessoa
// é dona daquele email, dá pra religar com segurança: o usuário chama esta função
// com o próprio token, a gente acha o perfil pelo email e aponta o auth_user_id
// para o id atual. Só é possível reivindicar a linha que tem o SEU email.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // 1. Identifica o chamador pela própria sessão.
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'Não autenticado.' }, 401)
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'Sessão inválida.' }, 401)

    const email = (caller.email ?? '').trim().toLowerCase()
    if (!email) return json({ error: 'Sessão sem e-mail.' }, 400)

    // 2. Já vinculado a este auth id? Nada a fazer.
    const { data: byAuth } = await adminClient
      .from('app_users').select('*').eq('auth_user_id', caller.id).maybeSingle()
    if (byAuth) return json({ profile: byAuth, linked: false }, 200)

    // 3. Acha o perfil pelo e-mail (case-insensitive) e religa ao auth id atual.
    const { data: byEmail, error: emailErr } = await adminClient
      .from('app_users').select('*').ilike('email', email).maybeSingle()
    if (emailErr) return json({ error: errMsg(emailErr) }, 400)
    if (!byEmail) return json({ profile: null, linked: false }, 200)

    const { data: updated, error: updErr } = await adminClient
      .from('app_users')
      .update({ auth_user_id: caller.id })
      .eq('id', byEmail.id)
      .select('*')
      .single()
    if (updErr) return json({ error: errMsg(updErr) }, 400)

    return json({ profile: updated, linked: true }, 200)
  } catch (error: any) {
    return json({ error: errMsg(error) }, 400)
  }
})
